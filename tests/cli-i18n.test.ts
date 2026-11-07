import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import jsYaml from "js-yaml";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
    I18N_GENERATED_FILES,
    I18N_TEMPLATE_VERSION,
    checkI18nTemplates,
    runInitI18n,
} from "../src/cli.ts";

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sveltia-i18n-"));
    tempDirs.push(dir);

    return dir;
}

// A realistic Sveltia CMS config: object-form locales, one translated collection
// (`blog`, with save_all_locales: false) and one that must be skipped (`authors`).
const SVELTIA_CONFIG = `export default {
  i18n: {
    structure: 'multiple_folders',
    default_locale: 'en',
    locales: [
      { locale: 'en', label: 'English' },
      { locale: 'fr', label: 'Français' },
      { locale: 'de', label: 'Deutsch' },
    ],
  },
  collections: [
    {
      name: 'blog',
      folder: 'blog',
      i18n: { save_all_locales: false, initial_locales: ['en'] },
    },
    {
      name: 'authors',
      folder: 'authors',
    },
  ],
};
`;

type YamlDoc = { on: { push: { paths: string[] } }; env: Record<string, string> };

describe("init:i18n — first run", () => {
    it("writes the three files and fills placeholders from the Sveltia config", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        const workflowPath = join(cwd, ".github", "workflows", "i18n-translate.yml");
        const glossaryPath = join(cwd, "i18n", "glossary.md");
        const remapPath = join(cwd, "scripts", "remap-translations.sh");
        expect(existsSync(workflowPath)).toBe(true);
        expect(existsSync(glossaryPath)).toBe(true);
        expect(existsSync(remapPath)).toBe(true);

        const workflow = readFileSync(workflowPath, "utf-8");

        // No placeholder remains unreplaced.
        expect(workflow).not.toMatch(/__[A-Z0-9_]+__/);

        // Parses as valid YAML.
        const doc = jsYaml.load(workflow) as YamlDoc;
        expect(doc).toBeTypeOf("object");

        // Language list matches the config minus the default locale.
        expect(doc.env.TARGET_LANGS).toBe("de,fr");

        // Content root and config file default as expected.
        expect(doc.env.CONTENT_ROOT).toBe("src/content");
        expect(doc.env.CONFIG_FILE).toBe("sveltia-cms.config.mjs");

        // 0.4.0: one wildcard covers every collection; the per-file flag decides.
        expect(doc.on.push.paths).toEqual(["src/content/**/en/**"]);
        expect(doc.env.SKIP_COLLECTIONS).toBeUndefined();
        expect(doc.env.OVERWRITE_MODE).toBe("all");

        // Glossary placeholder was replaced.
        const glossary = readFileSync(glossaryPath, "utf-8");
        expect(glossary).not.toContain("__PROJECT_NAME__");
    });

    it("injects GenAIScript-compatible credential env into the translate step", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        type Step = { name?: string; env?: Record<string, string> };
        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as {
            jobs: { translate: { steps: Step[] } };
        };
        const translateStep = doc.jobs.translate.steps.find((step) =>
            step.name?.startsWith("Translate chunk"),
        );

        // 0.4.1: with-inputs become INPUT_* vars that GenAIScript 2.3.9 does
        // not read for the OpenAI provider, silently reverting to GitHub Models.
        expect(translateStep?.env).toMatchObject({
            OPENAI_API_KEY: "${{ secrets.DEEPSEEK_API_KEY }}",
            OPENAI_API_BASE: "${{ env.OPENAI_API_BASE }}",
            GENAISCRIPT_MODEL_TRANSLATION: "openai:${{ env.TRANSLATION_MODEL }}",
            GENAISCRIPT_MODEL_VALIDATION: "openai:${{ env.TRANSLATION_MODEL }}",
        });
        expect(
            doc.jobs.translate.steps.some(
                (step) => step.name === "Preflight translation credentials",
            ),
        ).toBe(true);
    });

    it("stamps 0.4.2 retry + destination guards into the generated workflow", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        const workflow = readFileSync(workflowPath(cwd), "utf-8");
        type Step = {
            name?: string;
            if?: string;
            run?: string;
            uses?: string;
            with?: Record<string, string>;
            env?: Record<string, string>;
        };
        const doc = jsYaml.load(workflow) as {
            env: Record<string, string>;
            jobs: { translate: { steps: Step[] } };
        };
        const steps = doc.jobs.translate.steps;
        const names = steps.map((step) => step.name);

        expect(doc.env.ALLOW_PARTIAL_TRANSLATIONS).toBe("true");
        expect(names).toContain("Install translation verifier");
        expect(names).toContain("Retry missing languages once");
        expect(names).toContain("Verify translations after retry");
        expect(names).toContain("Verify destination layout");

        const retry = steps.find(
            (step) => step.name === "Retry missing languages once",
        );
        expect(retry?.uses).toBe("pelikhan/action-continuous-translation@v0.2.11");
        expect(retry?.with?.lang).toBe("${{ steps.verify.outputs.missing_langs }}");
        expect(retry?.env?.GENAISCRIPT_MODEL_TRANSLATION).toBe(
            "openai:${{ env.TRANSLATION_MODEL }}",
        );

        // The verifier is written by a heredoc: the delimiter must appear twice
        // (open + close) or the following steps would be swallowed by the shell.
        const installer = steps.find(
            (step) => step.name === "Install translation verifier",
        );
        expect(installer?.run?.split("VERIFY_EOF").length).toBe(3);
    });

    it("stamps 0.4.4 first-push batch handling and failure-safe cache saving", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        type Step = { name?: string; uses?: string; if?: string; run?: string };
        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as {
            jobs: { translate: { steps: Step[] } };
        };
        const steps = doc.jobs.translate.steps;
        const restore = steps.find((s) => s.name === "Restore translation cache");
        const save = steps.find((s) => s.name === "Save translation cache");
        const check = steps.find((s) => s.name === "Check translation cache");

        // actions/cache@v4's post-save only runs on success: a completed
        // translation followed by a failed publish used to lose every cache.
        expect(restore?.uses).toBe("actions/cache/restore@v4");
        expect(save?.uses).toBe("actions/cache/save@v4");
        expect(save?.if).toContain("always()");
        expect(save?.if).toContain("cache_check.outputs.has_files == 'true'");
        expect(check?.run).toContain("compgen -G");
        expect(steps.some((s) => s.uses === "actions/cache@v4")).toBe(false);

        // A brand-new i18n/batch-<run_id> branch must be pushed, not rebased
        // onto a remote ref that does not exist yet.
        const batch = steps.find(
            (s) => s.name === "Self-check & commit to batch branch",
        );
        expect(batch?.run).toContain(
            'git rev-parse --verify "refs/remotes/origin/$BR"',
        );
        expect(batch?.run).toContain('git push -u origin "$BR"');
        expect(batch?.run).toContain("git rebase --abort");
    });

    it("derives the wildcard trigger from --content-root, not from collections", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n(["--content-root", "content/posts"], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.on.push.paths).toEqual(["content/posts/**/en/**"]);
        expect(doc.env.CONTENT_ROOT).toBe("content/posts");
    });
});

describe("init:i18n — idempotency and --force", () => {
    it("skips existing files on a second run (no --force)", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);
        const workflowPath = join(cwd, ".github", "workflows", "i18n-translate.yml");
        const before = readFileSync(workflowPath, "utf-8");

        // Second run without --force should not overwrite.
        runInitI18n([], cwd);

        expect(readFileSync(workflowPath, "utf-8")).toBe(before);
    });

    it("overwrites existing files when --force is passed", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);
        const workflowPath = join(cwd, ".github", "workflows", "i18n-translate.yml");

        // Tamper with the file, then force a regenerate.
        writeFileSync(workflowPath, "GARBAGE");
        expect(readFileSync(workflowPath, "utf-8")).toBe("GARBAGE");

        runInitI18n(["--force"], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath, "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe("de,fr");
    });
});

describe("init:i18n — error handling", () => {
    it("fails when no Sveltia config is found", () => {
        const cwd = makeTempDir();
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => runInitI18n([], cwd)).toThrow(/process\.exit\(1\)/);
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });
});

// Array-form `locales: ["en", "fr"]` plus `default_locale: "en"` used to resolve
// to just ["en"] because /locale:/ also matched the tail of `default_locale`.
// This is the shape used by real consumer repos (a Sveltia CMS options module).
const ARRAY_LOCALES_CONFIG = `export default {
  i18n: {
    structure: 'multiple_folders',
    default_locale: 'en',
    locales: ['en', 'fr', 'de', 'ja'],
  },
  collections: [
    {
      name: 'blog',
      folder: 'src/content/blog',
      i18n: { save_all_locales: false, initial_locales: ['en'] },
    },
  ],
};
`;

describe("init:i18n — locale parsing regression (0.3.5)", () => {
    it("parses array-form locales without being confused by default_locale / initial_locales", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), ARRAY_LOCALES_CONFIG);

        runInitI18n([], cwd);

        const workflow = readFileSync(
            join(cwd, ".github", "workflows", "i18n-translate.yml"),
            "utf-8",
        );
        const doc = jsYaml.load(workflow) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe("de,fr,ja");
        expect(doc.on.push.paths).toEqual(["src/content/**/en/**"]);
    });

    it("parses a single-line inline i18n config (real-world shape)", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `export default {
  i18n: { structure: 'multiple_folders', default_locale: 'en', locales: ['en','fr','de','ja'] },
  collections: [
    { name: 'blog', folder: 'src/content/blog', i18n: { save_all_locales: false, initial_locales: ['en'] } },
  ],
};
`,
        );

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe("de,fr,ja");
    });

    it("does not mistake initial_locales for the global locales list", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `export default {
  collections: [
    { name: 'blog', folder: 'blog', i18n: { initial_locales: ['xx'] } },
  ],
  i18n: { default_locale: 'en', locales: ['en', 'es'] },
};
`,
        );

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe("es");
    });

    it("preserves hyphenated / uppercase-region locale codes", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `export default {
  i18n: {
    structure: 'multiple_folders',
    default_locale: 'en',
    locales: [
      { locale: 'en' },
      { locale: 'zh-CN' },
      { locale: 'pt-BR' },
    ],
  },
  collections: [
    { name: 'blog', folder: 'src/content/blog', i18n: { save_all_locales: false, initial_locales: ['en'] } },
  ],
};
`,
        );

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        // Case must survive: Sveltia folder names are case-sensitive, and remap
        // maps pelikhan's lowercased {{lang}} back to these exact strings.
        expect(doc.env.TARGET_LANGS).toBe("pt-BR,zh-CN");
    });
});

function workflowPath(cwd: string): string {
    return join(cwd, ".github", "workflows", "i18n-translate.yml");
}

describe("init:i18n — template version stamping & upgrade (0.3.5)", () => {
    it("stamps all three generated files with the current template version", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        for (const rel of I18N_GENERATED_FILES) {
            const content = readFileSync(join(cwd, rel), "utf-8");
            expect(content).toContain(
                `astro-sveltia-pages i18n template v${I18N_TEMPLATE_VERSION}`,
            );
            expect(content).not.toMatch(/__[A-Z0-9_]+__/);
        }
    });

    it("--check passes on a freshly generated project", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        const console_ = captureConsole();

        try {
            runInitI18n([], cwd);
            expect(() => checkI18nTemplates(cwd)).not.toThrow();
            expect(console_.log.join("\n")).toContain("均为最新版本");
        } finally {
            console_.restore();
        }
    });

    it("--check fails when i18n is enabled but a generated file is stale", () => {
        const cwd = makeTempDir();
        const path = workflowPath(cwd);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
            path,
            "<!-- astro-sveltia-pages i18n template v0.3.4 -->\nname: old\n",
        );
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => checkI18nTemplates(cwd)).toThrow(/process\.exit\(1\)/);
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });

    it("--check is a no-op when i18n was never initialised (0.3.6)", () => {
        const cwd = makeTempDir();
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => checkI18nTemplates(cwd)).not.toThrow();
            expect(console_.log.join("\n")).toContain("i18n 未启用");
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });

    it("auto-upgrades a legacy (unversioned) 0.3.4 workflow and keeps a .bak", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        const path = workflowPath(cwd);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
            path,
            "# 来源: astro-sveltia-pages —— i18n 自动翻译工作流模板。\nname: old-workflow\n",
        );
        const console_ = captureConsole();

        try {
            runInitI18n([], cwd);
            const upgraded = readFileSync(path, "utf-8");
            expect(upgraded).toContain(
                `astro-sveltia-pages i18n template v${I18N_TEMPLATE_VERSION}`,
            );
            expect(upgraded).toContain("i18n-staging");
            expect(existsSync(`${path}.bak`)).toBe(true);
            expect(readFileSync(`${path}.bak`, "utf-8")).toContain(
                "name: old-workflow",
            );
            expect(console_.log.join("\n")).toContain("已升级");
            // After the upgrade the CI gate passes.
            expect(() => checkI18nTemplates(cwd)).not.toThrow();
        } finally {
            console_.restore();
        }
    });

    it("upgrades an outdated stamped workflow but leaves a same-version one untouched", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        const path = workflowPath(cwd);
        const console_ = captureConsole();

        try {
            runInitI18n([], cwd);
            const current = readFileSync(path, "utf-8");

            // Same version -> no rewrite.
            runInitI18n([], cwd);
            expect(readFileSync(path, "utf-8")).toBe(current);

            // Older version -> auto-upgrade.
            writeFileSync(path, current.replace(`v${I18N_TEMPLATE_VERSION}`, "v0.3.4"));
            runInitI18n([], cwd);
            expect(readFileSync(path, "utf-8")).toContain(
                `astro-sveltia-pages i18n template v${I18N_TEMPLATE_VERSION}`,
            );
        } finally {
            console_.restore();
        }
    });

    it("restamps an old glossary without discarding user-added terms", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        const path = join(cwd, "i18n", "glossary.md");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "# Translation Glossary\n\n- MyBrandTerm\n- ACME-9000\n");
        const console_ = captureConsole();

        try {
            runInitI18n([], cwd);
            const content = readFileSync(path, "utf-8");
            expect(content).toContain("MyBrandTerm");
            expect(content).toContain("ACME-9000");
            expect(content).toContain(
                `astro-sveltia-pages i18n template v${I18N_TEMPLATE_VERSION}`,
            );
            expect(() => checkI18nTemplates(cwd)).not.toThrow();
        } finally {
            console_.restore();
        }
    });

    it("does not overwrite a foreign workflow unless --force is given", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        const path = workflowPath(cwd);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "name: my-own-workflow\non: push\n");
        const console_ = captureConsole();

        try {
            runInitI18n([], cwd);
            expect(readFileSync(path, "utf-8")).toBe(
                "name: my-own-workflow\non: push\n",
            );

            runInitI18n(["--force"], cwd);
            expect(readFileSync(path, "utf-8")).toContain("i18n-staging");
        } finally {
            console_.restore();
        }
    });
});

// 0.4.0: the CLI no longer parses CMS collections at all. Whether a file is
// translated is decided by its own `autoTranslate: true` frontmatter flag, so
// none of the 0.3.7/0.3.8 collection-parsing hazards can recur.
describe("init:i18n — frontmatter opt-in (0.4.0)", () => {
    const TRICKY_CONFIG = `export const collections = [
  { name: 'products', folder: 'src/content/products', media_folder: 'public/img', public_folder: '/img' },
  { name: 'blog', folder: 'src/content/blog', i18n: { save_all_locales: false, initial_locales: ['en'] } },
  { name: 'terms', folder: 'src/content/terms', i18n: true },
];
export default {
  // 注释里提到 initial_locales: ['en']，不应被当成配置。
  i18n: { structure: 'multiple_folders', default_locale: 'en', locales: ['en', 'fr', 'de'] },
};
`;

    it("generates a collection-agnostic workflow from any CMS config shape", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), TRICKY_CONFIG);

        runInitI18n([], cwd);

        const workflow = readFileSync(workflowPath(cwd), "utf-8");
        const doc = jsYaml.load(workflow) as YamlDoc;

        expect(doc.on.push.paths).toEqual(["src/content/**/en/**"]);
        expect(doc.env.SKIP_COLLECTIONS).toBeUndefined();
        expect(doc.env.TARGET_LANGS).toBe("de,fr");
        expect(workflow).not.toContain("__SKIP_COLLECTIONS__");
    });

    it("detect only keeps EN files whose frontmatter enables autoTranslate", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        const workflow = readFileSync(workflowPath(cwd), "utf-8");
        expect(workflow).toContain("/^autoTranslate:\\s*true\\s*$/m");
        expect(workflow).toContain("未开启 autoTranslate: true");
        expect(workflow).not.toContain("autoTranslate:\\s*false");
        expect(workflow).not.toContain("SKIP_COLLECTIONS");
    });

    it("remap honours OVERWRITE_MODE and per-locale translateLock", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), TRICKY_CONFIG);

        runInitI18n([], cwd);

        const remap = readFileSync(
            join(cwd, "scripts", "remap-translations.sh"),
            "utf-8",
        );
        expect(remap).toContain('OVERWRITE_MODE="${OVERWRITE_MODE:-all}"');
        expect(remap).toContain("translateLock");
        expect(remap).toContain("handled=$((moved + skipped))");
    });

    it("legacy --collections / --skip-collections args no longer change output", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), TRICKY_CONFIG);
        const console_ = captureConsole();

        try {
            runInitI18n(["--collections", "products,blog"], cwd);
            expect(console_.error.join("\n")).not.toContain("⚠️");
        } finally {
            console_.restore();
        }

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.on.push.paths).toEqual(["src/content/**/en/**"]);
    });
});

// 0.4.3: GitHub's `on.push.paths` also matches DELETED files. A removed EN
// post used to reach the staging step, which then failed with "源文件不存在"
// and made publish open a bogus failure issue. Run the template's real detect
// script with a mocked filesystem so the guard cannot silently regress.
describe("init:i18n — deleted EN sources (0.4.3)", () => {
    const templatePath = fileURLToPath(
        new URL("../templates/i18n/i18n-translate.yml", import.meta.url),
    );

    function detectSource(): string {
        const workflow = readFileSync(templatePath, "utf-8");
        // The closing NODE delimiter is indented inside the YAML block scalar.
        const blocks = [
            ...workflow.matchAll(/node <<'NODE'\r?\n([\s\S]*?)\r?\n\s*NODE/g),
        ].map((match) => match[1]);
        const block = blocks.find((candidate) => candidate.includes("const keep"));

        if (!block) {
            throw new Error("detect script is missing from the workflow template");
        }

        return block;
    }

    function runDetect(options: {
        file: string;
        exists: boolean;
        frontmatter?: string;
        env?: Record<string, string>;
    }): { outputs: string; logs: string } {
        const written: string[] = [];
        const logs: string[] = [];
        const sandbox = {
            require: (id: string) => {
                if (id === "child_process") {
                    return {
                        execSync: (command: string) =>
                            command.startsWith("head ")
                                ? (options.frontmatter ??
                                  "---\ntitle: Post\nautoTranslate: true\n---\n")
                                : `${options.file}\n`,
                    };
                }

                if (id === "fs") {
                    return {
                        existsSync: () => options.exists,
                        appendFileSync: (_path: string, value: string) =>
                            written.push(value),
                    };
                }

                if (id === "path") {
                    return { basename };
                }

                throw new Error(`unexpected require("${id}")`);
            },
            process: {
                env: {
                    CONTENT_ROOT: "src/content",
                    AUTO_TRANSLATE: "true",
                    GH_EVENT: "push",
                    BEFORE: "1111111111111111111111111111111111111111",
                    AFTER: "2222222222222222222222222222222222222222",
                    CHUNK_SIZE: "20",
                    GITHUB_OUTPUT: "/dev/null",
                    ...options.env,
                },
                exit: (code: number) => {
                    throw new Error(`EXIT_${String(code)}`);
                },
            },
            console: { log: (...args: unknown[]) => logs.push(args.join(" ")) },
        };

        try {
            runInNewContext(detectSource(), sandbox);
        } catch (error) {
            // The script calls process.exit(0) on the "nothing to translate"
            // path; a mock must stop execution exactly like the real thing.
            if (!String(error).includes("EXIT_")) {
                throw error;
            }
        }

        return { outputs: written.join(""), logs: logs.join("\n") };
    }

    const file = "src/content/blog/en/gone.md";

    it("skips EN paths that no longer exist instead of staging them", () => {
        const { outputs, logs } = runDetect({ file, exists: false });

        expect(outputs).toContain("chunks=[]");
        expect(outputs).toContain("has_files=false");
        expect(logs).toContain("源文件已删除/重命名");
        expect(logs).toContain("本次变更仅包含 EN 文件删除");
        expect(logs).not.toContain("待翻译");
    });

    it("still translates a surviving EN file with autoTranslate: true", () => {
        const { outputs } = runDetect({ file, exists: true });

        expect(outputs).toContain("has_files=true");
        expect(outputs).toContain(`"files":"${file}"`);
    });

    it("falls back to git ls-files for a first push (before is all zeroes)", () => {
        const { outputs } = runDetect({
            file,
            exists: true,
            env: { BEFORE: "0000000000000000000000000000000000000000" },
        });

        expect(outputs).toContain("has_files=true");
    });

    it("does not translate an existing EN file without the opt-in flag", () => {
        const { outputs, logs } = runDetect({
            file,
            exists: true,
            frontmatter: "---\ntitle: Post\n---\n",
        });

        expect(outputs).toContain("has_files=false");
        expect(logs).toContain("未开启 autoTranslate: true");
    });
});

// 0.4.5: `locale: 'zh'` at the top level is Sveltia's CMS **UI** language,
// not a content locale. The old whole-file /locale:/ scan returned early on
// that single match, so array-form configs produced TARGET_LANGS=zh and the
// real 14 target languages were silently skipped (reported by a consumer).
const UI_LOCALE_CONFIG = `// CMS 后台界面语言：locale: 'zh'
export const sveltiaOptions = {
  locale: 'zh',
  extraConfig: {
    i18n: {
      structure: 'multiple_folders',
      locales: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'ar', 'tr', 'nl', 'pl', 'vi', 'th'],
      default_locale: 'en',
    },
  },
  collections: [{ name: 'blog', folder: 'src/content/blog', i18n: true }],
};
`;

const EXPECTED_TARGETS = "ar,de,es,fr,it,ja,ko,nl,pl,pt,ru,th,tr,vi";

/** Extracts the inline CI validator so tests exercise the real YAML snippet. */
function validatorScript(): string {
    const template = readFileSync(
        fileURLToPath(new URL("../templates/i18n/i18n-translate.yml", import.meta.url)),
        "utf-8",
    );
    const doc = jsYaml.load(template) as {
        jobs: { detect: { steps: { name?: string; run?: string }[] } };
    };
    const step = doc.jobs.detect.steps.find(
        (item) => item.name === "Validate TARGET_LANGS against Sveltia config",
    );

    if (!step?.run) {
        throw new Error("Validate TARGET_LANGS step is missing");
    }

    return step.run
        .replace(/\r\n/g, "\n")
        .replace(/^\s*node <<'NODE'\n/, "")
        .replace(/\n\s*NODE\s*$/, "");
}

function runValidator(configText: string, targetLangs: string) {
    const logs: string[] = [];
    const errors: string[] = [];
    let code = 0;

    try {
        runInNewContext(validatorScript(), {
            require: (name: string) => {
                if (name === "fs") {
                    return { existsSync: () => true, readFileSync: () => configText };
                }

                throw new Error(`unexpected require: ${name}`);
            },
            process: {
                env: { CONFIG_FILE: "sveltia.config.mjs", TARGET_LANGS: targetLangs },
                exit: (value: number) => {
                    code = value;
                    throw new Error(`VM_EXIT_${String(value)}`);
                },
            },
            console: {
                log: (...args: unknown[]) => logs.push(args.join(" ")),
                error: (...args: unknown[]) => errors.push(args.join(" ")),
            },
        });
    } catch (error) {
        if (!String(error).includes("VM_EXIT_")) {
            throw error;
        }
    }

    return { code, logs, errors };
}

describe("init:i18n — CMS UI locale is not a content locale", () => {
    it("keeps all 14 target languages and auto-detects sveltia.config.mjs", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia.config.mjs"), UI_LOCALE_CONFIG);

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe(EXPECTED_TARGETS);
        expect(doc.env.CONFIG_FILE).toBe("sveltia.config.mjs");
    });

    it("also accepts a constant-valued CMS locale (no workaround needed)", () => {
        const cwd = makeTempDir();
        const config = UI_LOCALE_CONFIG.replace(
            "  locale: 'zh',",
            "  locale: CMS_LOCALE,",
        ).replace(
            "export const sveltiaOptions",
            "const CMS_LOCALE = 'zh';\nexport const sveltiaOptions",
        );
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), config);

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe(EXPECTED_TARGETS);
    });

    it("ignores locale / locales words written inside comments", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `// locale: 'xx'\n// locales: ['zz']\n/* default_locale: 'zz' */\nexport default {\n  i18n: { default_locale: 'en', locales: ['en', 'fr', 'de'] },\n};\n`,
        );

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe("de,fr");
    });

    it("does not mix object-form locales with the CMS UI locale", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `export default {\n  locale: 'zh',\n  i18n: {\n    default_locale: 'en',\n    locales: [{ locale: 'en', label: 'English' }, { locale: 'fr', label: 'Français' }],\n  },\n};\n`,
        );

        runInitI18n([], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath(cwd), "utf-8")) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe("fr");
    });

    it("fails loudly when the parsed locales omit default_locale", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `export default { i18n: { default_locale: 'en', locales: ['fr'] } };\n`,
        );
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => runInitI18n([], cwd)).toThrow(/process\.exit\(1\)/);
            expect(console_.error.join("\n")).toContain("不包含 default_locale");
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });

    it("the inline CI validator agrees with the CLI on the UI-locale config", () => {
        const result = runValidator(UI_LOCALE_CONFIG, EXPECTED_TARGETS);

        expect(result.code).toBe(0);
        expect(result.logs.join("\n")).toContain("语言列表一致");
    });

    it("the inline CI validator rejects the old TARGET_LANGS=zh mistake", () => {
        const result = runValidator(UI_LOCALE_CONFIG, "zh");

        expect(result.code).toBe(1);
        expect(result.errors.join("\n")).toContain("语言列表不一致");
    });
});

function captureConsole(): { log: string[]; error: string[]; restore: () => void } {
    const log: string[] = [];
    const error: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
        log.push(args.join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
        error.push(args.join(" "));
    });

    return {
        log,
        error,
        restore: () => {
            logSpy.mockRestore();
            errorSpy.mockRestore();
        },
    };
}

// 0.4.5: classic Sveltia/Decap repositories keep the CMS config as YAML under
// public/admin, with unquoted values and a top-level CMS UI `locale: 'zh'`.
const YAML_CMS_CONFIG = `# CMS 后台界面语言
locale: 'zh'
# 注释里的 locale: 'xx' / locales: ['zz'] 不应参与解析
i18n:
  structure: multiple_folders
  locales: [en, es, fr, de, it, pt, ru, ar, ja, ko, th, tr, pl]
  default_locale: en
collections:
  - name: blog
    folder: src/content/blog
`;

const YAML_TARGET_LANGS = "ar,de,es,fr,it,ja,ko,pl,pt,ru,th,tr";

describe("init:i18n — YAML CMS config (0.4.5)", () => {
    it("auto-detects public/admin/config.yml with unquoted locale values", () => {
        const cwd = makeTempDir();
        mkdirSync(join(cwd, "public", "admin"), { recursive: true });
        writeFileSync(join(cwd, "public", "admin", "config.yml"), YAML_CMS_CONFIG);

        runInitI18n([], cwd);

        const doc = jsYaml.load(
            readFileSync(
                join(cwd, ".github", "workflows", "i18n-translate.yml"),
                "utf-8",
            ),
        ) as YamlDoc;
        expect(doc.env.TARGET_LANGS).toBe(YAML_TARGET_LANGS);
        expect(doc.env.CONFIG_FILE).toBe("public/admin/config.yml");
        expect(doc.env.I18N_STRUCTURE).toBe("multiple_folders");
    });

    it("the CI validator agrees with the CLI on unquoted YAML lists", () => {
        expect(runValidator(YAML_CMS_CONFIG, YAML_TARGET_LANGS).code).toBe(0);
        expect(runValidator(YAML_CMS_CONFIG, "zh").code).toBe(1);
    });
});

describe("init:i18n — configurable translation commit author (0.4.5)", () => {
    it("fills the author placeholders from --commit-author", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n(
            ["--commit-author", "Your Name <you@users.noreply.github.com>"],
            cwd,
        );

        const raw = readFileSync(
            join(cwd, ".github", "workflows", "i18n-translate.yml"),
            "utf-8",
        );
        const doc = jsYaml.load(raw) as YamlDoc;
        expect(doc.env.COMMIT_AUTHOR_NAME).toBe("Your Name");
        expect(doc.env.COMMIT_AUTHOR_EMAIL).toBe("you@users.noreply.github.com");
        expect(raw).not.toContain("__COMMIT_AUTHOR_");
        expect(raw).not.toContain("i18n-bot");
    });

    it("leaves the placeholders empty when no author is configured", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n([], cwd);

        const doc = jsYaml.load(
            readFileSync(
                join(cwd, ".github", "workflows", "i18n-translate.yml"),
                "utf-8",
            ),
        ) as YamlDoc;
        expect(doc.env.COMMIT_AUTHOR_NAME).toBe("");
        expect(doc.env.COMMIT_AUTHOR_EMAIL).toBe("");
    });

    it("preserves a hand-picked author across template upgrades", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);

        runInitI18n(
            ["--commit-author", "Your Name <you@users.noreply.github.com>"],
            cwd,
        );

        const workflowPath = join(cwd, ".github", "workflows", "i18n-translate.yml");
        // Simulate the previous release's snapshot: same author, older marker.
        writeFileSync(
            workflowPath,
            readFileSync(workflowPath, "utf-8").replace(
                /template v[\d.]+/g,
                "template v0.4.4",
            ),
        );

        runInitI18n(["--no-backup"], cwd);

        const doc = jsYaml.load(readFileSync(workflowPath, "utf-8")) as YamlDoc;
        expect(doc.env.COMMIT_AUTHOR_EMAIL).toBe("you@users.noreply.github.com");
        expect(doc.env.TEMPLATE_VERSION).toBe(I18N_TEMPLATE_VERSION);
        expect(existsSync(`${workflowPath}.bak`)).toBe(false);
    });
});

describe("init:i18n — postinstall hook (0.4.5)", () => {
    it("is a silent no-op in repositories that never enabled i18n", () => {
        const cwd = makeTempDir();
        const console_ = captureConsole();

        try {
            expect(() => runInitI18n(["--postinstall"], cwd)).not.toThrow();
            expect(console_.log).toHaveLength(0);
            expect(console_.error).toHaveLength(0);
            for (const rel of I18N_GENERATED_FILES) {
                expect(existsSync(join(cwd, rel))).toBe(false);
            }
        } finally {
            console_.restore();
        }
    });

    it("upgrades stale snapshots without .bak files", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        runInitI18n([], cwd);

        for (const rel of I18N_GENERATED_FILES) {
            const path = join(cwd, rel);
            writeFileSync(
                path,
                readFileSync(path, "utf-8").replace(
                    /template v[\d.]+/g,
                    "template v0.4.4",
                ),
            );
        }

        const console_ = captureConsole();

        try {
            expect(() => runInitI18n(["--postinstall"], cwd)).not.toThrow();
        } finally {
            console_.restore();
        }

        for (const rel of I18N_GENERATED_FILES) {
            const path = join(cwd, rel);
            expect(readFileSync(path, "utf-8")).toContain(
                `template v${I18N_TEMPLATE_VERSION}`,
            );
            expect(existsSync(`${path}.bak`)).toBe(false);
        }
    });

    it("never breaks install when the CMS config cannot be parsed", () => {
        const cwd = makeTempDir();
        writeFileSync(join(cwd, "sveltia-cms.config.mjs"), SVELTIA_CONFIG);
        runInitI18n([], cwd);
        // Config disappears (e.g. sparse CI checkout): warn, do not exit(1).
        rmSync(join(cwd, "sveltia-cms.config.mjs"));

        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => runInitI18n(["--postinstall"], cwd)).not.toThrow();
            expect(exitSpy).not.toHaveBeenCalled();
            expect(console_.error.join("\n")).toContain("postinstall 未能更新");
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });
});

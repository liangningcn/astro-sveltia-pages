import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
// This is the shape used by real consumer repos (e.g. nextcharm/charmost).
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

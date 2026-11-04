import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import jsYaml from "js-yaml";
import { afterAll, describe, expect, it, vi } from "vitest";

import { runInitI18n } from "../src/cli.ts";

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

        // Only the translated collection is wired into the push trigger.
        expect(doc.on.push.paths).toEqual(["src/content/blog/en/**"]);

        // The non-translated collection is listed as a skip target.
        expect(doc.env.SKIP_COLLECTIONS).toBe("authors");

        // Glossary placeholder was replaced.
        const glossary = readFileSync(glossaryPath, "utf-8");
        expect(glossary).not.toContain("__PROJECT_NAME__");
    });

    it("derives the EN path from a full folder path", () => {
        const cwd = makeTempDir();
        writeFileSync(
            join(cwd, "sveltia-cms.config.mjs"),
            `export default {
  i18n: { default_locale: 'en', locales: [{ locale: 'en' }, { locale: 'es' }] },
  collections: [
    { name: 'docs', folder: 'src/content/docs', i18n: { save_all_locales: false, initial_locales: ['en'] } },
  ],
};
`,
        );

        runInitI18n([], cwd);

        const workflow = readFileSync(
            join(cwd, ".github", "workflows", "i18n-translate.yml"),
            "utf-8",
        );
        const doc = jsYaml.load(workflow) as YamlDoc;
        expect(doc.on.push.paths).toEqual(["src/content/docs/en/**"]);
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

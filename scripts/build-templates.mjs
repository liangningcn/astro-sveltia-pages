/**
 * Builds the deployable function templates.
 *
 * The runtime lives in `src/functions`; the templates are the bundled,
 * dependency-free files that users copy into their project. Bundling keeps a
 * single source of truth: the shipped JavaScript is always the tested
 * TypeScript implementation.
 *
 * Additionally, the i18n workflow templates under `templates/i18n/` are copied
 * verbatim into `dist/templates/i18n/` so they ship inside the npm tarball and
 * are resolved by the `init:i18n` CLI command.
 */
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { format } from "vite-plus/fmt";

const root = fileURLToPath(new URL("..", import.meta.url));

const TARGETS = [
    {
        platform: "Cloudflare Pages + EdgeOne Pages (auto-detected)",
        entry: "src/functions/entries/auto.ts",
        outDir: "templates",
        target: "auth.js",
    },
];

// i18n templates shipped as-is (placeholders filled by the init:i18n CLI).
const I18N_TEMPLATE_DIR = "templates/i18n";
const I18N_DIST_DIR = "dist/templates/i18n";

// Mirrors the formatter profile in vite.config.ts.
const FORMAT_OPTIONS = {
    tabWidth: 4,
    useTabs: false,
    printWidth: 88,
    endOfLine: "lf",
    insertFinalNewline: true,
    trailingComma: "all",
    objectWrap: "collapse",
    bracketSameLine: false,
    semi: true,
    singleQuote: false,
};

function banner(target) {
    return [
        `// Sveltia CMS GitHub OAuth proxy for ${target.platform}.`,
        "// Generated from src/functions by `vp run build:templates` - do not edit.",
        `// Deploy as ${target.target} and configure GITHUB_CLIENT_ID,`,
        "// GITHUB_CLIENT_SECRET, SITE_URL and ENVIRONMENT in the platform dashboard.",
        "",
    ].join("\n");
}

async function buildAuthTemplates() {
    for (const target of TARGETS) {
        await build({
            configFile: false,
            root,
            logLevel: "warn",
            build: {
                outDir: join(root, target.outDir),
                emptyOutDir: false,
                minify: false,
                target: "es2022",
                lib: {
                    entry: join(root, target.entry),
                    formats: ["es"],
                    fileName: () => "auth.js",
                },
            },
        });

        const file = join(root, target.outDir, "auth.js");
        const source = await readFile(file, "utf-8");
        const { code, errors } = await format(file, source, FORMAT_OPTIONS);

        if (errors.length > 0) {
            const message = errors[0].message || "unknown error";

            throw new Error(`Failed to format ${target.target}: ${message}`);
        }

        await writeFile(file, banner(target) + code, "utf-8");

        console.log(`[astro-sveltia-pages] Built ${target.target} template.`);
    }
}

/**
 * Copies the i18n workflow templates into the published `dist/templates/i18n`
 * directory and guards against accidental removal of required placeholders.
 */
async function buildI18nTemplates() {
    const srcDir = join(root, I18N_TEMPLATE_DIR);
    const distDir = join(root, I18N_DIST_DIR);

    let entries;

    try {
        entries = await readdir(srcDir);
    } catch {
        throw new Error(
            `Missing i18n templates at ${I18N_TEMPLATE_DIR}/ (expected i18n-translate.yml, glossary.md, remap-translations.sh).`,
        );
    }

    const files = entries.filter((e) => !e.startsWith("."));

    if (files.length === 0) {
        throw new Error(`No i18n templates found in ${I18N_TEMPLATE_DIR}/.`);
    }

    await mkdir(distDir, { recursive: true });
    await cp(srcDir, distDir, { recursive: true });

    // Guard: assert each template still carries the placeholders the CLI replaces,
    // plus the version marker used by `init:i18n --check` to detect stale files.
    const required = {
        "i18n-translate.yml": [
            "__TEMPLATE_VERSION__",
            "TEMPLATE_VERSION:",
            "__CONTENT_ROOT__",
            "__COLLECTION_EN_PATH__",
            "__TARGET_LANGS__",
            "__CONFIG_FILE__",
        ],
        "glossary.md": ["__TEMPLATE_VERSION__", "__PROJECT_NAME__"],
        "remap-translations.sh": ["__TEMPLATE_VERSION__"],
    };

    for (const [file, placeholders] of Object.entries(required)) {
        const path = join(srcDir, file);

        if (!files.includes(file)) {
            throw new Error(
                `Missing required i18n template: ${I18N_TEMPLATE_DIR}/${file}`,
            );
        }

        const content = await readFile(path, "utf-8");

        for (const token of placeholders) {
            if (!content.includes(token)) {
                throw new Error(
                    `i18n template ${I18N_TEMPLATE_DIR}/${file} is missing placeholder ${token}.`,
                );
            }
        }

        // Sanity check: the workflow template must remain valid YAML once placeholders are replaced
        // with non-empty values. A stray trailing placeholder would break `js-yaml` parsing.
        if (content.includes("__UNKNOWN__")) {
            throw new Error(
                `i18n template ${I18N_TEMPLATE_DIR}/${file} has an unreplaced token.`,
            );
        }
    }

    // Guard the hard-won CI fixes. These are easy to "clean up" by mistake and
    // each one caused a real production failure in 0.3.4.
    const workflow = await readFile(join(srcDir, "i18n-translate.yml"), "utf-8");
    const invariants = [
        ['STAGING_DIR: "i18n-staging"', "non-hidden staging dir (glob skips dot dirs)"],
        ["pelikhan/action-continuous-translation@v0.2.11", "pinned action version"],
        ["openai:deepseek-flash", "current DeepSeek model id"],
        ["Reclaim ownership of Docker-generated files", "Docker root permission fix"],
        ["Verify translations were produced", "zero-translation failure gate"],
        ["Fail when translation did not succeed", "publish-side failure gate"],
        ["filename_template:", "explicit translation filename template"],
        [
            "tr '[:upper:]' '[:lower:]'",
            "pelikhan lowercases {{lang}} in output filenames",
        ],
        ["Verify i18n template version", "CI-side stale-template gate (0.3.6)"],
        [
            'TEMPLATE_VERSION: "__TEMPLATE_VERSION__"',
            "template version exposed to the CI gate",
        ],
        [
            "i18n-${{ runner.os }}-${{ matrix.i }}-",
            "per-shard translation cache isolation (0.3.6)",
        ],
        [
            "pnpm exec astro-sveltia-pages init:i18n",
            "canonical pnpm upgrade command in the notice",
        ],
    ];

    for (const [needle, label] of invariants) {
        if (!workflow.includes(needle)) {
            throw new Error(
                `i18n workflow template lost a required fix: ${label} (${needle}).`,
            );
        }
    }

    const remap = await readFile(join(srcDir, "remap-translations.sh"), "utf-8");
    const remapInvariants = [
        ["canonical_lang", "restore Sveltia locale casing in output paths"],
        ["lower()", "case-insensitive language matching"],
        ['mv -f "$f"', "plain mv instead of git mv"],
    ];

    for (const [needle, label] of remapInvariants) {
        if (!remap.includes(needle)) {
            throw new Error(
                `i18n remap template lost a required fix: ${label} (${needle}).`,
            );
        }
    }

    // Pre-seeding staging with existing translations defeats the verify gate:
    // pelikhan never reads target markdown, it only uses its JSON cache.
    if (
        /\.i18n-staging|deepseek-v4-flash|mkdir -p \.genaiscript|CONTENT_ROOT\/\$coll\/\$L/.test(
            workflow,
        )
    ) {
        throw new Error(
            "i18n workflow template still contains a known-broken 0.3.4 construct.",
        );
    }

    // Consumer-facing commands are pnpm-first. A stray `npx` would leave the
    // docs, CLI output and generated headers inconsistent again.
    for (const file of files) {
        const content = await readFile(join(srcDir, file), "utf-8");

        if (/npx\s+astro-sveltia-pages/.test(content)) {
            throw new Error(
                `i18n template ${file} uses npx; use "pnpm exec astro-sveltia-pages" instead.`,
            );
        }
    }

    console.log(
        `[astro-sveltia-pages] Copied ${files.length} i18n template(s) to ${I18N_DIST_DIR}/.`,
    );
}

async function main() {
    await buildAuthTemplates();
    await buildI18nTemplates();
}

await main();

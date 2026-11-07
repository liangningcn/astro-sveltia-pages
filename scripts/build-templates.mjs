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
            "__CONTENT_ROOT__/**/en/**",
            "autoTranslate: true",
            "OVERWRITE_MODE",
            // 0.4.1: the Docker action only reads unprefixed / GENAISCRIPT_*
            // variables. Dropping these silently reverts the engine to
            // github:openai/gpt-4o and produces zero translations.
            "TRANSLATION_MODEL",
            "OPENAI_API_BASE:",
            "GENAISCRIPT_MODEL_TRANSLATION",
            "Preflight translation credentials",
            // 0.4.2: a single language whose model echoes ┌T000┐ markers must
            // not discard every other language's finished translation.
            "MANDATORY OUTPUT FORMAT",
            "Retry missing languages once",
            "Verify destination layout",
            "ALLOW_PARTIAL_TRANSLATIONS",
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
        [
            'TRANSLATION_MODEL: "deepseek-flash"',
            "current DeepSeek model id (single source of truth)",
        ],
        [
            "openai:${{ env.TRANSLATION_MODEL }}",
            "GenAIScript model alias derived from TRANSLATION_MODEL",
        ],
        ["Reclaim ownership of Docker-generated files", "Docker root permission fix"],
        ["Verify translations were produced", "zero-translation failure gate"],
        [
            "Install translation verifier",
            "shared soft/hard verification script (0.4.2)",
        ],
        [
            "Retry missing languages once",
            "clean-cache retry for flaky per-language output format (0.4.2)",
        ],
        [
            "Verify destination layout",
            "translations must land in <collection>/<lang>/ (0.4.2)",
        ],
        [
            "源文件已删除/重命名",
            "deleted EN paths must be filtered before staging (0.4.3)",
        ],
        [
            "const firstPush = before !== '' && /^0+$/.test(before);",
            "first-push (all-zero before sha) fallback (0.4.3)",
        ],
        [
            "actions/cache/restore@v4",
            "restore/save split so a failed publish keeps the cache (0.4.4)",
        ],
        ["actions/cache/save@v4", "explicit always() cache save (0.4.4)"],
        [
            'git rev-parse --verify "refs/remotes/origin/$BR"',
            "branch-exists check before rebasing (0.4.4)",
        ],
        ['git push -u origin "$BR"', "first push of a brand-new batch branch (0.4.4)"],
        ["Fail when translation did not succeed", "publish-side failure gate"],
        ["filename_template:", "explicit translation filename template"],
        [
            "tr '[:upper:]' '[:lower:]'",
            "pelikhan lowercases {{lang}} in output filenames",
        ],
        [
            "const localesBlock = s =>",
            "CI validator parses only the locales: [...] block, not CMS UI locale",
        ],
        [
            "if (!locs.includes(dl[1]))",
            "CI validator rejects a locale list missing default_locale",
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
        [
            'COMMIT_AUTHOR_NAME: "__COMMIT_AUTHOR_NAME__"',
            "configurable translation commit author name (0.4.5)",
        ],
        [
            'COMMIT_AUTHOR_EMAIL: "__COMMIT_AUTHOR_EMAIL__"',
            "configurable translation commit author email (0.4.5)",
        ],
        [
            'I18N_NAME="${COMMIT_AUTHOR_NAME:-$I18N_ACTOR}"',
            "commit author falls back to the workflow triggerer (0.4.5)",
        ],
        [
            "YAML bare array: locales: [en, es, fr]",
            "CI validator supports unquoted YAML locale lists (0.4.5)",
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
        ['basename "$dest_dir"', "0.4.2 guard: destination is a language folder"],
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

    // The combined actions/cache@v4 saves its cache in a post step that only
    // runs on successful jobs: a completed translation followed by a failed
    // publish loses the whole incremental cache and pays for the model again.
    if (/\buses:\s*actions\/cache@v4\b/.test(workflow)) {
        throw new Error(
            "i18n workflow must not use the combined actions/cache@v4; use actions/cache/restore@v4 + actions/cache/save@v4 with always().",
        );
    }

    // 0.4.4 hardcoded this identity; GitHub then attributed every translated
    // commit to a bot account instead of the person who published the post.
    if (/i18n-bot@users\.noreply\.github\.com/.test(workflow)) {
        throw new Error(
            "i18n workflow must not hardcode the i18n-bot commit identity.",
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

// Nothing in the published package may name a consumer's private repository or
// embed a personal noreply address. The literals are assembled at runtime so
// this guard does not flag its own source while scanning `scripts/`.
const PRIVATE_IDENTIFIER_PARTS = [
    ["ref", "orteha"],
    ["char", "most"],
    ["next", "charm"],
    ["top", "q"],
    ["liang", "ningcn@users.noreply.github.com"],
];
const PRIVACY_SCAN_FILES = [
    "README.md",
    "README.zh-CN.md",
    "CHANGELOG.md",
    "CHANGELOG.zh-CN.md",
];
const PRIVACY_SCAN_DIRS = ["src", "templates", "scripts", "tests"];
const TEXT_FILE = /\.(?:ts|mjs|js|md|yml|yaml|sh|json)$/;

async function collectTextFiles(relativeDir, out) {
    const entries = await readdir(join(root, relativeDir), { withFileTypes: true });

    for (const entry of entries) {
        const relative = join(relativeDir, entry.name);

        if (entry.isDirectory()) {
            await collectTextFiles(relative, out);
        } else if (TEXT_FILE.test(entry.name)) {
            out.push(relative);
        }
    }
}

async function assertNoPrivateIdentifiers() {
    const forbidden = PRIVATE_IDENTIFIER_PARTS.map((parts) => parts.join(""));
    const pattern = new RegExp(forbidden.join("|"), "i");
    const files = [...PRIVACY_SCAN_FILES];

    for (const dir of PRIVACY_SCAN_DIRS) {
        await collectTextFiles(dir, files);
    }

    for (const file of files) {
        const content = await readFile(join(root, file), "utf-8");
        const hit = content.match(pattern);

        if (hit) {
            throw new Error(
                `[privacy] ${file} leaks a private project/person identifier (${hit[0]}). Remove it before publishing.`,
            );
        }
    }

    console.log(
        `[astro-sveltia-pages] Privacy scan passed (${files.length} tracked source/doc files).`,
    );
}

async function main() {
    await assertNoPrivateIdentifiers();
    await buildAuthTemplates();
    await buildI18nTemplates();
}

await main();

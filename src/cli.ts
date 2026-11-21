#!/usr/bin/env node
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    computeTargetLangs,
    describeParseError,
    diffLocales,
    extractInlineSveltiaBlock,
    localeKey,
    parseI18nConfig,
    parseLocaleList,
    stripConfigComments,
} from "./i18n-config.js";
import {
    I18N_CHECK_COMMAND,
    I18N_POSTINSTALL_COMMAND,
    I18N_TEMPLATE_MARKER,
    I18N_TEMPLATE_VERSION,
    I18N_UPGRADE_COMMAND,
    I18N_UPGRADE_NOTICE,
    compareVersions,
    formatI18nUpgradeNotice,
    inspectI18nTemplates,
    readI18nTemplateVersion,
} from "./i18n-template-check.js";
import { LOG_PREFIX } from "./options.js";

// Keep the public surface stable: tests and consumers import these from the CLI.
export { I18N_GENERATED_FILES, I18N_TEMPLATE_VERSION } from "./i18n-template-check.js";

/** Deployment platforms the OAuth proxy can be deployed to. */
export type InitPlatform = "cloudflare" | "edgeone" | "vercel" | "netlify" | "deno";

type PlatformDescriptor = {
    /** Human readable platform name. */
    label: string;
    /** Template path relative to the package root. */
    template: string;
    /** File name written into the project (relative to `dir`). */
    fileName: string;
    /** Directory the function is copied into, relative to the project root. */
    dir: string;
    /** Where the environment variables are configured. */
    envHint: string;
    /** Where the site URL can be found. */
    siteHint: string;
};

const PLATFORMS: Record<InitPlatform, PlatformDescriptor> = {
    cloudflare: {
        label: "Cloudflare Pages",
        template: "templates/auth.js",
        fileName: "auth.js",
        dir: "functions",
        envHint: "the Cloudflare Pages dashboard (Settings -> Environment variables)",
        siteHint: "the Cloudflare Pages dashboard",
    },
    edgeone: {
        label: "EdgeOne Pages",
        template: "templates/auth.js",
        fileName: "auth.js",
        dir: "edge-functions",
        envHint:
            "the EdgeOne Pages dashboard (Project settings -> Environment variables)",
        siteHint: "the EdgeOne Pages dashboard",
    },
    vercel: {
        label: "Vercel",
        template: "templates/vercel-auth.js",
        fileName: "auth.js",
        dir: "api",
        envHint: "the Vercel dashboard (Project -> Settings -> Environment Variables)",
        siteHint: "the Vercel dashboard",
    },
    netlify: {
        label: "Netlify",
        template: "templates/netlify-auth.js",
        fileName: "auth.js",
        dir: "netlify/edge-functions",
        envHint:
            "the Netlify dashboard (Site -> Site configuration -> Environment variables)",
        siteHint: "the Netlify dashboard",
    },
    deno: {
        label: "Deno Deploy",
        template: "templates/deno-auth.js",
        fileName: "serve.js",
        dir: ".",
        envHint:
            "the Deno Deploy dashboard (Project -> Settings -> Environment Variables)",
        siteHint: "the Deno Deploy dashboard",
    },
};

const DEFAULT_PLATFORM: InitPlatform = "cloudflare";

const KNOWN_PLATFORMS: ReadonlySet<string> = new Set([
    "cloudflare",
    "edgeone",
    "vercel",
    "netlify",
    "deno",
]);

const GITHUB_OAUTH_APPS_URL = "https://github.com/settings/developers";

/**
 * Resolves a bundled template. In the published package it lives in
 * `dist/templates/` (next to this file); when running from source it is one
 * level up (`templates/`).
 */
function resolveTemplatePath(relativePath: string): string {
    for (const candidate of [`./${relativePath}`, `../${relativePath}`]) {
        const path = fileURLToPath(new URL(candidate, import.meta.url));

        if (existsSync(path)) {
            return path;
        }
    }

    return fileURLToPath(new URL(`./${relativePath}`, import.meta.url));
}

function envEntries(platform: InitPlatform): { key: string; comment: string }[] {
    const { envHint } = PLATFORMS[platform];

    return [
        { key: "GITHUB_CLIENT_ID", comment: "# Get this from your GitHub OAuth App." },
        {
            key: "GITHUB_CLIENT_SECRET",
            comment:
                "# GITHUB_CLIENT_SECRET and ENVIRONMENT must be configured in\n" +
                `# ${envHint}. Do not commit real values.`,
        },
        {
            key: "ENVIRONMENT",
            comment:
                "# Set to `production` on production deploys (tightens the OAuth CORS origin).",
        },
        {
            key: "SITE_URL",
            comment:
                "# Full origin of the production site, e.g. https://example.com. Configure it\n" +
                `# in ${envHint} (used as the OAuth origin, keeping the\n` +
                "# callback consistent across custom domains, preview domains and local dev).",
        },
        {
            key: "CMS_ORIGIN",
            comment:
                "# REQUIRED since 0.3.0: the origin the GitHub token is posted back to,\n" +
                "# e.g. https://example.com (https, or http://localhost for local dev).\n" +
                `# Configure it in ${envHint}; the auth endpoint returns 500 if it is missing.`,
        },
    ];
}

/**
 * `--postinstall` must never break `pnpm install`: a missing CMS config or a
 * stale lockfile is a warning there, not a fatal error. In that mode `fail()`
 * throws so the hook can catch it and degrade to a notice.
 */
let softFail = false;
let quiet = false;

function fail(message: string): never {
    console.error(`${LOG_PREFIX} init failed: ${message}`);

    if (softFail) {
        throw new Error(message);
    }

    process.exit(1);
}

function readArgValue(args: string[], name: string): string | undefined {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === name) {
            return args[index + 1];
        }

        if (arg?.startsWith(`${name}=`)) {
            return arg.slice(name.length + 1);
        }
    }

    return undefined;
}

function readSiteUrlFromArgs(args: string[]): string | undefined {
    return readArgValue(args, "--site-url");
}

function readPlatformFromArgs(args: string[]): InitPlatform {
    const value = readArgValue(args, "--platform")?.trim().toLowerCase();

    if (!value) {
        return DEFAULT_PLATFORM;
    }

    if (!KNOWN_PLATFORMS.has(value)) {
        fail(
            `unknown --platform "${value}" (expected one of cloudflare, edgeone, vercel, netlify, deno).`,
        );
    }

    return value as InitPlatform;
}

function hasEnvKey(content: string, key: string): boolean {
    return new RegExp(`^\\s*${key}=`, "m").test(content);
}

function appendEnvEntries(envExamplePath: string, platform: InitPlatform): void {
    const existing = existsSync(envExamplePath)
        ? readFileSync(envExamplePath, "utf-8")
        : "";
    const entries = envEntries(platform);

    const missing = entries.filter((entry) => !hasEnvKey(existing, entry.key));

    if (missing.length === 0) {
        console.log(
            `${LOG_PREFIX} .env.example already lists all OAuth variables; skipped.`,
        );
        return;
    }

    const block = [
        "# Sveltia CMS GitHub OAuth (added by astro-sveltia-pages init)",
        ...missing.flatMap((entry) => [entry.comment, `${entry.key}=`]),
    ];

    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(envExamplePath, `${existing}${separator}${block.join("\n")}\n`);
    console.log(
        `${LOG_PREFIX} Updated .env.example (${missing.map((e) => e.key).join(", ")}).`,
    );
}

function copyAuthTemplate(platform: InitPlatform, cwd: string): void {
    const descriptor = PLATFORMS[platform];

    // Prefer the unified auto-detecting template; fall back to the old
    // per-platform layout for packages built before 0.3.0.
    const candidates = [descriptor.template, `templates/${descriptor.dir}/auth.js`];

    let templatePath: string | undefined;

    for (const relative of candidates) {
        const candidate = resolveTemplatePath(relative);

        if (existsSync(candidate)) {
            templatePath = candidate;
            break;
        }
    }

    if (!templatePath) {
        fail(
            `auth.js template is missing from the installed package (looked for ${candidates.join(", ")}).`,
        );
    }

    const functionsDir = descriptor.dir === "." ? cwd : join(cwd, descriptor.dir);
    const target = join(functionsDir, descriptor.fileName);

    if (existsSync(target)) {
        console.error(`${LOG_PREFIX} ${target} already exists, skipping.`);
        process.exit(1);
    }

    mkdirSync(functionsDir, { recursive: true });
    copyFileSync(templatePath, target);
    console.log(`${LOG_PREFIX} Created ${target}.`);
}

function printGuidance(platform: InitPlatform, siteUrl: string | undefined): void {
    const descriptor = PLATFORMS[platform];
    const callbackUrl = siteUrl
        ? `${siteUrl.replace(/\/+$/, "")}/auth`
        : "<your-site-url>/auth";

    console.log(`
${LOG_PREFIX} Next steps:

1. Create a GitHub OAuth App: ${GITHUB_OAUTH_APPS_URL}
   - Authorization callback URL: ${callbackUrl}
2. Set the environment variables in ${descriptor.envHint}:
   - GITHUB_CLIENT_ID
   - GITHUB_CLIENT_SECRET
   - ENVIRONMENT=production
   - SITE_URL=https://example.com (full origin of the production site)
   - CMS_ORIGIN=https://example.com (required since 0.3.0; https, or http://localhost for local dev)
3. Redeploy. The CMS will be available at ${siteUrl ? `${siteUrl.replace(/\/+$/, "")}/admin/` : "<your-site-url>/admin/"}.
`);

    if (!siteUrl) {
        console.log(
            `${LOG_PREFIX} Your site URL can be found in either place:\n` +
                `  - The "site" field in astro.config.mjs\n` +
                `  - The custom domain shown in ${descriptor.siteHint}\n` +
                `Re-run with --site-url <url> to print exact URLs next time.\n`,
        );
    }
}

export function runInit(args: string[], cwd: string = process.cwd()): void {
    const siteUrl = readSiteUrlFromArgs(args);
    const platform = readPlatformFromArgs(args);

    copyAuthTemplate(platform, cwd);
    appendEnvEntries(join(cwd, ".env.example"), platform);
    printGuidance(platform, siteUrl);
}

// ── init:i18n ──────────────────────────────────────────────────────────────
// Reads the consumer's Sveltia CMS config, fills the i18n workflow templates'
// placeholders and writes the three files into the project.

/**
 * CI-friendly guard: reports generated files that are missing or older than the
 * installed package. Exits non-zero with the canonical upgrade notice so a
 * dependency upgrade cannot silently leave a broken workflow in the repo.
 */
export function checkI18nTemplates(cwd: string = process.cwd()): void {
    const status = inspectI18nTemplates(cwd);

    // 0.3.6: `inspectI18nTemplates` reports outdated=true when all three files
    // are missing. The build-time check guards this with `status.enabled`, but
    // the CLI gate did not, so `init:i18n --check` failed in every repository
    // that never opted into i18n — making it useless as a CI gate for teams
    // that only enable translation on some sites.
    if (!status.enabled) {
        console.log(`${LOG_PREFIX} 未检测到 i18n 生成文件（i18n 未启用），跳过检查。`);
        return;
    }

    if (status.outdated) {
        fail(
            `i18n 模板不是最新版本（需要 ${I18N_TEMPLATE_VERSION}）。\n${formatI18nUpgradeNotice(status)}`,
        );
    }

    console.log(`${LOG_PREFIX} ✅ i18n 模板均为最新版本 ${I18N_TEMPLATE_VERSION}。`);
}

/** Resolves an i18n template from `dist/templates/i18n/` (published) or `../templates/i18n/` (source). */
function resolveI18nTemplatePath(name: string): string {
    return resolveTemplatePath(join("templates", "i18n", name));
}

const CONTENT_FILE = /\.(?:md|mdx|markdown)$/i;
const LANGUAGE_DIR = /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

type DiskDetection = {
    languages: string[];
    rootExists: boolean;
    collectionCount: number;
};

/**
 * Probes actual language folders under one content root. Empty folders,
 * `.gitkeep`-only folders, dot-directories and non-language directory names
 * are ignored so a scaffold never becomes a phantom target language.
 */
function detectContentLanguages(cwd: string, contentRoot: string): DiskDetection {
    const root = resolve(cwd, contentRoot);

    if (!existsSync(root)) {
        return { languages: [], rootExists: false, collectionCount: 0 };
    }

    const collections = readdirSync(root, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    );
    const found = new Set<string>();

    for (const collection of collections) {
        const collectionDir = join(root, collection.name);

        for (const entry of readdirSync(collectionDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                // `single_file` / `multiple_files` keep the locale in
                // frontmatter instead of a <lang>/ folder. Only the leading
                // frontmatter block is read, so prose cannot leak in.
                if (!entry.isFile() || !CONTENT_FILE.test(entry.name)) {
                    continue;
                }

                const head = readFileSync(
                    join(collectionDir, entry.name),
                    "utf-8",
                ).slice(0, 2048);
                const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1];

                if (!frontmatter) {
                    continue;
                }

                const locale =
                    /^locale:\s*['"]?([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)['"]?\s*$/m.exec(
                        frontmatter,
                    )?.[1];

                if (locale) {
                    found.add(locale);
                }

                continue;
            }

            if (entry.name.startsWith(".") || !LANGUAGE_DIR.test(entry.name)) {
                continue;
            }

            const hasContent = readdirSync(join(collectionDir, entry.name), {
                withFileTypes: true,
            }).some(
                (file) =>
                    file.isFile() &&
                    !file.name.startsWith(".") &&
                    CONTENT_FILE.test(file.name),
            );

            if (hasContent) {
                found.add(entry.name);
            }
        }
    }

    return {
        languages: [...found].sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase()),
        ),
        rootExists: true,
        collectionCount: collections.length,
    };
}

function deriveProjectName(cwd: string): string {
    try {
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));

        if (pkg.name) {
            return String(pkg.name);
        }
    } catch {
        // Ignore: fall back to the directory name.
    }

    return basename(cwd);
}

/**
 * Candidate CMS config files, in priority order. `astro.config.*` comes last:
 * the integration may be configured inline there, but a plain Astro config
 * without a `sveltia()` call must not be mistaken for a CMS config.
 */
const I18N_CONFIG_CANDIDATES = [
    "sveltia-cms.config.mjs",
    "sveltia-cms.config.js",
    // Real consumer repos also use the shorter `sveltia.config.mjs`
    // name too. Previously --config was mandatory there.
    "sveltia.config.mjs",
    "sveltia.config.js",
    "src/sveltia-cms.config.mjs",
    "src/sveltia-cms.config.js",
    "src/sveltia.config.mjs",
    "src/sveltia.config.js",
    // Classic Decap/Sveltia sites keep the CMS config as YAML under
    // public/admin. 0.4.4 only understood .mjs/.js,
    // so `init:i18n` refused to run on those repositories.
    "public/admin/config.yml",
    "public/admin/config.yaml",
    "config.yml",
    "config.yaml",
    // Inline `sveltia({ locales: [...] })` in the Astro config, checked last.
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.mts",
    "astro.config.ts",
];

function isAstroConfigName(name: string): boolean {
    return basename(name).includes("astro.config.");
}

/**
 * Resolves the CMS config. An `astro.config.*` fallback is only adopted when
 * the inline `sveltia({...})` options can be parsed statically; a config that
 * exists but cannot be parsed gets its own actionable error instead of the
 * generic "not found" message.
 */
function readI18nConfigPath(cwd: string, configArg: string | undefined): string {
    const candidates = configArg ? [configArg] : I18N_CONFIG_CANDIDATES;
    const failures: { candidate: string; message: string }[] = [];

    for (const candidate of candidates) {
        const path = join(cwd, candidate);

        if (!existsSync(path)) {
            continue;
        }

        if (!configArg && isAstroConfigName(candidate)) {
            let text: string;

            try {
                text = readFileSync(path, "utf-8");
            } catch {
                continue;
            }

            const inline = extractInlineSveltiaBlock(stripConfigComments(text));

            // A plain Astro config with no integration is not a CMS config.
            if (inline.status === "not-found") {
                continue;
            }

            const result = parseI18nConfig(text, true);

            if (!result.ok) {
                failures.push({
                    candidate,
                    message: describeParseError(result, candidate),
                });
                continue;
            }
        }

        return path;
    }

    if (failures.length > 0) {
        const first = failures[0];

        fail(
            `找到 ${first.candidate}，但它含 sveltia() 集成却无法静态解析 i18n 配置。\n` +
                `      ${first.message}`,
        );
    }

    fail(
        "未找到 Sveltia CMS 配置文件（默认查找 sveltia-cms.config.mjs / sveltia.config.mjs / public/admin/config.yml / astro.config.mjs 内联 sveltia({...})）。\n" +
            "      请通过 --config <path> 指定，或在项目根目录创建其中一个（见 README）。",
    );
}

type CommitAuthor = { name: string; email: string };

/** Accepts `Name <mail@example.com>`, a bare email, or a bare name. */
function parseCommitAuthor(raw: string): CommitAuthor {
    const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);

    if (match) {
        return { name: match[1].trim(), email: match[2].trim() };
    }

    if (raw.includes("@")) {
        return { name: "", email: raw.trim() };
    }

    return { name: raw.trim(), email: "" };
}

/**
 * The generated workflow commits translations with this identity. Priority:
 * `--commit-author`, then values already committed in the existing workflow
 * (so later upgrades never reset a hand-picked identity), then empty, which
 * makes the workflow fall back to whoever triggered the run.
 */
function resolveCommitAuthor(args: string[], cwd: string): CommitAuthor {
    const explicit = readArgValue(args, "--commit-author");

    if (explicit) {
        return parseCommitAuthor(explicit);
    }

    const workflowPath = join(cwd, ".github", "workflows", "i18n-translate.yml");

    if (existsSync(workflowPath)) {
        const existing = readFileSync(workflowPath, "utf-8");
        const name = /^\s*COMMIT_AUTHOR_NAME:\s*"([^"]*)"/m.exec(existing)?.[1] ?? "";
        const email = /^\s*COMMIT_AUTHOR_EMAIL:\s*"([^"]*)"/m.exec(existing)?.[1] ?? "";

        if (name || email) {
            return { name, email };
        }
    }

    return { name: "", email: "" };
}

const yamlString = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * `postinstall` hook: upgrade the committed i18n snapshots right when
 * `pnpm add` / `pnpm install` runs, so the change rides along in the same
 * upgrade commit. Never breaks install, never generates .bak files, and is a
 * silent no-op in repositories that have not enabled i18n.
 */
function runPostinstallI18n(args: string[], cwd: string): void {
    const before = inspectI18nTemplates(cwd);

    // No generated files at all => this repository never ran init:i18n.
    if (!before.enabled) {
        return;
    }

    softFail = true;
    quiet = true;

    try {
        runInitI18n(
            [...args.filter((arg) => arg !== "--postinstall"), "--no-backup"],
            cwd,
        );
    } catch (error) {
        console.error(
            `${LOG_PREFIX} ⚠️ postinstall 未能更新 i18n 模板（不影响本次 install）：\n` +
                `   ${error instanceof Error ? error.message : String(error)}\n` +
                `   请在本地运行 \`${I18N_UPGRADE_COMMAND}\` 后提交三份生成文件。`,
        );
    } finally {
        softFail = false;
        quiet = false;
    }

    const after = inspectI18nTemplates(cwd);

    if (before.outdated && !after.outdated) {
        console.log(
            `${LOG_PREFIX} ✅ postinstall：三份 i18n 模板已升级到 ${I18N_TEMPLATE_VERSION}，` +
                "请随本次依赖升级一起提交。",
        );
    } else if (!after.outdated) {
        console.log(
            `${LOG_PREFIX} postinstall：i18n 模板已是 ${I18N_TEMPLATE_VERSION}，无需改动。`,
        );
    }
}

export function runInitI18n(args: string[], cwd: string = process.cwd()): void {
    if (args.includes("--postinstall")) {
        runPostinstallI18n(args, cwd);
        return;
    }

    if (args.includes("--check")) {
        checkI18nTemplates(cwd);
        return;
    }

    const noBackup = args.includes("--no-backup");
    const force = args.includes("--force") || args.includes("--force=true");
    const configArg = readArgValue(args, "--config");
    const contentRoot = readArgValue(args, "--content-root") ?? "src/content";
    const explicitDefaultLocale = readArgValue(args, "--default-locale")?.trim() ?? "";
    const explicitLocales = parseLocaleList(readArgValue(args, "--locales") ?? "");
    const projectName = readArgValue(args, "--project-name") ?? deriveProjectName(cwd);

    const configPath = readI18nConfigPath(cwd, configArg);
    // `relative()` returns backslashes on Windows. Those are unknown escape
    // sequences inside a YAML double-quoted scalar (e.g. `public\admin\...`),
    // so always emit POSIX separators for paths written into the workflow.
    const configRelative =
        relative(cwd, configPath).replace(/\\/g, "/") || "sveltia-cms.config.mjs";
    const parsed = parseI18nConfig(
        readFileSync(configPath, "utf-8"),
        isAstroConfigName(configPath),
    );

    if (!parsed.ok) {
        fail(describeParseError(parsed, configRelative));
    }

    // Explicit CLI flags win over the config, per the documented priority.
    const defaultLocale = explicitDefaultLocale || parsed.defaultLocale || "en";

    // Sveltia requires locales to include default_locale. If they don't, the
    // parser produced a wrong list (0.4.4 read the CMS UI `locale: 'zh'`),
    // so fail loudly instead of generating a bogus TARGET_LANGS.
    const configDefault = parsed.defaultLocale || defaultLocale;

    if (
        !explicitLocales.length &&
        !parsed.locales.some((lang) => localeKey(lang) === localeKey(configDefault))
    ) {
        fail(
            `解析到的语言列表 [${parsed.locales.join(", ")}] 不包含 default_locale=${configDefault}。\n` +
                "      请确认 i18n.locales 是数组或对象数组；CMS 界面语言 `locale: 'zh'` 不会被当作语言列表。",
        );
    }

    const disk = detectContentLanguages(cwd, contentRoot);
    let source = "Sveltia 配置（i18n.locales）";

    if (explicitLocales.length) {
        source = "--locales 显式指定";
    } else if (disk.languages.length) {
        source = "Sveltia 配置 + 文件系统实测并集";
    }

    console.log(`${LOG_PREFIX} 语言来源：${source}；源语言 ${defaultLocale}`);
    console.log(`${LOG_PREFIX} 配置声明：${parsed.locales.join(", ") || "(无)"}`);
    console.log(
        `${LOG_PREFIX} 文件系统实测：${disk.languages.join(", ") || "(无)"}` +
            `（content-root ${contentRoot}，${disk.collectionCount} 个 collection）`,
    );

    if (!disk.rootExists) {
        console.log(
            `${LOG_PREFIX} ⚠️ content-root 不存在：${contentRoot}；` +
                "请用 --content-root <path> 指向实际内容目录。",
        );
    }

    const difference = diffLocales(parsed.locales, disk.languages, defaultLocale);

    if (
        disk.rootExists &&
        difference.declaredMissing.length > 0 &&
        !explicitLocales.length
    ) {
        console.log(
            `${LOG_PREFIX} ⚠️ 配置声明但目录不存在：${difference.declaredMissing.join(", ")}`,
        );
    }

    if (
        disk.rootExists &&
        difference.undeclared.length > 0 &&
        !explicitLocales.length
    ) {
        console.log(
            `${LOG_PREFIX} ⚠️ 目录存在但配置未声明：${difference.undeclared.join(", ")}` +
                "（已并入 TARGET_LANGS，建议同步补进 i18n.locales）",
        );
    }

    const targetLangs = computeTargetLangs({
        configLocales: parsed.locales,
        detectedLangs: disk.languages,
        explicitLocales,
        defaultLocale,
    });

    if (targetLangs.length === 0) {
        fail(
            `没有可翻译的目标语言（源语言 ${defaultLocale}；配置=${parsed.locales.join(",") || "无"}；` +
                `文件系统=${disk.languages.join(",") || "无"}）。\n` +
                "      请在配置里添加其它语言、用 --locales <list> 显式指定，" +
                "或用 --content-root <path> 指向实际内容目录。",
        );
    }

    // The workflow no longer needs to know which collections exist. GitHub's
    // `on.push.paths` is a static wildcard over every collection's EN folder,
    // and the per-file `autoTranslate: true` frontmatter flag decides what is
    // actually translated. Removing collection parsing also removes the whole
    // class of SKIP_COLLECTIONS / phantom-folder / trailing-comment bugs.
    const workflowTemplate = readFileSync(
        resolveI18nTemplatePath("i18n-translate.yml"),
        "utf-8",
    );
    const author = resolveCommitAuthor(args, cwd);
    // Every placeholder lands inside a YAML double-quoted scalar; escape
    // backslashes and quotes so Windows paths / custom values stay valid YAML.
    const workflow = workflowTemplate
        .replace(/__CONTENT_ROOT__/g, yamlString(contentRoot))
        .replace(/__TARGET_LANGS__/g, yamlString(targetLangs.join(",")))
        .replace(/__DETECTED_LANGS__/g, yamlString(disk.languages.join(",")))
        .replace(/__LANGS_OVERRIDE__/g, yamlString(explicitLocales.join(",")))
        .replace(/__DEFAULT_LOCALE__/g, yamlString(defaultLocale))
        .replace(/__CONFIG_FILE__/g, yamlString(configRelative))
        .replace(/__I18N_STRUCTURE__/g, yamlString(parsed.structure))
        .replace(/__COMMIT_AUTHOR_NAME__/g, yamlString(author.name))
        .replace(/__COMMIT_AUTHOR_EMAIL__/g, yamlString(author.email));

    // Fill the glossary template.
    const glossaryTemplate = readFileSync(
        resolveI18nTemplatePath("glossary.md"),
        "utf-8",
    );
    const glossary = glossaryTemplate.replace(/__PROJECT_NAME__/g, projectName);

    const remapTemplate = readFileSync(
        resolveI18nTemplatePath("remap-translations.sh"),
        "utf-8",
    );

    // All three artifacts carry a version marker so upgrades can be detected.
    const stamped = (template: string): string =>
        template.replace(/__TEMPLATE_VERSION__/g, I18N_TEMPLATE_VERSION);
    const versionComment = `<!-- ${I18N_TEMPLATE_MARKER}${I18N_TEMPLATE_VERSION} -->`;

    /**
     * Upgrades a user-editable file (the glossary) by only refreshing the
     * version marker — the user's terms are preserved verbatim. Required so
     * `init:i18n --check` can pass after upgrading from a pre-0.3.5 release.
     */
    const restampContent = (existing: string): string => {
        const markerRe = /<!--\s*astro-sveltia-pages i18n template v[\d.]+\s*-->/;

        if (markerRe.test(existing)) {
            return existing.replace(markerRe, versionComment);
        }

        return `${versionComment}\n${existing}`;
    };

    // `generated` artifacts are owned by this package and are upgraded in place
    // when an older template version is detected. `content` (the glossary) is
    // user-editable, so it is only created once and never auto-overwritten.
    const writes: {
        rel: string;
        content: string;
        mode: number;
        kind: "generated" | "content";
    }[] = [
        {
            rel: join(".github", "workflows", "i18n-translate.yml"),
            content: stamped(workflow),
            mode: 0o644,
            kind: "generated",
        },
        {
            rel: join("i18n", "glossary.md"),
            content: stamped(glossary),
            mode: 0o644,
            kind: "content",
        },
        {
            rel: join("scripts", "remap-translations.sh"),
            content: stamped(remapTemplate),
            mode: 0o755,
            kind: "generated",
        },
    ];

    const stale: { rel: string; from: string }[] = [];
    let wrote = 0;
    let upgraded = 0;
    let skipped = 0;

    for (const entry of writes) {
        const target = join(cwd, entry.rel);

        if (!existsSync(target)) {
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, entry.content, { mode: entry.mode });
            console.log(`${LOG_PREFIX} 已写入 ${entry.rel}`);
            wrote += 1;
            continue;
        }

        const existing = readFileSync(target, "utf-8");
        const foundVersion = readI18nTemplateVersion(existing);
        // A user-editable file without our marker is still "ours" if it sits at
        // the generated path: we only restamp it, never replace its content.
        const isLegacyGenerated =
            foundVersion === null && existing.includes("astro-sveltia-pages");
        const outdated =
            foundVersion !== null
                ? compareVersions(foundVersion, I18N_TEMPLATE_VERSION) < 0
                : entry.kind === "content" || isLegacyGenerated;

        if (force) {
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, entry.content, { mode: entry.mode });
            console.log(`${LOG_PREFIX} 已强制覆盖 ${entry.rel}`);
            wrote += 1;
            continue;
        }

        if (outdated) {
            stale.push({ rel: entry.rel, from: foundVersion ?? "旧版（无版本标记）" });

            if (entry.kind === "content") {
                // Preserve every user-added glossary term; only the marker moves.
                writeFileSync(target, restampContent(existing), { mode: entry.mode });
                console.log(
                    `${LOG_PREFIX} ⬆ 已更新 ${entry.rel} 的版本标记（内容保持不变）。`,
                );
                upgraded += 1;
                continue;
            }

            // Keep the previous file next to the new one; the .bak suffix is not
            // picked up by GitHub Actions as a workflow and can be deleted later.
            // `postinstall` / `--no-backup` skip it: git history is already the
            // backup when the change rides along in the upgrade commit.
            if (!noBackup) {
                copyFileSync(target, `${target}.bak`);
            }
            writeFileSync(target, entry.content, { mode: entry.mode });
            console.log(
                `${LOG_PREFIX} ⬆ 已升级 ${entry.rel}（${foundVersion ?? "旧版"} → ${I18N_TEMPLATE_VERSION}）` +
                    (noBackup
                        ? "（未生成 .bak：改动随 commit 进入仓库）"
                        : `，原文件备份为 ${entry.rel}.bak`),
            );
            upgraded += 1;
            continue;
        }

        if (foundVersion === null && entry.kind === "generated") {
            console.error(
                `${LOG_PREFIX} ⚠️ ${entry.rel} 已存在且不是本包生成的文件，未改动（确认可覆盖请加 --force）。`,
            );
            skipped += 1;
            continue;
        }

        skipped += 1;
    }

    if (!quiet) {
        if (upgraded > 0) {
            console.log(`
${LOG_PREFIX} ⚠️ 已从旧版模板升级到 ${I18N_TEMPLATE_VERSION}：
${stale.map((item) => `   • ${item.rel}（${item.from}）`).join("\n")}
${I18N_UPGRADE_NOTICE}
   ${noBackup ? "未生成 .bak：改动随本次升级 commit 进入仓库即可。" : "旧文件已备份为 *.bak，确认升级无误后可删除，或加入 .gitignore。"}
`);
        } else if (skipped > 0 && wrote === 0) {
            console.error(
                `${LOG_PREFIX} 三份文件均已存在，未做任何改动（--force 可覆盖）。`,
            );
        }

        console.log(`
${LOG_PREFIX} i18n 自动翻译已初始化（模板 ${I18N_TEMPLATE_VERSION}，源语言 ${defaultLocale} → ${targetLangs.join(", ")}）。

下一步（必做）：
1. 仓库 Secret（Settings → Secrets and variables → Actions → New repository secret）：
   • DEEPSEEK_API_KEY —— DeepSeek API Key（https://platform.deepseek.com，sk- 开头）。
2. 在 Sveltia CMS 的每个集合 fields 里加一个开关（并写进 _template.md）：
     { label: '自动翻译', name: 'autoTranslate', widget: 'boolean',
       default: false, i18n: 'duplicate' }
   并确认 backend 没有配置 skip_ci: true。
3. ⚠️ 提交信息里绝不能出现方括号包裹的 CI 跳过标记（如 [skip ci] / [ci skip]），
   否则整次 push 的工作流与 CF 部署都会被跳过。
4. 在 ${contentRoot}/**/en/** 下发布一个 ${defaultLocale} 文件、并把 frontmatter 的
   autoTranslate 设为 true，即会触发 i18n-translate；不打开开关就是普通修改。
   其它语言版本在 CMS 后台随意修改都不会触发工作流。
5. 推荐在 package.json 配置 postinstall 钩子，升级依赖时自动同步三份模板：
     "postinstall": "${I18N_POSTINSTALL_COMMAND}"
   本地 pnpm add / pnpm install 即自动跑，改动随升级那次 commit 进入仓库。
   未配置钩子时，每次升级需重跑 \`${I18N_UPGRADE_COMMAND}\`
   （或 \`${I18N_CHECK_COMMAND}\` 在 CI 中拦截过期模板）。
`);
    }
}

/** Reads the version from the package root (dist/cli.mjs -> ../package.json). */
function readPackageVersion(): string {
    try {
        const path = fileURLToPath(new URL("../package.json", import.meta.url));
        const pkg = JSON.parse(readFileSync(path, "utf-8")) as { version?: string };

        return pkg.version ?? "unknown";
    } catch {
        return "unknown";
    }
}

const CLI_USAGE = `
${LOG_PREFIX} Usage:
  astro-sveltia-pages init [--platform cloudflare|edgeone|vercel|netlify|deno] [--site-url <url>]
  astro-sveltia-pages init:i18n [--config <path>] [--content-root <path>]
                                [--default-locale <lang>] [--locales <list>]
                                [--project-name <name>]
                                [--commit-author "Name <email>"]
                                [--force] [--check] [--no-backup] [--postinstall]
  astro-sveltia-pages --help
  astro-sveltia-pages --version

Commands:
  init        Copy the GitHub OAuth edge function and update .env.example.
              This is the default when no command is given.
  init:i18n   Generate (or upgrade) the i18n auto-translation workflow,
              glossary and remap script. Also available as \`init --i18n\`.

Flags:
  --help, -h      Print this usage and exit.
  --version, -v   Print the package version and exit.
  --platform      Deployment platform for the OAuth proxy:
                    cloudflare (default) -> functions/auth.js
                    edgeone              -> edge-functions/auth.js
                    vercel               -> api/auth.js
                    netlify              -> netlify/edge-functions/auth.js
                    deno                 -> serve.js (project root)
  --site-url      Production site origin, used to print the exact OAuth
                  callback URL and admin URL in the next steps.
  --locales       Comma-separated target locales for init:i18n; overrides both
                  the Sveltia config and on-disk language detection.
  --postinstall   Hook mode for package.json postinstall: no-op when i18n is not
                  enabled, upgrade only stale snapshots, no .bak, never fails
                  the install, and prints a reminder to commit the change.
  --no-backup     Skip *.bak copies (git history is the backup).
  --commit-author Fix the git author of translated commits, e.g.
                  "Your Name <you@users.noreply.github.com>".
                  Empty = attribute each run to whoever triggered it.
`;

/**
 * Node resolves the ESM main module through symlinks, while `process.argv[1]`
 * keeps the path pnpm's bin shim passed in (`node_modules/<pkg>/dist/cli.mjs`
 * points into the `.pnpm` store). A raw string comparison therefore fails under
 * pnpm: the whole dispatch block is skipped and the CLI exits 0 with no output.
 * Compare canonical real paths instead (case-insensitively on Windows).
 */
function isCliInvokedAsScript(): boolean {
    const entry = process.argv[1];

    if (!entry) {
        return false;
    }

    const normalize = (value: string): string =>
        process.platform === "win32" ? value.toLowerCase() : value;

    try {
        const self = fileURLToPath(import.meta.url);
        const invoked = resolve(entry);

        if (normalize(invoked) === normalize(self)) {
            return true;
        }

        return (
            normalize(realpathSync.native(invoked)) ===
            normalize(realpathSync.native(self))
        );
    } catch {
        return false;
    }
}

function isI18nCommand(args: string[]): boolean {
    return args[0] === "init:i18n" || (args[0] === "init" && args.includes("--i18n"));
}

/**
 * Flags accepted by the default OAuth `init`. Anything else is a typo and must
 * not silently start `init`, which writes files into the project.
 */
const INIT_VALUE_FLAGS = new Set(["--platform", "--site-url"]);

function invalidInitFlag(args: string[]): string | undefined {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] ?? "";

        if (!arg.startsWith("-")) {
            continue; // a value consumed by the previous flag
        }

        const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;

        if (!INIT_VALUE_FLAGS.has(name)) {
            return arg;
        }

        const hasInlineValue = arg.includes("=");
        const next = args[index + 1];

        if (!hasInlineValue && (next === undefined || next.startsWith("-"))) {
            return arg; // missing value
        }

        if (!hasInlineValue) {
            index += 1; // skip the value
        }
    }

    return undefined;
}

function failUnknownCommand(command: string): never {
    console.error(
        `${LOG_PREFIX} Unknown command: ${command}\n` +
            "      Available commands: init, init:i18n (also `init --i18n`).",
    );
    console.error(CLI_USAGE);
    process.exit(1);
}

/** Dispatches one CLI invocation. Unknown commands/flags fail loudly (exit 1). */
export function dispatchCli(args: string[], cwd: string = process.cwd()): void {
    if (args.includes("--version") || args.includes("-v")) {
        console.log(readPackageVersion());
        return;
    }

    if (args.includes("--help") || args.includes("-h")) {
        console.log(CLI_USAGE);
        return;
    }

    if (isI18nCommand(args)) {
        const rest =
            args[0] === "init:i18n"
                ? args.slice(1)
                : args.slice(1).filter((arg) => arg !== "--i18n");
        runInitI18n(rest, cwd);
        return;
    }

    const first = args[0];

    // No command, an explicit `init`, or a bare flag set all run the OAuth
    // init — but only after verifying every flag is one we actually support.
    if (!first || first === "init" || first.startsWith("-")) {
        const initArgs = first === "init" ? args.slice(1) : args;
        const invalid = invalidInitFlag(initArgs);

        if (invalid) {
            failUnknownCommand(invalid);
        }

        runInit(initArgs, cwd);
        return;
    }

    failUnknownCommand(first);
}

if (isCliInvokedAsScript()) {
    try {
        dispatchCli(process.argv.slice(2), process.cwd());
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);

        fail(message);
    }
}

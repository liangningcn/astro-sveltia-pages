#!/usr/bin/env node
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    I18N_CHECK_COMMAND,
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
export type InitPlatform = "cloudflare" | "edgeone";

type PlatformDescriptor = {
    /** Human readable platform name. */
    label: string;
    /** Template path relative to the package root. */
    template: string;
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
        dir: "functions",
        envHint: "the Cloudflare Pages dashboard (Settings -> Environment variables)",
        siteHint: "the Cloudflare Pages dashboard",
    },
    edgeone: {
        label: "EdgeOne Pages",
        template: "templates/auth.js",
        dir: "edge-functions",
        envHint:
            "the EdgeOne Pages dashboard (Project settings -> Environment variables)",
        siteHint: "the EdgeOne Pages dashboard",
    },
};

const DEFAULT_PLATFORM: InitPlatform = "cloudflare";

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
    ];
}

function fail(message: string): never {
    console.error(`${LOG_PREFIX} init failed: ${message}`);
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

    if (value !== "cloudflare" && value !== "edgeone") {
        fail(`unknown --platform "${value}" (expected "cloudflare" or "edgeone").`);
    }

    return value;
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

    const functionsDir = join(cwd, descriptor.dir);
    const target = join(functionsDir, "auth.js");

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

function extractDefaultLocale(text: string): string {
    const match = text.match(/default_locale:\s*['"](\w+)['"]/);
    return match ? match[1] : "";
}

function extractLocales(text: string): string[] {
    // Object form: locales: [{ locale: "en", label: "..." }, ...]
    // The `(?:^|[{,\s])` guard prevents matching `default_locale: "en"` — an
    // unguarded /locale:/ also matches the tail of `default_locale`, which used
    // to make array-form configs resolve to just the default locale.
    const objectKeys = [
        ...text.matchAll(/(?:^|[{,\s])locale:\s*['"]([\w-]+)['"]/g),
    ].map((m) => m[1]);

    if (objectKeys.length > 0) {
        return objectKeys;
    }

    // Array form: locales: ["en", "fr", "de"]. The negative lookbehind keeps
    // `initial_locales` out while still allowing an inline single-line config
    // such as `i18n: { default_locale: 'en', locales: ['en','fr'] }`.
    const block = text.match(/(?<![\w])locales:\s*\[([^\]]*)\]/);

    if (block) {
        return [...block[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]);
    }

    return [];
}

function extractStructure(text: string): string {
    const match = text.match(
        /structure:\s*['"](multiple_folders|single_file|multiple_files)['"]/,
    );
    return match ? match[1] : "multiple_folders";
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

function readI18nConfigPath(cwd: string, configArg: string | undefined): string {
    const candidates = configArg
        ? [configArg]
        : [
              "sveltia-cms.config.mjs",
              "sveltia-cms.config.js",
              "src/sveltia-cms.config.mjs",
              "src/sveltia-cms.config.js",
          ];

    for (const candidate of candidates) {
        const path = join(cwd, candidate);

        if (existsSync(path)) {
            return path;
        }
    }

    fail(
        "未找到 Sveltia CMS 配置文件（默认查找 sveltia-cms.config.mjs）。\n" +
            "      请通过 --config <path> 指定，或在项目根目录创建 `sveltia-cms.config.mjs`（见 README）。",
    );
}

export function runInitI18n(args: string[], cwd: string = process.cwd()): void {
    if (args.includes("--check")) {
        checkI18nTemplates(cwd);
        return;
    }

    const force = args.includes("--force") || args.includes("--force=true");
    const configArg = readArgValue(args, "--config");
    const contentRoot = readArgValue(args, "--content-root") ?? "src/content";
    const requestedDefaultLocale = readArgValue(args, "--default-locale") ?? "en";
    const projectName = readArgValue(args, "--project-name") ?? deriveProjectName(cwd);

    const configPath = readI18nConfigPath(cwd, configArg);
    const configRelative = relative(cwd, configPath) || "sveltia-cms.config.mjs";
    const configText = readFileSync(configPath, "utf-8");

    const rawLocales = extractLocales(configText);

    if (rawLocales.length === 0) {
        fail(
            "未能从 Sveltia 配置解析出 locales。\n" +
                '      请确认配置包含 locales: [...] 或 locales: [{ locale: "en" }]。',
        );
    }

    const defaultLocale = extractDefaultLocale(configText) || requestedDefaultLocale;
    const structure = extractStructure(configText);
    const targetLangs = rawLocales.filter((lang) => lang !== defaultLocale).sort();

    if (targetLangs.length === 0) {
        fail(
            `解析到 locales=${rawLocales.join(",")} 但 default_locale=${defaultLocale}，` +
                "没有可翻译的目标语言。请在配置里添加除源语言外的其它语言。",
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
    const workflow = workflowTemplate
        .replace(/__CONTENT_ROOT__/g, contentRoot)
        .replace(/__TARGET_LANGS__/g, targetLangs.join(","))
        .replace(/__CONFIG_FILE__/g, configRelative)
        .replace(/__I18N_STRUCTURE__/g, structure);

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
            copyFileSync(target, `${target}.bak`);
            writeFileSync(target, entry.content, { mode: entry.mode });
            console.log(
                `${LOG_PREFIX} ⬆ 已升级 ${entry.rel}（${foundVersion ?? "旧版"} → ${I18N_TEMPLATE_VERSION}），原文件备份为 ${entry.rel}.bak`,
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

    if (upgraded > 0) {
        console.log(`
${LOG_PREFIX} ⚠️ 已从旧版模板升级到 ${I18N_TEMPLATE_VERSION}：
${stale.map((item) => `   • ${item.rel}（${item.from}）`).join("\n")}
${I18N_UPGRADE_NOTICE}
   旧文件已备份为 *.bak，确认升级无误后可删除，或加入 .gitignore。
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
5. 每次升级 astro-sveltia-pages 后重跑 \`${I18N_UPGRADE_COMMAND}\`
   （或 \`${I18N_CHECK_COMMAND}\` 在 CI 中拦截过期模板）。
`);
}

const CLI_USAGE = `
${LOG_PREFIX} Usage:
  astro-sveltia-pages init [--platform cloudflare|edgeone] [--site-url <url>]
  astro-sveltia-pages init:i18n [--config <path>] [--content-root <path>]
                                [--default-locale <lang>] [--project-name <name>]
                                [--force] [--check]
  astro-sveltia-pages --help

Commands:
  init        Copy the GitHub OAuth edge function and update .env.example.
              This is the default when no command is given.
  init:i18n   Generate (or upgrade) the i18n auto-translation workflow,
              glossary and remap script. Also available as \`init --i18n\`.
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

function failUnknownCommand(command: string): never {
    console.error(
        `${LOG_PREFIX} Unknown command: ${command}\n` +
            "      Available commands: init, init:i18n (also `init --i18n`).\n" +
            "      Run `astro-sveltia-pages --help` for usage.",
    );
    process.exit(1);
}

/** Dispatches one CLI invocation. Unknown subcommands fail loudly (exit 1). */
export function dispatchCli(args: string[], cwd: string = process.cwd()): void {
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

    // Keep the historical behaviour: no command, an explicit `init`, or a bare
    // flag (e.g. `--platform edgeone`) all run the OAuth init.
    if (!first || first === "init" || first.startsWith("-")) {
        runInit(first === "init" ? args.slice(1) : args, cwd);
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

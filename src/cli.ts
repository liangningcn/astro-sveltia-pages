#!/usr/bin/env node
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { LOG_PREFIX } from "./options.js";

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
    const objectKeys = [...text.matchAll(/locale:\s*['"](\w+)['"]/g)].map((m) => m[1]);

    if (objectKeys.length > 0) {
        return objectKeys;
    }

    // Array form: locales: ["en", "fr", "de"]
    const block = text.match(/locales:\s*\[([^\]]*)\]/);

    if (block) {
        return [...block[1].matchAll(/['"](\w+)['"]/g)].map((m) => m[1]);
    }

    return [];
}

function extractStructure(text: string): string {
    const match = text.match(
        /structure:\s*['"](multiple_folders|single_file|multiple_files)['"]/,
    );
    return match ? match[1] : "multiple_folders";
}

type I18nCollection = { name: string; folder: string; translated: boolean };

/**
 * Extracts content collections from a Sveltia CMS config. A collection is
 * considered "translated" (and thus wired into the workflow) when its block
 * declares `save_all_locales: false`, `initial_locales`, or a
 * `multiple_folders` structure — the Sveltia settings that make CI-driven
 * per-locale translation safe.
 */
function extractCollections(text: string): I18nCollection[] {
    const result: I18nCollection[] = [];
    const folderRe = /folder:\s*['"]([^'"]+)['"]/g;
    const matches: { value: string; index: number }[] = [];
    let match: RegExpExecArray | null;

    while ((match = folderRe.exec(text)) !== null) {
        matches.push({ value: match[1], index: match.index ?? 0 });
    }

    for (let index = 0; index < matches.length; index += 1) {
        const segmentEnd =
            index + 1 < matches.length ? matches[index + 1].index : text.length;
        const segment = text.slice(matches[index].index, segmentEnd);

        // Walk backwards a little to find the nearest `name:` for this collection.
        const before = text.slice(
            Math.max(0, matches[index].index - 600),
            matches[index].index,
        );
        const nameMatches = [...before.matchAll(/name:\s*['"]([\w-]+)['"]/g)];
        const name =
            nameMatches.length > 0
                ? nameMatches[nameMatches.length - 1][1]
                : matches[index].value;

        const translated =
            /save_all_locales:\s*false/.test(segment) ||
            /initial_locales/.test(segment) ||
            /structure:\s*['"]multiple_folders['"]/.test(segment);

        result.push({ name, folder: matches[index].value, translated });
    }

    return result;
}

/** Builds the `on.push.paths` entry for a collection's English source folder. */
function collectionEnPath(contentRoot: string, folder: string): string {
    let relative = folder;

    if (relative.startsWith(`${contentRoot}/`)) {
        relative = relative.slice(contentRoot.length + 1);
    } else if (relative.startsWith(contentRoot)) {
        relative = relative.slice(contentRoot.length);
    }

    return `${contentRoot}/${relative}/en/**`;
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
            "      请通过 --config <path> 指定，或先运行 `npx sveltia-cms init` 生成配置。",
    );
}

export function runInitI18n(args: string[], cwd: string = process.cwd()): void {
    const force = args.includes("--force") || args.includes("--force=true");
    const configArg = readArgValue(args, "--config");
    const contentRoot = readArgValue(args, "--content-root") ?? "src/content";
    const requestedDefaultLocale = readArgValue(args, "--default-locale") ?? "en";
    const projectName = readArgValue(args, "--project-name") ?? deriveProjectName(cwd);
    const skipArg = readArgValue(args, "--skip-collections");
    const collectionsArg = readArgValue(args, "--collections");

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

    let collections = extractCollections(configText);

    if (collectionsArg) {
        const wanted = collectionsArg
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const matched = collections.filter(
            (collection) =>
                wanted.includes(collection.name) || wanted.includes(collection.folder),
        );
        collections =
            matched.length > 0
                ? matched
                : wanted.map((value) => ({
                      name: value,
                      folder: value,
                      translated: true,
                  }));
    }

    const translatedCollections = collections.filter(
        (collection) => collection.translated,
    );

    if (translatedCollections.length === 0) {
        fail(
            "未发现可翻译的集合（集合需设 i18n.save_all_locales: false）。\n" +
                "      可用 --collections <name1,name2> 显式指定要翻译的集合。",
        );
    }

    const enPaths = translatedCollections.map((collection) =>
        collectionEnPath(contentRoot, collection.folder),
    );
    const translatedFolders = new Set(
        translatedCollections.map((collection) => collection.folder),
    );
    let skipCollections = collections
        .filter((collection) => !translatedFolders.has(collection.folder))
        .map((collection) => collection.name);
    if (skipArg) {
        skipCollections = skipArg
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }

    // Fill the workflow template.
    const workflowTemplate = readFileSync(
        resolveI18nTemplatePath("i18n-translate.yml"),
        "utf-8",
    );
    const pathItems = enPaths.map((path) => `- "${path}"`).join("\n            ");
    const workflow = workflowTemplate
        .replace('- "__COLLECTION_EN_PATH__"', pathItems)
        .replace(/__CONTENT_ROOT__/g, contentRoot)
        .replace(/__TARGET_LANGS__/g, targetLangs.join(","))
        .replace(/__CONFIG_FILE__/g, configRelative)
        .replace(/__SKIP_COLLECTIONS__/g, skipCollections.join(","))
        .replace(/__I18N_STRUCTURE__/g, structure);

    // Fill the glossary template.
    const glossaryTemplate = readFileSync(
        resolveI18nTemplatePath("glossary.md"),
        "utf-8",
    );
    const glossary = glossaryTemplate.replace(/__PROJECT_NAME__/g, projectName);

    // remap-translations.sh is copied verbatim (positional args, no placeholders).
    const remapTemplate = readFileSync(
        resolveI18nTemplatePath("remap-translations.sh"),
        "utf-8",
    );

    const writes = [
        {
            rel: join(".github", "workflows", "i18n-translate.yml"),
            content: workflow,
            mode: 0o644,
        },
        { rel: join("i18n", "glossary.md"), content: glossary, mode: 0o644 },
        {
            rel: join("scripts", "remap-translations.sh"),
            content: remapTemplate,
            mode: 0o755,
        },
    ];

    let wrote = 0;
    let skipped = 0;

    for (const entry of writes) {
        const target = join(cwd, entry.rel);

        if (existsSync(target) && !force) {
            console.error(
                `${LOG_PREFIX} ${entry.rel} 已存在，跳过（用 --force 覆盖）。`,
            );
            skipped += 1;
            continue;
        }

        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.content, { mode: entry.mode });
        console.log(`${LOG_PREFIX} 已写入 ${entry.rel}`);
        wrote += 1;
    }

    if (skipped > 0 && wrote === 0) {
        console.error(
            `${LOG_PREFIX} 三份文件均已存在，未做任何改动（--force 可覆盖）。`,
        );
    }

    console.log(`
${LOG_PREFIX} i18n 自动翻译已初始化（源语言 ${defaultLocale} → ${targetLangs.join(", ")}）。

下一步（必做）：
1. 仓库 Secret（Settings → Secrets and variables → Actions → New repository secret）：
   • DEEPSEEK_API_KEY —— DeepSeek API Key（https://platform.deepseek.com，sk- 开头）。
2. Sveltia CMS 配置（${configRelative}）每个要翻译的集合必须设置：
     i18n: { save_all_locales: false, initial_locales: ['${defaultLocale}'] }
   且 backend 不能配置 skip_ci: true。
3. ⚠️ 提交信息里绝不能出现方括号包裹的 CI 跳过标记（如 [skip ci] / [ci skip]），
   否则整次 push 的工作流与 CF 部署都会被跳过。
4. 推送一个 ${defaultLocale} 源文件（如 ${enPaths[0]}）即可触发 i18n-translate。
`);
}

function isCliInvokedAsScript(): boolean {
    const entry = process.argv[1];

    return Boolean(entry) && fileURLToPath(import.meta.url) === entry;
}

function isI18nCommand(args: string[]): boolean {
    return args[0] === "init:i18n" || (args[0] === "init" && args.includes("--i18n"));
}

if (isCliInvokedAsScript()) {
    try {
        const args = process.argv.slice(2);

        if (isI18nCommand(args)) {
            const rest =
                args[0] === "init:i18n"
                    ? args.slice(1)
                    : args.slice(1).filter((arg) => arg !== "--i18n");
            runInitI18n(rest, process.cwd());
        } else {
            runInit(args, process.cwd());
        }
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);

        fail(message);
    }
}

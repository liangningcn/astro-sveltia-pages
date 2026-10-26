#!/usr/bin/env node
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
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

function isCliInvokedAsScript(): boolean {
    const entry = process.argv[1];

    return Boolean(entry) && fileURLToPath(import.meta.url) === entry;
}

if (isCliInvokedAsScript()) {
    try {
        runInit(process.argv.slice(2));
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);

        fail(message);
    }
}

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

/**
 * Resolves the bundled auth.js template. In the published package it lives in
 * `dist/templates/` (next to this file); when running from source it is one
 * level up (`templates/`).
 */
function resolveTemplatePath(): string {
    for (const candidate of [
        "./templates/functions/auth.js",
        "../templates/functions/auth.js",
    ]) {
        const path = fileURLToPath(new URL(candidate, import.meta.url));

        if (existsSync(path)) {
            return path;
        }
    }

    return fileURLToPath(new URL("./templates/functions/auth.js", import.meta.url));
}

const TEMPLATE_PATH = resolveTemplatePath();

const GITHUB_OAUTH_APPS_URL = "https://github.com/settings/developers";

const ENV_ENTRIES = [
    { key: "GITHUB_CLIENT_ID", comment: "# Get this from your GitHub OAuth App." },
    {
        key: "GITHUB_CLIENT_SECRET",
        comment:
            "# GITHUB_CLIENT_SECRET and ENVIRONMENT must be configured in the Cloudflare Pages\n" +
            "# dashboard (Settings -> Environment variables). Do not commit real values.",
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
            "# in the Cloudflare Pages dashboard (used as the OAuth origin, keeping the\n" +
            "# callback consistent across custom domains, *.pages.dev and local dev).",
    },
] as const;

function fail(message: string): never {
    console.error(`${LOG_PREFIX} init failed: ${message}`);
    process.exit(1);
}

function readSiteUrlFromArgs(args: string[]): string | undefined {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === "--site-url") {
            return args[index + 1];
        }

        if (arg?.startsWith("--site-url=")) {
            return arg.slice("--site-url=".length);
        }
    }

    return undefined;
}

function hasEnvKey(content: string, key: string): boolean {
    return new RegExp(`^\\s*${key}=`, "m").test(content);
}

function appendEnvEntries(envExamplePath: string): void {
    const existing = existsSync(envExamplePath)
        ? readFileSync(envExamplePath, "utf-8")
        : "";

    const missing = ENV_ENTRIES.filter((entry) => !hasEnvKey(existing, entry.key));

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

function copyAuthTemplate(functionsDir: string): void {
    if (!existsSync(TEMPLATE_PATH)) {
        fail(
            `auth.js template is missing from the installed package (${TEMPLATE_PATH}).`,
        );
    }

    const target = join(functionsDir, "auth.js");

    if (existsSync(target)) {
        console.error(`${LOG_PREFIX} ${target} already exists, skipping.`);
        process.exit(1);
    }

    mkdirSync(functionsDir, { recursive: true });
    copyFileSync(TEMPLATE_PATH, target);
    console.log(`${LOG_PREFIX} Created ${target}.`);
}

function printGuidance(siteUrl: string | undefined): void {
    const callbackUrl = siteUrl
        ? `${siteUrl.replace(/\/+$/, "")}/auth`
        : "<your-site-url>/auth";

    console.log(`
${LOG_PREFIX} Next steps:

1. Create a GitHub OAuth App: ${GITHUB_OAUTH_APPS_URL}
   - Authorization callback URL: ${callbackUrl}
2. Set the environment variables in the Cloudflare Pages dashboard
   (Settings -> Environment variables):
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
                `  - The custom domain shown in the Cloudflare Pages dashboard\n` +
                `Re-run with --site-url <url> to print exact URLs next time.\n`,
        );
    }
}

export function runInit(args: string[], cwd: string = process.cwd()): void {
    const siteUrl = readSiteUrlFromArgs(args);
    const functionsDir = join(cwd, "functions");

    copyAuthTemplate(functionsDir);
    appendEnvEntries(join(cwd, ".env.example"));
    printGuidance(siteUrl);
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

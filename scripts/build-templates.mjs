/**
 * Builds the deployable function templates.
 *
 * The runtime lives in `src/functions`; the templates are the bundled,
 * dependency-free files that users copy into their project. Bundling keeps a
 * single source of truth: the shipped JavaScript is always the tested
 * TypeScript implementation.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { format } from "vite-plus/fmt";

const root = fileURLToPath(new URL("..", import.meta.url));

const TARGETS = [
    {
        platform: "Cloudflare Pages",
        entry: "src/functions/entries/cloudflare.ts",
        outDir: "templates/functions",
        target: "functions/auth.js",
    },
    {
        platform: "EdgeOne Pages",
        entry: "src/functions/entries/edgeone.ts",
        outDir: "templates/edge-functions",
        target: "edge-functions/auth.js",
    },
];

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

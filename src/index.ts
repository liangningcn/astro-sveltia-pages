import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AstroIntegration, AstroIntegrationLogger } from "astro";
import { dump } from "js-yaml";

import {
    DEFAULT_APP_TITLE,
    DEFAULT_SVELTIA_VERSION,
    buildCmsConfig,
} from "./build-config.js";
import { injectCollectionTypes, writeConfigToDisk } from "./codegen.js";
import type { PlatformName } from "./functions/adapter.js";
import { LOG_PREFIX, validateOptions, type SveltiaPagesOptions } from "./options.js";

export type { BuildCmsConfigResult } from "./build-config.js";
export type { SveltiaCollection, SveltiaPagesOptions } from "./options.js";

const SCHEMA_COMMENT =
    "# yaml-language-server: $schema=https://unpkg.com/@sveltia/cms/schema/sveltia-cms.json";
const ADMIN_DIR = "admin";

/** Editor-only schema hint; Sveltia CMS does not depend on it at runtime. */
function buildConfigYaml(config: Record<string, unknown>): string {
    return `${SCHEMA_COMMENT}\n${dump(config, { lineWidth: -1, noRefs: true })}`;
}

function buildIndexHtml(appTitle: string, sveltiaVersion: string): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>${appTitle}</title>
    <link rel="cms-config-url" href="/${ADMIN_DIR}/config.yml" />
  </head>
  <body>
    <script src="https://unpkg.com/@sveltia/cms@${sveltiaVersion}/dist/sveltia-cms.js"></script>
  </body>
</html>
`;
}

/** Human readable description of the deployment platform. */
function describePlatform(platform: PlatformName | undefined): {
    name: PlatformName;
    label: string;
    functionDir: string;
} {
    if (platform === "edgeone") {
        return {
            name: "edgeone",
            label: "EdgeOne Pages",
            functionDir: "edge-functions",
        };
    }

    return { name: "cloudflare", label: "Cloudflare Pages", functionDir: "functions" };
}

/**
 * Generates `admin/index.html` and `admin/config.yml` into the build output.
 * Any write failure aborts the build instead of degrading to a warning.
 */
function writeAdminFiles(
    outDir: URL,
    config: Record<string, unknown>,
    appTitle: string,
    sveltiaVersion: string,
    logger: AstroIntegrationLogger,
): void {
    try {
        const adminDirUrl = new URL(`${ADMIN_DIR}/`, outDir);
        const adminDir = fileURLToPath(adminDirUrl);

        mkdirSync(adminDir, { recursive: true });
        writeFileSync(
            fileURLToPath(new URL("config.yml", adminDirUrl)),
            buildConfigYaml(config),
        );
        writeFileSync(
            fileURLToPath(new URL("index.html", adminDirUrl)),
            buildIndexHtml(appTitle, sveltiaVersion),
        );
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);

        logger.error(`Failed to write the admin UI files: ${message}`);
        throw new Error(
            `${LOG_PREFIX} Failed to write the admin UI files: ${message}`,
            { cause },
        );
    }
}

export default function sveltiaPages(options: SveltiaPagesOptions): AstroIntegration {
    validateOptions(options);

    const appTitle = options.appTitle ?? DEFAULT_APP_TITLE;
    const sveltiaVersion = options.sveltiaVersion ?? DEFAULT_SVELTIA_VERSION;
    const platform = describePlatform(options.platform);
    // Captured during `astro:config:setup` (when Astro's `site` is available)
    // and reused in `astro:build:done`, which has no config access.
    let cmsConfig: Record<string, unknown> | undefined;

    return {
        name: "astro-sveltia-pages",
        hooks: {
            "astro:config:setup": ({ config, createCodegenDir, logger }) => {
                const { config: generated, conflicts } = buildCmsConfig(
                    options,
                    config.site,
                );

                for (const key of conflicts) {
                    logger.warn(
                        `extraConfig key "${key}" overrides the generated value.`,
                    );
                }

                cmsConfig = generated;
                writeConfigToDisk(createCodegenDir, generated);

                logger.info(
                    `CMS config generated for ${options.collections.length} ` +
                        `collection(s); the admin UI will be written to /${ADMIN_DIR}/ at build time.`,
                );
            },

            "astro:config:done": ({ injectTypes }) => {
                const finalConfig =
                    cmsConfig ?? buildCmsConfig(options, undefined).config;

                injectCollectionTypes(injectTypes, finalConfig as never);
            },

            "astro:build:done": ({ dir, logger }) => {
                const finalConfig =
                    cmsConfig ?? buildCmsConfig(options, undefined).config;

                writeAdminFiles(
                    dir,
                    finalConfig as Record<string, unknown>,
                    appTitle,
                    sveltiaVersion,
                    logger,
                );
                logger.info(
                    `Sveltia CMS admin UI written to /${ADMIN_DIR}/. ` +
                        `Deploy the GitHub OAuth proxy to ${platform.label}: ` +
                        `run "astro-sveltia-pages init --platform ${platform.name}" ` +
                        `to create ${platform.functionDir}/auth.js.`,
                );
            },
        },
    };
}

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CmsConfig, EntryCollection } from "@sveltia/cms";
import type { AstroConfig, AstroIntegration, HookParameters } from "astro";

import { isEntryCollection } from "./config.js";

export type { CmsConfig };

export type SveltiaOptions = {
    route?: string;
    title?: string;
    config: CmsConfig;
    /** Set to `false` to skip the built-in GitHub OAuth routes. */
    oauth?: boolean;
};

const VIRTUAL_MODULE_ID = "virtual:astro-sveltia-pages/config";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;

const OAUTH_AUTH_ROUTE = "/api/auth";
const OAUTH_CALLBACK_ROUTE = "/api/callback";

/** Sveltia requires `collections` or `singletons`; this hidden one prevents a crash. */
const PLACEHOLDER_COLLECTION_NAME = "__sveltia_placeholder__";

const PLACEHOLDER_COLLECTION: EntryCollection = {
    name: PLACEHOLDER_COLLECTION_NAME,
    label: "Placeholder",
    folder: "src/content",
    hide: true,
    fields: [{ name: "title", label: "Title", widget: "string" }],
};

type ConfigSetupOptions = HookParameters<"astro:config:setup">;
type TrailingSlash = AstroConfig["trailingSlash"];

/** `trailingSlash: "always"` requires the injected page route to end with a slash. */
function applyTrailingSlash(route: string, trailingSlash: TrailingSlash): string {
    if (trailingSlash === "always" && !route.endsWith("/")) {
        return `${route}/`;
    }

    return route;
}

function getCollectionNames(config: CmsConfig): string[] {
    return (config.collections ?? [])
        .filter(isEntryCollection)
        .map((collection) => collection.name)
        .filter((name) => name !== PLACEHOLDER_COLLECTION_NAME);
}

function withPlaceholderCollection(config: CmsConfig): CmsConfig {
    if ((config.collections ?? []).length > 0) {
        return config;
    }

    return { ...config, collections: [PLACEHOLDER_COLLECTION] };
}

function buildVirtualModuleSource(config: CmsConfig, title: string): string {
    // JSON.stringify is safe here: the config is user-controlled and served as a
    // JS module (not injected into an HTML script tag), so </script> sequences
    // are not a concern. Any unusual Unicode is the user's responsibility.
    return `
    export const config = ${JSON.stringify(config)};
    export const title = ${JSON.stringify(title)};
  `;
}

function buildTypeDeclaration(collectionNames: string[]): string {
    if (collectionNames.length === 0) {
        return "";
    }

    const unionType = collectionNames.map((n) => JSON.stringify(n)).join(" | ");

    return `declare module "astro-sveltia-pages/loader" {
  import type { EntryCollection } from "@sveltia/cms";
  import type { SveltiaLoader } from "astro-sveltia-pages/loader";

  type SveltiaCollectionName = ${unionType};

  export function sveltiaLoader(
    name: SveltiaCollectionName,
    options?: { locale?: string },
  ): SveltiaLoader;
  export function sveltiaLoader(
    collection: EntryCollection,
    options?: { locale?: string },
  ): SveltiaLoader;
}
`;
}

/** Serve the CMS config and title to `admin.astro` through a virtual module. */
function setupVirtualModule(
    updateConfig: ConfigSetupOptions["updateConfig"],
    config: CmsConfig,
    title: string,
): void {
    updateConfig({
        vite: {
            plugins: [
                {
                    name: "vite-plugin-astro-loader-sveltia-cms-config",
                    resolveId(id) {
                        if (id === VIRTUAL_MODULE_ID) {
                            return RESOLVED_VIRTUAL_MODULE_ID;
                        }
                    },
                    load(id) {
                        if (id === RESOLVED_VIRTUAL_MODULE_ID) {
                            return buildVirtualModuleSource(config, title);
                        }
                    },
                },
            ],
        },
    });
}

/** Persist the CMS config for the content loader's name-based lookup. */
function writeConfigToDisk(
    createCodegenDir: ConfigSetupOptions["createCodegenDir"],
    userConfig: CmsConfig,
): void {
    // Write the config without the hidden placeholder so the content
    // loader only sees collections the user has defined.
    const codegenDir = createCodegenDir();

    writeFileSync(
        fileURLToPath(new URL("config.json", codegenDir)),
        JSON.stringify(userConfig),
    );
}

/** Inject the GitHub OAuth endpoints when the GitHub backend is configured. */
function injectOAuthRoutes(
    injectRoute: ConfigSetupOptions["injectRoute"],
    userConfig: CmsConfig,
    oauthEnabled: boolean,
    logger: ConfigSetupOptions["logger"],
): void {
    if (oauthEnabled && userConfig.backend.name === "github") {
        injectRoute({
            pattern: OAUTH_AUTH_ROUTE,
            entrypoint: fileURLToPath(
                new URL("./routes/auth.mjs", import.meta.url),
            ),
            prerender: false,
        });
        injectRoute({
            pattern: OAUTH_CALLBACK_ROUTE,
            entrypoint: fileURLToPath(
                new URL("./routes/callback.mjs", import.meta.url),
            ),
            prerender: false,
        });

        logger.info(
            `Sveltia CMS GitHub OAuth routes injected at ${OAUTH_AUTH_ROUTE} ` +
                `and ${OAUTH_CALLBACK_ROUTE}`,
        );
    }
}

export default function sveltiaCms(options: SveltiaOptions): AstroIntegration {
    const route = options.route ?? "/admin";
    const title = options.title ?? "Sveltia CMS";
    const oauthEnabled = options.oauth !== false;
    const userConfig: CmsConfig = {
        media_folder: "public/uploads",
        public_folder: "/uploads",
        ...options.config,
        load_config_file: false,
    };
    const cmsConfig = withPlaceholderCollection(userConfig);

    return {
        name: "astro-loader-sveltia-cms",
        hooks: {
            "astro:config:setup": ({
                config,
                injectRoute,
                updateConfig,
                createCodegenDir,
                logger,
            }) => {
                const routePattern = applyTrailingSlash(route, config.trailingSlash);

                injectRoute({
                    pattern: routePattern,
                    entrypoint: fileURLToPath(
                        new URL("./admin.astro", import.meta.url),
                    ),
                });

                injectOAuthRoutes(injectRoute, userConfig, oauthEnabled, logger);
                writeConfigToDisk(createCodegenDir, userConfig);
                setupVirtualModule(updateConfig, cmsConfig, title);

                logger.info(`Sveltia CMS injected at ${routePattern}`);
            },

            "astro:config:done": ({ injectTypes }) => {
                const collectionNames = getCollectionNames(userConfig);

                if (collectionNames.length === 0) {
                    return;
                }

                injectTypes({
                    filename: "types.d.ts",
                    content: buildTypeDeclaration(collectionNames),
                });
            },
        },
    };
}

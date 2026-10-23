import type { CmsConfig } from "@sveltia/cms";

import { LOG_PREFIX, type SveltiaPagesOptions } from "./options.js";

export const DEFAULT_MEDIA_FOLDER = "public/images";
export const DEFAULT_PUBLIC_FOLDER = "/images";
export const DEFAULT_LOCALE = "zh";
export const DEFAULT_APP_TITLE = "Sveltia CMS";
export const DEFAULT_BACKEND_NAME = "github";
export const DEFAULT_SVELTIA_VERSION = "latest";

export type BuildCmsConfigResult = {
    /** The generated CMS configuration. */
    config: CmsConfig;
    /**
     * Top-level `extraConfig` keys that overrode generated values, listed in
     * the final config key order. Pure data — callers decide how to report.
     */
    conflicts: string[];
};

function toOrigin(site: string | URL): string {
    try {
        return new URL(site).origin;
    } catch (cause) {
        throw new Error(
            `${LOG_PREFIX} Astro's "site" option is not a valid URL (got ${String(site)}). ` +
                `Set a valid "site" in astro.config.mjs or pass "siteUrl" to sveltiaPages().`,
            { cause },
        );
    }
}

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
}

function resolveSiteUrl(
    options: Pick<SveltiaPagesOptions, "siteUrl">,
    astroSite: string | URL | undefined,
): string {
    if (options.siteUrl) {
        return stripTrailingSlash(options.siteUrl.trim());
    }

    if (
        astroSite !== undefined &&
        astroSite !== null &&
        `${astroSite}`.trim().length > 0
    ) {
        return toOrigin(astroSite);
    }

    throw new Error(
        `${LOG_PREFIX} Unable to determine the site URL for the CMS "base_url". ` +
            `Pass "siteUrl" to sveltiaPages() or set "site" in astro.config.mjs.`,
    );
}

/**
 * Builds the CMS config from integration options. This is the single source
 * of truth: the loader's `config.json` (written in `astro:config:setup`) and
 * the published `config.yml` (written in `astro:build:done`) are both
 * serialized from the returned object.
 */
export function buildCmsConfig(
    options: SveltiaPagesOptions,
    astroSite?: string | URL,
): BuildCmsConfigResult {
    const siteUrl = resolveSiteUrl(options, astroSite);

    const config: Record<string, unknown> = {
        backend: {
            name: options.backendName ?? DEFAULT_BACKEND_NAME,
            repo: options.repo.trim(),
            branch: options.branch ?? "main",
            base_url: siteUrl,
            auth_endpoint: "auth",
            auth_scope: "repo",
        },
        media_folder: options.mediaFolder ?? DEFAULT_MEDIA_FOLDER,
        public_folder: options.publicFolder ?? DEFAULT_PUBLIC_FOLDER,
    };

    if (options.r2) {
        config.media_libraries = {
            cloudflare_r2: {
                account_id: options.r2.accountId,
                access_key_id: options.r2.accessKeyId,
                bucket: options.r2.bucket,
                public_url: options.r2.publicUrl,
            },
        };
    }

    config.locale = options.locale ?? DEFAULT_LOCALE;
    config.site_url = siteUrl;
    config.app_title = options.appTitle ?? DEFAULT_APP_TITLE;

    if (options.logo) {
        config.logo = options.logo;
    }

    config.collections = options.collections;

    const generatedKeys = new Set(Object.keys(config));
    const extraConfig = options.extraConfig;

    if (extraConfig) {
        for (const [key, value] of Object.entries(extraConfig)) {
            config[key] = value;
        }
    }

    // Final key order: generated keys keep their position; extra keys are
    // appended in `extraConfig` insertion order.
    const conflicts = Object.keys(config).filter(
        (key) => generatedKeys.has(key) && extraConfig && key in extraConfig,
    );

    return { config: config as CmsConfig, conflicts };
}

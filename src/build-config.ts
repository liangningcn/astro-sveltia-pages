import type { CmsConfig } from "@sveltia/cms";

import { LOG_PREFIX, type SveltiaPagesOptions } from "./options.js";

export const DEFAULT_MEDIA_FOLDER = "public/images";
export const DEFAULT_PUBLIC_FOLDER = "/images";
export const DEFAULT_APP_TITLE = "Sveltia CMS";
export const DEFAULT_BACKEND_NAME = "github";
/**
 * Pinned Sveltia CMS version loaded from unpkg. Kept in sync with the
 * `@sveltia/cms` type dependency so the runtime UI and build-time types never
 * drift. Previously `"latest"`, which pulled untested releases at build time
 * and was not reproducible.
 */
export const DEFAULT_SVELTIA_VERSION = "0.270.0";

/**
 * Maps first-class integration options to their canonical Sveltia config keys.
 * These were previously only reachable via the `extraConfig` escape hatch.
 */
export const PROMOTED_OPTIONS: ReadonlyArray<
    readonly [keyof SveltiaPagesOptions, string]
> = [
    ["singletons", "singletons"],
    ["assetCollections", "asset_collections"],
    ["i18n", "i18n"],
    ["readonly", "readonly"],
    ["showPreviewLinks", "show_preview_links"],
    ["displayUrl", "display_url"],
    ["logoutRedirectUrl", "logout_redirect_url"],
    ["editor", "editor"],
    ["publishMode", "publish_mode"],
    ["fieldDefaults", "field_defaults"],
    ["output", "output"],
    ["slug", "slug"],
];

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

/**
 * Validates an explicit `siteUrl` just like Astro's `site` is validated by
 * {@link toOrigin}. Previously the option was only trimmed, so a typo such as
 * `"not a url"` silently produced an invalid CMS `base_url`/`site_url` that
 * broke the OAuth redirect at runtime instead of failing the build.
 */
function toValidatedSiteUrl(siteUrl: string): string {
    const trimmed = siteUrl.trim();
    let parsed: URL;

    try {
        parsed = new URL(trimmed);
    } catch (cause) {
        throw new Error(
            `${LOG_PREFIX} "siteUrl" is not a valid URL (got ${JSON.stringify(siteUrl)}). ` +
                `Pass an absolute http(s) URL such as https://example.com.`,
            { cause },
        );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
            `${LOG_PREFIX} "siteUrl" must use http or https (got "${parsed.protocol}").`,
        );
    }

    return stripTrailingSlash(trimmed);
}

function resolveSiteUrl(
    options: Pick<SveltiaPagesOptions, "siteUrl">,
    astroSite: string | URL | undefined,
): string {
    if (options.siteUrl) {
        return toValidatedSiteUrl(options.siteUrl);
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

    config.site_url = siteUrl;
    config.app_title = options.appTitle ?? DEFAULT_APP_TITLE;

    if (options.logo) {
        config.logo = options.logo;
    } else if (options.logoUrl) {
        // `logo_url` is deprecated in Sveltia (superseded by `logo.src`);
        // forward the option to the new key so the generated config stays
        // warning-free on current Sveltia versions.
        config.logo = { src: options.logoUrl };
    }

    config.collections = options.collections;

    // Promoted first-class global options (official Sveltia CmsConfig keys).
    // Each is emitted only when set; `extraConfig` can still override them
    // (with a warning) exactly as before.
    for (const [optKey, configKey] of PROMOTED_OPTIONS) {
        const value = (options as Record<string, unknown>)[optKey];
        if (value !== undefined) {
            config[configKey] = value;
        }
    }

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

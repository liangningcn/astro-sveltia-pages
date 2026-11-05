import type { CmsConfig } from "@sveltia/cms";

import type { PlatformName } from "./functions/adapter.js";

export const LOG_PREFIX = "[astro-sveltia-pages]";

/**
 * Minimal shape the package needs for a Sveltia collection. Any additional
 * Sveltia collection option (e.g. `create`, `slug`, `i18n`, `media_folder`)
 * is passed through to the generated config unchanged.
 */
export type SveltiaCollection = {
    name: string;
    label?: string;
    folder: string;
    fields: unknown[];
} & Record<string, unknown>;

export type SveltiaR2Options = {
    /** Cloudflare account ID. */
    accountId: string;
    /** R2 access key ID (safe to embed; the secret key is entered in the CMS UI). */
    accessKeyId: string;
    /** R2 bucket name. */
    bucket: string;
    /** Public base URL for assets, e.g. `https://pub-xxx.r2.dev` or a custom domain. */
    publicUrl: string;
};

export type SveltiaPagesOptions = {
    /** GitHub repository in `owner/name` form. */
    repo: string;
    /** Branch CMS changes are committed to. Default: `main`. */
    branch?: string;
    /**
     * Site origin used as the CMS `base_url` (the OAuth proxy host). Defaults
     * to Astro's `site` config; the build fails when neither is available.
     */
    siteUrl?: string;
    /** CMS collections, mapped 1:1 into the generated `collections`. */
    collections: SveltiaCollection[];
    /** When set, generates `media_libraries.cloudflare_r2`. */
    r2?: SveltiaR2Options;
    /** Default: `public/images`. */
    mediaFolder?: string;
    /** Default: `/images`. */
    publicFolder?: string;
    /** CMS title shown in the browser tab and login page. Default: `Sveltia CMS`. */
    appTitle?: string;
    /** CMS logo, e.g. `{ src: "/logo.svg" }`. */
    logo?: { src: string; [key: string]: unknown };
    /** Git backend name. Default: `github`. */
    backendName?: string;
    /**
     * Sveltia CMS version loaded from unpkg, without the leading `@`.
     * Default: `0.256.1` (pinned; previously `latest`).
     */
    sveltiaVersion?: string;
    /**
     * Escape hatch merged shallowly into the generated CMS config. Keys that
     * collide with generated values override them and emit a warning per key.
     */
    extraConfig?: Record<string, unknown>;
    /**
     * Deployment platform of the GitHub OAuth proxy: `cloudflare` (default)
     * or `edgeone`. It selects the function template and the dashboard the
     * environment variables are configured in.
     */
    platform?: PlatformName;
    /**
     * Singleton files (non-collection editable files), e.g. a site settings
     * file. Maps to the Sveltia `singletons` config key.
     */
    singletons?: unknown[];
    /**
     * Asset collections. Maps to the Sveltia `asset_collections` config key.
     */
    assetCollections?: unknown[];
    /**
     * Global i18n options. Maps to the Sveltia `i18n` config key.
     */
    i18n?: Record<string, unknown>;
    /**
     * Make the whole CMS read-only (e.g. during maintenance).
     * Maps to the Sveltia `readonly` config key. Default: `false`.
     */
    readonly?: boolean;
    /**
     * Whether to show links to live/deploy-preview entries.
     * Maps to the Sveltia `show_preview_links` config key.
     */
    showPreviewLinks?: boolean;
    /**
     * URL linked from the UI. Maps to the Sveltia `display_url` config key.
     */
    displayUrl?: string;
    /**
     * URL to redirect to after logout.
     * Maps to the Sveltia `logout_redirect_url` config key.
     */
    logoutRedirectUrl?: string;
    /**
     * Editor view options. Maps to the Sveltia `editor` config key.
     */
    editor?: Record<string, unknown>;
    /**
     * Publish mode (string or object with options).
     * Maps to the Sveltia `publish_mode` config key.
     */
    publishMode?: string | Record<string, unknown>;
    /**
     * Default options applied to all fields.
     * Maps to the Sveltia `field_defaults` config key.
     */
    fieldDefaults?: Record<string, unknown>;
    /**
     * Data output options. Maps to the Sveltia `output` config key.
     */
    output?: Record<string, unknown>;
    /**
     * Slug options for entries and assets.
     * Maps to the Sveltia `slug` config key.
     */
    slug?: Record<string, unknown>;
    /**
     * Absolute URL or path to the logo shown on the entrance page and as the
     * favicon. Maps to the Sveltia `logo_url` config key.
     */
    logoUrl?: string;
    /**
     * Build-time check for the committed `init:i18n` snapshots.
     * `warn` (default) prints a prominent upgrade notice during
     * `astro dev` / `astro build`; `error` fails the build; `off` disables it.
     * The check stays silent when none of the three files exist.
     */
    i18nTemplateCheck?: "warn" | "error" | "off";
};

function fail(message: string): never {
    throw new Error(`${LOG_PREFIX} ${message}`);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates user-supplied options eagerly, so misconfiguration surfaces when
 * `astro.config.mjs` is evaluated instead of deep inside the build.
 */
export function validateOptions(options: SveltiaPagesOptions): void {
    if (
        !isNonEmptyString(options.repo) ||
        !/^[\w.-]+\/[\w.-]+$/.test(options.repo.trim())
    ) {
        fail(
            `"repo" is required and must look like "owner/name" (got ${JSON.stringify(options.repo)}).`,
        );
    }

    if (options.branch !== undefined && !isNonEmptyString(options.branch)) {
        fail('"branch" must be a non-empty string.');
    }

    if (options.siteUrl !== undefined && !isNonEmptyString(options.siteUrl)) {
        fail('"siteUrl" must be a non-empty string.');
    }

    if (!Array.isArray(options.collections) || options.collections.length === 0) {
        fail(
            '"collections" is required and must be a non-empty array of collection definitions.',
        );
    }

    options.collections.forEach((collection, index) => {
        if (!collection || typeof collection !== "object") {
            fail(`collections[${index}] must be an object.`);
        }

        if (!isNonEmptyString(collection.name)) {
            fail(`collections[${index}].name is required.`);
        }

        if (!isNonEmptyString(collection.folder)) {
            fail(`collections[${index}].folder is required.`);
        }

        if (!Array.isArray(collection.fields)) {
            fail(`collections[${index}].fields must be an array.`);
        }
    });

    if (options.r2) {
        const missing = (
            ["accountId", "accessKeyId", "bucket", "publicUrl"] as const
        ).filter((key) => !isNonEmptyString(options.r2?.[key]));

        if (missing.length > 0) {
            fail(`"r2" is missing required fields: ${missing.join(", ")}.`);
        }
    }

    for (const key of [
        "mediaFolder",
        "publicFolder",
        "appTitle",
        "displayUrl",
        "logoutRedirectUrl",
        "logoUrl",
    ] as const) {
        if (options[key] !== undefined && !isNonEmptyString(options[key])) {
            fail(`"${key}" must be a non-empty string.`);
        }
    }

    if (options.logo && !isNonEmptyString(options.logo.src)) {
        fail('"logo.src" must be a non-empty string.');
    }

    if (options.backendName !== undefined && !isNonEmptyString(options.backendName)) {
        fail('"backendName" must be a non-empty string.');
    }

    if (
        options.sveltiaVersion !== undefined &&
        !isNonEmptyString(options.sveltiaVersion)
    ) {
        fail('"sveltiaVersion" must be a non-empty string.');
    }

    if (options.readonly !== undefined && typeof options.readonly !== "boolean") {
        fail('"readonly" must be a boolean.');
    }

    if (
        options.showPreviewLinks !== undefined &&
        typeof options.showPreviewLinks !== "boolean"
    ) {
        fail('"showPreviewLinks" must be a boolean.');
    }

    if (options.singletons !== undefined && !Array.isArray(options.singletons)) {
        fail('"singletons" must be an array.');
    }

    if (
        options.assetCollections !== undefined &&
        !Array.isArray(options.assetCollections)
    ) {
        fail('"assetCollections" must be an array.');
    }

    for (const key of ["i18n", "editor", "fieldDefaults", "output", "slug"] as const) {
        const value = options[key];
        if (
            value !== undefined &&
            (typeof value !== "object" || value === null || Array.isArray(value))
        ) {
            fail(`"${key}" must be an object.`);
        }
    }

    if (
        options.publishMode !== undefined &&
        !(
            typeof options.publishMode === "string" ||
            (typeof options.publishMode === "object" &&
                options.publishMode !== null &&
                !Array.isArray(options.publishMode))
        )
    ) {
        fail('"publishMode" must be a string or an object.');
    }

    if (options.extraConfig !== undefined && typeof options.extraConfig !== "object") {
        fail('"extraConfig" must be an object.');
    }

    if (
        options.platform !== undefined &&
        options.platform !== "cloudflare" &&
        options.platform !== "edgeone"
    ) {
        fail(
            `"platform" must be "cloudflare" or "edgeone" (got ${JSON.stringify(options.platform)}).`,
        );
    }

    if (
        options.i18nTemplateCheck !== undefined &&
        options.i18nTemplateCheck !== "warn" &&
        options.i18nTemplateCheck !== "error" &&
        options.i18nTemplateCheck !== "off"
    ) {
        fail('"i18nTemplateCheck" must be "warn", "error" or "off".');
    }
}

/** Narrow helper used by consumers that need the generated CMS config type. */
export type GeneratedCmsConfig = CmsConfig;

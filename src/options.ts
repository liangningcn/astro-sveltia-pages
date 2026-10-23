import type { CmsConfig } from "@sveltia/cms";

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
    /** CMS UI language. Default: `zh`. */
    locale?: string;
    /** CMS title shown in the browser tab and login page. Default: `Sveltia CMS`. */
    appTitle?: string;
    /** CMS logo, e.g. `{ src: "/logo.svg" }`. */
    logo?: { src: string; [key: string]: unknown };
    /** Git backend name. Default: `github`. */
    backendName?: string;
    /**
     * Sveltia CMS version loaded from unpkg, without the leading `@`.
     * Default: `latest`.
     */
    sveltiaVersion?: string;
    /**
     * Escape hatch merged shallowly into the generated CMS config. Keys that
     * collide with generated values override them and emit a warning per key.
     */
    extraConfig?: Record<string, unknown>;
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

    for (const key of ["mediaFolder", "publicFolder", "locale", "appTitle"] as const) {
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

    if (options.extraConfig !== undefined && typeof options.extraConfig !== "object") {
        fail('"extraConfig" must be an object.');
    }
}

/** Narrow helper used by consumers that need the generated CMS config type. */
export type GeneratedCmsConfig = CmsConfig;

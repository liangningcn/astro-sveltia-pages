import { readFileSync } from "node:fs";

import type {
    CmsConfig,
    EntryCollection,
    FileCollection,
    I18nOptions,
} from "@sveltia/cms";

const CONFIG_PATH = ".astro/integrations/astro-sveltia-pages/config.json";

export type FolderCollection = EntryCollection & { folder: string };
/** An entry collection whose entries are stored as a JSON array in one file. */
export type FileBackedCollection = EntryCollection & { file: string };

export function isEntryCollection(c: unknown): c is FolderCollection {
    return (
        typeof c === "object" &&
        c !== null &&
        "name" in c &&
        typeof c.name === "string" &&
        "folder" in c &&
        typeof c.folder === "string" &&
        c.folder.trim().length > 0 &&
        "fields" in c &&
        Array.isArray(c.fields)
    );
}

export function isFileBackedCollection(c: unknown): c is FileBackedCollection {
    return (
        typeof c === "object" &&
        c !== null &&
        "name" in c &&
        typeof c.name === "string" &&
        "file" in c &&
        typeof c.file === "string" &&
        c.file.trim().length > 0 &&
        "fields" in c &&
        Array.isArray(c.fields)
    );
}

/** Any collection shape the loader can handle: a `folder` or a `file`. */
export function isSupportedCollection(
    c: unknown,
): c is FolderCollection | FileBackedCollection {
    return isEntryCollection(c) || isFileBackedCollection(c);
}

export function readCmsConfig(): CmsConfig {
    const configPath = `${process.cwd()}/${CONFIG_PATH}`;
    try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            throw new Error(
                `[sveltiaLoader] CMS config at ${configPath} is not a valid JSON object ` +
                    `(got ${parsed === null ? "null" : typeof parsed}).`,
            );
        }
        return parsed as CmsConfig;
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("[sveltiaLoader]")) {
            throw err;
        }
        throw new Error(
            `[sveltiaLoader] Could not read CMS config from ${configPath}. ` +
                `Make sure the astro-sveltia-pages integration is added to your astro.config.mjs.`,
            { cause: err },
        );
    }
}

/**
 * Returns the global i18n options, or `null` when the CMS config has none.
 *
 * Pass `config` when it has already been read; omit it (or pass `undefined`)
 * to read the generated CMS config from disk. Passing `null` returns `null`,
 * which lets callers treat an unavailable config as "no i18n".
 */
export function getI18nConfig(config?: CmsConfig | null): I18nOptions | null {
    const resolved = config === undefined ? readCmsConfig() : config;
    return resolved?.i18n ?? null;
}

export function resolveCollection(config: CmsConfig, name: string): EntryCollection {
    const collections = config.collections ?? [];
    const match = collections.find((c) => "name" in c && c.name === name);

    if (!match) {
        const available = collections
            .filter((c): c is EntryCollection | FileCollection => "name" in c)
            .map((c) => c.name);
        const list = available.length > 0 ? available.join(", ") : "(none)";
        throw new Error(
            `[sveltiaLoader] Collection "${name}" not found in CMS config. ` +
                `Available collections: ${list}`,
        );
    }

    if (!isSupportedCollection(match)) {
        throw new Error(
            `[sveltiaLoader] Collection "${name}" is not a supported entry collection. ` +
                `Only entry collections with a "folder" or "file" and a "fields" array ` +
                `are supported by sveltiaLoader.`,
        );
    }

    return match;
}

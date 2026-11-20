import type { CmsConfig, EntryCollection, Field, I18nOptions } from "@sveltia/cms";
import { file as fileLoader, glob } from "astro/loaders";
import type { Loader, LoaderContext } from "astro/loaders";

import {
    getI18nConfig,
    isFileBackedCollection,
    isSupportedCollection,
    readCmsConfig,
    resolveCollection,
} from "./config.js";
import type { FileBackedCollection, FolderCollection } from "./config.js";
import { frontmatterFormats, resolveFormat } from "./schema.js";
import { transformFieldValues } from "./transforms.js";
import { buildCollectionSchema } from "./type-gen.js";

export type SveltiaLoader = Loader & {
    createSchema: () => ReturnType<typeof buildCollectionSchema>;
};
export type SveltiaEntryCollection = EntryCollection;
export type SveltiaField = Field;
export type SveltiaConfig = CmsConfig;

export type SveltiaLoaderOptions = {
    /**
     * Locale folder to load from. Required when the CMS config uses the
     * `multiple_folders` i18n structure; ignored when i18n is not configured.
     * Not supported for file collections (`file`).
     */
    locale?: string;
};

function wrapContextWithTransforms(
    context: LoaderContext,
    collection: EntryCollection,
): LoaderContext {
    const excludeBody = frontmatterFormats.has(resolveFormat(collection));
    return {
        ...context,
        parseData: <TData extends Record<string, unknown>>(opts: {
            id: string;
            data: TData;
            filePath?: string;
        }) => {
            const transformed = transformFieldValues(
                opts.data as Record<string, unknown>,
                collection.fields,
                excludeBody,
            );
            return context.parseData({ ...opts, data: transformed as TData });
        },
    };
}

function defaultExtension(format: string): string {
    switch (format) {
        case "yaml":
            return "yml";
        case "json":
            return "json";
        case "toml":
            return "toml";
        case "raw":
            return "txt";
        default:
            return "md";
    }
}

/**
 * Parser for Astro's `file()` loader. Sveltia file collections store a JSON
 * array where an entry's slug is its position in the array, while the `file()`
 * loader derives IDs from an `id`/`slug` field or from object keys. Turning
 * the array into a keyed object makes the 0-based array index the entry ID.
 * An already-keyed object is passed through unchanged.
 */
export function jsonArrayToKeyedObject(
    text: string,
): Record<string, Record<string, unknown>> {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) {
        return Object.fromEntries(
            data.map((item, index) => [String(index), item as Record<string, unknown>]),
        );
    }
    if (typeof data === "object" && data !== null) {
        return data as Record<string, Record<string, unknown>>;
    }
    throw new Error(
        `[sveltiaLoader] Expected a JSON array or object in the file collection, got ${typeof data}.`,
    );
}

function resolveI18n(
    config: CmsConfig | null,
    collection: EntryCollection,
): I18nOptions | null {
    const globalI18n = getI18nConfig(config);
    const collectionI18n = collection.i18n;

    // A collection can opt out of i18n even when the CMS enables it globally.
    if (collectionI18n === false) {
        return null;
    }

    // Collection-level options take precedence over the global ones.
    // Spreading `null`/`undefined` is a no-op, so no fallback object is needed.
    if (collectionI18n && typeof collectionI18n === "object") {
        return { ...globalI18n, ...collectionI18n };
    }

    return globalI18n;
}

function resolveBaseFolder(
    collection: FolderCollection,
    config: CmsConfig | null,
    locale: string | undefined,
): string {
    const i18n = resolveI18n(config, collection);

    if (!i18n) {
        return collection.folder;
    }

    if (i18n.structure !== "multiple_folders") {
        if (locale === undefined) {
            return collection.folder;
        }
        throw new Error(
            `[sveltiaLoader] Collection "${collection.name}" uses the "${i18n.structure ?? "single_file"}" i18n structure. ` +
                `Only the "multiple_folders" structure is supported for locale-based loading.`,
        );
    }

    if (!locale) {
        throw new Error(
            `[sveltiaLoader] Collection "${collection.name}" uses the "multiple_folders" i18n structure. ` +
                `Pass a locale, e.g. sveltiaLoader("${collection.name}", { locale: "en" }).`,
        );
    }

    return `${collection.folder}/${locale}`;
}

function loadFolderCollection(
    collection: FolderCollection,
    config: CmsConfig | null,
    context: LoaderContext,
    locale: string | undefined,
): Promise<void> {
    const base = resolveBaseFolder(collection, config, locale);
    const extension =
        collection.extension ?? defaultExtension(resolveFormat(collection));
    return glob({ pattern: `**/*.${extension}`, base }).load(
        wrapContextWithTransforms(context, collection),
    );
}

function loadFileCollection(
    collection: FileBackedCollection,
    context: LoaderContext,
): Promise<void> {
    return fileLoader(collection.file, { parser: jsonArrayToKeyedObject }).load(
        wrapContextWithTransforms(context, collection),
    );
}

export function sveltiaLoader(
    collectionOrName: string | EntryCollection,
    options?: SveltiaLoaderOptions,
): SveltiaLoader {
    const getCollection = (): {
        collection: FolderCollection | FileBackedCollection;
        config: CmsConfig | null;
    } => {
        let config: CmsConfig | null = null;
        let collection: EntryCollection;

        if (typeof collectionOrName === "string") {
            config = readCmsConfig();
            collection = resolveCollection(config, collectionOrName);
        } else {
            collection = collectionOrName;
            // The object form also works without a generated config file. In
            // that case i18n is unavailable and the folder is used as-is.
            try {
                config = readCmsConfig();
            } catch {
                config = null;
            }
        }

        if (!isSupportedCollection(collection)) {
            throw new Error(
                `[sveltiaLoader] Collection "${collection.name}" must have a non-empty "folder" or "file" and a "fields" array.`,
            );
        }
        if (isFileBackedCollection(collection)) {
            if (options?.locale !== undefined) {
                throw new Error(
                    `[sveltiaLoader] The "locale" option is not supported for file collections: ` +
                        `"${collection.name}" uses "file", which stores all locales in one JSON array.`,
                );
            }
        } else if (collection.folder.includes("{{locale}}")) {
            throw new Error(
                `[sveltiaLoader] Collection "${collection.name}" uses a {{locale}} folder placeholder, which is not supported.`,
            );
        }
        if (resolveFormat(collection) === "raw") {
            throw new Error(
                `[sveltiaLoader] Collection "${collection.name}" uses the "raw" format, which is not supported: ` +
                    `Astro has no built-in parser for raw text files. Use another format, or register a ` +
                    `custom content entry type for the file extension first.`,
            );
        }
        return { collection, config };
    };

    return {
        name: "sveltia-cms",
        createSchema: async () => {
            const { collection, config } = getCollection();
            if (isFileBackedCollection(collection)) {
                return buildCollectionSchema(collection);
            }
            // Fail early when the CMS requires a locale but none was given.
            resolveBaseFolder(collection, config, options?.locale);
            return buildCollectionSchema(collection);
        },
        load: async (context) => {
            const { collection, config } = getCollection();
            if (isFileBackedCollection(collection)) {
                return loadFileCollection(collection, context);
            }
            return loadFolderCollection(collection, config, context, options?.locale);
        },
    } satisfies SveltiaLoader;
}

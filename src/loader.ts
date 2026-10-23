import type { CmsConfig, EntryCollection, Field, I18nOptions } from "@sveltia/cms";
import { glob } from "astro/loaders";
import type { Loader, LoaderContext } from "astro/loaders";

import {
    getI18nConfig,
    isEntryCollection,
    readCmsConfig,
    resolveCollection,
} from "./config.js";
import type { FolderCollection } from "./config.js";
import { frontmatterFormats } from "./schema.js";
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
     */
    locale?: string;
};

function wrapContextWithTransforms(
    context: LoaderContext,
    collection: EntryCollection,
): LoaderContext {
    const excludeBody = frontmatterFormats.has(collection.format);
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

function defaultExtension(format: EntryCollection["format"]): string {
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

export function sveltiaLoader(
    collectionOrName: string | EntryCollection,
    options?: SveltiaLoaderOptions,
): SveltiaLoader {
    const getCollection = (): {
        collection: FolderCollection;
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

        if (!isEntryCollection(collection)) {
            throw new Error(
                `[sveltiaLoader] Collection "${collection.name}" must have a non-empty folder and a fields array. File-backed collections are not supported.`,
            );
        }
        if (collection.folder.includes("{{locale}}")) {
            throw new Error(
                `[sveltiaLoader] Collection "${collection.name}" uses a {{locale}} folder placeholder, which is not supported.`,
            );
        }
        return { collection, config };
    };

    return {
        name: "sveltia-cms",
        createSchema: async () => {
            const { collection, config } = getCollection();
            // Fail early when the CMS requires a locale but none was given.
            resolveBaseFolder(collection, config, options?.locale);
            return buildCollectionSchema(collection);
        },
        load: async (context) => {
            const { collection, config } = getCollection();
            const base = resolveBaseFolder(collection, config, options?.locale);
            const extension =
                collection.extension ?? defaultExtension(collection.format);
            return glob({ pattern: `**/*.${extension}`, base }).load(
                wrapContextWithTransforms(context, collection),
            );
        },
    } satisfies SveltiaLoader;
}

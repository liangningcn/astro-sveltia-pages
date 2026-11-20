import { readFileSync } from "node:fs";

import type { EntryCollection, Field } from "@sveltia/cms";
import type { LoaderContext } from "astro/loaders";
import { file as fileLoader, glob } from "astro/loaders";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isEntryCollection, readCmsConfig } from "../src/config.ts";
import { jsonArrayToKeyedObject, sveltiaLoader } from "../src/loader.ts";
import { sveltiaSchema } from "../src/schema.ts";
import { transformFieldValues } from "../src/transforms.ts";

vi.mock("astro/loaders", () => ({
    glob: vi.fn(() => ({ load: vi.fn() })),
    file: vi.fn(() => ({ load: vi.fn() })),
}));
vi.mock("node:fs", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs")>()),
    readFileSync: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("collection storage", () => {
    it.each([undefined, "", "  "])("rejects an invalid folder: %s", async (folder) => {
        const collection: EntryCollection = { name: "posts", folder, fields: [] };
        expect(isEntryCollection(collection)).toBe(false);
        await expect(sveltiaLoader(collection).createSchema()).rejects.toThrow(
            /non-empty "folder" or "file"/,
        );
        await expect(
            sveltiaLoader(collection).load({} as LoaderContext),
        ).rejects.toThrow(/non-empty "folder" or "file"/);
        expect(glob).not.toHaveBeenCalled();
    });

    it("routes a file collection to the file() loader with an index-keyed parser", async () => {
        await sveltiaLoader({ name: "posts", file: "posts.json", fields: [] }).load(
            {} as LoaderContext,
        );
        expect(fileLoader).toHaveBeenCalledWith("posts.json", {
            parser: expect.any(Function),
        });
        expect(glob).not.toHaveBeenCalled();
    });

    it("rejects a file collection when a locale is passed", async () => {
        const loader = sveltiaLoader(
            { name: "posts", file: "posts.json", fields: [] },
            { locale: "en" },
        );
        await expect(loader.load({} as LoaderContext)).rejects.toThrow(/locale/);
        await expect(loader.createSchema()).rejects.toThrow(/locale/);
        expect(fileLoader).not.toHaveBeenCalled();
        expect(glob).not.toHaveBeenCalled();
    });

    it("rejects the raw format with a clear error", async () => {
        const loader = sveltiaLoader({
            name: "posts",
            folder: "content",
            fields: [],
            format: "raw",
        });
        await expect(loader.load({} as LoaderContext)).rejects.toThrow(
            /raw.*not supported/,
        );
        await expect(loader.createSchema()).rejects.toThrow(/raw.*not supported/);
        expect(glob).not.toHaveBeenCalled();
    });

    it("rejects unexpanded locale folders", async () => {
        const loader = sveltiaLoader({
            name: "posts",
            folder: "content/{{locale}}",
            fields: [],
        });
        await expect(loader.createSchema()).rejects.toThrow(/locale/);
    });

    it.each([
        [undefined, "md"],
        ["yaml", "yml"],
        ["yml", "yml"],
        ["json", "json"],
        ["toml", "toml"],
        ["yaml-frontmatter", "md"],
        ["frontmatter", "md"],
    ])("infers the extension for %s", async (format, extension) => {
        await sveltiaLoader({
            name: "posts",
            folder: "content",
            fields: [],
            format,
        }).load({} as LoaderContext);
        expect(glob).toHaveBeenCalledWith({
            pattern: `**/*.${extension}`,
            base: "content",
        });
    });

    it("infers the extension when format is unset but extension is set", async () => {
        await sveltiaLoader({
            name: "posts",
            folder: "content",
            fields: [],
            extension: "yaml",
        }).load({} as LoaderContext);
        expect(glob).toHaveBeenCalledWith({ pattern: "**/*.yaml", base: "content" });
    });

    it("preserves an explicit extension", async () => {
        await sveltiaLoader({
            name: "posts",
            folder: "content",
            fields: [],
            format: "yaml",
            extension: "yaml",
        }).load({} as LoaderContext);
        expect(glob).toHaveBeenCalledWith({ pattern: "**/*.yaml", base: "content" });
    });
});

describe("single-field list transformations", () => {
    it.each([false, true])(
        "handles relation multiple: %s per list item",
        (multiple) => {
            const fields: Field[] = [
                {
                    name: "authors",
                    widget: "list",
                    field: {
                        name: "author",
                        widget: "relation",
                        collection: "authors",
                        multiple,
                    },
                },
            ];
            const ref = { collection: "authors", id: "jane" };
            const transformed = transformFieldValues(
                { authors: multiple ? [["jane"]] : ["jane"] },
                fields,
                false,
            );
            expect(transformed.authors).toEqual(multiple ? [[ref]] : [ref]);
            expect(sveltiaSchema(fields).safeParse(transformed).success).toBe(true);
        },
    );

    it("recurses through an object used as the single list field", () => {
        const fields: Field[] = [
            {
                name: "items",
                widget: "list",
                field: {
                    name: "item",
                    widget: "object",
                    fields: [
                        { name: "cover", widget: "image" },
                        { name: "author", widget: "relation", collection: "authors" },
                    ],
                },
            },
        ];
        const transformed = transformFieldValues(
            { items: [{ cover: "photo.jpg", author: "jane" }] },
            fields,
            false,
        );
        expect(transformed.items).toEqual([
            {
                cover: "__ASTRO_IMAGE_./photo.jpg",
                author: { collection: "authors", id: "jane" },
            },
        ]);
        expect(sveltiaSchema(fields).safeParse(transformed).success).toBe(true);
    });
});

describe("jsonArrayToKeyedObject", () => {
    it("turns a JSON array into a 0-based keyed object", () => {
        expect(jsonArrayToKeyedObject('[{"title":"a"},{"title":"b"}]')).toEqual({
            "0": { title: "a" },
            "1": { title: "b" },
        });
    });

    it("keeps empty arrays empty", () => {
        expect(jsonArrayToKeyedObject("[]")).toEqual({});
    });

    it("passes an already-keyed object through", () => {
        expect(jsonArrayToKeyedObject('{"foo":{"title":"a"}}')).toEqual({
            foo: { title: "a" },
        });
    });

    it("rejects non-object JSON values", () => {
        expect(() => jsonArrayToKeyedObject("42")).toThrow(
            /Expected a JSON array or object/,
        );
        expect(() => jsonArrayToKeyedObject("null")).toThrow(
            /Expected a JSON array or object/,
        );
        expect(() => jsonArrayToKeyedObject("nope")).toThrow();
    });
});

describe("i18n multiple_folders regression", () => {
    const cmsConfig = {
        i18n: {
            structure: "multiple_folders",
            locales: ["en", "zh"],
            default_locale: "en",
        },
        collections: [{ name: "posts", folder: "content/posts", fields: [] }],
    };

    it("requires a locale when the structure is multiple_folders", async () => {
        vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(cmsConfig));
        await expect(sveltiaLoader("posts").load({} as LoaderContext)).rejects.toThrow(
            /multiple_folders.*locale|locale.*multiple_folders/,
        );
        expect(glob).not.toHaveBeenCalled();
    });

    it("appends the locale to the base folder for multiple_folders", async () => {
        vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(cmsConfig));
        await sveltiaLoader("posts", { locale: "en" }).load({} as LoaderContext);
        expect(glob).toHaveBeenCalledWith({
            pattern: "**/*.md",
            base: "content/posts/en",
        });
    });
});

describe("CMS configuration reads", () => {
    it("does not retain stale configuration between reads", () => {
        vi.mocked(readFileSync)
            .mockReturnValueOnce('{"collections":[]}')
            .mockReturnValueOnce('{"collections":[{"name":"posts"}]}');
        expect(readCmsConfig().collections).toEqual([]);
        expect(readCmsConfig().collections).toEqual([{ name: "posts" }]);
    });

    it("preserves the underlying read error", () => {
        const cause = new Error("permission denied");
        vi.mocked(readFileSync).mockImplementationOnce(() => {
            throw cause;
        });
        expect(readCmsConfig).toThrow(expect.objectContaining({ cause }));
    });
});

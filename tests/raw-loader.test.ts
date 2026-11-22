import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { EntryCollection } from "@sveltia/cms";
import type { LoaderContext } from "astro/loaders";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadRawCollection } from "../src/raw-loader.ts";

type StoredEntry = {
    id: string;
    data: Record<string, unknown>;
    body?: string;
    filePath?: string;
    digest?: string;
};

function createContext(rootDir: string) {
    const entries = new Map<string, StoredEntry>();
    const warnings: string[] = [];
    const infos: string[] = [];
    const errors: string[] = [];
    const watchers: {
        added: string[];
        handlers: Record<string, (path: string) => void | Promise<void>>;
    } = { added: [], handlers: {} };

    const parseData = vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => data,
    );

    const context = {
        collection: "snippets",
        config: { root: pathToFileURL(`${rootDir}/`) } as LoaderContext["config"],
        store: {
            keys: () => [...entries.keys()],
            get: (key: string) => entries.get(key),
            set: (entry: StoredEntry) => {
                entries.set(entry.id, entry);
                return true;
            },
            delete: (key: string) => {
                entries.delete(key);
            },
        },
        logger: {
            warn: (msg: string) => warnings.push(msg),
            info: (msg: string) => infos.push(msg),
            error: (msg: string) => errors.push(msg),
        },
        generateDigest: (data: string) => `digest:${data.length}`,
        parseData,
        watcher: {
            add: (path: string) => watchers.added.push(path),
            on: (event: string, handler: (path: string) => void | Promise<void>) => {
                watchers.handlers[event] = handler;
            },
        },
    } as unknown as LoaderContext;

    return { context, parseData, entries, warnings, infos, errors, watchers };
}

const collection: EntryCollection = {
    name: "snippets",
    folder: "content/snippets",
    format: "raw",
    fields: [{ name: "body", widget: "code" }],
};

describe("loadRawCollection", () => {
    let rootDir: string;

    beforeEach(() => {
        rootDir = mkdtempSync(join(tmpdir(), "raw-loader-"));
    });

    afterEach(() => {
        rmSync(rootDir, { recursive: true, force: true });
    });

    it("reads each text file as a plain-text body field, keyed by its relative path", async () => {
        mkdirSync(join(rootDir, "content/snippets"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/first.txt"), "hello world");
        writeFileSync(join(rootDir, "content/snippets/second.txt"), '{ "a": 1 }');
        const { context, parseData, entries } = createContext(rootDir);

        await loadRawCollection(collection, "content/snippets", "txt", context);

        expect(entries.size).toBe(2);
        expect(entries.get("first")?.data).toEqual({ body: "hello world" });
        expect(entries.get("second")?.data).toEqual({ body: '{ "a": 1 }' });
        expect(entries.get("first")?.body).toBe("hello world");
        expect(entries.get("first")?.digest).toBe("digest:11");
        expect(parseData).toHaveBeenCalledTimes(2);
    });

    it("filters by extension and recurses into subdirectories using POSIX ids", async () => {
        mkdirSync(join(rootDir, "content/snippets/nested"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/top.astro"), "top");
        writeFileSync(join(rootDir, "content/snippets/nested/deep.astro"), "deep");
        writeFileSync(join(rootDir, "content/snippets/ignore.md"), "not raw");
        const { context, entries } = createContext(rootDir);

        await loadRawCollection(collection, "content/snippets", "astro", context);

        expect([...entries.keys()].sort()).toEqual(["nested/deep", "top"]);
        expect(entries.get("nested/deep")?.data).toEqual({ body: "deep" });
        expect(entries.get("ignore")?.data).toBeUndefined();
    });

    it("drops a trailing /index from the id", async () => {
        mkdirSync(join(rootDir, "content/snippets/guide"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/guide/index.txt"), "guide body");
        const { context, entries } = createContext(rootDir);

        await loadRawCollection(collection, "content/snippets", "txt", context);

        expect(entries.get("guide")?.data).toEqual({ body: "guide body" });
    });

    it("removes entries whose files no longer exist since the last load", async () => {
        mkdirSync(join(rootDir, "content/snippets"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/stale.txt"), "old");
        const first = createContext(rootDir);
        await loadRawCollection(collection, "content/snippets", "txt", first.context);
        expect(first.entries.has("stale")).toBe(true);

        rmSync(join(rootDir, "content/snippets/stale.txt"));
        // Reuse the same store so untouched-entry cleanup is observable.
        const second = createContext(rootDir);
        for (const [id, entry] of first.entries) {
            second.entries.set(id, entry);
        }
        await loadRawCollection(collection, "content/snippets", "txt", second.context);

        expect(second.entries.has("stale")).toBe(false);
    });

    it("skips a digest-identical file (no re-parse) and re-parses on change", async () => {
        mkdirSync(join(rootDir, "content/snippets"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/item.txt"), "abc");
        const { context, parseData, entries } = createContext(rootDir);
        await loadRawCollection(collection, "content/snippets", "txt", context);
        expect(parseData).toHaveBeenCalledTimes(1);

        // A second load with identical content should not re-parse.
        const again = createContext(rootDir);
        for (const [id, entry] of entries) {
            again.entries.set(id, entry);
        }
        await loadRawCollection(collection, "content/snippets", "txt", again.context);
        expect(again.parseData).not.toHaveBeenCalled();

        // Watch-triggered change with new content re-parses and updates the entry.
        writeFileSync(join(rootDir, "content/snippets/item.txt"), "abcdef");
        await again.watchers.handlers.change(
            join(rootDir, "content/snippets/item.txt"),
        );
        expect(again.parseData).toHaveBeenCalledTimes(1);
        expect(again.entries.get("item")?.data).toEqual({ body: "abcdef" });
    });

    it("registers the watcher and deletes an entry on unlink", async () => {
        mkdirSync(join(rootDir, "content/snippets"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/gone.txt"), "bye");
        const { context, entries, watchers } = createContext(rootDir);
        await loadRawCollection(collection, "content/snippets", "txt", context);

        expect(watchers.added).toHaveLength(1);
        expect(watchers.handlers.change).toBeTypeOf("function");
        expect(watchers.handlers.unlink).toBeTypeOf("function");

        await watchers.handlers.unlink(join(rootDir, "content/snippets/gone.txt"));
        expect(entries.has("gone")).toBe(false);
    });

    it("ignores watcher events for same-extension files outside the base directory", async () => {
        mkdirSync(join(rootDir, "content/snippets"), { recursive: true });
        mkdirSync(join(rootDir, "content/other"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/mine.txt"), "mine");
        const { context, entries, parseData, infos, errors, watchers } =
            createContext(rootDir);
        await loadRawCollection(collection, "content/snippets", "txt", context);
        expect([...entries.keys()]).toEqual(["mine"]);

        const foreignPath = join(rootDir, "content/other/foreign.txt");
        writeFileSync(foreignPath, "foreign");
        await watchers.handlers.change(foreignPath);
        await watchers.handlers.unlink(foreignPath);

        expect([...entries.keys()]).toEqual(["mine"]);
        expect(parseData).toHaveBeenCalledTimes(1);
        expect(infos).toHaveLength(0);
        expect(errors).toHaveLength(0);
    });

    it("warns when the base directory has no matching files", async () => {
        mkdirSync(join(rootDir, "content/snippets"), { recursive: true });
        writeFileSync(join(rootDir, "content/snippets/readme.md"), "skip me");
        const { context, warnings } = createContext(rootDir);

        await loadRawCollection(collection, "content/snippets", "txt", context);

        expect(warnings.some((w) => w.includes('"**/*.txt"'))).toBe(true);
    });

    it("warns (without throwing) when the base directory is missing", async () => {
        const { context, warnings, entries } = createContext(rootDir);

        await loadRawCollection(collection, "content/missing", "txt", context);

        expect(entries.size).toBe(0);
        expect(warnings.some((w) => w.includes("does not exist"))).toBe(true);
    });
});

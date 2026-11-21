import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { EntryCollection } from "@sveltia/cms";
import type { LoaderContext } from "astro/loaders";

/**
 * Loads a `raw`-format folder collection. Sveltia's `raw` format stores each
 * entry as a whole plain-text file with no frontmatter (typically `.astro`,
 * `.txt`, `.json`, `.xml`, `.csv`) and exposes the entire content as a single
 * `body` field.
 *
 * Astro's built-in `glob()` cannot be reused here: it picks an entry parser by
 * file extension, so `.json`/`.xml`/`.csv` would be parsed as structured data
 * and `.astro`/`.txt` would be skipped for lack of a parser. This loader reads
 * the files as UTF-8 text and injects `{ body: content }` through `parseData`,
 * which applies the collection's field transforms and Zod schema as usual.
 */
export function loadRawCollection(
    collection: EntryCollection,
    base: string,
    extension: string,
    context: LoaderContext,
): Promise<void> {
    const baseUrl = new URL(base, context.config.root);
    if (!baseUrl.pathname.endsWith("/")) {
        baseUrl.pathname = `${baseUrl.pathname}/`;
    }
    const baseDir = fileURLToPath(baseUrl);
    const relativeBase = relative(fileURLToPath(context.config.root), baseDir);

    if (!existsSync(baseDir)) {
        context.logger.warn(`The base directory "${baseDir}" does not exist.`);
    }

    const fileToIdMap = new Map<string, string>();
    const untouchedEntries = new Set(context.store.keys());
    const ext = `.${extension.toLowerCase()}`;

    const isRawFile = (filePath: string): boolean =>
        basename(filePath).toLowerCase().endsWith(ext);

    const toEntryId = (filePath: string): string => {
        const rel = relative(baseDir, filePath).split(sep).join("/");
        const withoutExt = rel.replace(/(\.[^./]+)$/, "");
        // Mirror glob()'s default slug behavior: a trailing `/index` is dropped.
        const slug = withoutExt.replace(/\/index$/, "");
        return slug || "index";
    };

    const syncData = async (filePath: string, oldId?: string): Promise<void> => {
        const contents = await readFile(filePath, "utf-8");
        const id = toEntryId(filePath);
        if (oldId && oldId !== id) {
            context.store.delete(oldId);
        }
        untouchedEntries.delete(id);

        const digest = context.generateDigest(contents);
        const existing = context.store.get(id);
        if (existing && existing.digest === digest && existing.filePath) {
            fileToIdMap.set(filePath, id);
            return;
        }

        const relativePath = relative(fileURLToPath(context.config.root), filePath)
            .split(sep)
            .join("/");
        const parsedData = await context.parseData({
            id,
            data: { body: contents } as Record<string, unknown>,
            filePath: relativePath,
        });
        context.store.set({
            id,
            data: parsedData,
            body: contents,
            filePath: relativePath,
            digest,
        });
        fileToIdMap.set(filePath, id);
    };

    return (async () => {
        let files: string[] = [];
        if (existsSync(baseDir)) {
            files = await listFilesRecursive(baseDir, ext);
        }
        if (files.length === 0 && existsSync(baseDir)) {
            context.logger.warn(
                `No files found matching "**/*${ext}" in directory "${relativeBase}"`,
            );
        }

        for (const filePath of files) {
            await syncData(filePath);
        }

        // Remove entries whose files were deleted since the last load.
        for (const id of untouchedEntries) {
            context.store.delete(id);
        }

        if (!context.watcher) {
            return;
        }
        context.watcher.add(baseDir);

        const onChange = async (changedPath: string): Promise<void> => {
            if (!isRawFile(changedPath)) {
                return;
            }
            try {
                await syncData(changedPath, fileToIdMap.get(changedPath));
                context.logger.info(`Reloaded raw data from ${relativeBase}`);
            } catch (err) {
                context.logger.error(
                    `Failed to reload ${changedPath}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        };
        context.watcher.on("change", onChange);
        context.watcher.on("add", onChange);
        context.watcher.on("unlink", (deletedPath: string) => {
            if (!isRawFile(deletedPath)) {
                return;
            }
            const id = fileToIdMap.get(deletedPath);
            if (id) {
                context.store.delete(id);
                fileToIdMap.delete(deletedPath);
            }
        });
    })();
}

async function listFilesRecursive(dir: string, ext: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...(await listFilesRecursive(fullPath, ext)));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
            result.push(fullPath);
        }
    }
    return result;
}

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CmsConfig, EntryCollection } from "@sveltia/cms";

import { isEntryCollection } from "./config.js";

/** Persist the CMS config for the content loader's name-based lookup. */
export function writeConfigToDisk(
    createCodegenDir: () => URL,
    userConfig: CmsConfig,
): void {
    const codegenDir = createCodegenDir();

    writeFileSync(
        fileURLToPath(new URL("config.json", codegenDir)),
        JSON.stringify(userConfig),
    );
}

function getCollectionNames(config: CmsConfig): string[] {
    return (config.collections ?? [])
        .filter(isEntryCollection)
        .map((collection) => collection.name);
}

function buildTypeDeclaration(collectionNames: string[]): string {
    if (collectionNames.length === 0) {
        return "";
    }

    const unionType = collectionNames.map((n) => JSON.stringify(n)).join(" | ");

    return `declare module "astro-sveltia-pages/loader" {
  import type { EntryCollection } from "@sveltia/cms";
  import type { SveltiaLoader } from "astro-sveltia-pages/loader";

  type SveltiaCollectionName = ${unionType};

  export function sveltiaLoader(
    name: SveltiaCollectionName,
    options?: { locale?: string },
  ): SveltiaLoader;
  export function sveltiaLoader(
    collection: EntryCollection,
    options?: { locale?: string },
  ): SveltiaLoader;
}
`;
}

/** Emits a name union type for entry collections, used by `sveltiaLoader`. */
export function injectCollectionTypes(
    injectTypes: (opts: { filename: string; content: string }) => void,
    userConfig: CmsConfig,
): void {
    const collectionNames = getCollectionNames(userConfig);

    if (collectionNames.length === 0) {
        return;
    }

    injectTypes({
        filename: "types.d.ts",
        content: buildTypeDeclaration(collectionNames),
    });
}

export type { EntryCollection };

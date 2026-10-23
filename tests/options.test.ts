import { describe, expect, it } from "vitest";

import { validateOptions, type SveltiaPagesOptions } from "../src/options.ts";

const validOptions: SveltiaPagesOptions = {
    repo: "owner/repo",
    collections: [
        {
            name: "posts",
            folder: "src/content/posts",
            fields: [{ name: "title", widget: "string" }],
        },
    ],
};

describe("validateOptions — collections", () => {
    it("rejects missing collections", () => {
        expect(() =>
            validateOptions({ ...validOptions, collections: undefined as never }),
        ).toThrow(/\[astro-sveltia-pages\].*collections/);
    });

    it("rejects an empty collections array", () => {
        expect(() => validateOptions({ ...validOptions, collections: [] })).toThrow(
            /\[astro-sveltia-pages\].*collections/,
        );
    });

    it("rejects a collection without folder", () => {
        expect(() =>
            validateOptions({
                ...validOptions,
                collections: [{ name: "posts", fields: [] } as never],
            }),
        ).toThrow(/\[astro-sveltia-pages\].*collections\[0\]\.folder/);
    });

    it("rejects a collection without a fields array", () => {
        expect(() =>
            validateOptions({
                ...validOptions,
                collections: [{ name: "posts", folder: "src/content/posts" } as never],
            }),
        ).toThrow(/\[astro-sveltia-pages\].*collections\[0\]\.fields/);
    });
});

describe("validateOptions — repo", () => {
    it("rejects a repo without owner", () => {
        expect(() => validateOptions({ ...validOptions, repo: "justname" })).toThrow(
            /\[astro-sveltia-pages\].*"repo"/,
        );
    });

    it("accepts owner/name with dots and dashes", () => {
        expect(() =>
            validateOptions({ ...validOptions, repo: "my.org/my-repo" }),
        ).not.toThrow();
    });
});

describe("validateOptions — r2", () => {
    it("accepts a complete r2 config", () => {
        expect(() =>
            validateOptions({
                ...validOptions,
                r2: {
                    accountId: "a",
                    accessKeyId: "k",
                    bucket: "b",
                    publicUrl: "https://img.example.com",
                },
            }),
        ).not.toThrow();
    });

    it("lists every missing r2 field", () => {
        expect(() =>
            validateOptions({ ...validOptions, r2: { accountId: "a" } as never }),
        ).toThrow(/\[astro-sveltia-pages\].*accessKeyId, bucket, publicUrl/);
    });
});

describe("validateOptions — scalars", () => {
    it("rejects an empty branch", () => {
        expect(() => validateOptions({ ...validOptions, branch: "  " })).toThrow(
            /\[astro-sveltia-pages\].*"branch"/,
        );
    });

    it("rejects an empty sveltiaVersion", () => {
        expect(() => validateOptions({ ...validOptions, sveltiaVersion: "" })).toThrow(
            /\[astro-sveltia-pages\].*"sveltiaVersion"/,
        );
    });

    it("rejects a logo without src", () => {
        expect(() => validateOptions({ ...validOptions, logo: {} as never })).toThrow(
            /\[astro-sveltia-pages\].*"logo\.src"/,
        );
    });

    it("accepts a fully populated options object", () => {
        expect(() =>
            validateOptions({
                ...validOptions,
                branch: "main",
                siteUrl: "https://example.com",
                locale: "en",
                appTitle: "CMS",
                logo: { src: "/logo.svg" },
                backendName: "github",
                sveltiaVersion: "latest",
                extraConfig: { display_url: "https://example.com" },
            }),
        ).not.toThrow();
    });
});

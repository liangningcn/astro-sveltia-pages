import { describe, expect, it } from "vitest";

import { buildCmsConfig } from "../src/build-config.ts";
import type { SveltiaPagesOptions } from "../src/options.ts";

const baseOptions: SveltiaPagesOptions = {
    repo: "owner/repo",
    collections: [
        {
            name: "posts",
            folder: "src/content/posts",
            fields: [{ name: "title", widget: "string" }],
        },
    ],
};

describe("buildCmsConfig — defaults", () => {
    it("derives siteUrl from Astro's site and fills defaults", () => {
        const { config, conflicts } = buildCmsConfig(
            baseOptions,
            "https://from-astro.example/",
        );

        expect(conflicts).toEqual([]);
        expect(config.backend as Record<string, unknown>).toEqual({
            name: "github",
            repo: "owner/repo",
            branch: "main",
            base_url: "https://from-astro.example",
            auth_endpoint: "auth",
            auth_scope: "repo",
        });
        const raw = config as Record<string, unknown>;
        expect(raw["media_folder"]).toBe("public/images");
        expect(raw["public_folder"]).toBe("/images");
        expect(raw["locale"]).toBe("zh");
        expect(raw["site_url"]).toBe("https://from-astro.example");
        expect(raw["app_title"]).toBe("Sveltia CMS");
        expect(raw["media_libraries"]).toBeUndefined();
        expect(raw["logo"]).toBeUndefined();
        expect(config.collections).toEqual(baseOptions.collections);
    });

    it("prefers options.siteUrl over Astro's site and strips trailing slashes", () => {
        const { config } = buildCmsConfig(
            { ...baseOptions, siteUrl: "https://explicit.example///" },
            "https://from-astro.example",
        );

        expect((config.backend as Record<string, unknown>)["base_url"]).toBe(
            "https://explicit.example",
        );
        expect(config.site_url).toBe("https://explicit.example");
    });

    it("throws a prefixed error when no site URL is available", () => {
        expect(() => buildCmsConfig(baseOptions, undefined)).toThrow(
            /\[astro-sveltia-pages\].*base_url/,
        );
    });

    it("throws a prefixed error when Astro's site is not a valid URL", () => {
        expect(() => buildCmsConfig(baseOptions, "not a url")).toThrow(
            /\[astro-sveltia-pages\].*not a valid URL/,
        );
    });
});

describe("buildCmsConfig — r2", () => {
    it("maps the r2 option to media_libraries.cloudflare_r2", () => {
        const { config } = buildCmsConfig(
            {
                ...baseOptions,
                r2: {
                    accountId: "account",
                    accessKeyId: "key",
                    bucket: "bucket",
                    publicUrl: "https://img.example.com",
                },
            },
            "https://example.com",
        );

        expect(config.media_libraries).toEqual({
            cloudflare_r2: {
                account_id: "account",
                access_key_id: "key",
                bucket: "bucket",
                public_url: "https://img.example.com",
            },
        });
    });

    it("never emits a secret_access_key", () => {
        const { config } = buildCmsConfig(
            {
                ...baseOptions,
                r2: {
                    accountId: "account",
                    accessKeyId: "key",
                    bucket: "bucket",
                    publicUrl: "https://img.example.com",
                },
            },
            "https://example.com",
        );

        expect(JSON.stringify(config)).not.toContain("secret_access_key");
    });
});

describe("buildCmsConfig — extraConfig", () => {
    it("reports overridden keys in final key order", () => {
        const { config, conflicts } = buildCmsConfig(
            {
                ...baseOptions,
                locale: "en",
                extraConfig: {
                    brand_new: true,
                    locale: "fr",
                    media_folder: "public/uploads",
                },
            },
            "https://example.com",
        );

        expect(conflicts).toEqual(["media_folder", "locale"]);
        const raw = config as Record<string, unknown>;
        expect(raw["locale"]).toBe("fr");
        expect(raw["media_folder"]).toBe("public/uploads");
        expect(raw["brand_new"]).toBe(true);
    });

    it("appends non-conflicting keys after the generated ones", () => {
        const { config, conflicts } = buildCmsConfig(
            { ...baseOptions, extraConfig: { display_url: "https://example.com" } },
            "https://example.com",
        );

        expect(conflicts).toEqual([]);
        expect(config.display_url).toBe("https://example.com");
        expect(Object.keys(config).at(-1)).toBe("display_url");
    });
});

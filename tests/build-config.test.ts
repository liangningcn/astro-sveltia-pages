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
        expect(raw["locale"]).toBeUndefined();
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

    it("throws a prefixed error when siteUrl is not a valid URL", () => {
        expect(() =>
            buildCmsConfig({ ...baseOptions, siteUrl: "not a url" }, undefined),
        ).toThrow(/\[astro-sveltia-pages\].*"siteUrl".*not a valid URL/);
    });

    it("rejects a non-http(s) siteUrl", () => {
        expect(() =>
            buildCmsConfig({ ...baseOptions, siteUrl: "ftp://example.com" }, undefined),
        ).toThrow(/\[astro-sveltia-pages\].*"siteUrl".*http or https/);
    });

    it("accepts an explicit http localhost siteUrl for local development", () => {
        const { config } = buildCmsConfig(
            { ...baseOptions, siteUrl: "http://localhost:4321/" },
            undefined,
        );

        expect((config.backend as Record<string, unknown>)["base_url"]).toBe(
            "http://localhost:4321",
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

describe("buildCmsConfig — logo", () => {
    it("forwards logoUrl to the modern logo.src key, not the deprecated logo_url", () => {
        const { config } = buildCmsConfig(
            { ...baseOptions, logoUrl: "https://example.com/logo.svg" },
            "https://example.com",
        );

        const raw = config as Record<string, unknown>;
        expect(raw["logo"]).toEqual({ src: "https://example.com/logo.svg" });
        expect(raw["logo_url"]).toBeUndefined();
        expect(JSON.stringify(config)).not.toContain("logo_url");
    });

    it("forwards the logo object as-is", () => {
        const { config } = buildCmsConfig(
            { ...baseOptions, logo: { src: "/logo.svg", header: false } },
            "https://example.com",
        );

        expect((config as Record<string, unknown>)["logo"]).toEqual({
            src: "/logo.svg",
            header: false,
        });
    });
});

describe("buildCmsConfig — extraConfig", () => {
    it("reports overridden keys in final key order", () => {
        const { config, conflicts } = buildCmsConfig(
            {
                ...baseOptions,
                appTitle: "My CMS",
                extraConfig: {
                    brand_new: true,
                    app_title: "Other CMS",
                    media_folder: "public/uploads",
                },
            },
            "https://example.com",
        );

        expect(conflicts).toEqual(["media_folder", "app_title"]);
        const raw = config as Record<string, unknown>;
        expect(raw["app_title"]).toBe("Other CMS");
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

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

import sveltiaPages from "../src/index.ts";
import type { SveltiaPagesOptions } from "../src/options.ts";

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function makeTempDir(): URL {
    const dir = mkdtempSync(join(tmpdir(), "sveltia-pages-"));
    tempDirs.push(dir);

    return pathToFileURL(`${dir}/`);
}

const baseOptions: SveltiaPagesOptions = {
    repo: "owner/repo",
    siteUrl: "https://example.com",
    collections: [
        {
            name: "posts",
            label: "Posts",
            folder: "src/content/posts",
            fields: [{ name: "title", widget: "string" }],
        },
        {
            name: "pages",
            folder: "src/content/pages",
            fields: [{ name: "title", widget: "string" }],
        },
    ],
};

function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), options: {} };
}

describe("sveltiaPages — return shape", () => {
    it('returns an integration named "astro-sveltia-pages"', () => {
        const integration = sveltiaPages(baseOptions);
        expect(integration.name).toBe("astro-sveltia-pages");
    });

    it("exposes the setup, done and build:done hooks", () => {
        const integration = sveltiaPages(baseOptions);
        expect(Object.keys(integration.hooks).sort()).toEqual([
            "astro:build:done",
            "astro:config:done",
            "astro:config:setup",
        ]);
    });
});

describe("sveltiaPages — astro:config:setup", () => {
    it("writes the generated CMS config next to the codegen dir", async () => {
        const codegenDir = makeTempDir();
        const integration = sveltiaPages({ ...baseOptions, siteUrl: undefined });
        const logger = makeLogger();

        await integration.hooks["astro:config:setup"]!({
            config: { site: "https://from-astro.example" } as never,
            createCodegenDir: () => codegenDir,
            logger: logger as never,
        } as never);

        const written = JSON.parse(
            readFileSync(new URL("config.json", codegenDir), "utf-8"),
        ) as Record<string, unknown>;

        expect(written["site_url"]).toBe("https://from-astro.example");
        expect(written["collections"]).toHaveLength(2);
    });

    it("warns once per overriding extraConfig key", async () => {
        const codegenDir = makeTempDir();
        const integration = sveltiaPages({
            ...baseOptions,
            locale: "en",
            extraConfig: { locale: "fr", something_new: 1 },
        });
        const logger = makeLogger();

        await integration.hooks["astro:config:setup"]!({
            config: { site: "https://example.com" } as never,
            createCodegenDir: () => codegenDir,
            logger: logger as never,
        } as never);

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('extraConfig key "locale" overrides'),
        );
    });
});

describe("sveltiaPages — astro:config:done type injection", () => {
    it("injects a union of entry collection names", () => {
        const integration = sveltiaPages(baseOptions);
        let injectedContent = "";

        const mockInjectTypes = (opts: { filename: string; content: string }) => {
            injectedContent = opts.content;
        };

        type DoneHook = (opts: { injectTypes: typeof mockInjectTypes }) => void;
        (integration.hooks["astro:config:done"] as unknown as DoneHook)({
            injectTypes: mockInjectTypes,
        });

        expect(injectedContent).toContain('"posts"');
        expect(injectedContent).toContain('"pages"');
    });

    it("injects types even when config:setup has not run", () => {
        const integration = sveltiaPages(baseOptions);
        let injectedContent = "";

        const mockInjectTypes = (opts: { filename: string; content: string }) => {
            injectedContent = opts.content;
        };

        type DoneHook = (opts: { injectTypes: typeof mockInjectTypes }) => void;
        (integration.hooks["astro:config:done"] as unknown as DoneHook)({
            injectTypes: mockInjectTypes,
        });

        expect(injectedContent).toContain('"posts"');
        expect(injectedContent).toContain('"pages"');
    });
});

describe("sveltiaPages — astro:build:done artifacts", () => {
    it("writes admin/index.html and admin/config.yml", async () => {
        const outDir = makeTempDir();
        const integration = sveltiaPages({
            ...baseOptions,
            appTitle: "My CMS",
            sveltiaVersion: "0.250.1",
            r2: {
                accountId: "acct",
                accessKeyId: "key",
                bucket: "bucket",
                publicUrl: "https://img.example.com",
            },
        });
        const logger = makeLogger();

        await integration.hooks["astro:config:setup"]!({
            config: { site: "https://example.com" } as never,
            createCodegenDir: () => makeTempDir(),
            logger: logger as never,
        } as never);

        await integration.hooks["astro:build:done"]!({
            dir: outDir,
            logger: logger as never,
        } as never);

        const indexHtml = readFileSync(new URL("admin/index.html", outDir), "utf-8");
        const configYml = readFileSync(new URL("admin/config.yml", outDir), "utf-8");

        expect(indexHtml).toContain('<meta name="robots" content="noindex" />');
        expect(indexHtml).toContain("<title>My CMS</title>");
        expect(indexHtml).toContain(
            '<link rel="cms-config-url" href="/admin/config.yml" />',
        );
        expect(indexHtml).toContain(
            'src="https://unpkg.com/@sveltia/cms@0.250.1/dist/sveltia-cms.js"',
        );

        expect(configYml).toMatch(
            /^# yaml-language-server: \$schema=https:\/\/unpkg\.com\/@sveltia\/cms\/schema\/sveltia-cms\.json/,
        );
        expect(configYml).toContain("base_url: https://example.com");
        expect(configYml).toContain("auth_endpoint: auth");
        expect(configYml).toContain("auth_scope: repo");
        expect(configYml).toContain("cloudflare_r2:");
        expect(configYml).toContain("public_url: https://img.example.com");
        expect(configYml).not.toContain("secret_access_key");
        expect(existsSync(new URL("admin/config.json", outDir))).toBe(false);
    });

    it("propagates write failures as a prefixed error", async () => {
        const outDir = makeTempDir();
        const blockedPath = fileURLToPath(new URL("admin", outDir));

        // A file named `admin` blocks mkdir, simulating a write failure.
        writeFileSync(blockedPath, "not a directory");

        const integration = sveltiaPages(baseOptions);
        const logger = makeLogger();

        await integration.hooks["astro:config:setup"]!({
            config: { site: "https://example.com" } as never,
            createCodegenDir: () => makeTempDir(),
            logger: logger as never,
        } as never);

        // The hook is implemented synchronously and throws before writing.
        try {
            void integration.hooks["astro:build:done"]!({
                dir: outDir,
                logger: logger as never,
            } as never);
            expect.unreachable("build:done should have thrown");
        } catch (error) {
            expect((error as Error).message).toContain(
                "[astro-sveltia-pages] Failed to write the admin UI files",
            );
        }
    });
});

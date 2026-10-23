import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

import { runInit } from "../src/cli.ts";

const TEMPLATE_PATH = fileURLToPath(
    new URL("../templates/functions/auth.js", import.meta.url),
);

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sveltia-pages-cli-"));
    tempDirs.push(dir);

    return dir;
}

function captureConsole(): { log: string[]; error: string[]; restore: () => void } {
    const log: string[] = [];
    const error: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
        log.push(args.join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
        error.push(args.join(" "));
    });

    return {
        log,
        error,
        restore: () => {
            logSpy.mockRestore();
            errorSpy.mockRestore();
        },
    };
}

describe("init — first run", () => {
    it("creates functions/auth.js from the template", () => {
        const cwd = makeTempDir();

        runInit([], cwd);

        const target = join(cwd, "functions", "auth.js");
        expect(existsSync(target)).toBe(true);
        expect(readFileSync(target, "utf-8")).toBe(
            readFileSync(TEMPLATE_PATH, "utf-8"),
        );
    });

    it("creates .env.example with the four OAuth variables", () => {
        const cwd = makeTempDir();

        runInit([], cwd);

        const content = readFileSync(join(cwd, ".env.example"), "utf-8");
        expect(content).toMatch(/^GITHUB_CLIENT_ID=$/m);
        expect(content).toMatch(/^GITHUB_CLIENT_SECRET=$/m);
        expect(content).toMatch(/^ENVIRONMENT=$/m);
        expect(content).toMatch(/^SITE_URL=$/m);
        expect(content).toContain("Cloudflare Pages");
        expect(content).toContain("Do not commit real values");
    });

    it("prints guidance with the callback URL from --site-url", () => {
        const cwd = makeTempDir();
        const console_ = captureConsole();

        try {
            runInit(["--site-url", "https://example.com/"], cwd);

            const output = console_.log.join("\n");
            expect(output).toContain("https://github.com/settings/developers");
            expect(output).toContain("https://example.com/auth");
        } finally {
            console_.restore();
        }
    });

    it("explains where to find the site URL when --site-url is omitted", () => {
        const cwd = makeTempDir();
        const console_ = captureConsole();

        try {
            runInit([], cwd);

            const output = console_.log.join("\n");
            expect(output).toContain("astro.config.mjs");
            expect(output).toContain("Cloudflare Pages dashboard");
        } finally {
            console_.restore();
        }
    });
});

describe("init — idempotency", () => {
    it("does not duplicate .env.example entries on a second run", () => {
        const cwd = makeTempDir();

        runInit([], cwd);

        const before = readFileSync(join(cwd, ".env.example"), "utf-8");

        // The second run refuses to overwrite functions/auth.js and exits
        // non-zero before touching .env.example.
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => runInit([], cwd)).toThrow(/process\.exit\(1\)/);
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }

        const after = readFileSync(join(cwd, ".env.example"), "utf-8");
        expect(after).toBe(before);
        expect(after.match(/^GITHUB_CLIENT_ID=$/gm)).toHaveLength(1);
        expect(after.match(/^GITHUB_CLIENT_SECRET=$/gm)).toHaveLength(1);
        expect(after.match(/^ENVIRONMENT=$/gm)).toHaveLength(1);
        expect(after.match(/^SITE_URL=$/gm)).toHaveLength(1);
    });

    it("skips keys that already exist, even without a value", () => {
        const cwd = makeTempDir();
        const envExamplePath = join(cwd, ".env.example");

        writeFileSync(envExamplePath, "GITHUB_CLIENT_ID=\n");

        runInit([], cwd);

        const content = readFileSync(envExamplePath, "utf-8");
        expect(content.match(/^GITHUB_CLIENT_ID=$/gm)).toHaveLength(1);
        expect(content).toMatch(/^GITHUB_CLIENT_SECRET=$/m);
        expect(content).toMatch(/^ENVIRONMENT=$/m);
        expect(content).toMatch(/^SITE_URL=$/m);
    });

    it("leaves an existing functions/auth.js untouched and exits non-zero", () => {
        const cwd = makeTempDir();
        const target = join(cwd, "functions", "auth.js");

        mkdirSync(join(cwd, "functions"), { recursive: true });
        writeFileSync(target, "EXISTING");

        const console_ = captureConsole();
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);

        try {
            expect(() => runInit([], cwd)).toThrow(/process\.exit\(1\)/);
            expect(readFileSync(target, "utf-8")).toBe("EXISTING");
            expect(console_.error.join("\n")).toContain("already exists");
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });
});

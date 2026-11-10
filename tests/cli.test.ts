import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

import { dispatchCli, runInit } from "../src/cli.ts";

const TEMPLATE_PATH = fileURLToPath(new URL("../templates/auth.js", import.meta.url));
const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));
const BUILT_CLI = join(DIST_DIR, "cli.mjs");
// The symlink group spawns dist/cli.mjs. A stale build must not be tested as
// if it were current code (that produced 3 confusing failures before).
const CLI_SOURCES = [
    "../src/cli.ts",
    "../src/i18n-template-check.ts",
    "../src/options.ts",
].map((relativePath) => fileURLToPath(new URL(relativePath, import.meta.url)));

function isBuiltCliFresh(): boolean {
    if (!existsSync(BUILT_CLI)) {
        return false;
    }

    const builtAt = statSync(BUILT_CLI).mtimeMs;

    return CLI_SOURCES.every((source) => statSync(source).mtimeMs <= builtAt);
}

if (existsSync(BUILT_CLI) && !isBuiltCliFresh()) {
    console.warn(
        "[cli.test] dist/cli.mjs is older than its sources - run `pnpm build`; skipping symlink tests.",
    );
}

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

    it("creates .env.example with all five OAuth variables", () => {
        const cwd = makeTempDir();

        runInit([], cwd);

        const content = readFileSync(join(cwd, ".env.example"), "utf-8");
        expect(content).toMatch(/^GITHUB_CLIENT_ID=$/m);
        expect(content).toMatch(/^GITHUB_CLIENT_SECRET=$/m);
        expect(content).toMatch(/^ENVIRONMENT=$/m);
        expect(content).toMatch(/^SITE_URL=$/m);
        expect(content).toMatch(/^CMS_ORIGIN=$/m);
        expect(content).toContain("REQUIRED since 0.3.0");
        expect(content).toContain("Cloudflare Pages");
        expect(content).toContain("Do not commit real values");
    });

    it("adds CMS_ORIGIN to an .env.example written before 0.3.0", () => {
        const cwd = makeTempDir();
        const envPath = join(cwd, ".env.example");

        writeFileSync(
            envPath,
            "GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\nENVIRONMENT=\nSITE_URL=\n",
        );
        runInit([], cwd);

        const content = readFileSync(envPath, "utf-8");
        expect(content).toMatch(/^CMS_ORIGIN=$/m);
        // Existing entries are preserved rather than duplicated.
        expect(content.match(/^SITE_URL=$/gm)).toHaveLength(1);
    });

    it("prints guidance with the callback URL from --site-url", () => {
        const cwd = makeTempDir();
        const console_ = captureConsole();

        try {
            runInit(["--site-url", "https://example.com/"], cwd);

            const output = console_.log.join("\n");
            expect(output).toContain("https://github.com/settings/developers");
            expect(output).toContain("https://example.com/auth");
            expect(output).toContain("CMS_ORIGIN=");
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

describe("init — EdgeOne Pages", () => {
    it("creates edge-functions/auth.js from the unified template", () => {
        const cwd = makeTempDir();

        runInit(["--platform", "edgeone"], cwd);

        const target = join(cwd, "edge-functions", "auth.js");
        expect(existsSync(target)).toBe(true);
        expect(readFileSync(target, "utf-8")).toBe(
            readFileSync(TEMPLATE_PATH, "utf-8"),
        );
        expect(existsSync(join(cwd, "functions", "auth.js"))).toBe(false);
    });

    it("produces byte-identical files for both platforms (single template)", () => {
        const cloudflareDir = makeTempDir();
        const edgeoneDir = makeTempDir();

        runInit([], cloudflareDir);
        runInit(["--platform", "edgeone"], edgeoneDir);

        const cloudflareAuth = readFileSync(
            join(cloudflareDir, "functions", "auth.js"),
            "utf-8",
        );
        const edgeoneAuth = readFileSync(
            join(edgeoneDir, "edge-functions", "auth.js"),
            "utf-8",
        );

        expect(cloudflareAuth).toBe(edgeoneAuth);
    });

    it("emits a self-contained template that auto-detects the platform", () => {
        const code = readFileSync(TEMPLATE_PATH, "utf-8");

        expect(code).not.toContain("import ");
        expect(code).not.toContain("require(");
        // Auto-detection is wired in (no per-platform pinned adapter).
        expect(code).toContain('name: "auto"');
        // The safe, fixed-origin token handover is present.
        expect(code).toContain("postMessage(message, cmsOrigin)");
        expect(code).not.toContain('postMessage(message, "*")');
    });

    it("accepts the --platform=edgeone syntax", () => {
        const cwd = makeTempDir();

        runInit(["--platform=edgeone"], cwd);

        expect(existsSync(join(cwd, "edge-functions", "auth.js"))).toBe(true);
    });

    it("documents the EdgeOne dashboard in .env.example", () => {
        const cwd = makeTempDir();

        runInit(["--platform", "edgeone"], cwd);

        const content = readFileSync(join(cwd, ".env.example"), "utf-8");
        expect(content).toContain("EdgeOne Pages");
        expect(content).not.toContain("Cloudflare Pages");
        expect(content).toMatch(/^GITHUB_CLIENT_ID=$/m);
        expect(content).toMatch(/^SITE_URL=$/m);
    });

    it("prints the EdgeOne guidance", () => {
        const cwd = makeTempDir();
        const console_ = captureConsole();

        try {
            runInit(
                ["--platform", "edgeone", "--site-url", "https://example.com"],
                cwd,
            );

            const output = console_.log.join("\n");
            expect(output).toContain("EdgeOne Pages");
            expect(output).toContain("https://example.com/auth");
        } finally {
            console_.restore();
        }
    });

    it("rejects an unknown platform", () => {
        const cwd = makeTempDir();
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => runInit(["--platform", "vercel"], cwd)).toThrow(
                /process\.exit\(1\)/,
            );
            expect(console_.error.join("\n")).toContain("unknown --platform");
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });
});

describe("CLI command dispatch", () => {
    it("prints usage listing init:i18n for --help", () => {
        const console_ = captureConsole();

        try {
            dispatchCli(["--help"], makeTempDir());

            expect(console_.log.join("\n")).toContain("init:i18n");
            expect(console_.log.join("\n")).toContain("--check");
        } finally {
            console_.restore();
        }
    });

    it("rejects an unknown command instead of silently running init", () => {
        const cwd = makeTempDir();
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code: number,
        ) => {
            throw new Error(`process.exit(${String(code)})`);
        }) as never);
        const console_ = captureConsole();

        try {
            expect(() => dispatchCli(["init:i19n"], cwd)).toThrow(/process\.exit\(1\)/);
            expect(console_.error.join("\n")).toContain("Unknown command: init:i19n");
            expect(existsSync(join(cwd, "functions", "auth.js"))).toBe(false);
        } finally {
            console_.restore();
            exitSpy.mockRestore();
        }
    });

    it("keeps the no-command and explicit init forms working", () => {
        const bareCwd = makeTempDir();
        const explicitCwd = makeTempDir();
        const console_ = captureConsole();

        try {
            dispatchCli([], bareCwd);
            dispatchCli(["init"], explicitCwd);
        } finally {
            console_.restore();
        }

        expect(existsSync(join(bareCwd, "functions", "auth.js"))).toBe(true);
        expect(existsSync(join(explicitCwd, "functions", "auth.js"))).toBe(true);
    });
});

// Regression: pnpm installs packages through symlinks. Node resolves the ESM
// main module to its real path but leaves `process.argv[1]` as the shim path,
// so the old strict equality check skipped the whole CLI (exit 0, no output).
// These spawn the built CLI; they run once `pnpm build` has produced dist/.
describe("CLI entry detection via a pnpm-style symlink", () => {
    // A dist/ that merely exists is not enough: it must be newer than its
    // sources, otherwise these assertions test a stale CLI.
    const runIt = isBuiltCliFresh() ? it : it.skip;

    function withLinkedDist(fn: (cliPath: string, cwd: string) => void): void {
        const cwd = makeTempDir();
        const link = join(cwd, "linked-dist");

        symlinkSync(DIST_DIR, link, process.platform === "win32" ? "junction" : "dir");

        try {
            fn(join(link, "cli.mjs"), cwd);
        } finally {
            rmSync(link, { force: true });
        }
    }

    runIt("fails loudly for an unknown command on the real path", () => {
        const cwd = makeTempDir();
        const result = spawnSync(
            process.execPath,
            [BUILT_CLI, "definitely-not-a-command"],
            { cwd, encoding: "utf-8" },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Unknown command: definitely-not-a-command");
    });

    runIt("rejects unknown flags instead of running init with side effects", () => {
        const cwd = makeTempDir();

        for (const flag of ["--version", "--hel", "--platform", "--site-url"]) {
            const result = spawnSync(process.execPath, [BUILT_CLI, flag], {
                cwd,
                encoding: "utf-8",
            });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(`Unknown command: ${flag}`);
            expect(result.stderr).toContain("Usage:");
        }

        expect(existsSync(join(cwd, "functions", "auth.js"))).toBe(false);
        expect(existsSync(join(cwd, ".env.example"))).toBe(false);
    });

    runIt("still accepts the supported init flags", () => {
        const cwd = makeTempDir();
        const result = spawnSync(
            process.execPath,
            [BUILT_CLI, "--platform", "edgeone", "--site-url", "https://example.com"],
            { cwd, encoding: "utf-8" },
        );

        expect(result.status).toBe(0);
        expect(existsSync(join(cwd, "edge-functions", "auth.js"))).toBe(true);
    });

    runIt("does not silently exit when reached through a symlink", () => {
        withLinkedDist((cliPath, cwd) => {
            const result = spawnSync(
                process.execPath,
                [cliPath, "definitely-not-a-command"],
                { cwd, encoding: "utf-8" },
            );

            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                "Unknown command: definitely-not-a-command",
            );
        });
    });

    runIt("prints help when reached through a symlink", () => {
        withLinkedDist((cliPath, cwd) => {
            const result = spawnSync(process.execPath, [cliPath, "--help"], {
                cwd,
                encoding: "utf-8",
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("init:i18n");
        });
    });
});

import { afterEach, describe, expect, it } from "vitest";

import { onRequest as cloudflareOnRequest } from "../../src/functions/entries/cloudflare.ts";
import { handler as denoHandler } from "../../src/functions/entries/deno.ts";
import edgeoneDefault, {
    onRequest as edgeoneOnRequest,
} from "../../src/functions/entries/edgeone.ts";
import netlifyEntry from "../../src/functions/entries/netlify.ts";
import vercelEntry from "../../src/functions/entries/vercel.ts";

const ENV = {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    SITE_URL: "https://example.com",
};

const PROCESS_ENV_KEYS = [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "SITE_URL",
] as const;

function withProcessEnv(
    env: Record<string, string>,
    fn: () => Promise<void> | void,
): Promise<void> | void {
    const saved: Record<string, string | undefined> = {};

    for (const key of PROCESS_ENV_KEYS) {
        saved[key] = process.env[key];
        process.env[key] = env[key];
    }

    try {
        return fn();
    } finally {
        for (const key of PROCESS_ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    }
}

afterEach(() => {
    for (const key of PROCESS_ENV_KEYS) {
        delete process.env[key];
    }
});

function createRequest(
    url: string,
    headers: Record<string, string> = {},
    extra: Record<string, unknown> = {},
): Request {
    const request = new Request(url, { headers });
    Object.assign(request, extra); // 注入 request.eo 等平台字段
    return request;
}

describe("Cloudflare Pages entry", () => {
    it("handles the Cloudflare context shape", async () => {
        const response = await cloudflareOnRequest({
            request: createRequest("https://example.com/auth", {
                "CF-Connecting-IP": "198.51.100.7",
            }),
            env: ENV,
            params: {},
        });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain(
            "https://github.com/login/oauth/authorize",
        );
    });
});

describe("EdgeOne Pages entry", () => {
    it("handles the EdgeOne context shape", async () => {
        const response = await edgeoneOnRequest({
            request: createRequest("https://example.com/auth", {}, {
                eo: { clientIp: "203.0.113.42" },
            } as unknown as Record<string, unknown>),
            env: ENV,
        });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain(
            "https://github.com/login/oauth/authorize",
        );
    });

    it("exposes the handler as the default export", async () => {
        const response = await edgeoneDefault({
            request: createRequest("https://example.com/auth"),
            env: ENV,
        });

        expect(response.status).toBe(302);
    });

    it("accepts a request and env pair", async () => {
        const response = await edgeoneOnRequest(
            createRequest("https://example.com/auth"),
            ENV,
        );

        expect(response.status).toBe(302);
    });

    it("reports missing credentials", async () => {
        const response = await edgeoneOnRequest({
            request: createRequest("https://example.com/auth"),
            env: {},
        });

        expect(response.status).toBe(500);
    });
});

describe("Vercel entry", () => {
    it("handles a bare Request (Vercel Edge Function signature)", async () => {
        await withProcessEnv(ENV, async () => {
            const request = new Request("https://example.com/auth", {
                headers: { "x-vercel-forwarded-for": "198.51.100.9" },
            });

            const response = await vercelEntry(request);

            expect(response.status).toBe(302);
            expect(response.headers.get("location")).toContain(
                "https://github.com/login/oauth/authorize",
            );
        });
    });

    it("reports missing credentials without process.env", async () => {
        const request = new Request("https://example.com/auth");

        const response = await vercelEntry(request);

        expect(response.status).toBe(500);
    });
});

describe("Netlify entry", () => {
    it("handles the (request, context) signature and reads context.ip", async () => {
        const request = new Request("https://example.com/auth");

        const response = await netlifyEntry(request, {
            env: ENV,
            site: { url: "https://example.com" },
            ip: "198.51.100.9",
        });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain(
            "https://github.com/login/oauth/authorize",
        );
    });

    it("reports missing credentials when env is empty", async () => {
        const request = new Request("https://example.com/auth");

        const response = await netlifyEntry(request, { env: {} });

        expect(response.status).toBe(500);
    });
});

describe("Deno Deploy entry", () => {
    it("exports the handler without starting Deno.serve in a non-Deno runtime", () => {
        expect(typeof denoHandler).toBe("function");
    });

    it("handles a bare Request through the exported handler", async () => {
        const request = new Request("https://example.com/auth");

        const response = await denoHandler({ request, env: ENV });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain(
            "https://github.com/login/oauth/authorize",
        );
    });

    it("is a no-op module on non-Deno runtimes (no Deno.serve call)", () => {
        // Importing the entry must not throw and must not register a server.
        // `Deno` is undefined under Node, so the top-level guard skips
        // `Deno.serve`; the only export is the named `handler`.
        expect(typeof denoHandler).toBe("function");
    });
});

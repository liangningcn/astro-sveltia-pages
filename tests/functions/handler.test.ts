import { describe, expect, it, vi } from "vitest";

import type { PlatformAdapter, PlatformContext } from "../../src/functions/adapter.ts";
import { cloudflareAdapter } from "../../src/functions/cloudflare.ts";
import { edgeoneAdapter } from "../../src/functions/edgeone.ts";
import { createAuthHandler } from "../../src/functions/handler.ts";
import { signState } from "../../src/functions/state.ts";

const CLIENT_ID = "client-id";
const CLIENT_SECRET = "client-secret";
const NOW = 1_700_000_000_000;

type ContextOptions = {
    env?: Record<string, string>;
    headers?: Record<string, string>;
    clientIp?: string;
};

function createRequest(
    url: string,
    options: ContextOptions = {},
    extra: Record<string, unknown> = {},
): Request {
    return {
        url,
        method: "GET",
        headers: new Headers(options.headers),
        ...extra,
    } as unknown as Request;
}

function createCloudflareContext(
    url: string,
    options: ContextOptions = {},
): PlatformContext {
    return {
        request: createRequest(url, options),
        env: {
            GITHUB_CLIENT_ID: CLIENT_ID,
            GITHUB_CLIENT_SECRET: CLIENT_SECRET,
            ...options.env,
        },
    };
}

function createEdgeOneContext(
    url: string,
    options: ContextOptions = {},
): PlatformContext {
    return {
        request: createRequest(url, options, {
            eo: { clientIp: options.clientIp ?? "203.0.113.42" },
        }),
        env: {
            GITHUB_CLIENT_ID: CLIENT_ID,
            GITHUB_CLIENT_SECRET: CLIENT_SECRET,
            ...options.env,
        },
    };
}

const PLATFORMS: {
    name: string;
    adapter: PlatformAdapter;
    createContext: (url: string, options?: ContextOptions) => PlatformContext;
}[] = [
    {
        name: "cloudflare",
        adapter: cloudflareAdapter,
        createContext: createCloudflareContext,
    },
    { name: "edgeone", adapter: edgeoneAdapter, createContext: createEdgeOneContext },
];

function createFetchMock(payload: Record<string, unknown>): typeof fetch {
    return vi.fn(
        async () =>
            new Response(JSON.stringify(payload), {
                headers: { "Content-Type": "application/json" },
            }),
    ) as unknown as typeof fetch;
}

describe.each(PLATFORMS)("createAuthHandler ($name)", ({ adapter, createContext }) => {
    const handler = createAuthHandler({
        adapter,
        now: () => NOW,
        fetch: createFetchMock({ access_token: "gho_token" }),
    });

    it("redirects to GitHub with a signed state", async () => {
        const context = createContext("https://example.com/auth", {
            env: { SITE_URL: "https://example.com" },
        });
        const response = await handler(context);

        expect(response.status).toBe(302);

        const location = new URL(response.headers.get("location") ?? "");

        expect(location.origin + location.pathname).toBe(
            "https://github.com/login/oauth/authorize",
        );
        expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
        expect(location.searchParams.get("redirect_uri")).toBe(
            "https://example.com/auth",
        );
        expect(location.searchParams.get("scope")).toBe("repo,user");
        expect(signState(CLIENT_SECRET, NOW).split(".")[0]).toBe(
            location.searchParams.get("state")?.split(".")[0],
        );
    });

    it("exchanges the code and hands the token to the CMS with a fixed targetOrigin", async () => {
        const state = signState(CLIENT_SECRET, NOW);
        const context = createContext(
            `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
            {
                env: {
                    SITE_URL: "https://example.com",
                    CMS_ORIGIN: "https://cms.example.com",
                },
            },
        );
        const response = await handler(context);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain("authorization:github:success:");
        expect(html).toContain("gho_token");
        // The token is posted to a fixed, configured origin (never "*").
        expect(html).toContain('var cmsOrigin = "https://cms.example.com";');
        expect(html).toContain("postMessage(message, cmsOrigin)");
        expect(html).not.toContain('postMessage(message, "*")');
    });

    it("returns 500 when CMS_ORIGIN is missing", async () => {
        const state = signState(CLIENT_SECRET, NOW);
        const context = createContext(
            `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
            { env: { SITE_URL: "https://example.com" } },
        );
        const response = await handler(context);

        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain("postMessage");
    });

    it("returns 500 when CMS_ORIGIN is not https/localhost", async () => {
        const state = signState(CLIENT_SECRET, NOW);
        const context = createContext(
            `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
            {
                env: {
                    SITE_URL: "https://example.com",
                    CMS_ORIGIN: "http://evil.example.com",
                },
            },
        );
        const response = await handler(context);

        expect(response.status).toBe(500);
    });

    it("rejects an unmarshalable CMS_ORIGIN", async () => {
        const state = signState(CLIENT_SECRET, NOW);
        const context = createContext(
            `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
            { env: { SITE_URL: "https://example.com", CMS_ORIGIN: "not a url" } },
        );
        const response = await handler(context);

        expect(response.status).toBe(500);
    });

    it("rejects a callback without a state", async () => {
        const context = createContext("https://example.com/auth?code=oauth-code");
        const response = await handler(context);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Missing state" });
    });

    it("rejects a forged state", async () => {
        const context = createContext(
            "https://example.com/auth?code=oauth-code&state=1700000000000.deadbeef",
        );
        const response = await handler(context);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid or expired state" });
    });

    it("rejects an expired state", async () => {
        const state = signState(CLIENT_SECRET, NOW - 11 * 60 * 1000);
        const context = createContext(
            `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
        );
        const response = await handler(context);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid or expired state" });
    });

    it("returns 500 when the credentials are missing", async () => {
        const context = createContext("https://example.com/auth", {
            env: { GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" },
        });
        const response = await handler(context);

        expect(response.status).toBe(500);
    });

    it("returns 400 when GitHub rejects the code", async () => {
        const failing = createAuthHandler({
            adapter,
            now: () => NOW,
            fetch: createFetchMock({
                error: "bad_verification_code",
                error_description: "The code passed is incorrect or expired.",
            }),
        });
        const state = signState(CLIENT_SECRET, NOW);
        const context = createContext(
            `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
        );
        const response = await failing(context);

        expect(response.status).toBe(400);
    });

    it("answers CORS preflight requests", async () => {
        const context = createContext("https://example.com/auth");
        const response = await handler({
            ...context,
            request: new Request(context.request.url, {
                method: "OPTIONS",
                headers: context.request.headers,
            }),
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    });
});

describe("createAuthHandler - rate limiting", () => {
    it("rejects requests above the limit", async () => {
        const handler = createAuthHandler({
            adapter: cloudflareAdapter,
            now: () => NOW,
            rateLimit: { limit: 1, windowMs: 60_000 },
            fetch: createFetchMock({ access_token: "gho_token" }),
        });
        const context = createCloudflareContext("https://example.com/auth");

        expect((await handler(context)).status).toBe(302);
        expect((await handler(context)).status).toBe(429);
    });
});

describe("createAuthHandler - platform parity", () => {
    it("produces the same redirect on both platforms", async () => {
        const locations = await Promise.all(
            PLATFORMS.map(async ({ adapter, createContext }) => {
                const handler = createAuthHandler({
                    adapter,
                    now: () => NOW,
                    fetch: createFetchMock({ access_token: "gho_token" }),
                });
                const response = await handler(
                    createContext("https://example.com/auth", {
                        env: { SITE_URL: "https://example.com" },
                    }),
                );

                return response.headers.get("location");
            }),
        );

        expect(locations[0]).toBe(locations[1]);
    });

    it("produces the same token handover on both platforms", async () => {
        const pages = await Promise.all(
            PLATFORMS.map(async ({ adapter, createContext }) => {
                const handler = createAuthHandler({
                    adapter,
                    now: () => NOW,
                    fetch: createFetchMock({ access_token: "gho_token" }),
                });
                const state = signState(CLIENT_SECRET, NOW);
                const response = await handler(
                    createContext(
                        `https://example.com/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
                    ),
                );

                return response.text();
            }),
        );

        expect(pages[0]).toBe(pages[1]);
    });
});

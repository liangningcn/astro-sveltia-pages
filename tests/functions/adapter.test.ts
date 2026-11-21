import { afterEach, describe, expect, it } from "vitest";

import { UNKNOWN_CLIENT_IP } from "../../src/functions/adapter.ts";
import { cloudflareAdapter } from "../../src/functions/cloudflare.ts";
import { denoAdapter } from "../../src/functions/deno.ts";
import { autoAdapter, detectAdapter } from "../../src/functions/detect.ts";
import { edgeoneAdapter } from "../../src/functions/edgeone.ts";
import { netlifyAdapter } from "../../src/functions/netlify.ts";
import { vercelAdapter } from "../../src/functions/vercel.ts";

function createRequest(
    url: string,
    headers: Record<string, string> = {},
    extra: Record<string, unknown> = {},
): Request {
    return {
        url,
        method: "GET",
        headers: new Headers(headers),
        ...extra,
    } as unknown as Request;
}

const globals = globalThis as {
    env?: unknown;
    Netlify?: unknown;
    Deno?: unknown;
    process?: { env?: Record<string, unknown> } | undefined;
};

afterEach(() => {
    delete globals.env;
    delete globals.Netlify;
    delete globals.Deno;
    // `process.env` is mutated in-place by some tests; restore it instead of
    // deleting it (Node always defines `process`).
    if (globals.process?.env) {
        for (const key of Object.keys(globals.process.env)) {
            if (
                key === "GITHUB_CLIENT_ID" ||
                key === "SITE_URL" ||
                key === "GITHUB_CLIENT_SECRET" ||
                key === "CMS_ORIGIN"
            ) {
                delete globals.process.env[key];
            }
        }
    }
});

describe("cloudflareAdapter", () => {
    const context = {
        request: createRequest("https://example.com/auth"),
        env: { GITHUB_CLIENT_ID: "id", SITE_URL: "https://example.com" },
    };

    it("reads the environment variables from the context", () => {
        expect(cloudflareAdapter.getEnv(context, "GITHUB_CLIENT_ID")).toBe("id");
        expect(cloudflareAdapter.getEnv(context, "MISSING")).toBeUndefined();
    });

    it("reads the client IP from the CF-Connecting-IP header", () => {
        const request = createRequest("https://example.com/auth", {
            "CF-Connecting-IP": "198.51.100.7",
        });

        expect(cloudflareAdapter.getClientIp(request)).toBe("198.51.100.7");
    });

    it("falls back to unknown when the header is missing", () => {
        expect(
            cloudflareAdapter.getClientIp(createRequest("https://example.com/auth")),
        ).toBe(UNKNOWN_CLIENT_IP);
    });

    it("prefers SITE_URL over the request origin", () => {
        const url = new URL("https://example.com/auth");

        expect(cloudflareAdapter.getOrigin(context, url)).toBe("https://example.com");
    });

    it("falls back to the request origin without SITE_URL", () => {
        const url = new URL("https://preview.pages.dev/auth");

        expect(
            cloudflareAdapter.getOrigin({ request: context.request, env: {} }, url),
        ).toBe("https://preview.pages.dev");
    });
});

describe("edgeoneAdapter", () => {
    const context = {
        request: createRequest("https://example.com/auth"),
        env: { GITHUB_CLIENT_ID: "id", SITE_URL: "https://example.com" },
    };

    it("reads the environment variables from the context", () => {
        expect(edgeoneAdapter.getEnv(context, "GITHUB_CLIENT_ID")).toBe("id");
        expect(edgeoneAdapter.getEnv(context, "MISSING")).toBeUndefined();
    });

    it("falls back to the global env object", () => {
        globals.env = { GITHUB_CLIENT_ID: "global-id" };

        expect(
            edgeoneAdapter.getEnv({ request: context.request }, "GITHUB_CLIENT_ID"),
        ).toBe("global-id");
    });

    it("reads the client IP from request.eo.clientIp", () => {
        const request = createRequest(
            "https://example.com/auth",
            {},
            { eo: { clientIp: "203.0.113.42" } },
        );

        expect(edgeoneAdapter.getClientIp(request)).toBe("203.0.113.42");
    });

    it("ignores the eo-client-ip header (only request.eo.clientIp is trusted)", () => {
        const request = createRequest("https://example.com/auth", {
            "eo-client-ip": "203.0.113.43",
        });

        expect(edgeoneAdapter.getClientIp(request)).toBe(UNKNOWN_CLIENT_IP);
    });

    it("ignores x-forwarded-for (must not be used as the rate-limit key)", () => {
        const request = createRequest("https://example.com/auth", {
            "x-forwarded-for": "203.0.113.44, 70.41.3.18",
        });

        expect(edgeoneAdapter.getClientIp(request)).toBe(UNKNOWN_CLIENT_IP);
    });

    it("prefers request.eo.clientIp even when a forged x-forwarded-for is set", () => {
        const request = createRequest(
            "https://example.com/auth",
            { "x-forwarded-for": "203.0.113.44, 70.41.3.18" },
            { eo: { clientIp: "203.0.113.42" } },
        );

        expect(edgeoneAdapter.getClientIp(request)).toBe("203.0.113.42");
    });

    it("falls back to unknown when the IP is not exposed", () => {
        expect(
            edgeoneAdapter.getClientIp(createRequest("https://example.com/auth")),
        ).toBe(UNKNOWN_CLIENT_IP);
    });

    it("prefers SITE_URL over the request origin", () => {
        const url = new URL("https://example.com/auth");

        expect(edgeoneAdapter.getOrigin(context, url)).toBe("https://example.com");
    });

    it("falls back to the request origin without SITE_URL", () => {
        const url = new URL("https://preview.edgeone.app/auth");

        expect(
            edgeoneAdapter.getOrigin({ request: context.request, env: {} }, url),
        ).toBe("https://preview.edgeone.app");
    });
});

describe("vercelAdapter", () => {
    const context = {
        request: createRequest("https://example.com/auth"),
        env: { GITHUB_CLIENT_ID: "id", SITE_URL: "https://example.com" },
    };

    it("reads the environment variables from the context first", () => {
        expect(vercelAdapter.getEnv(context, "GITHUB_CLIENT_ID")).toBe("id");
        expect(vercelAdapter.getEnv(context, "MISSING")).toBeUndefined();
    });

    it("falls back to process.env when context.env has no value", () => {
        if (!globals.process?.env) {
            // Should not happen under Node, but skip gracefully.
            return;
        }
        globals.process.env.GITHUB_CLIENT_ID = "vercel-id";

        expect(
            vercelAdapter.getEnv({ request: context.request }, "GITHUB_CLIENT_ID"),
        ).toBe("vercel-id");
    });

    it("reads the client IP from x-vercel-forwarded-for", () => {
        const request = createRequest("https://example.com/auth", {
            "x-vercel-forwarded-for": "198.51.100.9",
        });

        expect(vercelAdapter.getClientIp(request)).toBe("198.51.100.9");
    });

    it("takes the first hop from x-vercel-forwarded-for", () => {
        const request = createRequest("https://example.com/auth", {
            "x-vercel-forwarded-for": "198.51.100.9, 10.0.0.1",
        });

        expect(vercelAdapter.getClientIp(request)).toBe("198.51.100.9");
    });

    it("falls back to x-vercel-ip", () => {
        const request = createRequest("https://example.com/auth", {
            "x-vercel-ip": "198.51.100.9",
        });

        expect(vercelAdapter.getClientIp(request)).toBe("198.51.100.9");
    });

    it("ignores x-forwarded-for (must not be used as the rate-limit key)", () => {
        const request = createRequest("https://example.com/auth", {
            "x-forwarded-for": "203.0.113.44",
        });

        expect(vercelAdapter.getClientIp(request)).toBe(UNKNOWN_CLIENT_IP);
    });

    it("falls back to unknown when no Vercel IP header is set", () => {
        expect(
            vercelAdapter.getClientIp(createRequest("https://example.com/auth")),
        ).toBe(UNKNOWN_CLIENT_IP);
    });

    it("prefers SITE_URL over the request origin", () => {
        const url = new URL("https://example.com/auth");

        expect(vercelAdapter.getOrigin(context, url)).toBe("https://example.com");
    });
});

describe("netlifyAdapter", () => {
    const context = {
        request: createRequest("https://example.com/auth"),
        env: { GITHUB_CLIENT_ID: "id", SITE_URL: "https://example.com" },
    };

    it("reads the environment variables from the context first", () => {
        expect(netlifyAdapter.getEnv(context, "GITHUB_CLIENT_ID")).toBe("id");
        expect(netlifyAdapter.getEnv(context, "MISSING")).toBeUndefined();
    });

    it("falls back to the global Netlify.env.get()", () => {
        globals.Netlify = {
            env: {
                get: (key: string) =>
                    key === "GITHUB_CLIENT_ID" ? "netlify-id" : undefined,
            },
        };

        expect(
            netlifyAdapter.getEnv({ request: context.request }, "GITHUB_CLIENT_ID"),
        ).toBe("netlify-id");
    });

    it("falls back to process.env when neither context nor Netlify.env has it", () => {
        if (!globals.process?.env) {
            return;
        }
        globals.process.env.GITHUB_CLIENT_ID = "node-id";

        expect(
            netlifyAdapter.getEnv({ request: context.request }, "GITHUB_CLIENT_ID"),
        ).toBe("node-id");
    });

    it("reads the client IP from context.ip", () => {
        const request = createRequest("https://example.com/auth");

        expect(
            netlifyAdapter.getClientIp(request, { request, ip: "198.51.100.9" }),
        ).toBe("198.51.100.9");
    });

    it("reads the client IP from context.geo.ip when context.ip is absent", () => {
        const request = createRequest("https://example.com/auth");

        expect(
            netlifyAdapter.getClientIp(request, {
                request,
                geo: { ip: "198.51.100.10" },
            }),
        ).toBe("198.51.100.10");
    });

    it("ignores x-forwarded-for (must not be used as the rate-limit key)", () => {
        const request = createRequest("https://example.com/auth", {
            "x-forwarded-for": "203.0.113.44",
        });

        expect(netlifyAdapter.getClientIp(request)).toBe(UNKNOWN_CLIENT_IP);
    });

    it("falls back to unknown when the IP is not exposed", () => {
        const request = createRequest("https://example.com/auth");

        expect(netlifyAdapter.getClientIp(request)).toBe(UNKNOWN_CLIENT_IP);
    });

    it("prefers SITE_URL over the request origin", () => {
        const url = new URL("https://example.com/auth");

        expect(netlifyAdapter.getOrigin(context, url)).toBe("https://example.com");
    });
});

describe("denoAdapter", () => {
    const context = {
        request: createRequest("https://example.com/auth"),
        env: { GITHUB_CLIENT_ID: "id", SITE_URL: "https://example.com" },
    };

    it("reads the environment variables from the context first", () => {
        expect(denoAdapter.getEnv(context, "GITHUB_CLIENT_ID")).toBe("id");
        expect(denoAdapter.getEnv(context, "MISSING")).toBeUndefined();
    });

    it("falls back to Deno.env.get()", () => {
        globals.Deno = {
            env: {
                get: (key: string) =>
                    key === "GITHUB_CLIENT_ID" ? "deno-id" : undefined,
            },
            serve: () => undefined,
        };

        expect(
            denoAdapter.getEnv({ request: context.request }, "GITHUB_CLIENT_ID"),
        ).toBe("deno-id");
    });

    it("falls back to process.env when neither context nor Deno.env has it", () => {
        if (!globals.process?.env) {
            return;
        }
        globals.process.env.GITHUB_CLIENT_ID = "node-id";

        expect(
            denoAdapter.getEnv({ request: context.request }, "GITHUB_CLIENT_ID"),
        ).toBe("node-id");
    });

    it("reads the client IP from x-forwarded-for (Deno Deploy exposes no trusted IP)", () => {
        const request = createRequest("https://example.com/auth", {
            "x-forwarded-for": "203.0.113.44",
        });

        expect(denoAdapter.getClientIp(request)).toBe("203.0.113.44");
    });

    it("takes the first hop from x-forwarded-for", () => {
        const request = createRequest("https://example.com/auth", {
            "x-forwarded-for": "203.0.113.44, 10.0.0.1",
        });

        expect(denoAdapter.getClientIp(request)).toBe("203.0.113.44");
    });

    it("falls back to unknown when the header is missing", () => {
        expect(denoAdapter.getClientIp(createRequest("https://example.com/auth"))).toBe(
            UNKNOWN_CLIENT_IP,
        );
    });

    it("prefers SITE_URL over the request origin", () => {
        const url = new URL("https://example.com/auth");

        expect(denoAdapter.getOrigin(context, url)).toBe("https://example.com");
    });
});

describe("detectAdapter", () => {
    it("detects EdgeOne through the request namespace", () => {
        const request = createRequest(
            "https://example.com/auth",
            {},
            { eo: { clientIp: "203.0.113.42" } },
        );

        expect(detectAdapter({ request })).toBe(edgeoneAdapter);
    });

    it("detects Netlify through the context.site field", () => {
        const request = createRequest("https://example.com/auth");

        expect(detectAdapter({ request, site: { url: "https://x.netlify.app" } })).toBe(
            netlifyAdapter,
        );
    });

    it("detects Netlify through the global Netlify object", () => {
        globals.Netlify = { env: { get: () => undefined } };
        const request = createRequest("https://example.com/auth");

        expect(detectAdapter({ request })).toBe(netlifyAdapter);
    });

    it("detects Netlify through context.ip", () => {
        const request = createRequest("https://example.com/auth");

        expect(detectAdapter({ request, ip: "198.51.100.9" })).toBe(netlifyAdapter);
    });

    it("detects Deno Deploy through the global Deno object", () => {
        globals.Deno = { env: { get: () => undefined }, serve: () => undefined };
        const request = createRequest("https://example.com/auth");

        expect(detectAdapter({ request })).toBe(denoAdapter);
    });

    it("detects Vercel through x-vercel-forwarded-for", () => {
        const request = createRequest("https://example.com/auth", {
            "x-vercel-forwarded-for": "198.51.100.9",
        });

        expect(detectAdapter({ request })).toBe(vercelAdapter);
    });

    it("detects Vercel through x-vercel-ip", () => {
        const request = createRequest("https://example.com/auth", {
            "x-vercel-ip": "198.51.100.9",
        });

        expect(detectAdapter({ request })).toBe(vercelAdapter);
    });

    it("detects Cloudflare through the CF-Connecting-IP header", () => {
        const request = createRequest("https://example.com/auth", {
            "CF-Connecting-IP": "198.51.100.7",
        });

        expect(detectAdapter({ request })).toBe(cloudflareAdapter);
    });

    it("falls back to Cloudflare for unknown requests", () => {
        const request = createRequest("https://example.com/auth");

        expect(detectAdapter({ request })).toBe(cloudflareAdapter);
    });

    it("EdgeOne wins over every other signal", () => {
        globals.Netlify = {};
        globals.Deno = {};
        const request = createRequest(
            "https://example.com/auth",
            {
                "CF-Connecting-IP": "198.51.100.7",
                "x-vercel-forwarded-for": "198.51.100.9",
            },
            { eo: { clientIp: "203.0.113.42" } },
        );

        expect(detectAdapter({ request })).toBe(edgeoneAdapter);
    });

    it("Netlify wins over Deno, Vercel and Cloudflare", () => {
        globals.Deno = {};
        const request = createRequest("https://example.com/auth", {
            "CF-Connecting-IP": "198.51.100.7",
            "x-vercel-forwarded-for": "198.51.100.9",
        });

        expect(detectAdapter({ request, site: {} })).toBe(netlifyAdapter);
    });

    it("Deno wins over Vercel and Cloudflare", () => {
        globals.Deno = { env: {}, serve: () => undefined };
        const request = createRequest("https://example.com/auth", {
            "CF-Connecting-IP": "198.51.100.7",
            "x-vercel-forwarded-for": "198.51.100.9",
        });

        expect(detectAdapter({ request })).toBe(denoAdapter);
    });

    it("Vercel wins over Cloudflare", () => {
        const request = createRequest("https://example.com/auth", {
            "CF-Connecting-IP": "198.51.100.7",
            "x-vercel-forwarded-for": "198.51.100.9",
        });

        expect(detectAdapter({ request })).toBe(vercelAdapter);
    });
});

describe("autoAdapter", () => {
    it("delegates to the detected platform", () => {
        const request = createRequest(
            "https://example.com/auth",
            {},
            { eo: { clientIp: "203.0.113.42" } },
        );

        expect(autoAdapter.getClientIp(request)).toBe("203.0.113.42");
    });

    it("delegates to Netlify with context-supplied IP", () => {
        const request = createRequest("https://example.com/auth");

        expect(autoAdapter.getClientIp(request, { request, ip: "198.51.100.9" })).toBe(
            "198.51.100.9",
        );
    });
});

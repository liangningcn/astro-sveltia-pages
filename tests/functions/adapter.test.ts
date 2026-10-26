import { afterEach, describe, expect, it } from "vitest";

import { UNKNOWN_CLIENT_IP } from "../../src/functions/adapter.ts";
import { cloudflareAdapter } from "../../src/functions/cloudflare.ts";
import { autoAdapter, detectAdapter } from "../../src/functions/detect.ts";
import { edgeoneAdapter } from "../../src/functions/edgeone.ts";

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

const globals = globalThis as { env?: unknown };

afterEach(() => {
    delete globals.env;
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

describe("detectAdapter", () => {
    it("detects EdgeOne through the request namespace", () => {
        const request = createRequest(
            "https://example.com/auth",
            {},
            { eo: { clientIp: "203.0.113.42" } },
        );

        expect(detectAdapter({ request })).toBe(edgeoneAdapter);
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
});

import { describe, expect, it } from "vitest";

import { onRequest as cloudflareOnRequest } from "../../src/functions/entries/cloudflare.ts";
import edgeoneDefault, {
    onRequest as edgeoneOnRequest,
} from "../../src/functions/entries/edgeone.ts";

const ENV = {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    SITE_URL: "https://example.com",
};

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

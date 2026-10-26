import {
    readEnvValue,
    resolveSiteOrigin,
    UNKNOWN_CLIENT_IP,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";

function getEnv(context: PlatformContext, key: string): string | undefined {
    return readEnvValue(context.env, key);
}

function getClientIp(request: Request): string {
    const ip = request.headers.get("CF-Connecting-IP")?.trim();

    return ip || UNKNOWN_CLIENT_IP;
}

function getOrigin(context: PlatformContext, url: URL): string {
    return resolveSiteOrigin(context, url, cloudflareAdapter);
}

/**
 * Cloudflare Pages adapter.
 *
 * Environment variables come from `context.env`, the client IP from the
 * `CF-Connecting-IP` header that Cloudflare sets on every request.
 */
export const cloudflareAdapter: PlatformAdapter = {
    name: "cloudflare",
    getEnv,
    getClientIp,
    getOrigin,
};

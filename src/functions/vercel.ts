import {
    readEnvValue,
    resolveSiteOrigin,
    UNKNOWN_CLIENT_IP,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";

/**
 * Vercel Edge Functions expose env through `process.env` (Edge runtime and
 * Node runtime both support it). `context.env` is checked first so a future
 * Vercel context shape works without an adapter change.
 */
function getEnv(context: PlatformContext, key: string): string | undefined {
    const fromContext = readEnvValue(context.env, key);

    if (fromContext !== undefined) {
        return fromContext;
    }

    const processEnv = (globalThis as { process?: { env?: unknown } }).process?.env;

    return readEnvValue(processEnv, key);
}

/**
 * Vercel sets `x-vercel-forwarded-for` (trusted) and `x-vercel-ip-*` headers
 * on every edge request. The platform-controlled `x-vercel-forwarded-for` is
 * preferred because it mirrors Cloudflare's `CF-Connecting-IP` contract.
 */
function getClientIp(request: Request): string {
    const headers = request.headers;
    const vercelFwd = headers.get("x-vercel-forwarded-for")?.trim();

    if (vercelFwd) {
        // The first hop is the client; subsequent entries are Vercel's own.
        return vercelFwd.split(",")[0]?.trim() || vercelFwd;
    }

    const vercelIp = headers.get("x-vercel-ip")?.trim();

    if (vercelIp) {
        return vercelIp;
    }

    return UNKNOWN_CLIENT_IP;
}

function getOrigin(context: PlatformContext, url: URL): string {
    return resolveSiteOrigin(context, url, vercelAdapter);
}

/**
 * Vercel adapter.
 *
 * Env variables come from `process.env` (Edge runtime exposes them the same
 * way); the client IP comes from Vercel's `x-vercel-forwarded-for` /
 * `x-vercel-ip` headers, which are set by the platform and cannot be forged
 * by the client.
 */
export const vercelAdapter: PlatformAdapter = {
    name: "vercel",
    getEnv,
    getClientIp,
    getOrigin,
};

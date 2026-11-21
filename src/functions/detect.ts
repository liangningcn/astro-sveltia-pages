import {
    UNKNOWN_CLIENT_IP,
    type AdapterName,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";
import { cloudflareAdapter } from "./cloudflare.js";
import { denoAdapter } from "./deno.js";
import { edgeoneAdapter, type EdgeOneRequest } from "./edgeone.js";
import { netlifyAdapter } from "./netlify.js";
import { vercelAdapter } from "./vercel.js";

/** Netlify edge context shape (only the fields this package reads). */
type NetlifyContext = PlatformContext & {
    site?: unknown;
    ip?: unknown;
    geo?: { ip?: string; [key: string]: unknown };
};

function isNetlifyContext(context: PlatformContext): boolean {
    // The Netlify edge runtime exposes a global `Netlify` object and attaches
    // `context.site` / `context.ip` / `context.geo` to every request context.
    if (typeof (globalThis as { Netlify?: unknown }).Netlify !== "undefined") {
        return true;
    }

    const ctx = context as NetlifyContext;

    return (
        ctx.site !== undefined ||
        ctx.ip !== undefined ||
        (ctx.geo !== undefined && typeof ctx.geo === "object")
    );
}

function isDenoRuntime(): boolean {
    return typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
}

/**
 * Detects the platform from the request shape and runtime globals.
 *
 * Priority (most specific first):
 *  1. EdgeOne — `request.eo` namespace.
 *  2. Netlify — global `Netlify` object or `context.site` / `context.ip` /
 *     `context.geo`.
 *  3. Deno Deploy — global `Deno` object.
 *  4. Vercel — `x-vercel-forwarded-for` or `x-vercel-ip` header.
 *  5. Cloudflare — `CF-Connecting-IP` header.
 *  6. Fallback — Cloudflare adapter (degrades to `unknown` client IP).
 */
export function detectAdapter(context: PlatformContext): PlatformAdapter {
    const request = context.request as EdgeOneRequest | undefined;

    if (request?.eo && typeof request.eo === "object") {
        return edgeoneAdapter;
    }

    if (isNetlifyContext(context)) {
        return netlifyAdapter;
    }

    if (isDenoRuntime()) {
        return denoAdapter;
    }

    const headers = request?.headers;

    if (headers?.has("x-vercel-forwarded-for") || headers?.has("x-vercel-ip")) {
        return vercelAdapter;
    }

    if (headers?.has("CF-Connecting-IP")) {
        return cloudflareAdapter;
    }

    return cloudflareAdapter;
}

/**
 * Adapter that resolves the platform implementation per request.
 *
 * Use it when a single bundle has to serve every supported platform.
 */
export const autoAdapter: PlatformAdapter = {
    name: "auto",
    getEnv(context, key) {
        return detectAdapter(context).getEnv(context, key);
    },
    getClientIp(request, context) {
        return detectAdapter(context ?? { request }).getClientIp(request, context);
    },
    getOrigin(context, url) {
        return detectAdapter(context).getOrigin(context, url);
    },
};

/** Resolves an adapter selector into a concrete adapter. */
export function resolveAdapter(selector: PlatformAdapter | "auto"): PlatformAdapter {
    if (selector === "auto") {
        return autoAdapter;
    }

    return selector;
}

/** Returns the adapter of a platform, or the auto-detecting one. */
export function adapterFor(platform: AdapterName): PlatformAdapter {
    switch (platform) {
        case "cloudflare":
            return cloudflareAdapter;
        case "edgeone":
            return edgeoneAdapter;
        case "vercel":
            return vercelAdapter;
        case "netlify":
            return netlifyAdapter;
        case "deno":
            return denoAdapter;
        default:
            return autoAdapter;
    }
}

export { UNKNOWN_CLIENT_IP };

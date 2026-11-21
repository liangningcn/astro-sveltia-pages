import {
    readEnvValue,
    resolveSiteOrigin,
    UNKNOWN_CLIENT_IP,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";

/** Netlify global runtime object exposed on Deno-based Edge Functions. */
type NetlifyGlobal = {
    env?: { get?: (key: string) => string | undefined; [key: string]: unknown };
    [key: string]: unknown;
};

/**
 * Netlify Edge Functions expose env through three sources: the `context.env`
 * object, the global `Netlify.env.get()` method (Deno runtime), and
 * `process.env` (Node runtime / local fallback). They are checked in that
 * order so the runtime-controlled value wins.
 */
function getEnv(context: PlatformContext, key: string): string | undefined {
    const fromContext = readEnvValue(context.env, key);

    if (fromContext !== undefined) {
        return fromContext;
    }

    const netlify = (globalThis as { Netlify?: NetlifyGlobal }).Netlify;

    if (netlify?.env?.get) {
        try {
            const value = netlify.env.get(key);

            if (typeof value === "string") {
                return value;
            }
        } catch {
            // `Netlify.env.get` throws for missing keys on some runtime
            // versions; treat it as a miss and continue.
        }
    }

    const processEnv = (globalThis as { process?: { env?: unknown } }).process?.env;

    return readEnvValue(processEnv, key);
}

/**
 * Netlify Edge Functions expose the client IP through `context.ip` (current)
 * or `context.geo.ip` (older runtime). Both are runtime-set and cannot be
 * forged by the client. The `x-forwarded-for` header is deliberately NOT
 * trusted: on Netlify it is derived from the same runtime value, and trusting
 * it directly would let a client forge the rate-limit key.
 *
 * When the adapter is invoked without a context (e.g. from
 * `autoAdapter.getClientIp(request)` without context), it falls back to
 * `unknown` rather than reading a header.
 */
function getClientIp(request: Request, context?: PlatformContext): string {
    if (context) {
        const directIp = readIp(context.ip);

        if (directIp) {
            return directIp;
        }

        const geoIp = readIp((context.geo as { ip?: unknown } | undefined)?.ip);

        if (geoIp) {
            return geoIp;
        }
    }

    // The Netlify context is normally required; the request-only fallback
    // keeps the signature compatible with the bare `autoAdapter` path.
    const ctxIp = (request as Request & { clientIp?: unknown }).clientIp;

    return readIp(ctxIp) || UNKNOWN_CLIENT_IP;
}

function readIp(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }

    return undefined;
}

function getOrigin(context: PlatformContext, url: URL): string {
    return resolveSiteOrigin(context, url, netlifyAdapter);
}

/**
 * Netlify adapter.
 *
 * Env variables come from `context.env`, the global `Netlify.env` object and
 * `process.env`; the client IP comes from `context.ip` / `context.geo.ip`
 * (set by the runtime). The handler passes the context to `getClientIp` so
 * the IP is read from the trusted runtime value instead of a forgeable header.
 */
export const netlifyAdapter: PlatformAdapter = {
    name: "netlify",
    getEnv,
    getClientIp,
    getOrigin,
};

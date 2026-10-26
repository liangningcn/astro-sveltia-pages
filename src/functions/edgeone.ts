import {
    readEnvValue,
    resolveSiteOrigin,
    UNKNOWN_CLIENT_IP,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";

/** EdgeOne request shape: the runtime attaches an `eo` namespace. */
export type EdgeOneRequest = Request & {
    eo?: { clientIp?: string; geo?: Record<string, unknown>; [key: string]: unknown };
};

function getEnv(context: PlatformContext, key: string): string | undefined {
    const fromContext = readEnvValue(context.env, key);

    if (fromContext !== undefined) {
        return fromContext;
    }

    // EdgeOne injects the variables into a global `env` object in some
    // runtimes; fall back to it before giving up.
    const globalEnv = (globalThis as { env?: unknown }).env;
    const fromGlobal = readEnvValue(globalEnv, key);

    if (fromGlobal !== undefined) {
        return fromGlobal;
    }

    // Node-compatible runtimes expose them through `process.env`.
    const processEnv = (globalThis as { process?: { env?: unknown } }).process?.env;

    return readEnvValue(processEnv, key);
}

function getClientIp(request: Request): string {
    // Only the runtime-provided `request.eo.clientIp` is trusted. Header-based
    // fallbacks (`eo-client-ip`, `x-forwarded-for`) are deliberately NOT used:
    // they can be forged by the client, which would let an attacker rotate the
    // rate-limit key and bypass the per-IP limit. When the runtime does not
    // expose the IP we fall back to "unknown" and share one bucket for it.
    const clientIp = (request as EdgeOneRequest).eo?.clientIp?.trim();

    return clientIp || UNKNOWN_CLIENT_IP;
}

function getOrigin(context: PlatformContext, url: URL): string {
    return resolveSiteOrigin(context, url, edgeoneAdapter);
}

/**
 * EdgeOne Pages adapter.
 *
 * Environment variables are read from `context.env` first and from the global
 * `env` object afterwards; the client IP comes from `request.eo.clientIp`.
 */
export const edgeoneAdapter: PlatformAdapter = {
    name: "edgeone",
    getEnv,
    getClientIp,
    getOrigin,
};

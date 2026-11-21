import {
    readEnvValue,
    resolveSiteOrigin,
    UNKNOWN_CLIENT_IP,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";

/** Minimal Deno global this adapter touches. */
type DenoGlobal = {
    env?: { get?: (key: string) => string | undefined; [key: string]: unknown };
    serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown;
};

/**
 * Deno Deploy exposes env through `Deno.env.get()`; the Node-compatible
 * `process.env` is also present in some Deno runtimes and is used as a
 * fallback. `context.env` is checked first so a future Deno entry shape
 * works without an adapter change.
 */
function getEnv(context: PlatformContext, key: string): string | undefined {
    const fromContext = readEnvValue(context.env, key);

    if (fromContext !== undefined) {
        return fromContext;
    }

    const deno = (globalThis as { Deno?: DenoGlobal }).Deno;

    if (deno?.env?.get) {
        try {
            const value = deno.env.get(key);

            if (typeof value === "string") {
                return value;
            }
        } catch {
            // `Deno.env.get` throws for missing permissions on some runtimes;
            // treat it as a miss and continue.
        }
    }

    const processEnv = (globalThis as { process?: { env?: unknown } }).process?.env;

    return readEnvValue(processEnv, key);
}

/**
 * Deno Deploy does not expose a trusted runtime-set client IP. The
 * `x-forwarded-for` header is the only signal available; it can be forged by
 * the client, so the rate limit may be rotated by a determined attacker.
 * This trade-off is documented in the README and is the same compromise every
 * Deno Deploy OAuth proxy has to make.
 */
function getClientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for")?.trim();

    if (forwarded) {
        return forwarded.split(",")[0]?.trim() || forwarded;
    }

    return UNKNOWN_CLIENT_IP;
}

function getOrigin(context: PlatformContext, url: URL): string {
    return resolveSiteOrigin(context, url, denoAdapter);
}

/**
 * Deno Deploy adapter.
 *
 * Env variables come from `Deno.env.get()` and `process.env`; the client IP is
 * read from `x-forwarded-for` (the only signal Deno Deploy exposes).
 */
export const denoAdapter: PlatformAdapter = {
    name: "deno",
    getEnv,
    getClientIp,
    getOrigin,
};

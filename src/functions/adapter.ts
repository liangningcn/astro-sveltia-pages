/** Deployment platforms the OAuth proxy can run on. */
export type PlatformName = "cloudflare" | "edgeone";

/** Adapter selector accepted by the public API. */
export type AdapterName = PlatformName | "auto";

/**
 * Runtime context handed to the function entry.
 *
 * Both platforms pass a single object that carries at least `request` and
 * `env`; the shape is normalized by `normalizeContext()` before the adapter
 * sees it.
 */
export type PlatformContext = {
    request: Request;
    env?: unknown;
    [key: string]: unknown;
};

/**
 * Runtime-specific glue.
 *
 * The OAuth logic never touches a platform API directly: it only reads
 * environment variables, the client IP and the request origin through this
 * interface, so one implementation serves Cloudflare Pages and EdgeOne Pages.
 */
export type PlatformAdapter = {
    /** Platform identifier, used in logs and error messages. */
    readonly name: AdapterName;
    /** Reads an environment variable; `undefined` when it is not configured. */
    getEnv(context: PlatformContext, key: string): string | undefined;
    /** Best-effort client IP; {@link UNKNOWN_CLIENT_IP} when hidden. */
    getClientIp(request: Request): string;
    /** Origin used to build the OAuth `redirect_uri` (`${origin}/auth`). */
    getOrigin(context: PlatformContext, url: URL): string;
};

/** Client IP placeholder used when the runtime does not expose the real one. */
export const UNKNOWN_CLIENT_IP = "unknown";

/**
 * Reads a string value from an unknown environment bag.
 *
 * Cloudflare exposes `context.env` as a plain object, EdgeOne may expose it as
 * a global object or through `process.env`; all of them are plain objects with
 * string values.
 */
export function readEnvValue(env: unknown, key: string): string | undefined {
    if (!env || typeof env !== "object") {
        return undefined;
    }

    const value = (env as Record<string, unknown>)[key];

    if (typeof value === "string") {
        return value;
    }

    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "boolean" || typeof value === "number") {
        return String(value);
    }

    if (typeof value === "object" && value !== null) {
        return JSON.stringify(value);
    }

    return undefined;
}

/**
 * Resolves the origin used for the OAuth `redirect_uri`.
 *
 * `SITE_URL` wins over the request origin: the request origin changes across
 * custom domains, `*.pages.dev` preview domains and local dev servers, while
 * the GitHub OAuth App registers one callback URL.
 */
export function resolveSiteOrigin(
    context: PlatformContext,
    url: URL,
    adapter: PlatformAdapter,
): string {
    const siteUrl = adapter.getEnv(context, "SITE_URL")?.trim();

    return siteUrl || url.origin;
}

import type { PlatformContext } from "./adapter.js";

/**
 * Duck-typed request check.
 *
 * The runtimes do not share a `Request` class across realms, and the tests
 * use plain objects, so the shape is checked instead of the prototype.
 */
function isRequestLike(value: unknown): value is Request {
    return (
        typeof value === "object" &&
        value !== null &&
        "url" in value &&
        "headers" in value
    );
}

/**
 * Normalizes the arguments a platform entry point receives.
 *
 * Cloudflare Pages calls `onRequest({ request, env, params })`, EdgeOne calls
 * `onRequest({ request, env })` or `onRequest(request, env)`. All of them are
 * reduced to a single {@link PlatformContext}.
 */
export function normalizeContext(input: unknown, env?: unknown): PlatformContext {
    if (isRequestLike(input)) {
        return { request: input, env };
    }

    if (typeof input !== "object" || input === null) {
        throw new TypeError(
            "The OAuth function expects a request context with a `request` property.",
        );
    }

    const context = input as Record<string, unknown>;

    if (!isRequestLike(context.request)) {
        throw new TypeError(
            "The OAuth function expects a request context with a `request` property.",
        );
    }

    return { ...context, request: context.request, env: context.env ?? env };
}

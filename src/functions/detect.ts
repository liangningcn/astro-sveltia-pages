import {
    UNKNOWN_CLIENT_IP,
    type AdapterName,
    type PlatformAdapter,
    type PlatformContext,
} from "./adapter.js";
import { cloudflareAdapter } from "./cloudflare.js";
import { edgeoneAdapter, type EdgeOneRequest } from "./edgeone.js";

/**
 * Detects the platform from the request shape.
 *
 * EdgeOne attaches an `eo` namespace to the request, Cloudflare sets the
 * `CF-Connecting-IP` header. Anything unknown falls back to Cloudflare, whose
 * adapter degrades to `"unknown"` for the client IP.
 */
export function detectAdapter(context: PlatformContext): PlatformAdapter {
    const request = context.request as EdgeOneRequest | undefined;

    if (request?.eo && typeof request.eo === "object") {
        return edgeoneAdapter;
    }

    if (request?.headers?.has("CF-Connecting-IP")) {
        return cloudflareAdapter;
    }

    return cloudflareAdapter;
}

/**
 * Adapter that resolves the platform implementation per request.
 *
 * Use it when a single bundle has to serve both platforms.
 */
export const autoAdapter: PlatformAdapter = {
    name: "auto",
    getEnv(context, key) {
        return detectAdapter(context).getEnv(context, key);
    },
    getClientIp(request) {
        return detectAdapter({ request }).getClientIp(request);
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
    if (platform === "cloudflare") {
        return cloudflareAdapter;
    }

    if (platform === "edgeone") {
        return edgeoneAdapter;
    }

    return autoAdapter;
}

export { UNKNOWN_CLIENT_IP };

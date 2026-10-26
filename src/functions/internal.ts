/**
 * Internal implementation details of the OAuth proxy.
 *
 * This module is intentionally NOT part of the stable public API exposed by
 * `astro-sveltia-pages/functions`. Its exports may change in any release.
 * Only import from `astro-sveltia-pages/functions/internal` if you specifically
 * need low-level access (custom adapters, crypto, rate limiting).
 */
export { UNKNOWN_CLIENT_IP, readEnvValue, resolveSiteOrigin } from "./adapter.js";
export { cloudflareAdapter } from "./cloudflare.js";
export { edgeoneAdapter, type EdgeOneRequest } from "./edgeone.js";
export { adapterFor, autoAdapter, detectAdapter, resolveAdapter } from "./detect.js";
export { normalizeContext } from "./context.js";
export {
    createRateLimiter,
    DEFAULT_RATE_LIMIT,
    MAX_TRACKED_CLIENTS,
    type RateLimiter,
    type RateLimitOptions,
} from "./rate-limit.js";
export { hmacSha256Hex, timingSafeEqual } from "./sha256.js";

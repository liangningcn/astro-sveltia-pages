/**
 * Public API of `astro-sveltia-pages/functions`.
 *
 * Everything below is stable across minor releases. Lower-level helpers
 * (adapters, crypto, rate limiting, detection) are intentionally not exported
 * here; find them in `astro-sveltia-pages/functions/internal`.
 */
export {
    type AdapterName,
    type PlatformAdapter,
    type PlatformContext,
    type PlatformName,
} from "./adapter.js";
export {
    createAuthHandler,
    type AuthHandler,
    type AuthHandlerOptions,
} from "./handler.js";
export { signState, STATE_TTL_MS, verifyState } from "./state.js";

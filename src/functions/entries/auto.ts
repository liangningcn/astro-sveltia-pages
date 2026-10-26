import { normalizeContext } from "../context.js";
import { autoAdapter } from "../detect.js";
import { createAuthHandler } from "../handler.js";

const handler = createAuthHandler({ adapter: autoAdapter });

/**
 * Auto-detecting edge function entry point.
 *
 * Deploy this file as `functions/auth.js` (Cloudflare Pages) or
 * `edge-functions/auth.js` (EdgeOne Pages). The runtime detects the platform
 * per request, so a single artifact serves both; there is no need for two
 * near-identical templates.
 */
export async function onRequest(context: unknown, env?: unknown): Promise<Response> {
    return handler(normalizeContext(context, env));
}

export default onRequest;

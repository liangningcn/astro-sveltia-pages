import { cloudflareAdapter } from "../cloudflare.js";
import { normalizeContext } from "../context.js";
import { createAuthHandler } from "../handler.js";

const handler = createAuthHandler({ adapter: cloudflareAdapter });

/**
 * Cloudflare Pages Function entry point.
 *
 * Deploy this file as `functions/auth.js` in the project root; Cloudflare
 * routes `GET /auth` to it.
 */
export async function onRequest(context: unknown, env?: unknown): Promise<Response> {
    return handler(normalizeContext(context, env));
}

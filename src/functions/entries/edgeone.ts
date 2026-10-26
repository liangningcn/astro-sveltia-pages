import { normalizeContext } from "../context.js";
import { edgeoneAdapter } from "../edgeone.js";
import { createAuthHandler } from "../handler.js";

const handler = createAuthHandler({ adapter: edgeoneAdapter });

/**
 * EdgeOne Pages edge function entry point.
 *
 * Deploy this file as `edge-functions/auth.js` in the project root; EdgeOne
 * routes `GET /auth` to it.
 */
export async function onRequest(context: unknown, env?: unknown): Promise<Response> {
    return handler(normalizeContext(context, env));
}

export default onRequest;

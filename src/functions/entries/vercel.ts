import { normalizeContext } from "../context.js";
import { autoAdapter } from "../detect.js";
import { createAuthHandler } from "../handler.js";

const handler = createAuthHandler({ adapter: autoAdapter });

/**
 * Vercel Edge Function entry point.
 *
 * Deploy this file as `api/auth.js` in the project root. Vercel routes
 * `GET /auth` to it and supplies env through `process.env` (Edge runtime
 * exposes it the same way as Node). The platform is auto-detected per
 * request so the same artifact also works on Cloudflare Pages and EdgeOne.
 *
 * Vercel Edge Functions expect a default export of shape
 * `(req: Request) => Response | Promise<Response>`.
 */
export default async function handleRequest(request: Request): Promise<Response> {
    return handler(normalizeContext(request));
}

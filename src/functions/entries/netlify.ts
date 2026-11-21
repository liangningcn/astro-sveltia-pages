import { normalizeContext } from "../context.js";
import { autoAdapter } from "../detect.js";
import { createAuthHandler } from "../handler.js";

const handler = createAuthHandler({ adapter: autoAdapter });

/**
 * Netlify Edge Function entry point.
 *
 * Deploy this file as `netlify/edge-functions/auth.js` and declare it in
 * `netlify.toml`:
 *
 *   [[edge_functions]]
 *   path = "/auth"
 *   function = "auth"
 *
 * Netlify Edge Functions expect a default export of shape
 * `(req: Request, context: Context) => Response | Promise<Response>`. The
 * context carries `env`, `site`, `ip`, `geo` and `cookies`; `normalizeContext`
 * keeps every field so the auto-adapter can detect Netlify and read
 * `context.ip` / `context.geo.ip` as the trusted client IP.
 */
export default async function handleRequest(
    request: Request,
    context: Record<string, unknown>,
): Promise<Response> {
    return handler(
        normalizeContext({
            ...context,
            request,
            env: (context as { env?: unknown }).env,
        }),
    );
}

import { normalizeContext } from "../context.js";
import { autoAdapter } from "../detect.js";
import { createAuthHandler } from "../handler.js";

const handler = createAuthHandler({ adapter: autoAdapter });

/**
 * Deno Deploy entry point.
 *
 * Deploy this file as the project entry (e.g. `serve.ts` / `main.ts`) and
 * run it with `deno run --allow-net --allow-env serve.ts` or let Deno Deploy
 * pick it up automatically. The file is a no-op on non-Deno runtimes so it
 * is safe to import from a shared codebase.
 *
 * `Deno.serve` expects a `(req: Request) => Response | Promise<Response>`
 * handler; env is read from `Deno.env.get()` by the adapter.
 */
const denoGlobal = globalThis as unknown as {
    Deno?: {
        serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown;
    };
};

if (
    typeof denoGlobal.Deno !== "undefined" &&
    typeof denoGlobal.Deno?.serve === "function"
) {
    denoGlobal.Deno.serve((request: Request): Response | Promise<Response> =>
        handler(normalizeContext(request)),
    );
}

export { handler };

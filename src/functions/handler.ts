import type { AdapterName, PlatformAdapter, PlatformContext } from "./adapter.js";
import { adapterFor, detectAdapter } from "./detect.js";
import {
    createRateLimiter,
    DEFAULT_RATE_LIMIT,
    type RateLimitOptions,
} from "./rate-limit.js";
import { signState, verifyState } from "./state.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_SCOPE = "repo,user";

/** Options of {@link createAuthHandler}. */
export type AuthHandlerOptions = {
    /**
     * Platform adapter. Pass `"auto"` (the default) to detect the platform
     * per request, which lets one bundle serve both platforms.
     */
    adapter?: PlatformAdapter | "auto";
    /**
     * Deployment platform. `"auto"` (the default) detects the platform per
     * request; `"cloudflare"` and `"edgeone"` pin it.
     */
    platform?: AdapterName;
    /** Overridable `fetch`, used by the tests. */
    fetch?: typeof fetch;
    /** Timestamp source, used by the state TTL and the rate limiter. */
    now?: () => number;
    /** Rate limit settings; `null` disables the limit entirely. */
    rateLimit?: RateLimitOptions | null;
    /** GitHub OAuth scope. */
    scope?: string;
};

/** Request handler shared by every platform entry point. */
export type AuthHandler = (context: PlatformContext) => Promise<Response>;

type TokenResponse = {
    access_token?: string;
    error?: string;
    error_description?: string;
};

function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function htmlResponse(html: string): Response {
    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

/**
 * Builds the page that hands the token over to Sveltia CMS.
 *
 * The `postMessage` target origin is `*` on purpose: the CMS may be served
 * from another origin than the OAuth proxy (preview deployments, custom
 * domains). The CMS itself validates the origin of the message sender, so the
 * token never reaches a window that did not open the popup.
 */
function successPage(token: string, origin: string): string {
    const tokenLiteral = JSON.stringify(token);
    const originLiteral = JSON.stringify(origin);

    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>授权成功</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    .success {
      color: #22c55e;
      font-size: 1.2rem;
      margin-bottom: 1rem;
    }
    .loading {
      color: #666;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">✓ 授权成功</div>
    <div class="loading">正在返回管理后台...</div>
  </div>
  <script>
    (function () {
      var token = ${tokenLiteral};
      var origin = ${originLiteral};
      // The target origin is "*" on purpose: the CMS may run on another origin
      // (preview deployment, custom domain) and the CMS validates the origin
      // of the message sender itself.
      var message = "authorization:github:success:" + JSON.stringify({ token: token });

      if (window.opener && window.opener !== window) {
        try {
          window.opener.postMessage(message, "*");
          setTimeout(function () {
            window.close();
          }, 1000);
        } catch (error) {
          window.location.href = origin + "/admin/#access_token=" + encodeURIComponent(token);
        }
      } else {
        window.location.href = origin + "/admin/#access_token=" + encodeURIComponent(token);
      }
    })();
  </script>
</body>
</html>`;
}

function preflightResponse(
    context: PlatformContext,
    url: URL,
    adapter: PlatformAdapter,
): Response {
    const productionOrigin = adapter.getEnv(context, "SITE_URL")?.trim() || url.origin;
    const allowOrigin =
        adapter.getEnv(context, "ENVIRONMENT") === "production"
            ? productionOrigin
            : "*";

    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": allowOrigin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        },
    });
}

/**
 * Creates the platform-agnostic GitHub OAuth handler.
 *
 * The handler owns the whole OAuth flow (state signing, token exchange,
 * `postMessage` handover); the adapter only provides the runtime details that
 * differ between Cloudflare Pages and EdgeOne Pages.
 */
export function createAuthHandler(options: AuthHandlerOptions = {}): AuthHandler {
    const adapter = options.adapter ?? adapterFor(options.platform ?? "auto");
    const now = options.now ?? ((): number => Date.now());
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const scope = options.scope ?? DEFAULT_SCOPE;
    const limit =
        options.rateLimit === undefined ? DEFAULT_RATE_LIMIT : options.rateLimit;
    const limiter = limit === null ? null : createRateLimiter(limit);

    return async function handleAuth(context: PlatformContext): Promise<Response> {
        const request = context.request;
        const url = new URL(request.url);
        const resolvedAdapter = adapter === "auto" ? detectAdapter(context) : adapter;

        if (request.method === "OPTIONS") {
            return preflightResponse(context, url, resolvedAdapter);
        }

        const clientId = resolvedAdapter.getEnv(context, "GITHUB_CLIENT_ID")?.trim();
        const clientSecret = resolvedAdapter
            .getEnv(context, "GITHUB_CLIENT_SECRET")
            ?.trim();

        if (!clientId || !clientSecret) {
            return jsonResponse(
                { error: "GitHub OAuth credentials not configured" },
                500,
            );
        }

        const clientIp = resolvedAdapter.getClientIp(request);

        if (limiter && !limiter.hit(clientIp, now())) {
            return jsonResponse({ error: "Too many requests" }, 429);
        }

        const origin = resolvedAdapter.getOrigin(context, url);
        const redirectUri = `${origin}/auth`;
        const code = url.searchParams.get("code");

        if (!code) {
            const state = signState(clientSecret, now());
            const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);

            authorizeUrl.searchParams.set("client_id", clientId);
            authorizeUrl.searchParams.set("redirect_uri", redirectUri);
            authorizeUrl.searchParams.set("scope", scope);
            authorizeUrl.searchParams.set("state", state);

            return Response.redirect(authorizeUrl.toString(), 302);
        }

        const state = url.searchParams.get("state");

        if (!state) {
            return jsonResponse({ error: "Missing state" }, 400);
        }

        if (!verifyState(clientSecret, state, now())) {
            return jsonResponse({ error: "Invalid or expired state" }, 400);
        }

        try {
            const tokenResponse = await fetchImpl(GITHUB_TOKEN_URL, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                    redirect_uri: redirectUri,
                }),
            });
            const tokenData = (await tokenResponse.json()) as TokenResponse;

            if (tokenData.error) {
                return jsonResponse(
                    { error: tokenData.error_description || tokenData.error },
                    400,
                );
            }

            const token = tokenData.access_token;

            if (!token) {
                return jsonResponse(
                    { error: "GitHub did not return an access token" },
                    500,
                );
            }

            return htmlResponse(successPage(token, origin));
        } catch (error) {
            console.error("Auth error:", error);

            return jsonResponse({ error: "Authentication failed" }, 500);
        }
    };
}

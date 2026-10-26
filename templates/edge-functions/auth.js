// Sveltia CMS GitHub OAuth proxy for EdgeOne Pages.
// Generated from src/functions by `vp run build:templates` - do not edit.
// Deploy as edge-functions/auth.js and configure GITHUB_CLIENT_ID,
// GITHUB_CLIENT_SECRET, SITE_URL and ENVIRONMENT in the platform dashboard.
//#region src/functions/context.ts
/**
 * Duck-typed request check.
 *
 * The runtimes do not share a `Request` class across realms, and the tests
 * use plain objects, so the shape is checked instead of the prototype.
 */
function isRequestLike(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        "url" in value &&
        "headers" in value
    );
}
/**
 * Normalizes the arguments a platform entry point receives.
 *
 * Cloudflare Pages calls `onRequest({ request, env, params })`, EdgeOne calls
 * `onRequest({ request, env })` or `onRequest(request, env)`. All of them are
 * reduced to a single {@link PlatformContext}.
 */
function normalizeContext(input, env) {
    if (isRequestLike(input)) return { request: input, env };
    if (typeof input !== "object" || input === null)
        throw new TypeError(
            "The OAuth function expects a request context with a `request` property.",
        );
    const context = input;
    if (!isRequestLike(context.request))
        throw new TypeError(
            "The OAuth function expects a request context with a `request` property.",
        );
    return { ...context, request: context.request, env: context.env ?? env };
}
/**
 * Reads a string value from an unknown environment bag.
 *
 * Cloudflare exposes `context.env` as a plain object, EdgeOne may expose it as
 * a global object or through `process.env`; all of them are plain objects with
 * string values.
 */
function readEnvValue(env, key) {
    if (!env || typeof env !== "object") return;
    const value = env[key];
    if (typeof value === "string") return value;
    if (value === void 0 || value === null) return;
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
}
/**
 * Resolves the origin used for the OAuth `redirect_uri`.
 *
 * `SITE_URL` wins over the request origin: the request origin changes across
 * custom domains, `*.pages.dev` preview domains and local dev servers, while
 * the GitHub OAuth App registers one callback URL.
 */
function resolveSiteOrigin(context, url, adapter) {
    return adapter.getEnv(context, "SITE_URL")?.trim() || url.origin;
}
//#endregion
//#region src/functions/edgeone.ts
function getEnv$1(context, key) {
    const fromContext = readEnvValue(context.env, key);
    if (fromContext !== void 0) return fromContext;
    const globalEnv = globalThis.env;
    const fromGlobal = readEnvValue(globalEnv, key);
    if (fromGlobal !== void 0) return fromGlobal;
    const processEnv = globalThis.process?.env;
    return readEnvValue(processEnv, key);
}
function getClientIp$1(request) {
    const clientIp = request.eo?.clientIp?.trim();
    if (clientIp) return clientIp;
    return (
        request.headers.get("eo-client-ip")?.trim() ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
    );
}
function getOrigin$1(context, url) {
    return resolveSiteOrigin(context, url, edgeoneAdapter);
}
/**
 * EdgeOne Pages adapter.
 *
 * Environment variables are read from `context.env` first and from the global
 * `env` object afterwards; the client IP comes from `request.eo.clientIp`.
 */
var edgeoneAdapter = {
    name: "edgeone",
    getEnv: getEnv$1,
    getClientIp: getClientIp$1,
    getOrigin: getOrigin$1,
};
//#endregion
//#region src/functions/cloudflare.ts
function getEnv(context, key) {
    return readEnvValue(context.env, key);
}
function getClientIp(request) {
    return request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
}
function getOrigin(context, url) {
    return resolveSiteOrigin(context, url, cloudflareAdapter);
}
/**
 * Cloudflare Pages adapter.
 *
 * Environment variables come from `context.env`, the client IP from the
 * `CF-Connecting-IP` header that Cloudflare sets on every request.
 */
var cloudflareAdapter = { name: "cloudflare", getEnv, getClientIp, getOrigin };
//#endregion
//#region src/functions/detect.ts
/**
 * Detects the platform from the request shape.
 *
 * EdgeOne attaches an `eo` namespace to the request, Cloudflare sets the
 * `CF-Connecting-IP` header. Anything unknown falls back to Cloudflare, whose
 * adapter degrades to `"unknown"` for the client IP.
 */
function detectAdapter(context) {
    const request = context.request;
    if (request?.eo && typeof request.eo === "object") return edgeoneAdapter;
    if (request?.headers?.has("CF-Connecting-IP")) return cloudflareAdapter;
    return cloudflareAdapter;
}
/**
 * Adapter that resolves the platform implementation per request.
 *
 * Use it when a single bundle has to serve both platforms.
 */
var autoAdapter = {
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
/** Returns the adapter of a platform, or the auto-detecting one. */
function adapterFor(platform) {
    if (platform === "cloudflare") return cloudflareAdapter;
    if (platform === "edgeone") return edgeoneAdapter;
    return autoAdapter;
}
//#endregion
//#region src/functions/rate-limit.ts
/** Default limit: 30 requests per minute per client IP. */
var DEFAULT_RATE_LIMIT = { limit: 30, windowMs: 60 * 1e3 };
var MAX_TRACKED_CLIENTS = 4096;
/**
 * Creates a per-isolate rate limiter.
 *
 * The counters live in the memory of the isolate that serves the request, so
 * the limit is best effort: it protects a single instance, not the whole
 * deployment. Every edge platform spreads traffic over many isolates.
 */
function createRateLimiter(options) {
    const hits = /* @__PURE__ */ new Map();
    function prune(now) {
        if (hits.size <= MAX_TRACKED_CLIENTS) return;
        for (const [key, entry] of hits) if (now >= entry.resetAt) hits.delete(key);
    }
    return {
        hit(key, now = Date.now()) {
            const entry = hits.get(key);
            if (!entry || now >= entry.resetAt) {
                hits.set(key, { count: 1, resetAt: now + options.windowMs });
                prune(now);
                return true;
            }
            entry.count += 1;
            return entry.count <= options.limit;
        },
        get size() {
            return hits.size;
        },
    };
}
//#endregion
//#region src/functions/sha256.ts
/**
 * Minimal SHA-256 / HMAC-SHA256 implementation.
 *
 * The OAuth state signature must run inside every edge runtime, so the
 * algorithm is implemented in plain JavaScript instead of relying on
 * `crypto.subtle`, which is not guaranteed to exist on all of them.
 */
var K = new Uint32Array([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748,
    2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206,
    2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983,
    1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671,
    3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372,
    1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411,
    3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734,
    506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
    1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479,
    3329325298,
]);
var INITIAL_HASH = new Uint32Array([
    1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635,
    1541459225,
]);
var BLOCK_SIZE = 64;
var DIGEST_SIZE = 32;
function rotr(value, shift) {
    return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}
/** Computes the SHA-256 digest of the given bytes. */
function sha256(message) {
    const bitLength = message.length * 8;
    const paddedLength =
        (Math.floor((message.length + 8) / BLOCK_SIZE) + 1) * BLOCK_SIZE;
    const padded = new Uint8Array(paddedLength);
    padded.set(message);
    padded[message.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    const hash = new Uint32Array(INITIAL_HASH);
    const w = /* @__PURE__ */ new Uint32Array(64);
    for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
        for (let index = 0; index < 16; index += 1)
            w[index] = view.getUint32(offset + index * 4);
        for (let index = 16; index < 64; index += 1) {
            const s0 =
                rotr(w[index - 15], 7) ^
                rotr(w[index - 15], 18) ^
                (w[index - 15] >>> 3);
            const s1 =
                rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
            w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
        }
        let a = hash[0];
        let b = hash[1];
        let c = hash[2];
        let d = hash[3];
        let e = hash[4];
        let f = hash[5];
        let g = hash[6];
        let h = hash[7];
        for (let index = 0; index < 64; index += 1) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + ch + K[index] + w[index]) >>> 0;
            const temp2 =
                ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
                    ((a & b) ^ (a & c) ^ (b & c))) >>>
                0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    const digest = new Uint8Array(DIGEST_SIZE);
    const digestView = new DataView(digest.buffer);
    for (let index = 0; index < 8; index += 1)
        digestView.setUint32(index * 4, hash[index]);
    return digest;
}
/** Computes HMAC-SHA256 of `message` with `key`. */
function hmacSha256(key, message) {
    let normalizedKey = key;
    if (normalizedKey.length > BLOCK_SIZE) normalizedKey = sha256(normalizedKey);
    const paddedKey = new Uint8Array(BLOCK_SIZE);
    paddedKey.set(normalizedKey);
    const inner = new Uint8Array(BLOCK_SIZE + message.length);
    const outer = /* @__PURE__ */ new Uint8Array(96);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
        inner[index] = paddedKey[index] ^ 54;
        outer[index] = paddedKey[index] ^ 92;
    }
    inner.set(message, BLOCK_SIZE);
    outer.set(sha256(inner), BLOCK_SIZE);
    return sha256(outer);
}
var encoder = new TextEncoder();
/** Computes HMAC-SHA256 of a string and returns the lowercase hex digest. */
function hmacSha256Hex(secret, message) {
    const digest = hmacSha256(encoder.encode(secret), encoder.encode(message));
    return Array.from(digest)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}
/**
 * Compares two hex digests without leaking their content through timing.
 *
 * The length check is not constant time, but the digest length is fixed and
 * public, so only the bytes themselves are compared in constant time.
 */
function timingSafeEqual(left, right) {
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1)
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return diff === 0;
}
/**
 * Signs a stateless CSRF state value.
 *
 * The state is `timestamp.hmac-sha256(timestamp, clientSecret)`: it carries
 * its own expiry, so no server-side session is needed. The client secret
 * doubles as the signing key, which means the state cannot be forged without
 * the same secret the token exchange uses.
 */
function signState(secret, timestamp = Date.now()) {
    const payload = String(timestamp);
    return `${payload}.${hmacSha256Hex(secret, payload)}`;
}
/**
 * Verifies a state value: the signature must match and the timestamp must be
 * within {@link STATE_TTL_MS}.
 */
function verifyState(secret, state, now = Date.now()) {
    const separator = state.indexOf(".");
    if (separator <= 0) return false;
    const payload = state.slice(0, separator);
    const signature = state.slice(separator + 1);
    const timestamp = Number(payload);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(now - timestamp) > 6e5) return false;
    return timingSafeEqual(signature, hmacSha256Hex(secret, payload));
}
//#endregion
//#region src/functions/handler.ts
var GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
var GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
var DEFAULT_SCOPE = "repo,user";
function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
function htmlResponse(html) {
    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}
/**
 * Escapes a value for safe embedding inside a `<script>` text node.
 *
 * `JSON.stringify` alone does not escape `<`, `>` or `&`, so a value
 * containing them could break out of the script element. We additionally turn
 * those into unicode escapes and neutralise the lone-surrogate line
 * separators U+2028/U+2029 that would otherwise be a syntax error in a JS
 * string literal.
 */
function escapeScriptString(value) {
    return JSON.stringify(value).replace(/[<>&]/g, (char) => {
        switch (char) {
            case "<":
                return "\\u003c";
            case ">":
                return "\\u003e";
            default:
                return "\\u0026";
        }
    });
}
/**
 * Validates the `CMS_ORIGIN` the token is posted back to.
 *
 * Only `https` origins and plain-`http` `localhost` are accepted; a wildcard
 * or any other scheme would let the token reach an attacker-controlled window.
 * Returns the normalized origin (`proto://host[:port]`) or `null`.
 */
function parseCmsOrigin(value) {
    if (!value) return null;
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    const isHttps = url.protocol === "https:";
    const isLocalhostHttp =
        url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (!isHttps && !isLocalhostHttp) return null;
    return url.origin;
}
/**
 * Builds the page that hands the token over to Sveltia CMS.
 *
 * The token is posted to a single, fixed `targetOrigin` (`CMS_ORIGIN`). It is
 * never posted to `"*"`, so a window that did not open the popup (an attacker
 * page) cannot receive it. The receiving CMS must still verify
 * `event.origin` matches `CMS_ORIGIN` before trusting the message.
 */
function successPage(token, origin, cmsOrigin) {
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
      var token = ${escapeScriptString(token)};
      var origin = ${escapeScriptString(origin)};
      var cmsOrigin = ${escapeScriptString(cmsOrigin)};
      // The token is posted only to the configured CMS origin. The receiving
      // CMS must still verify event.origin matches CMS_ORIGIN.
      var message = "authorization:github:success:" + JSON.stringify({ token: token });

      if (window.opener && window.opener !== window) {
        try {
          window.opener.postMessage(message, cmsOrigin);
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
  <\/script>
</body>
</html>`;
}
function preflightResponse(context, url, adapter) {
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
function createAuthHandler(options = {}) {
    const adapter = options.adapter ?? adapterFor(options.platform ?? "auto");
    const now = options.now ?? (() => Date.now());
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const scope = options.scope ?? DEFAULT_SCOPE;
    const limit = options.rateLimit === void 0 ? DEFAULT_RATE_LIMIT : options.rateLimit;
    const limiter = limit === null ? null : createRateLimiter(limit);
    return async function handleAuth(context) {
        const request = context.request;
        const url = new URL(request.url);
        const resolvedAdapter = adapter === "auto" ? detectAdapter(context) : adapter;
        if (request.method === "OPTIONS")
            return preflightResponse(context, url, resolvedAdapter);
        const clientId = resolvedAdapter.getEnv(context, "GITHUB_CLIENT_ID")?.trim();
        const clientSecret = resolvedAdapter
            .getEnv(context, "GITHUB_CLIENT_SECRET")
            ?.trim();
        if (!clientId || !clientSecret)
            return jsonResponse(
                { error: "GitHub OAuth credentials not configured" },
                500,
            );
        const clientIp = resolvedAdapter.getClientIp(request);
        if (limiter && !limiter.hit(clientIp, now()))
            return jsonResponse({ error: "Too many requests" }, 429);
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
        if (!state) return jsonResponse({ error: "Missing state" }, 400);
        if (!verifyState(clientSecret, state, now()))
            return jsonResponse({ error: "Invalid or expired state" }, 400);
        try {
            const tokenData = await (
                await fetchImpl(GITHUB_TOKEN_URL, {
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
                })
            ).json();
            if (tokenData.error)
                return jsonResponse(
                    { error: tokenData.error_description || tokenData.error },
                    400,
                );
            const token = tokenData.access_token;
            if (!token)
                return jsonResponse(
                    { error: "GitHub did not return an access token" },
                    500,
                );
            const cmsOrigin = parseCmsOrigin(
                resolvedAdapter.getEnv(context, "CMS_ORIGIN"),
            );
            if (!cmsOrigin)
                return jsonResponse(
                    {
                        error: "CMS_ORIGIN is not configured or invalid (expected an https or localhost origin)",
                    },
                    500,
                );
            return htmlResponse(successPage(token, origin, cmsOrigin));
        } catch (error) {
            console.error("Auth error:", error);
            return jsonResponse({ error: "Authentication failed" }, 500);
        }
    };
}
//#endregion
//#region src/functions/entries/edgeone.ts
var handler = createAuthHandler({ adapter: edgeoneAdapter });
/**
 * EdgeOne Pages edge function entry point.
 *
 * Deploy this file as `edge-functions/auth.js` in the project root; EdgeOne
 * routes `GET /auth` to it.
 */
async function onRequest(context, env) {
    return handler(normalizeContext(context, env));
}
//#endregion
export { onRequest as default, onRequest };

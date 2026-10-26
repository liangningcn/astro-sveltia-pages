# astro-sveltia-pages

[中文文档](README.zh-CN.md) | English

> **Attribution**
> This package is a fork of [`astro-loader-sveltia-cms`](https://github.com/joknoll/astro-loader-sveltia-cms) by Johannes Knoll, licensed under the MIT License.

Sveltia CMS integration for Astro, optimized for Cloudflare Pages and EdgeOne Pages:

- Generates `/admin/index.html` and `/admin/config.yml` into the build output from a single options object — no hand-written CMS config.
- Configures Sveltia's **external media library** for **Cloudflare R2** (validated, with the secret key never written to disk).
- Ships a battle-tested **GitHub OAuth edge function** for Cloudflare Pages (`functions/auth.js`) and EdgeOne Pages (`edge-functions/auth.js`), plus an `init` command that wires it up.
- Includes a content loader (`astro-sveltia-pages/loader`) with automatic Zod schema generation.

## Quick Start

```bash
pnpm add astro-sveltia-pages
```

Register the integration in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import sveltia from "astro-sveltia-pages";

export default defineConfig({
    site: "https://example.com", // used as the CMS base_url when siteUrl is omitted
    integrations: [
        sveltia({
            repo: "my-org/my-site",
            branch: "main",
            mediaFolder: "public/images",
            publicFolder: "/images",
            collections: [
                {
                    name: "posts",
                    label: "Posts",
                    folder: "src/content/posts",
                    fields: [
                        { name: "title", widget: "string" },
                        { name: "date", widget: "datetime" },
                        { name: "draft", widget: "boolean", required: false },
                        { name: "body", widget: "markdown" },
                    ],
                },
            ],
        }),
    ],
});
```

Build, then check the output:

```bash
astro build
# dist/admin/index.html   — CMS UI (loads Sveltia from unpkg)
# dist/admin/config.yml   — generated CMS config
```

Use the content loader in `src/content.config.ts`:

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

const posts = defineCollection({ loader: sveltiaLoader("posts") });

export const collections = { posts };
```

## Authentication (GitHub OAuth)

The package does not host OAuth endpoints itself. Instead it ships the exact
edge function used in production by real deployments. The OAuth logic
(state signing, token exchange, `postMessage` handover) is platform agnostic;
only the runtime accessors differ, so the same implementation runs on
Cloudflare Pages and EdgeOne Pages.

### Cloudflare Pages

1. Run the init command from your project root:

    ```bash
    pnpm exec astro-sveltia-pages init --site-url https://example.com
    ```

    This will:
    - copy the OAuth template to `functions/auth.js` (never overwrites an existing file; exits non-zero with a message);
    - append `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ENVIRONMENT` and `SITE_URL` to `.env.example` (existing keys are skipped, never duplicated);
    - print the GitHub OAuth App setup steps and the required callback URL (`{siteUrl}/auth`).

2. Create a GitHub OAuth App at <https://github.com/settings/developers> with
   the authorization callback URL `{siteUrl}/auth`.

3. Set the environment variables in the **Cloudflare Pages dashboard**
   (Settings → Environment variables):
    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production` (tightens the OAuth CORS origin to your site)
    - `SITE_URL` (full origin of the production site, e.g. `https://example.com`; the auth
      function prefers it over the request origin so the OAuth origin stays consistent
      across custom domains, `*.pages.dev` preview domains and local `wrangler pages dev`)
    - `CMS_ORIGIN` (**required since 0.3.0**) — the origin the token is posted back to,
      e.g. `https://example.com`. Must be `https` (or `http://localhost` for local dev).
      This is the only origin allowed as the `postMessage` target; the receiver must
      still verify `event.origin === CMS_ORIGIN`.

4. Redeploy. The CMS login button now uses GitHub OAuth; Sveltia receives the
   token via `authorization:github:success:` postMessage (with an
   `#access_token=` fallback). The token is posted **only** to the configured
   `CMS_ORIGIN` — never to `"*"` — so an attacker page that opens the auth popup
   cannot receive it. The receiving CMS is still expected to verify
   `event.origin` before trusting the message.

The generated config uses `base_url: {siteUrl}` and `auth_endpoint: auth`,
which is the route served by `functions/auth.js`.

### EdgeOne Pages

The EdgeOne Pages deployment is the same flow with two differences: the
function lives in `edge-functions/` and the environment variables are
configured in the EdgeOne dashboard.

1. Run the init command with the platform flag:

    ```bash
    pnpm exec astro-sveltia-pages init --platform edgeone --site-url https://example.com
    ```

    This copies the EdgeOne template to `edge-functions/auth.js` and writes
    the same four variables to `.env.example`. The default platform is
    `cloudflare`, so `--platform cloudflare` (or no flag) keeps the previous
    behaviour.

2. Create a GitHub OAuth App at <https://github.com/settings/developers> with
   the authorization callback URL of the **EdgeOne domain**:
   `https://{your-edgeone-domain}/auth`.

3. Set the environment variables in the **EdgeOne Pages dashboard**
   (Project settings → Environment variables):
    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production`
    - `SITE_URL` (full origin of the production site, e.g. `https://example.com`)
    - `CMS_ORIGIN` (**required since 0.3.0**) — see the Cloudflare section for the
      exact meaning; it is the only allowed `postMessage` target origin.

    The EdgeOne edge function reads them from the runtime `env` object, so
    they are injected by the platform — do not inline them into the bundle.

4. Build with the EdgeOne Astro adapter in `astro.config.mjs`:

    ```js
    import { defineConfig } from "astro/config";
    import edgeone from "@edgeone/astro";
    import sveltia from "astro-sveltia-pages";

    export default defineConfig({
        site: "https://example.com",
        output: "server",
        adapter: edgeone(),
        integrations: [
            sveltia({
                repo: "my-org/my-site",
                platform: "edgeone", // selects the EdgeOne guidance and template
                collections: [
                    /* ... */
                ],
            }),
        ],
    });
    ```

    `@edgeone/astro` renders the site through EdgeOne Pages; the OAuth
    function stays a plain edge function in `edge-functions/auth.js`, so it is
    deployed next to the site and not affected by the Astro adapter.

5. Redeploy. The CMS login button uses GitHub OAuth exactly like on
   Cloudflare Pages.

#### Differences from the Cloudflare Pages deployment

| Topic                 | Cloudflare Pages                           | EdgeOne Pages                                                        |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Function directory    | `functions/auth.js`                        | `edge-functions/auth.js`                                             |
| Entry point           | `export async function onRequest(context)` | `export async function onRequest({ request, env })` (+ `default`)    |
| Environment variables | `context.env`                              | `context.env`, falling back to the global `env` object               |
| Client IP             | `CF-Connecting-IP` header                  | `request.eo.clientIp` only (no header fallback; unknown when absent) |
| Rate limiting         | per-isolate, in-memory, best effort        | per-isolate, in-memory, best effort                                  |
| Astro adapter         | `@astrojs/cloudflare`                      | `@edgeone/astro`                                                     |

Both platforms rate-limit the auth endpoint **per isolate**: the counters live
in the memory of the single isolate that serves the request, so the limit is
best effort and resets when a request lands on another isolate. The client IP
is used only as the rate-limit key — when a platform hides it, the adapter
falls back to `unknown` and every such request shares one bucket.

If the IP cannot be determined on EdgeOne, the limit therefore degrades to a
global limit for those requests. Keep `ENVIRONMENT=production` so that the
CORS preflight only answers your own origin.

#### Using the runtime from your own function

The platform adapters and the OAuth handler are exported by the package, so you
can host the auth endpoint yourself:

```js
// functions/auth.js (Cloudflare Pages)
import { onRequest } from "astro-sveltia-pages/functions/cloudflare";

export { onRequest };
```

```js
// edge-functions/auth.js (EdgeOne Pages)
import { onRequest } from "astro-sveltia-pages/functions/edgeone";

export { onRequest };
```

`astro-sveltia-pages/functions` (stable API) exports `createAuthHandler()`,
`signState()`, `verifyState()` and the `PlatformAdapter` types. Pass
`platform: "cloudflare" | "edgeone" | "auto"` to pin or auto-detect the platform
per request.

The lower-level pieces — the platform adapters (`cloudflareAdapter`,
`edgeoneAdapter`, `autoAdapter`, `detectAdapter`), the crypto helpers
(`hmacSha256Hex`, `timingSafeEqual`), `createRateLimiter()` and
`normalizeContext()` — live in `astro-sveltia-pages/functions/internal`. They are
**not** part of the stable API and may change in any release; only import them if
you need to build a custom adapter or handler.

## Cloudflare R2 Media Storage

Pass the `r2` option to generate Sveltia's external media library config
(`media_libraries.cloudflare_r2`). All four fields are required and validated
at startup:

```js
sveltia({
    repo: "my-org/my-site",
    r2: {
        accountId: "your-cloudflare-account-id",
        accessKeyId: "your-r2-access-key-id",
        bucket: "my-r2-bucket",
        publicUrl: "https://pub-xxx.r2.dev", // or a custom domain
    },
    collections: [
        /* ... */
    ],
});
```

> **Important Security Note:**
> The R2 **Secret Access Key is never written into the config**. Sveltia CMS
> prompts users to enter it in the CMS UI on first access to the media
> library, and it is stored only in the browser's local storage.

Additional required setup (documented here, not generated):

- **R2 CORS**: allow your site origin in the Cloudflare dashboard (bucket →
  Settings → CORS policy) for `GET`, `PUT`, `DELETE` and `OPTIONS` with the
  `authorization` and `content-type` headers.
- **`publicUrl`** must be publicly accessible: use the bucket's `r2.dev`
  development URL or bind a custom domain to the bucket.

## CSP for the /admin page

If your host sends a strict `Content-Security-Policy`, allow at least the
following for `/admin/*` (the package does **not** generate headers):

- Scripts: `unpkg.com` (or `cdn.jsdelivr.net` if you swap the CDN)
- Connect: `api.github.com`, `github.com`, `raw.githubusercontent.com`, your R2 public domain, `unpkg.com`
- Images: `data:`, `blob:`, `https:` (media previews)

## Options Reference

| Option           | Type                        | Default           | Description                                                                                                                          |
| ---------------- | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `repo`           | `string`                    | —                 | GitHub repository, `owner/name`. Required.                                                                                           |
| `branch`         | `string`                    | `"main"`          | Branch CMS changes are committed to.                                                                                                 |
| `siteUrl`        | `string`                    | Astro `site`      | Origin used as CMS `base_url`. Build fails when neither is set.                                                                      |
| `collections`    | `SveltiaCollection[]`       | —                 | Mapped 1:1 into the CMS config. Required.                                                                                            |
| `r2`             | `object`                    | —                 | Cloudflare R2 external media library (see above).                                                                                    |
| `mediaFolder`    | `string`                    | `"public/images"` | CMS `media_folder`.                                                                                                                  |
| `publicFolder`   | `string`                    | `"/images"`       | CMS `public_folder`.                                                                                                                 |
| `locale`         | `string`                    | `"zh"`            | CMS UI language.                                                                                                                     |
| `appTitle`       | `string`                    | `"Sveltia CMS"`   | Browser tab / login page title.                                                                                                      |
| `logo`           | `{ src, ... }`              | —                 | CMS logo, forwarded as `logo`.                                                                                                       |
| `backendName`    | `string`                    | `"github"`        | Git backend name.                                                                                                                    |
| `sveltiaVersion` | `string`                    | `"latest"`        | Sveltia version loaded from unpkg (`@latest` by default).                                                                            |
| `extraConfig`    | `object`                    | —                 | Escape hatch, shallowly merged into the generated config. Colliding keys override the generated value and emit one warning per key.  |
| `platform`       | `"cloudflare" \| "edgeone"` | `"cloudflare"`    | Deployment platform of the OAuth proxy. Selects the function template and the dashboard the environment variables are configured in. |

`collections` entries require `name`, `folder` and `fields`; every other
Sveltia collection option (`create`, `slug`, `i18n`, collection-level
`media_folder`, ...) is passed through unchanged.

## Multi-language Support (i18n)

Pass Sveltia's i18n options via `extraConfig` (or per collection):

```js
sveltia({
    repo: "my-org/my-site",
    extraConfig: {
        i18n: {
            structure: "multiple_folders",
            locales: ["en", "zh"],
            default_locale: "en",
        },
    },
    collections: [
        /* ... */
    ],
});
```

Then load content per locale with the loader:

```ts
export const collections = {
    blog_en: defineCollection({ loader: sveltiaLoader("blog", { locale: "en" }) }),
    blog_zh: defineCollection({ loader: sveltiaLoader("blog", { locale: "zh" }) }),
};
```

**Notes:**

- If the CMS config uses `multiple_folders` but you forget to pass `{ locale: "..." }`, the loader throws an explicit error to prevent loading the wrong data.
- If a specific collection has `i18n: false` in its CMS config, it opts out of localization and loads from the root folder regardless of the global i18n settings.

## Loader support and limitations

- Collections must have a non-empty `folder` and a `fields` array. File-backed collections and `{{locale}}` folder placeholders are rejected.
- When `extension` is omitted, the loader uses `yml` for YAML, `json` for JSON, `toml` for TOML, `txt` for raw files, and `md` otherwise. Astro must have an entry parser registered for the selected extension; inferring an extension does not add a parser.
- Name-based lookup currently reads the integration's generated `config.json` (inside Astro's `.astro/integrations/` directory) relative to the working directory. Run Astro from the site root with its default generated-files directory, or pass a collection object directly to the loader.
- Relations are converted to Astro references assuming the stored value matches the target entry ID and the CMS collection name matches the Astro collection key. Custom `value_field` mappings are not resolved.
- Top-level list/key-value storage (`root: true`) is not supported. i18n structures other than `multiple_folders` are not supported.

## Local development

No special handling is required. When you open `/admin/` on `localhost`,
Sveltia CMS offers a built-in **Local repository** preference (in the CMS UI)
that switches saving to the local file system without OAuth.

## Migrating from 0.2.x to 0.3.0

Version 0.3.0 is a security and consistency release.

| 0.2.x / 0.2.6                                             | 0.3.0                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token posted to `window.opener` with `targetOrigin:"*"`   | Token is posted **only** to the configured `CMS_ORIGIN` (`https`/`localhost`). `CMS_ORIGIN` is now **required** — the auth endpoint returns `500` if it is missing or invalid. Re-run `astro-sveltia-pages init` and set it. |
| EdgeOne client IP read from `x-forwarded-for` fallback    | EdgeOne now trusts only `request.eo.clientIp`; the `x-forwarded-for` fallback was removed (it could be spoofed, bypassing rate limiting).                                                                                    |
| Two generated templates (`functions/`, `edge-functions/`) | A single self-contained `auth.js` is generated and copied to the right directory by `init --platform`.                                                                                                                       |
| `astro-sveltia-pages/functions` exposed many internals    | Only stable APIs (`createAuthHandler`, `onRequest`, `signState`, `verifyState`) and a few public types are top-level exports; crypto/rate-limit/detect helpers moved to `astro-sveltia-pages/functions/internal`.            |

After upgrading, re-run `pnpm exec astro-sveltia-pages init` to refresh the
template and set `CMS_ORIGIN` in the platform dashboard.

## Migrating from 0.2.x to 0.2.6

Version 0.2.6 adds EdgeOne Pages support and splits the OAuth runtime into a
platform adapter layer.

| 0.2.x                                      | 0.2.6                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `functions/auth.js` (hand-maintained copy) | Still the Cloudflare entry point, but generated from `src/functions` by `vp run build:templates`. Run `pnpm exec astro-sveltia-pages init` again to refresh it.             |
| —                                          | New: `edge-functions/auth.js` for EdgeOne Pages, created by `astro-sveltia-pages init --platform edgeone`.                                                                  |
| —                                          | New: `platform` option (`"cloudflare"` \| `"edgeone"`) and `astro-sveltia-pages/functions*` exports.                                                                        |
| CSRF `state` was a random value            | The state is now `timestamp.HMAC-SHA256(timestamp, clientSecret)` with a 10 minute TTL, verified with a timing-safe comparison. The OAuth App callback URL does not change. |
| No rate limiting                           | The auth endpoint is rate limited per client IP (30 requests per minute per isolate).                                                                                       |

Existing Cloudflare deployments keep working: the callback URL stays
`{siteUrl}/auth` and the environment variables are unchanged. Copy the new
template over `functions/auth.js` to pick up the signed state and the rate
limit.

## Migrating from 0.2.x to 0.2.5

Version 0.2.5 removes the built-in OAuth routes and the injected admin page in
favor of generated static files plus an auth template.

| 0.2.x                                                               | 0.2.5                                                                                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth: true/false` (Astro API routes `/api/auth`, `/api/callback`) | Removed. Run `pnpm exec astro-sveltia-pages init` and host `functions/auth.js` on Cloudflare Pages.                                    |
| `./routes/auth`, `./routes/callback`, `./admin.astro` exports       | Removed. Nothing to import; the admin UI is generated at build time.                                                                   |
| `route: "/cms"`                                                     | Removed. The admin UI is always generated at `/admin/`. Add a `_redirects` rule (`/cms/* /admin/:splat 301`) if you need the old path. |
| `title: "..."`                                                      | Renamed to `appTitle`.                                                                                                                 |
| `config: { backend, media_folder, ..., collections }`               | Split into top-level options (`repo`, `branch`, `mediaFolder`, ...) plus `extraConfig` for anything else.                              |
| —                                                                   | New: `r2` option generates `media_libraries.cloudflare_r2`.                                                                            |
| —                                                                   | New: `sveltiaVersion` controls the unpkg version of the CMS script.                                                                    |

## The generated `config.yml`

The first line is an editor-only schema hint; Sveltia CMS does not depend on
it at runtime:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@sveltia/cms/schema/sveltia-cms.json
```

Both `<link rel="cms-config-url" href="/admin/config.yml">` in the generated
`index.html` and Sveltia's default config discovery (a `config.yml` next to
the admin page) resolve to the same file, so the config is picked up
regardless of which mechanism the CMS version prefers.

## Development

```bash
vp install
vp check
vp test
vp pack
```

`vp run build:templates` regenerates the deployable function templates
(`templates/functions/auth.js` and `templates/edge-functions/auth.js`) from
`src/functions`; `vp run build` runs it before packaging.

Use `vp run format` to format code and `vp run format:check` to verify formatting.
See [Code style](docs/code-style.md) for the formatter profile and unsupported rules.

See the `example` directory for a complete Astro setup.

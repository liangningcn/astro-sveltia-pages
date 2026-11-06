# astro-sveltia-pages

English | [中文文档](README.zh-CN.md)

Sveltia CMS, wired into Astro with **zero hand-written CMS config**. Built for Cloudflare Pages and EdgeOne Pages.

- **One options object → CMS UI.** Generates `/admin/index.html` and `/admin/config.yml` into your build output from a single `sveltia({ ... })` call.
- **External media library.** Configures Sveltia's Cloudflare R2 media library, with the secret key entered in the CMS UI (never written to disk).
- **Production-ready OAuth.** Ships the exact GitHub OAuth edge function used in real deployments for both Cloudflare Pages (`functions/auth.js`) and EdgeOne Pages (`edge-functions/auth.js`), plus an `init` command that wires it up.
- **Typed content loader.** `astro-sveltia-pages/loader` reads the generated config and loads entries with automatic Zod schema generation.

## Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [What gets generated](#what-gets-generated)
- [Configuration](#configuration)
    - [Options reference](#options-reference)
    - [Authentication (GitHub OAuth)](#authentication-github-oauth)
    - [Cloudflare R2 Media Storage](#cloudflare-r2-media-storage)
- [Content Loader](#content-loader)
- [Guides](#guides)
    - [Multi-language (i18n)](#multi-language-i18n)
    - [Automated translation (i18n-translate)](#automated-translation-i18n-translate)
    - [Read-only mode](#read-only-mode)
    - [Singleton files](#singleton-files)
    - [Other promoted options](#other-promoted-options)
- [The generated `config.yml`](#the-generated-configyml)
- [Development](#development)
- [License](#license)

## Installation

```bash
pnpm add astro-sveltia-pages
```

> **⚠️ UPGRADING? READ THIS FIRST** — if you use the i18n auto-translation
> workflow, **every package upgrade requires re-running
> `pnpm exec astro-sveltia-pages init:i18n` in each site repository.** The three
> generated files (`.github/workflows/i18n-translate.yml`, `i18n/glossary.md`,
> `scripts/remap-translations.sh`) are committed snapshots: `pnpm up` does
> **not** replace them. Upgrading the dependency while running an old workflow
> makes translations fail silently and is extremely hard to diagnose.
>
> - Fix now: `pnpm exec astro-sveltia-pages init:i18n` (auto-upgrades, keeps `*.bak`)
> - CI gate: `pnpm exec astro-sveltia-pages init:i18n --check`
> - Since 0.3.6 the generated workflow checks its own template version against
>   the lockfile **inside CI** and fails with the exact fix command if they
>   diverge. Since 0.3.5 `astro dev` / `astro build` also print a prominent
>   warning when stale templates are detected. Pass
>   `i18nTemplateCheck: "error"` to the integration to fail the build instead,
>   or `"off"` to silence it.

## Quick Start

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

Load the content with the bundled loader in `src/content.config.ts`:

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

const posts = defineCollection({ loader: sveltiaLoader("posts") });

export const collections = { posts };
```

## What gets generated

`astro build` produces the CMS from your options — you never edit the Sveltia config by hand:

```bash
astro build
# dist/admin/index.html   — CMS UI (loads Sveltia from unpkg)
# dist/admin/config.yml   — generated CMS config
```

Open `<your-site>/admin/` to use the CMS.

## Configuration

All configuration lives in the `sveltia({ ... })` options object. The integration turns it into a complete Sveltia `config.yml`.

### Options reference

| Option              | Type                        | Default               | Description                                                                                                                          |
| ------------------- | --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `repo`              | `string`                    | —                     | GitHub repository, `owner/name`. Required.                                                                                           |
| `branch`            | `string`                    | `"main"`              | Branch CMS changes are committed to.                                                                                                 |
| `siteUrl`           | `string`                    | Astro `site`          | Origin used as CMS `base_url`. Build fails when neither is set.                                                                      |
| `collections`       | `SveltiaCollection[]`       | —                     | Mapped 1:1 into the CMS config. Required.                                                                                            |
| `r2`                | `object`                    | —                     | Cloudflare R2 external media library (see [Media Storage](#cloudflare-r2-media-storage)).                                            |
| `mediaFolder`       | `string`                    | `"public/images"`     | CMS `media_folder`.                                                                                                                  |
| `publicFolder`      | `string`                    | `"/images"`           | CMS `public_folder`.                                                                                                                 |
| `appTitle`          | `string`                    | `"Sveltia CMS"`       | Browser tab / login page title.                                                                                                      |
| `logo`              | `{ src, ... }`              | —                     | CMS logo, forwarded as `logo`.                                                                                                       |
| `backendName`       | `string`                    | `"github"`            | Git backend name.                                                                                                                    |
| `sveltiaVersion`    | `string`                    | `"0.256.1"`           | Sveltia version loaded from unpkg, **pinned** for reproducibility (previously `"latest"`). Override only to upgrade deliberately.    |
| `extraConfig`       | `object`                    | —                     | Escape hatch, shallowly merged into the generated config. Colliding keys override the generated value and emit one warning per key.  |
| `platform`          | `"cloudflare" \| "edgeone"` | `"cloudflare"`        | Deployment platform of the OAuth proxy. Selects the function template and the dashboard the environment variables are configured in. |
| `singletons`        | `unknown[]`                 | —                     | Singleton files, forwarded as `singletons`.                                                                                          |
| `assetCollections`  | `unknown[]`                 | —                     | Asset collections, forwarded as `asset_collections`.                                                                                 |
| `i18n`              | `object`                    | —                     | Global i18n options, forwarded as `i18n`.                                                                                            |
| `readonly`          | `boolean`                   | `false`               | Make the whole CMS read-only, forwarded as `readonly`.                                                                               |
| `showPreviewLinks`  | `boolean`                   | — (Sveltia: `true`)   | Show live/deploy-preview links; forwarded as `show_preview_links` **only when set**.                                                 |
| `displayUrl`        | `string`                    | —                     | URL linked from the UI, forwarded as `display_url`.                                                                                  |
| `logoutRedirectUrl` | `string`                    | —                     | Post-logout redirect URL, forwarded as `logout_redirect_url`.                                                                        |
| `editor`            | `object`                    | —                     | Editor view options, forwarded as `editor`.                                                                                          |
| `publishMode`       | `string \| object`          | — (Sveltia: `simple`) | Publish mode, forwarded as `publish_mode` **only when set**.                                                                         |
| `fieldDefaults`     | `object`                    | —                     | Default field options, forwarded as `field_defaults`.                                                                                |
| `output`            | `object`                    | —                     | Data output options, forwarded as `output`.                                                                                          |
| `slug`              | `object`                    | —                     | Slug options for entries and assets, forwarded as `slug`.                                                                            |
| `logoUrl`           | `string`                    | —                     | Entrance page / favicon logo URL, forwarded as `logo_url`.                                                                           |

`collections` entries require `name`, `folder` and `fields`; every other Sveltia collection option (`create`, collection-level `slug`, `i18n`, `media_folder`, …) is passed through unchanged.

**Promoted options.** The 13 options below the `platform` row were previously only reachable through `extraConfig`. They are now first-class, type-checked, and forwarded to their matching Sveltia config key. Each is emitted **only when you set it** — the integration never overrides Sveltia's own defaults — so `—` in the Default column means "not emitted; Sveltia's default applies". `extraConfig` still works and can override any of them (with one warning per colliding key).

**Removed in 0.3.1:** the integration `locale` option was dropped. Sveltia has no `locale` config key (the value was silently ignored), and the CMS UI language follows the browser. The `locale` parameter on the **loader** — `sveltiaLoader(name, { locale })` — is unrelated and remains.

### Authentication (GitHub OAuth)

The package does not host OAuth endpoints itself. Instead it ships the exact edge function used in production by real deployments. The OAuth logic (state signing, token exchange, `postMessage` handover) is platform agnostic; only the runtime accessors differ, so the same implementation runs on Cloudflare Pages and EdgeOne Pages.

> **Security:** Since 0.3.0 the GitHub token is posted back **only** to the configured `CMS_ORIGIN` (`https`, or `http://localhost` for local dev) — never to `"*"`. An attacker page that opens the auth popup cannot receive it. The receiving CMS must still verify `event.origin === CMS_ORIGIN`. `CMS_ORIGIN` is **required**; the auth endpoint returns `500` when it is missing or invalid.

#### Cloudflare Pages

1. Run the init command from your project root:

    ```bash
    pnpm exec astro-sveltia-pages init --site-url https://example.com
    ```

    This will:

    - copy the OAuth template to `functions/auth.js` (never overwrites an existing file; exits non-zero with a message);
    - append `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ENVIRONMENT` and `SITE_URL` to `.env.example` (existing keys are skipped, never duplicated);
    - print the GitHub OAuth App setup steps and the required callback URL (`{siteUrl}/auth`).

2. Create a GitHub OAuth App at <https://github.com/settings/developers> with the authorization callback URL `{siteUrl}/auth`.

3. Set the environment variables in the **Cloudflare Pages dashboard** (Settings → Environment variables):

    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production` (tightens the OAuth CORS origin to your site)
    - `SITE_URL` (full origin of the production site, e.g. `https://example.com`; the auth function prefers it over the request origin so the OAuth origin stays consistent across custom domains, `*.pages.dev` preview domains and local `wrangler pages dev`)
    - `CMS_ORIGIN` (**required since 0.3.0**) — the origin the token is posted back to, e.g. `https://example.com`. Must be `https` (or `http://localhost` for local dev). This is the only origin allowed as the `postMessage` target; the receiver must still verify `event.origin === CMS_ORIGIN`.

4. Redeploy. The CMS login button now uses GitHub OAuth; Sveltia receives the token via `authorization:github:success:` postMessage (with an `#access_token=` fallback). The generated config uses `base_url: {siteUrl}` and `auth_endpoint: auth`, which is the route served by `functions/auth.js`.

#### EdgeOne Pages

The EdgeOne Pages deployment is the same flow with two differences: the function lives in `edge-functions/` and the environment variables are configured in the EdgeOne dashboard.

1. Run the init command with the platform flag:

    ```bash
    pnpm exec astro-sveltia-pages init --platform edgeone --site-url https://example.com
    ```

    This copies the EdgeOne template to `edge-functions/auth.js` and writes the same four variables to `.env.example`. The default platform is `cloudflare`, so `--platform cloudflare` (or no flag) keeps the previous behaviour.

2. Create a GitHub OAuth App at <https://github.com/settings/developers> with the authorization callback URL of the **EdgeOne domain**: `https://{your-edgeone-domain}/auth`.

3. Set the environment variables in the **EdgeOne Pages dashboard** (Project settings → Environment variables):

    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production`
    - `SITE_URL` (full origin of the production site, e.g. `https://example.com`)
    - `CMS_ORIGIN` (**required since 0.3.0**) — see the Cloudflare section for the exact meaning; it is the only allowed `postMessage` target origin.

    The EdgeOne edge function reads them from the runtime `env` object, so they are injected by the platform — do not inline them into the bundle.

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

5. Redeploy. The CMS login button uses GitHub OAuth exactly like on Cloudflare Pages.

#### Differences from the Cloudflare Pages deployment

| Topic                 | Cloudflare Pages                           | EdgeOne Pages                                                        |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Function directory    | `functions/auth.js`                        | `edge-functions/auth.js`                                             |
| Entry point           | `export async function onRequest(context)` | `export async function onRequest({ request, env })` (+ `default`)    |
| Environment variables | `context.env`                              | `context.env`, falling back to the global `env` object               |
| Client IP             | `CF-Connecting-IP` header                  | `request.eo.clientIp` only (no header fallback; unknown when absent) |
| Rate limiting         | per-isolate, in-memory, best effort        | per-isolate, in-memory, best effort                                  |
| Astro adapter         | `@astrojs/cloudflare`                      | `@edgeone/astro`                                                     |

Both platforms rate-limit the auth endpoint **per isolate**: the counters live in the memory of the single isolate that serves the request, so the limit is best effort and resets when a request lands on another isolate. The client IP is used only as the rate-limit key — when a platform hides it, the adapter falls back to `unknown` and every such request shares one bucket.

If the IP cannot be determined on EdgeOne, the limit therefore degrades to a global limit for those requests. Keep `ENVIRONMENT=production` so that the CORS preflight only answers your own origin.

#### Hosting the auth endpoint yourself

The platform adapters and the OAuth handler are exported by the package, so you can host the auth endpoint yourself:

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

`astro-sveltia-pages/functions` (stable API) exports `createAuthHandler()`, `signState()`, `verifyState()` and the `PlatformAdapter` types. Pass `platform: "cloudflare" | "edgeone" | "auto"` to pin or auto-detect the platform per request.

The lower-level pieces — the platform adapters (`cloudflareAdapter`, `edgeoneAdapter`, `autoAdapter`, `detectAdapter`), the crypto helpers (`hmacSha256Hex`, `timingSafeEqual`), `createRateLimiter()` and `normalizeContext()` — live in `astro-sveltia-pages/functions/internal`. They are **not** part of the stable API and may change in any release; only import them if you need to build a custom adapter or handler.

### Cloudflare R2 Media Storage

Pass the `r2` option to generate Sveltia's external media library config (`media_libraries.cloudflare_r2`). All four fields are required and validated at startup:

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
> The R2 **Secret Access Key is never written into the config**. Sveltia CMS prompts users to enter it in the CMS UI on first access to the media library, and it is stored only in the browser's local storage.

Additional required setup (documented here, not generated):

- **R2 CORS**: allow your site origin in the Cloudflare dashboard (bucket → Settings → CORS policy) for `GET`, `PUT`, `DELETE` and `OPTIONS` with the `authorization` and `content-type` headers.
- **`publicUrl`** must be publicly accessible: use the bucket's `r2.dev` development URL or bind a custom domain to the bucket.

If your host sends a strict `Content-Security-Policy`, allow at least the following for `/admin/*` (the package does **not** generate headers):

- Scripts: `unpkg.com` (or `cdn.jsdelivr.net` if you swap the CDN)
- Connect: `api.github.com`, `github.com`, `raw.githubusercontent.com`, your R2 public domain, `unpkg.com`
- Images: `data:`, `blob:`, `https:` (media previews)

## Content Loader

`astro-sveltia-pages/loader` loads your CMS content into Astro with an automatically generated Zod schema, so you get type-safe entries without writing a schema by hand.

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

export const collections = {
    posts: defineCollection({ loader: sveltiaLoader("posts") }),
};
```

You can also pass a collection object directly instead of its name:

```ts
import { sveltiaLoader } from "astro-sveltia-pages/loader";

const posts = sveltiaLoader({
    name: "posts",
    label: "Posts",
    folder: "src/content/posts",
    fields: [{ name: "title", widget: "string" }],
});

export const collections = { posts: defineCollection({ loader: posts }) };
```

**Name-based lookup** reads the integration's generated `config.json` (inside Astro's `.astro/integrations/` directory) relative to the working directory. Run Astro from the site root with its default generated-files directory, or pass a collection object directly to the loader.

**Limitations:**

- Collections must have a non-empty `folder` and a `fields` array. File-backed collections and `{{locale}}` folder placeholders are rejected.
- When `extension` is omitted, the loader uses `yml` for YAML, `json` for JSON, `toml` for TOML, `txt` for raw files, and `md` otherwise. Astro must have an entry parser registered for the selected extension; inferring an extension does not add a parser.
- Relations are converted to Astro references assuming the stored value matches the target entry ID and the CMS collection name matches the Astro collection key. Custom `value_field` mappings are not resolved.
- Top-level list/key-value storage (`root: true`) is not supported. i18n structures other than `multiple_folders` are not supported.

## Guides

### Multi-language (i18n)

Pass Sveltia's i18n options via the `i18n` option (or `extraConfig`, or per collection):

```js
sveltia({
    repo: "my-org/my-site",
    i18n: {
        structure: "multiple_folders",
        locales: ["en", "zh"],
        default_locale: "en",
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

### Automated translation (i18n-translate)

Once the CMS edits only the English source (see the Sveltia settings below), you can let CI translate every other locale automatically. The package ships a ready-to-use
[`pelikhan/action-continuous-translation`](https://github.com/pelikhan/action-continuous-translation) workflow (DeepSeek-driven) plus a glossary and a remap helper, and the `init:i18n` command wires them into your repo with zero manual path editing.

1.  From your project root, run:

            ```bash
            pnpm exec astro-sveltia-pages init:i18n
            ```

            It auto-detects `sveltia-cms.config.mjs` (override with `--config <path>`), reads
            `i18n.default_locale`, `i18n.locales` and each collection's `folder`, fills the
            template placeholders, and writes three files:

            - `.github/workflows/i18n-translate.yml`
            - `i18n/glossary.md`
            - `scripts/remap-translations.sh`

            Useful flags:

            - `--content-root <path>` — content root (default `src/content`)
            - `--default-locale <lang>` — source locale (default `en`)
            - `--project-name <name>` — used in the glossary heading
            - `--collections <a,b,c>` — only wire in these collections
            - `--skip-collections <a,b>` — always exclude these collections
            - `--force` — overwrite files that already exist
            - `--check` — verify generated files are current (exits non-zero if stale; use in CI)

            A successful run is **never silent**: it logs one `已写入 …` (or
            `⬆ 已升级 …`) line per file, then the
            `i18n 自动翻译已初始化（模板 …，源语言 … → …）` summary and a setup
            checklist. `--check` prints `✅ i18n 模板均为最新版本 …` (exit 0) or a
            `STALE i18n TEMPLATES` notice (exit 1). Unknown subcommands now print
            `Unknown command: <name>` and exit 1; `--help` lists both commands.
            If a command produces **no output at all**, the CLI never ran. This
            affected 0.3.6 and earlier under pnpm; upgrade to 0.3.7+, or use
            `node node_modules/astro-sveltia-pages/dist/cli.mjs init:i18n` as a
            temporary workaround.

            Generated files carry a version stamp. Re-running `init:i18n` **automatically
            upgrades** outdated generated files (the previous copy is kept as `*.bak`);
            the user-editable `i18n/glossary.md` is never auto-overwritten. `--force`
            overwrites everything.

> ⚠️ **After upgrading `astro-sveltia-pages`, always re-run `init:i18n`.** The three
> files are generated snapshots committed to your repo — bumping the dependency
> alone does **not** update them, so the workflow keeps running the old (possibly
> broken) version. Since 0.3.5 the integration also warns during `astro dev` /
> `astro build`; since 0.3.6 the workflow itself fails inside CI when its
> template stamp does not match the installed package. Add
> `pnpm exec astro-sveltia-pages init:i18n --check` to your CI to catch stale
> templates at build time (or set `i18nTemplateCheck: "error"`).

2.  Add the GitHub repository secret
    (**Settings → Secrets and variables → Actions → New repository secret**):

    - `DEEPSEEK_API_KEY` — a DeepSeek API key (`sk-…`) from
      <https://platform.deepseek.com>. The workflow calls DeepSeek's OpenAI-compatible
      endpoint `https://api.deepseek.com` with `deepseek-flash` (the old
      `deepseek-v4-flash` name has been retired).

3.  In your Sveltia CMS config, **every collection you want auto-translated must set**:

    ```js
    i18n: { save_all_locales: false, initial_locales: ["en"] }
    ```

    This makes the CMS commit **only** the English source; CI produces the other
    locales. Also mark untranslatable fields (`slug`, image paths, …) as
    `i18n: duplicate`, and make sure the backend does **not** set `skip_ci: true`.

4.  ⚠️ **Commit-message rule (critical):** never include a bracketed CI-skip marker such
    as `[skip ci]` / `[ci skip]` / `skip-checks` in a commit message. On GitHub
    Actions + Cloudflare Pages that marker skips the entire push's workflow **and**
    the Cloudflare deployment, so a translation push (or any deploy) would silently
    not run.

5.  Pushing an English source file (e.g. `src/content/blog/en/my-post.md`) to `main`
    triggers `i18n-translate`, which translates the change into every target locale,
    self-checks the output, and commits it back to `main` (`PUBLISH_MODE: "commit"`).
    Set `PUBLISH_MODE: "pr"` in the generated workflow to require a human merge
    instead. The English source goes live immediately; all target locales are
    published together in one follow-up commit. Since 0.3.5 the workflow explicitly
    **fails** (and opens an issue) when no translations were produced instead of
    reporting a green run.

> **Incremental & manual backfill:** the workflow caches pelikhan's per-locale
> translation JSON (`i18n-translations/<lang>.json`) via `actions/cache`, so reruns
> only re-translate changed nodes. Note that pelikhan regenerates translated files
> from the English source plus that cache — it does **not** read existing translated
> markdown, so manual edits to translated files are overwritten on the next run.
> To bootstrap an already-populated site, run the workflow manually
> (`workflow_dispatch`) with `force` + a `scope` regex (e.g. `posts`).

### Read-only mode

Flip the CMS to read-only during deploys, content migrations, or incident mitigation. Editors can still browse and search, but saving and publishing are disabled:

```js
sveltia({
    repo: "my-org/my-site",
    readonly: true,
    collections: [
        /* ... */
    ],
});
```

`readonly` maps to Sveltia's top-level `readonly` flag; the default is `false`. Revert to `false` when maintenance is done.

### Singleton files

Use `singletons` for single-file config pages (site settings, navigation, SEO) that are not a list of entries. Each singleton targets one file and is forwarded to Sveltia's `singletons` key:

```js
sveltia({
    repo: "my-org/my-site",
    singletons: [
        {
            name: "site",
            label: "Site Settings",
            file: "src/data/site.json",
            fields: [
                { name: "title", widget: "string" },
                { name: "description", widget: "text" },
            ],
        },
    ],
    collections: [
        /* ... */
    ],
});
```

The declared `singletons` appear verbatim in the generated `config.yml` and behave like a single-entry settings page in the CMS. This option is passed through unchanged; refer to the Sveltia `singletons` reference for the full field schema.

### Other promoted options

The remaining promoted options are forwarded to their Sveltia config keys verbatim. Common shapes:

```js
sveltia({
    repo: "my-org/my-site",
    assetCollections: [{ name: "images", label: "Images", folder: "src/assets" }],
    editor: { preview: false },
    publishMode: "editorial_workflow", // or { mode: "editorial_workflow" }
    fieldDefaults: { name: { widget: "string" } },
    output: { dateFormat: "YYYY-MM-DD" },
    slug: { encoding: "unicode" },
    displayUrl: "https://example.com",
    logoutRedirectUrl: "https://example.com/bye",
    showPreviewLinks: true,
    logoUrl: "https://example.com/logo.svg",
    collections: [
        /* ... */
    ],
});
```

Each is emitted only when set; see the [Options reference](#options-reference) for the exact Sveltia key each maps to.

## The generated `config.yml`

The first line is an editor-only schema hint; Sveltia CMS does not depend on it at runtime:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@sveltia/cms/schema/sveltia-cms.json
```

Both `<link rel="cms-config-url" href="/admin/config.yml">` in the generated `index.html` and Sveltia's default config discovery (a `config.yml` next to the admin page) resolve to the same file, so the config is picked up regardless of which mechanism the CMS version prefers.

## Development

```bash
vp install
vp check
vp test
vp pack
```

`vp run build:templates` regenerates the deployable function templates (`templates/functions/auth.js` and `templates/edge-functions/auth.js`) from `src/functions`, and copies the i18n workflow templates from `templates/i18n/` into `dist/templates/i18n/`; `vp run build` runs it before packaging.

Use `vp run format` to format code and `vp run format:check` to verify formatting. See [Code style](docs/code-style.md) for the formatter profile and unsupported rules.

See the `example` directory for a complete Astro setup.

## License

MIT — forked from [`astro-loader-sveltia-cms`](https://github.com/joknoll/astro-loader-sveltia-cms) by Johannes Knoll.

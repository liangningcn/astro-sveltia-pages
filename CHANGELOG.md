# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

中文文档见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

Version-to-version migration guides live in each release's **Migration**
section below.

---

## 0.3.2

### Added

- Added an opt-in GitHub Actions workflow (`.github/workflows/i18n-translate.yml`)
  that automates multilingual translation so Sveltia CMS editors maintain only the
  English source. It reuses `pelikhan/action-continuous-translation` (remark AST
  parsing, incremental translation, caching, quality validation) to translate
  changed English Markdown into the 15 target languages and opens a translation
  pull request.
- Added `i18n/glossary.md` (brand/product terms kept untranslated across locales)
  and `scripts/remap-translations.sh` (maps the action's default
  `content/{collection}/en/{slug}.{lang}.md` output to Sveltia's
  `multiple_folders` layout `content/{collection}/{lang}/{slug}.md`).

### Changed

- Documented the recommended Sveltia CMS setup for this workflow in the workflow
  header and supporting files: set `i18n.save_all_locales: false` (or
  `initial_locales: [en]`) so the CMS commits only the English source, and mark
  `slug`/image-path fields as `i18n: duplicate` so they are never sent for
  translation.
- Enabled the bundled `example` as an end-to-end dogfood for this workflow:
  added a 16-locale Sveltia `i18n` config (`multiple_folders`,
  `default_locale: en`, 15 target locales), set `save_all_locales: false` and
  `initial_locales: [en]` on the `authors`/`posts` collections, marked
  non-translatable fields (`name`, `avatar`, `date`, `author`, `draft`, `cover`)
  as `i18n: duplicate`, moved sample content under `en/` folders, and pointed
  `sveltiaLoader` at `locale: "en"`. Pushing to `main` on an `en/` file now
  triggers the translation workflow.
- Enabled Sveltia Editorial Workflow on the `posts` collection in the example
  (`publish_mode: "editorial_workflow"`): a CMS save opens a
  `cms/posts/[slug]` pull request without touching `main`, so deployment and the
  translation workflow only run after the entry is published. `authors` and
  singletons remain in the default `simple` mode.
- Reworked the translation workflow's publish flow so it self-checks and publishes
  **directly to `main`** (`PUBLISH_MODE: "commit"`, the new default) instead of
  only opening a PR. Translations now go live automatically on publish with no
  second CMS action; set `PUBLISH_MODE: "pr"` to keep a human merge gate. Added a
  serial `concurrency` lock (`cancel-in-progress: false`) so rapid multi-post
  publishes queue and run one at a time, avoiding translation-API rate-limit
  storms and mid-run cancellations. The publish step verifies no target-locale
  file is empty before committing.
- Added two opt-out switches for translations: a global `AUTO_TRANSLATE` env
  (`false` pauses all translation) and a per-entry frontmatter flag
  `autoTranslate: false` (set in the CMS) that excludes a single entry from
  translation. Both are applied during change detection so a skipped entry still
  publishes in English but is not auto-translated; it can be back-filled later via
  `workflow_dispatch` (force). The translate step is skipped entirely when no
  files remain.
- Added a `scope` input to `workflow_dispatch` so an existing (pre-populated) site
  can be translated incrementally in batches (e.g. `scope: posts` then
  `scope: products`) instead of one giant run. Existing EN files in `main` never
  auto-trigger translation; bootstrap them via the manual dispatch with `force` +
  `scope`. Runs resume incrementally (existing translations in the repo are read and
  only gaps are filled), so an interrupted batch can be re-run safely.
- Added an `autoTranslate` boolean field to the `posts` and `authors` collections
  in the example so the opt-out is toggleable from the CMS UI (defaults to `true`).
- The change-detection step now also skips **draft** entries (frontmatter
  `draft: true`) and **template** files (`_template.md`, `template.md`, or files
  under `templates/` / `_templates/`) so they are published in English but never
  sent for translation. Added an instruction telling the translation model to
  preserve existing human-edited translations and only update segments whose
  English source changed (prevents CI from clobbering manual fixes to translations).

---

## 0.3.1

### Added

- Promoted 13 commonly used Sveltia CMS options to first-class integration
  options, so they no longer need `extraConfig`: `singletons`,
  `assetCollections`, `i18n`, `readonly`, `showPreviewLinks`, `displayUrl`,
  `logoutRedirectUrl`, `editor`, `publishMode`, `fieldDefaults`, `output`,
  `slug`, and `logoUrl`. Each is type-checked and forwarded to the matching
  Sveltia config key.
- Documented `readonly`, `singletons`, and `i18n` usage with examples in both
  `README.md` and `README.zh-CN.md`.

### Changed

- Pinned the default Sveltia CMS version to `0.256.1` (previously `latest`)
  via `DEFAULT_SVELTIA_VERSION`, so the admin UI is reproducible instead of
  tracking the latest unpkg release. Override with `sveltiaVersion` only to
  upgrade deliberately.
- Bumped the `@sveltia/cms` type dependency from `^0.248.1` to `^0.256.1` to
  match the pinned runtime version and remove the type/runtime drift.

### Removed

- Dropped the `locale` option. It was forwarded to Sveltia's `config.yml` but
  Sveltia has no `locale` config key (the value was silently ignored); the CMS
  UI language follows the browser. The `DEFAULT_LOCALE` constant and the
  `config.locale` generation were also removed.

### Migration (from 0.2.x)

- If you used the `locale` option, remove it — the CMS UI language now follows
  the browser automatically.
- No other action required; the 13 promoted options are additive and the
  pinned Sveltia version is a safe default.

---

## 0.3.0

Security and consistency release.

### Security

- **Token handover is now bound to a fixed origin.** The success page posts the
  GitHub token only to the configured `CMS_ORIGIN` via
  `window.opener.postMessage(message, cmsOrigin)` — never to `"*"`. An attacker
  page that opens the auth popup can no longer receive the token. The receiving
  CMS must still verify `event.origin === CMS_ORIGIN`.

### Behavior changes

- **`CMS_ORIGIN` is now required.** It must be an `https` origin (or
  `http://localhost` for local dev). The auth endpoint returns `500` when it is
  missing or invalid. Set it in the platform dashboard and re-run
  `astro-sveltia-pages init`.
- **EdgeOne client IP now trusts only `request.eo.clientIp`.** The previous
  `x-forwarded-for` / `eo-client-ip` header fallbacks were removed because they
  can be client-spoofed, which let an attacker rotate the per-IP rate-limit key
  and bypass throttling. When the runtime does not expose the IP, the bucket
  falls back to `unknown`.

### Features / refactor

- **Single auto-detecting template.** `astro-sveltia-pages init` now copies one
  self-contained `auth.js` (using `autoAdapter`, which detects Cloudflare vs
  EdgeOne per request) into `functions/` or `edge-functions/` based on
  `--platform`. The old per-platform templates are gone. A fallback to the old
  path is kept for packages built before 0.3.0.
- **Rate limiter bounds memory.** `createRateLimiter` now evicts the
  soonest-to-expire bucket when it exceeds `MAX_TRACKED_CLIENTS`, so a
  key-rotating client cannot grow memory without bound.
- **Narrower public API.** `astro-sveltia-pages/functions` exports only the
  stable surface (`createAuthHandler`, `signState`, `verifyState`, the
  `Platform*` types). Adapters, crypto and rate-limit helpers moved to
  `astro-sveltia-pages/functions/internal` (not stable; may change in any
  release).

### Tooling

- Added `check:templates` (rebuild templates, fail on drift) and a CI workflow
  that runs check + test + `check:templates` + build.

### Migration (from 0.2.x)

| 0.2.x / 0.2.6                                             | 0.3.0                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token posted to `window.opener` with `targetOrigin:"*"`   | Token is posted **only** to the configured `CMS_ORIGIN` (`https`/`localhost`). `CMS_ORIGIN` is now **required** — the auth endpoint returns `500` if it is missing or invalid. Re-run `astro-sveltia-pages init` and set it. |
| EdgeOne client IP read from `x-forwarded-for` fallback    | EdgeOne now trusts only `request.eo.clientIp`; the `x-forwarded-for` fallback was removed (it could be spoofed, bypassing rate limiting).                                                                                    |
| Two generated templates (`functions/`, `edge-functions/`) | A single self-contained `auth.js` is generated and copied to the right directory by `init --platform`.                                                                                                                       |
| `astro-sveltia-pages/functions` exposed many internals    | Only stable APIs (`createAuthHandler`, `onRequest`, `signState`, `verifyState`) and a few public types are top-level exports; crypto/rate-limit/detect helpers moved to `astro-sveltia-pages/functions/internal`.            |

After upgrading, re-run `pnpm exec astro-sveltia-pages init` to refresh the template and set `CMS_ORIGIN` in the platform dashboard.

---

## 0.2.6

### Added

- Added EdgeOne Pages support.
- Split the OAuth runtime into a platform adapter layer
  (`PlatformAdapter`, `cloudflareAdapter`, `edgeoneAdapter`, `autoAdapter`).
- Replaced random CSRF state with a signed, timestamped state
  (`signState`/`verifyState`).
- Added a per-isolate rate limiter.

### Migration (from 0.2.x)

| 0.2.x                                      | 0.2.6                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `functions/auth.js` (hand-maintained copy) | Still the Cloudflare entry point, but generated from `src/functions` by `vp run build:templates`. Run `pnpm exec astro-sveltia-pages init` again to refresh it.             |
| —                                          | New: `edge-functions/auth.js` for EdgeOne Pages, created by `astro-sveltia-pages init --platform edgeone`.                                                                  |
| —                                          | New: `platform` option (`"cloudflare"` \| `"edgeone"`) and `astro-sveltia-pages/functions*` exports.                                                                        |
| CSRF `state` was a random value            | The state is now `timestamp.HMAC-SHA256(timestamp, clientSecret)` with a 10 minute TTL, verified with a timing-safe comparison. The OAuth App callback URL does not change. |
| No rate limiting                           | The auth endpoint is rate limited per client IP (30 requests per minute per isolate).                                                                                       |

Existing Cloudflare deployments keep working: the callback URL stays `{siteUrl}/auth` and the environment variables are unchanged. Copy the new template over `functions/auth.js` to pick up the signed state and the rate limit.

---

## 0.2.5

### Changed

- Removed the built-in OAuth routes and the injected admin page in favor of
  generated static files plus an auth template.

### Migration (from 0.2.x)

| 0.2.x                                                               | 0.2.5                                                                                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth: true/false` (Astro API routes `/api/auth`, `/api/callback`) | Removed. Run `pnpm exec astro-sveltia-pages init` and host `functions/auth.js` on Cloudflare Pages.                                    |
| `./routes/auth`, `./routes/callback`, `./admin.astro` exports       | Removed. Nothing to import; the admin UI is generated at build time.                                                                   |
| `route: "/cms"`                                                     | Removed. The admin UI is always generated at `/admin/`. Add a `_redirects` rule (`/cms/* /admin/:splat 301`) if you need the old path. |
| `title: "..."`                                                      | Renamed to `appTitle`.                                                                                                                 |
| `config: { backend, media_folder, ..., collections }`               | Split into top-level options (`repo`, `branch`, `mediaFolder`, ...) plus `extraConfig` for anything else.                              |
| —                                                                   | New: `r2` option generates `media_libraries.cloudflare_r2`.                                                                            |
| —                                                                   | New: `sveltiaVersion` controls the unpkg version of the CMS script.                                                                    |

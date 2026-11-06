# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

中文文档见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

Version-to-version migration guides live in each release's **Migration**
section below.

---

## 0.3.6

Bug-fix release for the _upgrade detection_ introduced in 0.3.5. A real CI log
from a consumer repository (`nextcharm`, run `42170827866`, 2026-11-06) showed
that a site can install 0.3.5 and still run the committed **0.3.4** workflow
snapshot. The resulting failure was indistinguishable from an API-key problem.

### Diagnosis (from the supplied logs)

- `detect` found 1 English source and produced 1 shard.
- `translate` passed `src/content/blog/en/<slug>.md` straight to
  `pelikhan/action-continuous-translation@v0.2.11`. That action filters out any
  path containing a two-letter locale directory (`/\/[a-z]{2,2}(-[a-zA-Z]{2,3})?\//`),
  so it logged `No files or not matching languages selected.` and
  `genaiscript: cancelled` (exit code 0).
- `remap` moved 0 files, the self-check saw no translation changes and skipped
  the commit, then the host-side `mkdir -p .genaiscript/cache` failed with
  `mkdir: Permission denied` because the Docker action created that directory as
  root. `publish` found no batch branch and opened an issue that only suggested
  checking `DEEPSEEK_API_KEY`, rate limits and the self-check.
- None of the 0.3.5 steps were present (no `Verify i18n template version`, no
  staging, no `Verify translations were produced`, no ownership reclaim, no
  publish-side failure gate). **Root cause: upgrading the npm dependency does not
  replace the committed workflow snapshot.** 0.3.5 only detected this on channels
  the user has to invoke locally (`astro dev` / `astro build`, `init:i18n --check`)
  — a CMS-driven content push never runs either of them.

### Fixed

- **CI-side stale-template gate.** The generated workflow now carries a
  `TEMPLATE_VERSION` env value and a `Verify i18n template version` step in
  `detect`. It resolves the actually installed package version from
  `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`, then
  `node_modules/astro-sveltia-pages/package.json`, then `package.json`, and fails
  immediately with an `::error::` plus the exact fix command when it does not
  match the workflow's template stamp. A bare `^0.3.x` range falls back to a
  non-fatal `major.minor` comparison so it cannot produce false positives.
- **Actionable failure issue.** The automatic issue now prints the template
  version and names the two symptoms from the stale-workflow log, so the next
  failure points at the snapshot rather than at the API credentials.
- **`init:i18n --check` no longer fails on repositories that never enabled
  i18n.** `inspectI18nTemplates` reports `outdated: true` when all three files
  are missing; the build-time check already guards on `status.enabled`, but the
  CLI gate did not, so it was unusable as a blanket CI check.
- **Per-shard translation cache.** The `actions/cache` key and `restore-keys`
  prefix now include `${{ matrix.i }}`. Previously all parallel shards restored
  the same cache and each saved a cache containing only its own translation
  records, so the next run recovered just one shard's incremental state and
  re-translated the rest.
- `check:templates` and the template tests guard all of the above, plus the
  0.3.5 invariants.

### Migration (from 0.3.5)

- **Re-run `pnpm exec astro-sveltia-pages init:i18n` in every consumer repository
  and commit the three regenerated files.** This is mandatory — the log above
  proves that a dependency bump alone leaves the broken workflow in place. From
  0.3.6 onwards, forgetting this step fails the next translation run with an
  explicit version mismatch instead of a silent zero-translation run.
- No CMS config or secret changes are required.

---

## 0.3.5

Critical fix release for the shipped i18n translation workflow. 0.3.4 shipped a
workaround for the upstream file filter but it was never validated in a real CI
run; several defects meant that even a freshly generated workflow could produce
zero translations.

### Fixed

- **Hidden staging directory.** The staging directory used by the workflow was
  `.i18n-staging` (dot-prefixed). GenAIScript's file glob ignores dot directories,
  so `pelikhan/action-continuous-translation` received no files and aborted with
  `No files or not matching languages selected.` The generated workflow now uses
  a plain `i18n-staging/` directory, plus a pre-flight check that rejects any
  staged path containing a two-letter locale segment or a `.{lang}.md` suffix.
- **Docker root ownership.** The translation action runs as root and creates
  `.genaiscript/`; the following `mkdir -p .genaiscript/cache` step failed with
  `mkdir: Permission denied`, failing the whole translate job. Ownership of all
  generated directories is now reclaimed with `sudo chown` and cleanup uses a
  `sudo` fallback. No host-side `mkdir` remains.
- **Silent green runs.** `genaiscript: cancelled` exits 0, so a run with zero
  translations previously finished successfully. A `Verify translations were
produced` step now asserts that every (source file × target language) output
  exists and is non-empty, and a `Fail when no translations were published` gate
  fails the publish job. Failures still open an issue, now with an actionable
  checklist.
- **`remap-translations.sh` used `git mv` on untracked staging files**, which
  fails with `not under version control`. It now uses plain `mv` (the workflow's
  `git add -A` picks the files up), excludes English sources via a `.sources`
  manifest, validates languages against `TARGET_LANGS` instead of a loose regex,
  and fails when nothing was mapped.
- **Wrong translation cache path.** The cache restored `.genaiscript/cache`,
  while pelikhan writes its incremental caches to `<translations_dir>/<lang>.json`.
  The workflow now sets `translations_dir: i18n-translations` explicitly and
  caches that directory.
- **Unpinned upstream action / retired model.** `pelikhan/...@v0` is now pinned
  to `@v0.2.11`; `filename_template` is set explicitly so remap cannot drift.
  The model id is now `deepseek-flash` (`deepseek-v4-flash` has been retired by
  DeepSeek).
- **`init:i18n` locale parsing.** The object-form regex `/locale:/` also matched
  the tail of `default_locale: "en"`, so an array-form `locales: ["en","fr"]`
  resolved to just `["en"]` and the command aborted with "no target languages".
  Both the CLI and the workflow validator now require a token boundary and match
  only the standalone `locales:` key.
- **The generated workflow's detect step** read frontmatter of deleted files
  without checking existence, which could crash `sh()` on a removal-only push.
  It now guards with `fs.existsSync`.
- **Pre-seeded staging files defeated the failure gate.** The staging step copied
  existing translations into the staging directory. pelikhan never reads target
  markdown (its incremental state lives in `translations_dir/<lang>.json`), so
  those copies made `Verify translations were produced` pass even on a run that
  produced nothing — reintroducing the silent green run. Staging now contains only
  English sources.
- **Locale codes with uppercase region segments.** pelikhan renders `{{lang}}`
  with `to.toLowerCase()`, so `zh-CN` produces `{slug}.zh-cn.md`. Verification and
  `remap-translations.sh` compared against the raw `TARGET_LANGS` string and could
  not find those files. Both now normalize case for matching, and remap maps the
  lowercased code back to the exact locale string from the Sveltia config when
  writing into `multiple_folders` directories.

### Added

- **Generated-file version stamping and upgrade detection.** All three generated
  files carry an `astro-sveltia-pages i18n template vX.Y.Z` marker. Re-running
  `init:i18n` now automatically upgrades outdated generated files (backing the
  previous copy up as `*.bak`) instead of silently skipping them; the
  user-editable `i18n/glossary.md` is never auto-overwritten. This fixes the
  root cause of "I upgraded the package but translation is still broken": the
  generated workflow in the consumer repo is a committed snapshot and a
  dependency bump never updates it.
- **`init:i18n --check`** — a CI-friendly guard that exits non-zero when any
  generated file is missing or older than the current package.
- `check:templates` now asserts the presence of every 0.3.5 workflow fix and
  rejects known-broken 0.3.4 constructs (hidden staging dir, retired model id,
  host-side `.genaiscript` mkdir).
- **Build-time upgrade warning.** `astro dev` / `astro build` now compare the
  installed package version with the stamps on the three committed i18n files
  and print a prominent upgrade notice when they are stale. This is exactly
  what a user runs right after `pnpm up`, so the notice reaches people who never
  open the README. New option `i18nTemplateCheck: "warn" | "error" | "off"`
  (default `warn`); `"error"` fails the build and doubles as a CI gate. The
  check stays silent when i18n was never initialised.
- **Self-reporting workflow.** Every run logs the template version it was
  generated from (`Report i18n template version`), so a stale workflow is
  obvious in the Actions log. `init:i18n --check` now renders the same canonical
  notice with the exact fix command instead of a generic error.
- **pnpm-first commands.** All user-facing examples, generated file headers and
  CLI output use `pnpm exec astro-sveltia-pages ...`.

### Migration (from 0.3.4)

- **Re-run `pnpm exec astro-sveltia-pages init:i18n` in every consumer repository.**
  This is mandatory: upgrading the dependency alone does not replace the
  committed `.github/workflows/i18n-translate.yml`, `i18n/glossary.md` or
  `scripts/remap-translations.sh`. The command detects the old files, upgrades
  them and leaves `*.bak` backups for review (delete them or add to
  `.gitignore`).
- Optionally add `pnpm exec astro-sveltia-pages init:i18n --check` to CI so a future
  dependency upgrade cannot leave stale templates unnoticed.
- No CMS config changes are required. Commit messages must still avoid
  bracketed CI-skip markers (`[skip ci]` etc.).

---

## 0.3.4

### Added

- Productized the i18n auto-translation workflow so consumers no longer copy files
  by hand. The three artifacts (`.github/workflows/i18n-translate.yml`,
  `i18n/glossary.md`, `scripts/remap-translations.sh`) are now shipped as templates
  under `templates/i18n/` and copied into `dist/templates/i18n/` by
  `vp run build:templates`, so they are included in the npm tarball.
- Added the `init:i18n` CLI command (also `init --i18n`). It reads the consumer's
  Sveltia CMS config (`sveltia-cms.config.mjs` by default; override with
  `--config`), extracts `i18n.default_locale`, `i18n.locales` (both
  `["en","fr"]` and `[{locale:"en"}]` forms) and each collection's `folder`,
  auto-fills the template placeholders (`__CONTENT_ROOT__`, `__COLLECTION_EN_PATH__`,
  `__TARGET_LANGS__`, `__CONFIG_FILE__`, `__SKIP_COLLECTIONS__`, `__I18N_STRUCTURE__`,
  `__PROJECT_NAME__`), and writes the three files. Existing files are skipped unless
  `--force` is passed, and the command prints the required `DEEPSEEK_API_KEY` secret
  and the mandatory Sveltia CMS settings.
- Worked around a `pelikhan/action-continuous-translation` compatibility bug in the
  shipped workflow: the action silently drops any file whose path contains a
  two-letter language directory (e.g. `/en/`) or a `.{lang}.` filename suffix, so
  Sveltia's `multiple_folders` English sources were being filtered out ("No files or
  not matching languages selected"). The workflow now stages English sources into a
  flat `.i18n-staging/` directory (no `/xx/` segment) before translation, seeds
  existing translations for incremental reuse, and remaps results back to the
  `multiple_folders` layout via `remap-translations.sh`.
- Documented the hard requirement that commit messages must never contain bracketed
  CI-skip markers (`[skip ci]`, `[ci skip]`, etc.): on GitHub Actions + Cloudflare
  Pages such a marker skips the entire push's workflow **and** the CF deployment.

### Changed

- `check:templates` now validates that each i18n template still carries its required
  placeholders before the package is built.

---

## 0.3.3

Maintenance release that bundled the i18n translation-workflow hardening that
followed 0.3.2 and pinned the correct DeepSeek model alias:

- Pinned `model_alias: "translation: openai:deepseek-v4-flash"` and documented the
  `DEEPSEEK_API_KEY` secret and the DeepSeek OpenAI-compatible endpoint.
- Change detection now skips draft entries (`draft: true`) and template files, and
  preserves existing human-edited translations (only updating segments whose English
  source changed).
- Added a CMS-toggleable `autoTranslate` field and a `workflow_dispatch` `scope` input
  for batched, incremental bootstrap of existing (pre-populated) sites.
- Hardened the publish flow: `.genaiscript/cache` restore, failure alerting via
  auto-created issues, single-source-of-truth locale validation, `authors` excluded
  from translation, and `force-with-lease` push retries.

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
- Switched the translation workflow's default engine to **DeepSeek** (OpenAI-compatible
  endpoint `https://api.deepseek.com`) via `openai_api_key`/`openai_api_base` and
  `model_alias: "translation: openai:deepseek-v4-flash"`. `deepseek-v4-flash` is the
  non-thinking tier (cheapest, low latency, 128K context) and the right fit for
  bulk Markdown translation; `deepseek-v4-pro`/`reasoner` are excluded as they add
  cost/latency with no translation benefit. GitHub Models remains a commented
  fallback. Credentials live in repo Secrets (`DEEPSEEK_API_KEY`); Baidu Translate
  is documented as a non-LLM fallback that cannot drive pelikhan directly.
- Hardened and optimized the translation workflow (0.3.2 follow-up):
    - **Detect → matrix-translate → publish** pipeline. The translate stage now runs
      in parallel **matrix shards** of `CHUNK_SIZE` files, so a large `force` bootstrap
      no longer risks the 6-hour timeout or a single oversized parameter set; disjoint
      shards commit to one shared `i18n/batch-<run>` branch and are merged once.
    - **(1) Cache restored**: `.genaiscript/cache` is now restored via `actions/cache`
      so incremental translation state persists across runs (faster, cheaper tokens).
    - **(2) Failure alerting**: if any translate/publish step fails, an issue is
      auto-created (`labels: i18n, ci-failure`) so silent failures are surfaced
      instead of going unnoticed in the Actions log.
    - **(3) Single-source-of-truth validation**: the Sveltia config's `locales` must
      match the workflow's `TARGET_LANGS`; a mismatch fails the run with a clear diff
      (point `CONFIG_FILE` at your config). Set once, never drift.
    - **(4) `authors` excluded from translation**: the push trigger now watches only
      `posts/**/en/**`, and `SKIP_COLLECTIONS: authors` guards force-mode too. Removed
      the misleading `autoTranslate` field from `authors` (kept on `posts`).
    - **(5) Fixed the remap script's `multiple_files` handling**: pelikhan always emits
      under `en/`, so both layouts now move the translation out of `en/` (folders →
      `{lang}/`, files → collection root). The previous "no move needed" comment was wrong.
    - **(6) Hardened publish**: `git push --force-with-lease` + retry loop against
      `origin/main` (and per-shard against the batch branch) prevents rebase/push races
      when `main` moves while a run is in flight.

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

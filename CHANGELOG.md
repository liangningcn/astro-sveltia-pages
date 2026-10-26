# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## 0.3.0

Security and consistency release. Upgrading requires a config change
(`CMS_ORIGIN`); see the README "Migrating from 0.2.x to 0.3.0" section.

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

## 0.2.6

- Added EdgeOne Pages support.
- Split the OAuth runtime into a platform adapter layer
  (`PlatformAdapter`, `cloudflareAdapter`, `edgeoneAdapter`, `autoAdapter`).
- Replaced random CSRF state with a signed, timestamped state
  (`signState`/`verifyState`).
- Added a per-isolate rate limiter.

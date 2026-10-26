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

### 中文

#### 安全

- **令牌交接现绑定到固定 origin。** 成功页仅通过
  `window.opener.postMessage(message, cmsOrigin)` 将 GitHub 令牌回传给配置好的
  `CMS_ORIGIN`——绝不会发给 `"*"`。打开 auth 弹窗的攻击者页面无法再接收到令牌。接收方
  CMS 仍需校验 `event.origin === CMS_ORIGIN`。

#### 行为变更

- **`CMS_ORIGIN` 现已必填。** 必须为 `https` origin（本地开发可用
  `http://localhost`）。当它缺失或无效时，auth 端点返回 `500`。请在平台控制台中设置它，
  并重新运行 `astro-sveltia-pages init`。
- **EdgeOne 客户端 IP 现在仅信任 `request.eo.clientIp`。** 此前
  `x-forwarded-for` / `eo-client-ip` 的请求头回退已被移除，因为它们可被客户端伪造，
  从而让攻击者轮换按 IP 限流的键并绕过节流。当运行时未暴露 IP 时，对应桶回退为
  `unknown`。

#### 功能 / 重构

- **单一自动探测模板。** `astro-sveltia-pages init` 现在基于 `--platform` 复制一份
  自包含的 `auth.js`（使用能按请求探测 Cloudflare 与 EdgeOne 的 `autoAdapter`），
  放入 `functions/` 或 `edge-functions/`。旧的按平台模板已移除。为 0.3.0 之前构建的
  包保留了对旧路径的回退。
- **限流器为内存设上限。** 当超过 `MAX_TRACKED_CLIENTS` 时，`createRateLimiter`
  会淘汰最早到期的桶，因此不断轮换键的客户端无法无限制地占用内存。
- **更窄的公开 API。** `astro-sveltia-pages/functions` 仅导出稳定面
  （`createAuthHandler`、`signState`、`verifyState`、`Platform*` 类型）。适配器、加密与
  限流辅助函数移至 `astro-sveltia-pages/functions/internal`（不稳定；可能在任意版本中变动）。

#### 工具

- 新增 `check:templates`（重建模板，发生漂移则失败）以及运行 check + test +
  `check:templates` + build 的 CI 工作流。

## 0.2.6

- Added EdgeOne Pages support.
- Split the OAuth runtime into a platform adapter layer
  (`PlatformAdapter`, `cloudflareAdapter`, `edgeoneAdapter`, `autoAdapter`).
- Replaced random CSRF state with a signed, timestamped state
  (`signState`/`verifyState`).
- Added a per-isolate rate limiter.

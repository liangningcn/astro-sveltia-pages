# 更新日志

本项目的所有重要变更记录于此，遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

English documentation: [CHANGELOG.md](CHANGELOG.md).

各版本之间的升级指引见每项的 **迁移** 小节。

---

## 0.3.2

### 新增

- 新增可选的 GitHub Actions 工作流（`.github/workflows/i18n-translate.yml`），
  用于自动化多语言翻译，使 Sveltia CMS 编辑只需维护英文源文件。该工作流复用
  `pelikhan/action-continuous-translation`（基于 remark AST 解析、增量翻译、
  缓存与质量校验），将变更的英文 Markdown 翻译为 15 个目标语言，并发起翻译
  Pull Request。
- 新增 `i18n/glossary.md`（跨语言保持不变的品牌名/产品词）与
  `scripts/remap-translations.sh`（将 Action 默认的
  `content/{collection}/en/{slug}.{lang}.md` 输出重新映射为 Sveltia 的
  `multiple_folders` 结构 `content/{collection}/{lang}/{slug}.md`）。

### 变更

- 在工作流头部与配套文件中说明了该工作流推荐的 Sveltia CMS 配置：设置
  `i18n.save_all_locales: false`（或 `initial_locales: [en]`），使 CMS 仅提交
  英文源文件；并将 `slug`/图片路径等字段标记为 `i18n: duplicate`，确保其不会
  被送翻。
- 将内置的 `example` 改造为该工作流的端到端 dogfood：启用了 16 语言 Sveltia
  `i18n` 配置（`multiple_folders`、`default_locale: en`、15 个目标语言），为
  `authors`/`posts` 集合设置 `save_all_locales: false` 与
  `initial_locales: [en]`，将不可翻译字段（`name`、`avatar`、`date`、
  `author`、`draft`、`cover`）标记为 `i18n: duplicate`，把示例内容移入 `en/`
  子目录，并将 `sveltiaLoader` 指向 `locale: "en"`。现在向 `main` 推送 `en/`
  下的文件即会触发翻译工作流。

---

## 0.3.1

### 新增

- 将 13 个常用的 Sveltia CMS 配置项提升为集成的一等公民配置项，不再需要
  `extraConfig`：`singletons`、`assetCollections`、`i18n`、`readonly`、
  `showPreviewLinks`、`displayUrl`、`logoutRedirectUrl`、`editor`、
  `publishMode`、`fieldDefaults`、`output`、`slug`、`logoUrl`。每一项都经过
  类型检查，并转发到对应的 Sveltia 配置键。
- 在 `README.md` 与 `README.zh-CN.md` 中补充了 `readonly`、`singletons`、
  `i18n` 的用法示例。

### 变更

- 通过 `DEFAULT_SVELTIA_VERSION` 将默认 Sveltia CMS 版本固定为 `0.256.1`
  （此前为 `latest`），使后台 UI 可复现，而不再跟踪 unpkg 上的最新发布。
  如需升级，请仅通过 `sveltiaVersion` 显式覆盖。
- 将 `@sveltia/cms` 的类型依赖从 `^0.248.1` 提升到 `^0.256.1`，与固定的
  运行时版本保持一致，消除类型与运行时的偏差。

### 移除

- 移除了 `locale` 配置项。它此前会被转发到 Sveltia 的 `config.yml`，但
  Sveltia 并没有 `locale` 配置键（该值被静默忽略）；CMS 界面语言现在跟随
  浏览器。相关的 `DEFAULT_LOCALE` 常量与 `config.locale` 生成逻辑也已删除。

### 迁移（0.2.x → 0.3.1）

- 如果你曾使用 `locale` 配置项，请将其删除 —— CMS 界面语言现在会自动跟随
  浏览器。
- 无需其他操作；13 个提升的配置项均为增量新增，固定的 Sveltia 版本也是安全的默认值。

---

## 0.3.0

安全与一致性发布。

### 安全

- **令牌交接现绑定到固定 origin。** 成功页仅通过
  `window.opener.postMessage(message, cmsOrigin)` 将 GitHub 令牌回传给配置好的
  `CMS_ORIGIN`——绝不会发给 `"*"`。打开 auth 弹窗的攻击者页面无法再接收到令牌。接收方
  CMS 仍需校验 `event.origin === CMS_ORIGIN`。

### 行为变更

- **`CMS_ORIGIN` 现已必填。** 必须为 `https` origin（本地开发可用
  `http://localhost`）。当它缺失或无效时，auth 端点返回 `500`。请在平台控制台中设置它，
  并重新运行 `astro-sveltia-pages init`。
- **EdgeOne 客户端 IP 现在仅信任 `request.eo.clientIp`。** 此前
  `x-forwarded-for` / `eo-client-ip` 的请求头回退已被移除，因为它们可被客户端伪造，
  从而让攻击者轮换按 IP 限流的键并绕过节流。当运行时未暴露 IP 时，对应桶回退为
  `unknown`。

### 功能 / 重构

- **单一自动探测模板。** `astro-sveltia-pages init` 现在基于 `--platform` 复制一份
  自包含的 `auth.js`（使用能按请求探测 Cloudflare 与 EdgeOne 的 `autoAdapter`），
  放入 `functions/` 或 `edge-functions/`。旧的按平台模板已移除。为 0.3.0 之前构建的
  包保留了对旧路径的回退。
- **限流器为内存设上限。** 当超过 `MAX_TRACKED_CLIENTS` 时，`createRateLimiter`
  会淘汰最早到期的桶，因此不断轮换键的客户端无法无限制地占用内存。
- **更窄的公开 API。** `astro-sveltia-pages/functions` 仅导出稳定面
  （`createAuthHandler`、`signState`、`verifyState`、`Platform*` 类型）。适配器、加密与
  限流辅助函数移至 `astro-sveltia-pages/functions/internal`（不稳定；可能在任意版本中变动）。

### 工具

- 新增 `check:templates`（重建模板，发生漂移则失败）以及运行 check + test +
  `check:templates` + build 的 CI 工作流。

### 迁移（0.2.x → 0.3.0）

| 0.2.x / 0.2.6                                       | 0.3.0                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 令牌通过 `window.opener` 以 `targetOrigin:"*"` 回传 | 令牌**仅**回传至配置的 `CMS_ORIGIN`（`https`/`localhost`）。`CMS_ORIGIN` 现**为必填** —— 缺失或无效时认证端点返回 `500`。请重新运行 `astro-sveltia-pages init` 并设置它。       |
| EdgeOne 客户端 IP 从 `x-forwarded-for` 回退读取     | EdgeOne 现在仅信任 `request.eo.clientIp`；`x-forwarded-for` 回退被移除（可被伪造，从而绕过限流）。                                                                              |
| 两个生成模板（`functions/`、`edge-functions/`）     | `init --platform` 生成一个自包含的 `auth.js` 并复制到对应目录。                                                                                                                 |
| `astro-sveltia-pages/functions` 暴露了大量内部实现  | 仅稳定 API（`createAuthHandler`、`onRequest`、`signState`、`verifyState`）与少量公共类型作为顶层导出；加密 / 限流 / 检测辅助函数移至 `astro-sveltia-pages/functions/internal`。 |

升级后，请重新运行 `pnpm exec astro-sveltia-pages init` 刷新模板，并在平台后台设置 `CMS_ORIGIN`。

---

## 0.2.6

### 新增

- 新增 EdgeOne Pages 支持。
- 将 OAuth 运行时拆分为平台适配器层
  （`PlatformAdapter`、`cloudflareAdapter`、`edgeoneAdapter`、`autoAdapter`）。
- 用带签名、带时间戳的 `state`（`signState`/`verifyState`）替换了随机的 CSRF state。
- 新增按隔离环境（isolate）的限流器。

### 迁移（0.2.x → 0.2.6）

| 0.2.x                                 | 0.2.6                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `functions/auth.js`（手工维护的副本） | 仍是 Cloudflare 入口，但由 `vp run build:templates` 从 `src/functions` 生成。请再次运行 `pnpm exec astro-sveltia-pages init` 刷新它。 |
| —                                     | 新增：EdgeOne Pages 的 `edge-functions/auth.js`，由 `astro-sveltia-pages init --platform edgeone` 创建。                              |
| —                                     | 新增：`platform` 配置项（`"cloudflare"` \| `"edgeone"`）以及 `astro-sveltia-pages/functions*` 导出。                                  |
| CSRF `state` 为随机值                 | state 现为 `timestamp.HMAC-SHA256(timestamp, clientSecret)`，带 10 分钟 TTL，以恒定时间比较校验。OAuth App 回调地址不变。             |
| 无限流                                | 认证端点按客户端 IP 限流（每隔离环境每分钟 30 次请求）。                                                                              |

已有的 Cloudflare 部署仍可正常工作：回调地址仍为 `{siteUrl}/auth`，环境变量不变。将新模板覆盖到 `functions/auth.js` 即可获得签名 state 与限流。

---

## 0.2.5

### 变更

- 移除了内置的 OAuth 路由与注入的后台页面，改为生成静态文件加认证模板。

### 迁移（0.2.x → 0.2.5）

| 0.2.x                                                              | 0.2.5                                                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `oauth: true/false`（Astro API 路由 `/api/auth`、`/api/callback`） | 已移除。请运行 `pnpm exec astro-sveltia-pages init` 并在 Cloudflare Pages 上托管 `functions/auth.js`。     |
| `./routes/auth`、`./routes/callback`、`./admin.astro` 导出         | 已移除。无需导入任何东西；后台 UI 在构建时生成。                                                           |
| `route: "/cms"`                                                    | 已移除。后台 UI 始终生成在 `/admin/`。若需要旧路径可添加 `_redirects` 规则（`/cms/* /admin/:splat 301`）。 |
| `title: "..."`                                                     | 重命名为 `appTitle`。                                                                                      |
| `config: { backend, media_folder, ..., collections }`              | 拆分为顶层配置项（`repo`、`branch`、`mediaFolder` 等），其余通过 `extraConfig` 设置。                      |
| —                                                                  | 新增：`r2` 配置项生成 `media_libraries.cloudflare_r2`。                                                    |
| —                                                                  | 新增：`sveltiaVersion` 控制 CMS 脚本的 unpkg 版本。                                                        |

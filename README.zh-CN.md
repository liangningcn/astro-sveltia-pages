# astro-sveltia-pages

[English](README.md) | 中文

> **归属声明**
> 本包是 Johannes Knoll 所著的 [`astro-loader-sveltia-cms`](https://github.com/joknoll/astro-loader-sveltia-cms) 的一个分支（fork），以 MIT 许可证发布。

为 Astro 提供 Sveltia CMS 集成，针对 Cloudflare Pages 与 EdgeOne Pages 做了优化：

- 从一个 options 对象生成构建产物中的 `/admin/index.html` 与 `/admin/config.yml`，无需手写 CMS 配置。
- 为 Sveltia 配置 **Cloudflare R2** 的**外部媒体库**（已做校验，密钥不会写入磁盘）。
- 内置经过实战检验的 **GitHub OAuth 边缘函数**，分别适用于 Cloudflare Pages（`functions/auth.js`）与 EdgeOne Pages（`edge-functions/auth.js`），并提供 `init` 命令自动接入。
- 内置内容加载器（`astro-sveltia-pages/loader`），可自动生成 Zod schema。

## 快速开始

```bash
pnpm add astro-sveltia-pages
```

在 `astro.config.mjs` 中注册该集成：

```js
import { defineConfig } from "astro/config";
import sveltia from "astro-sveltia-pages";

export default defineConfig({
    site: "https://example.com", // 当省略 siteUrl 时，作为 CMS 的 base_url 使用
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

构建后检查输出：

```bash
astro build
# dist/admin/index.html   — CMS 界面（从 unpkg 加载 Sveltia）
# dist/admin/config.yml   — 生成的 CMS 配置
```

在 `src/content.config.ts` 中使用内容加载器：

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

const posts = defineCollection({ loader: sveltiaLoader("posts") });

export const collections = { posts };
```

## 认证（GitHub OAuth）

本包本身不托管 OAuth 端点，而是直接提供真实部署在生产环境中所使用的边缘函数。OAuth 逻辑（state 签名、令牌交换、`postMessage` 交接）与平台无关；只有运行时的访问器不同，因此同一套实现可同时运行于 Cloudflare Pages 与 EdgeOne Pages。

### Cloudflare Pages

1. 在项目根目录运行 init 命令：

    ```bash
    pnpm exec astro-sveltia-pages init --site-url https://example.com
    ```

    该命令会：
    - 将 OAuth 模板复制到 `functions/auth.js`（**不会**覆盖已有文件；若已存在则非零退出并打印提示）；
    - 向 `.env.example` 追加 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`ENVIRONMENT` 与 `SITE_URL`（已存在的键会被跳过，不会重复写入）；
    - 打印 GitHub OAuth App 的设置步骤与所需的回调 URL（`{siteUrl}/auth`）。

2. 在 <https://github.com/settings/developers> 创建 GitHub OAuth App，授权回调 URL 为 `{siteUrl}/auth`。

3. 在 **Cloudflare Pages 控制台**（Settings → Environment variables）配置环境变量：
    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production`（将 OAuth CORS 来源收紧为你自己的站点）
    - `SITE_URL`（生产站点的完整 origin，例如 `https://example.com`；auth 函数优先使用它而非请求来源，从而让 OAuth 来源在自定义域名、`*.pages.dev` 预览域名与本地 `wrangler pages dev` 之间保持一致）
    - `CMS_ORIGIN`（**自 0.3.0 起必填**）——令牌被回传到的 origin，例如 `https://example.com`。必须为 `https`（本地开发可用 `http://localhost`）。这是唯一被允许作为 `postMessage` 目标的 origin；接收方仍需自行校验 `event.origin === CMS_ORIGIN`。

4. 重新部署。CMS 登录按钮现在使用 GitHub OAuth；Sveltia 通过 `authorization:github:success:` 的 postMessage（并提供 `#access_token=` 兜底）接收令牌。令牌**仅**会回传给配置好的 `CMS_ORIGIN`，绝不会发给 `"*"`——因此打开 auth 弹窗的攻击者页面无法接收到它。接收方的 CMS 仍应在信任该消息前校验 `event.origin`。

生成的配置使用 `base_url: {siteUrl}` 与 `auth_endpoint: auth`，即由 `functions/auth.js` 提供的路由。

### EdgeOne Pages

EdgeOne Pages 的部署流程相同，仅有两处差异：函数位于 `edge-functions/`，且环境变量在 EdgeOne 控制台中配置。

1. 使用平台标志运行 init 命令：

    ```bash
    pnpm exec astro-sveltia-pages init --platform edgeone --site-url https://example.com
    ```

    该命令会将 EdgeOne 模板复制到 `edge-functions/auth.js`，并向 `.env.example` 写入同样的四个变量。默认平台为 `cloudflare`，因此 `--platform cloudflare`（或不带该标志）保持原有行为。

2. 在 <https://github.com/settings/developers> 创建 GitHub OAuth App，授权回调 URL 为 **EdgeOne 域名**：
   `https://{your-edgeone-domain}/auth`。

3. 在 **EdgeOne Pages 控制台**（Project settings → Environment variables）配置环境变量：
    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production`
    - `SITE_URL`（生产站点的完整 origin，例如 `https://example.com`）
    - `CMS_ORIGIN`（**自 0.3.0 起必填**）——具体含义参见 Cloudflare 小节；它是唯一被允许作为 `postMessage` 目标的 origin。

    EdgeOne 边缘函数从运行时的 `env` 对象读取这些变量，由平台注入——不要将它们内联进打包产物。

4. 在 `astro.config.mjs` 中使用 EdgeOne Astro 适配器构建：

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
                platform: "edgeone", // 选择 EdgeOne 指引与模板
                collections: [
                    /* ... */
                ],
            }),
        ],
    });
    ```

    `@edgeone/astro` 通过 EdgeOne Pages 渲染站点；OAuth 函数仍为 `edge-functions/auth.js` 中的一个普通边缘函数，随站点一同部署，不受 Astro 适配器影响。

5. 重新部署。CMS 登录按钮的使用方式与 Cloudflare Pages 完全一致。

#### 与 Cloudflare Pages 部署的差异

| 主题         | Cloudflare Pages                           | EdgeOne Pages                                                     |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| 函数目录     | `functions/auth.js`                        | `edge-functions/auth.js`                                          |
| 入口         | `export async function onRequest(context)` | `export async function onRequest({ request, env })` (+ `default`) |
| 环境变量     | `context.env`                              | `context.env`，回退到全局 `env` 对象                              |
| 客户端 IP    | `CF-Connecting-IP` 请求头                  | 仅 `request.eo.clientIp`（无请求头回退；缺失时为 unknown）        |
| 限流         | 单隔离实例、内存级、尽力而为               | 单隔离实例、内存级、尽力而为                                      |
| Astro 适配器 | `@astrojs/cloudflare`                      | `@edgeone/astro`                                                  |

两个平台对 auth 端点的限流均为**单隔离实例**级别：计数器存在于处理该请求的那一个隔离实例的内存中，因此限流是尽力而为的，当请求落到另一个隔离实例时会重置。客户端 IP 仅用作限流键——当某个平台隐藏了它时，适配器会回退到 `unknown`，此类请求共享同一个桶。

若在 EdgeOne 上无法确定 IP，上述限流就会退化为针对这些请求的全局限流。请保持 `ENVIRONMENT=production`，以便 CORS 预检只回应你自己的 origin。

#### 在你自己的函数中使用运行时

平台适配器与 OAuth 处理器均由本包导出，因此你可以自行托管 auth 端点：

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

`astro-sveltia-pages/functions`（稳定 API）导出 `createAuthHandler()`、`signState()`、`verifyState()` 以及 `PlatformAdapter` 类型。传入 `platform: "cloudflare" | "edgeone" | "auto"` 可在每次请求时固定或自动探测平台。

更底层的组件——平台适配器（`cloudflareAdapter`、`edgeoneAdapter`、`autoAdapter`、`detectAdapter`）、加密辅助函数（`hmacSha256Hex`、`timingSafeEqual`）、`createRateLimiter()` 以及 `normalizeContext()`——位于 `astro-sveltia-pages/functions/internal`。它们**不属于**稳定 API，可能在任意版本中变动；仅当你需要构建自定义适配器或处理器时才可引入。

## Cloudflare R2 媒体存储

传入 `r2` 选项以生成 Sveltia 的外部媒体库配置（`media_libraries.cloudflare_r2`）。四个字段均为必填，并在启动时进行校验：

```js
sveltia({
    repo: "my-org/my-site",
    r2: {
        accountId: "your-cloudflare-account-id",
        accessKeyId: "your-r2-access-key-id",
        bucket: "my-r2-bucket",
        publicUrl: "https://pub-xxx.r2.dev", // 或自定义域名
    },
    collections: [
        /* ... */
    ],
});
```

> **重要安全提示：**
> R2 的**私密访问密钥绝不会被写入配置**。Sveltia CMS 会在用户首次访问媒体库时在 CMS 界面中提示输入，且仅存储于浏览器的 localStorage 中。

需要额外手动完成的配置（此处说明，不由生成器产出）：

- **R2 CORS**：在 Cloudflare 控制台（bucket → Settings → CORS policy）允许你的站点 origin，方法为 `GET`、`PUT`、`DELETE` 与 `OPTIONS`，并携带 `authorization` 与 `content-type` 请求头。
- **`publicUrl`** 必须可公开访问：使用 bucket 的 `r2.dev` 开发 URL，或将自定义域名绑定到该 bucket。

## /admin 页面的 CSP

若你的托管方发送了严格的 `Content-Security-Policy`，请至少为 `/admin/*` 放行以下内容（本包**不会**生成响应头）：

- 脚本：`unpkg.com`（若替换 CDN，则为 `cdn.jsdelivr.net`）
- 连接：`api.github.com`、`github.com`、`raw.githubusercontent.com`、你的 R2 公开域名、`unpkg.com`
- 图片：`data:`、`blob:`、`https:`（媒体预览）

## 配置项参考

| 选项             | 类型                        | 默认值            | 说明                                                                       |
| ---------------- | --------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `repo`           | `string`                    | —                 | GitHub 仓库，`owner/name`。必填。                                          |
| `branch`         | `string`                    | `"main"`          | CMS 修改提交到的分支。                                                     |
| `siteUrl`        | `string`                    | Astro `site`      | 用作 CMS `base_url` 的 origin。两者均未设置时构建会失败。                  |
| `collections`    | `SveltiaCollection[]`       | —                 | 1:1 映射进 CMS 配置。必填。                                                |
| `r2`             | `object`                    | —                 | Cloudflare R2 外部媒体库（见上）。                                         |
| `mediaFolder`    | `string`                    | `"public/images"` | CMS 的 `media_folder`。                                                    |
| `publicFolder`   | `string`                    | `"/images"`       | CMS 的 `public_folder`。                                                   |
| `locale`         | `string`                    | `"zh"`            | CMS 界面语言。                                                             |
| `appTitle`       | `string`                    | `"Sveltia CMS"`   | 浏览器标签页 / 登录页标题。                                                |
| `logo`           | `{ src, ... }`              | —                 | CMS 标识，原样透传为 `logo`。                                              |
| `backendName`    | `string`                    | `"github"`        | Git 后端名称。                                                             |
| `sveltiaVersion` | `string`                    | `"latest"`        | 从 unpkg 加载的 Sveltia 版本（默认 `@latest`）。                           |
| `extraConfig`    | `object`                    | —                 | 逃生舱，浅合并进生成的配置。冲突的键会覆盖生成值，并对每个键输出一条警告。 |
| `platform`       | `"cloudflare" \| "edgeone"` | `"cloudflare"`    | OAuth 代理的部署平台。决定生成的函数模板以及配置环境变量的控制台。         |

`collections` 条目需要 `name`、`folder` 与 `fields`；其余所有 Sveltia 集合选项（`create`、`slug`、`i18n`、集合级的 `media_folder`，……）均原样透传。

## 多语言支持（i18n）

通过 `extraConfig`（或按集合）传入 Sveltia 的 i18n 选项：

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

然后用加载器按语言加载内容：

```ts
export const collections = {
    blog_en: defineCollection({ loader: sveltiaLoader("blog", { locale: "en" }) }),
    blog_zh: defineCollection({ loader: sveltiaLoader("blog", { locale: "zh" }) }),
};
```

**注意：**

- 若 CMS 配置使用 `multiple_folders`，但忘记传入 `{ locale: "..." }`，加载器会抛出明确错误，以防加载到错误数据。
- 若某个集合在其 CMS 配置中设置了 `i18n: false`，则退出本地化，无论全局 i18n 设置如何都从根目录加载。

## 加载器的支持范围与限制

- 集合必须拥有非空的 `folder` 与 `fields` 数组。文件型集合与 `{{locale}}` 目录占位符会被拒绝。
- 当省略 `extension` 时，加载器对 YAML 使用 `yml`，JSON 使用 `json`，TOML 使用 `toml`，原始文件使用 `txt`，其余情况使用 `md`。Astro 必须为所选扩展名注册了对应的解析器；推断扩展名不会自动添加解析器。
- 基于名称的查找目前会读取集成生成的 `config.json`（位于 Astro 的 `.astro/integrations/` 目录内），路径相对于工作目录。请从站点根目录运行 Astro 并使用其默认的生成文件目录，或直接将集合对象传给加载器。
- 关系字段会被转换为 Astro 引用，前提是存储值匹配目标条目 ID，且 CMS 集合名匹配 Astro 集合键。自定义的 `value_field` 映射不会被解析。
- 不支持顶层列表 / 键值存储（`root: true`）。除 `multiple_folders` 外的其他 i18n 结构也不支持。

## 本地开发

无需特殊处理。当在 `localhost` 上打开 `/admin/` 时，Sveltia CMS 提供内置的 **Local repository**（CMS 界面中的偏好项），可在不使用 OAuth 的情况下将保存切换为本地文件系统。

## 从 0.2.x 迁移到 0.3.0

0.3.0 是一次以安全与一致性为主的发布。

| 0.2.x / 0.2.6                                      | 0.3.0                                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 令牌以 `targetOrigin:"*"` 回传给 `window.opener`   | 令牌**仅**回传给配置好的 `CMS_ORIGIN`（`https`/`localhost`）。`CMS_ORIGIN` 现已**必填**——若缺失或无效，auth 端点返回 `500`。请重新运行 `astro-sveltia-pages init` 并设置它。 |
| EdgeOne 客户端 IP 读取自 `x-forwarded-for` 回退    | EdgeOne 现在仅信任 `request.eo.clientIp`；已移除 `x-forwarded-for` 回退（它可被伪造，从而绕过限流）。                                                                        |
| 两份生成的模板（`functions/`、`edge-functions/`）  | 由 `init --platform` 生成单份自包含的 `auth.js`，并复制到对应目录。                                                                                                          |
| `astro-sveltia-pages/functions` 暴露了大量内部实现 | 顶层仅导出稳定 API（`createAuthHandler`、`onRequest`、`signState`、`verifyState`）与少量公开类型；加密 / 限流 / 探测辅助函数移至 `astro-sveltia-pages/functions/internal`。  |

升级后请重新运行 `pnpm exec astro-sveltia-pages init` 以刷新模板，并在平台控制台设置 `CMS_ORIGIN`。

## 从 0.2.x 迁移到 0.2.6

0.2.6 增加了 EdgeOne Pages 支持，并将 OAuth 运行时拆分为平台适配器层。

| 0.2.x                                 | 0.2.6                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `functions/auth.js`（手工维护的副本） | 仍是 Cloudflare 入口，但改由 `src/functions` 经 `vp run build:templates` 生成。重新运行 `pnpm exec astro-sveltia-pages init` 刷新它。     |
| —                                     | 新增：由 `astro-sveltia-pages init --platform edgeone` 创建的 `edge-functions/auth.js`（EdgeOne Pages）。                                 |
| —                                     | 新增：`platform` 选项（`"cloudflare"` \| `"edgeone"`）与 `astro-sveltia-pages/functions*` 导出。                                          |
| CSRF `state` 为随机值                 | 现在 `state` 为 `timestamp.HMAC-SHA256(timestamp, clientSecret)`，TTL 为 10 分钟，并使用定时安全比较进行校验。OAuth App 的回调 URL 不变。 |
| 无限流                                | auth 端点按客户端 IP 进行限流（每个隔离实例每分钟 30 次请求）。                                                                           |

已有的 Cloudflare 部署仍可正常工作：回调 URL 仍为 `{siteUrl}/auth`，环境变量不变。将新模板覆盖到 `functions/auth.js` 即可获得签名 state 与限流。

## 从 0.2.x 迁移到 0.2.5

0.2.5 移除了内置的 OAuth 路由与注入的 admin 页面，改为生成静态文件加一份 auth 模板。

| 0.2.x                                                              | 0.2.5                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `oauth: true/false`（Astro API 路由 `/api/auth`、`/api/callback`） | 已移除。运行 `pnpm exec astro-sveltia-pages init` 并在 Cloudflare Pages 上托管 `functions/auth.js`。         |
| `./routes/auth`、`./routes/callback`、`./admin.astro` 导出         | 已移除。无需导入任何内容；admin 界面在构建时生成。                                                           |
| `route: "/cms"`                                                    | 已移除。admin 界面始终生成于 `/admin/`。若需要旧路径，添加 `_redirects` 规则（`/cms/* /admin/:splat 301`）。 |
| `title: "..."`                                                     | 重命名为 `appTitle`。                                                                                        |
| `config: { backend, media_folder, ..., collections }`              | 拆分为顶层选项（`repo`、`branch`、`mediaFolder`，……）以及用于其余内容的 `extraConfig`。                      |
| —                                                                  | 新增：`r2` 选项生成 `media_libraries.cloudflare_r2`。                                                        |
| —                                                                  | 新增：`sveltiaVersion` 控制 CMS 脚本的 unpkg 版本。                                                          |

## 生成的 `config.yml`

第一行只是供编辑器使用的 schema 提示；Sveltia CMS 在运行时并不依赖它：

```yaml
# yaml-language-server: $schema=https://unpkg.com/@sveltia/cms/schema/sveltia-cms.json
```

生成的 `index.html` 中的 `<link rel="cms-config-url" href="/admin/config.yml">`，与 Sveltia 默认的 config 发现机制（admin 页面旁的 `config.yml`）都指向同一个文件，因此无论 CMS 版本偏好哪种机制，配置都会被正确读取。

## 开发

```bash
vp install
vp check
vp test
vp pack
```

`vp run build:templates` 会从 `src/functions` 重新生成可部署的函数模板（`templates/functions/auth.js` 与 `templates/edge-functions/auth.js`）；`vp run build` 会在打包前自动运行它。

使用 `vp run format` 格式化代码，`vp run format:check` 校验格式。
格式器配置及不支持的规则见 [Code style](docs/code-style.md)。

完整的 Astro 配置示例见 `example` 目录。

# astro-sveltia-pages

[English](README.md) | 中文文档

Sveltia CMS 与 Astro 深度集成，**无需手写任何 CMS 配置**。专为 Cloudflare Pages 与 EdgeOne Pages 打造。

- **一个配置对象 → 一套 CMS 后台。** 只需一次 `sveltia({ ... })` 调用，即可在构建产物中生成 `/admin/index.html` 与 `/admin/config.yml`。
- **外部媒体库。** 自动配置 Sveltia 的 Cloudflare R2 外部媒体库，密钥在 CMS 界面中输入（绝不写入磁盘）。
- **生产级 OAuth。** 直接提供真实部署所用的 GitHub OAuth 边缘函数，同时支持 Cloudflare Pages（`functions/auth.js`）与 EdgeOne Pages（`edge-functions/auth.js`），并附带一键 `init` 命令完成接入。
- **带类型的 Content Loader。** `astro-sveltia-pages/loader` 读取生成的配置，自动生成 Zod schema 加载内容。

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [构建产物](#构建产物)
- [配置](#配置)
    - [配置项参考](#配置项参考)
    - [身份认证（GitHub OAuth）](#身份认证github-oauth)
    - [Cloudflare R2 媒体存储](#cloudflare-r2-媒体存储)
- [Content Loader](#content-loader)
- [使用指南](#使用指南)
    - [多语言（i18n）](#多语言i18n)
    - [自动翻译（i18n-translate）](#自动翻译i18n-translate)
    - [只读模式](#只读模式)
    - [单文件配置（singletons）](#单文件配置singletons)
    - [其他已提升的配置项](#其他已提升的配置项)
- [生成的 `config.yml`](#生成的-configyml)
- [本地开发](#本地开发)
- [许可证](#许可证)

## 安装

```bash
pnpm add astro-sveltia-pages
```

> **⚠️ 升级必读（每次升级都要看）** —— 如果你启用了 i18n 自动翻译，**每次升级本包后，都必须在每一个站点仓库重跑
> `pnpm exec astro-sveltia-pages init:i18n`**。`.github/workflows/i18n-translate.yml`、
> `i18n/glossary.md`、`scripts/remap-translations.sh` 是提交进仓库的生成快照，`pnpm up` **不会**替换它们。
> 只升级依赖却继续跑旧 workflow，会导致翻译静默失败，而且极难排查。
>
> - 立即修复：`pnpm exec astro-sveltia-pages init:i18n`（自动升级旧文件，并保留 `*.bak` 备份）
> - CI 门禁：`pnpm exec astro-sveltia-pages init:i18n --check`
> - 自 0.3.6 起，生成的 workflow 会在 **CI 内**把自身模板版本与 lockfile 中实际
>   安装的包版本比对，不一致立即失败并给出修复命令。
> - 自 0.3.5 起，`astro dev` / `astro build` 检测到过期模板时会主动打印醒目警告；
>   给集成传 `i18nTemplateCheck: "error"` 可改为直接让构建失败，传 `"off"` 则关闭。

## 快速开始

在 `astro.config.mjs` 中注册集成：

```js
import { defineConfig } from "astro/config";
import sveltia from "astro-sveltia-pages";

export default defineConfig({
    site: "https://example.com", // 未传 siteUrl 时用作 CMS base_url
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

在 `src/content.config.ts` 中用配套 loader 加载内容：

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

const posts = defineCollection({ loader: sveltiaLoader("posts") });

export const collections = { posts };
```

## 构建产物

执行 `astro build` 时，CMS 完全由你的配置项生成 —— 你无需手动编辑 Sveltia 配置：

```bash
astro build
# dist/admin/index.html   — CMS 界面（从 unpkg 加载 Sveltia）
# dist/admin/config.yml   — 生成的 CMS 配置
```

访问 `<你的站点>/admin/` 即可使用 CMS。

## 配置

所有配置都写在 `sveltia({ ... })` 的配置对象里。集成会把它转换成一份完整的 Sveltia `config.yml`。

### 配置项参考

| 配置项              | 类型                        | 默认值                 | 说明                                                                                            |
| ------------------- | --------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `repo`              | `string`                    | —                      | GitHub 仓库，格式 `owner/name`。必填。                                                          |
| `branch`            | `string`                    | `"main"`               | CMS 提交更改的分支。                                                                            |
| `siteUrl`           | `string`                    | Astro `site`           | 用作 CMS `base_url` 的源站地址。两者都未设置时构建会失败。                                      |
| `collections`       | `SveltiaCollection[]`       | —                      | 1:1 映射到 CMS 配置。必填。                                                                     |
| `r2`                | `object`                    | —                      | Cloudflare R2 外部媒体库（见[媒体存储](#cloudflare-r2-媒体存储)）。                             |
| `mediaFolder`       | `string`                    | `"public/images"`      | CMS `media_folder`。                                                                            |
| `publicFolder`      | `string`                    | `"/images"`            | CMS `public_folder`。                                                                           |
| `appTitle`          | `string`                    | `"Sveltia CMS"`        | 浏览器标签 / 登录页标题。                                                                       |
| `logo`              | `{ src, ... }`              | —                      | CMS 徽标，转发为 `logo`。                                                                       |
| `backendName`       | `string`                    | `"github"`             | Git 后端名称。                                                                                  |
| `sveltiaVersion`    | `string`                    | `"0.256.1"`            | 从 unpkg 加载的 Sveltia 版本，**已锁定**以保证可复现（此前为 `"latest"`）。仅在有意升级时覆盖。 |
| `extraConfig`       | `object`                    | —                      | 逃生通道，浅合并进生成的配置。与生成值冲突的键会覆盖生成值，并对每个冲突键输出一条警告。        |
| `platform`          | `"cloudflare" \| "edgeone"` | `"cloudflare"`         | OAuth 代理的部署平台。决定函数模板以及配置环境变量的后台。                                      |
| `singletons`        | `unknown[]`                 | —                      | 单文件配置，转发为 `singletons`。                                                               |
| `assetCollections`  | `unknown[]`                 | —                      | 资产集合，转发为 `asset_collections`。                                                          |
| `i18n`              | `object`                    | —                      | 全局 i18n 选项，转发为 `i18n`。                                                                 |
| `readonly`          | `boolean`                   | `false`                | 将整个 CMS 设为只读，转发为 `readonly`。                                                        |
| `showPreviewLinks`  | `boolean`                   | —（Sveltia：`true`）   | 是否显示线上 / 预览环境链接；**仅在设置时**转发为 `show_preview_links`。                        |
| `displayUrl`        | `string`                    | —                      | UI 中跳转的地址，转发为 `display_url`。                                                         |
| `logoutRedirectUrl` | `string`                    | —                      | 登出后跳转地址，转发为 `logout_redirect_url`。                                                  |
| `editor`            | `object`                    | —                      | 编辑器视图选项，转发为 `editor`。                                                               |
| `publishMode`       | `string \| object`          | —（Sveltia：`simple`） | 发布模式，**仅在设置时**转发为 `publish_mode`。                                                 |
| `fieldDefaults`     | `object`                    | —                      | 字段默认选项，转发为 `field_defaults`。                                                         |
| `output`            | `object`                    | —                      | 数据输出选项，转发为 `output`。                                                                 |
| `slug`              | `object`                    | —                      | 条目与资产的 slug 选项，转发为 `slug`。                                                         |
| `logoUrl`           | `string`                    | —                      | 入口页 / favicon 徽标地址，转发为 `logo_url`。                                                  |

`collections` 条目必须包含 `name`、`folder` 和 `fields`；其余所有 Sveltia 集合选项（`create`、集合级 `slug`、`i18n`、`media_folder` 等）原样透传。

**已提升的配置项。** `platform` 行以下的 13 个配置项此前只能通过 `extraConfig` 设置。现在它们成为一等公民，经过类型校验，并转发到对应的 Sveltia 配置键。**仅当你设置时才会输出** —— 集成不会覆盖 Sveltia 自身的默认值，因此默认值列中的 `—` 表示"不输出，使用 Sveltia 默认值"。`extraConfig` 依然可用，并能覆盖其中任意一项（每个冲突键输出一条警告）。

**0.3.1 移除：** 集成层的 `locale` 配置项已被删除。Sveltia 没有 `locale` 配置键（该值此前被静默忽略），CMS 界面语言跟随浏览器。**Loader** 上的 `locale` 参数 —— `sveltiaLoader(name, { locale })` —— 与此无关，予以保留。

### 身份认证（GitHub OAuth）

本包不自行托管 OAuth 端点，而是直接提供真实部署所用的边缘函数。OAuth 逻辑（state 签名、令牌交换、`postMessage` 回传）与平台无关，只有运行时访问器不同，因此同一套实现可在 Cloudflare Pages 与 EdgeOne Pages 上运行。

> **安全说明：** 自 0.3.0 起，GitHub 令牌**仅**回传至配置的 `CMS_ORIGIN`（`https`，本地开发可为 `http://localhost`）—— 绝不会回传至 `"*"`。打开认证弹窗的攻击页面无法接收该令牌。接收方 CMS 仍须校验 `event.origin === CMS_ORIGIN`。`CMS_ORIGIN` 为**必填**项；缺失或无效时认证端点返回 `500`。

#### Cloudflare Pages

1. 在项目根目录执行 init 命令：

    ```bash
    pnpm exec astro-sveltia-pages init --site-url https://example.com
    ```

    该命令会：

    - 将 OAuth 模板复制到 `functions/auth.js`（若文件已存在则绝不覆盖，并以非零状态退出并提示）；
    - 向 `.env.example` 追加 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`ENVIRONMENT` 和 `SITE_URL`（已存在的键会被跳过，绝不重复）；
    - 打印 GitHub OAuth App 的创建步骤以及所需的回调地址（`{siteUrl}/auth`）。

2. 在 <https://github.com/settings/developers> 创建 GitHub OAuth App，授权回调地址填 `{siteUrl}/auth`。

3. 在 **Cloudflare Pages 后台**（Settings → Environment variables）配置环境变量：

    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production`（将 OAuth CORS 源收紧为你的站点）
    - `SITE_URL`（生产站点的完整源站，如 `https://example.com`；认证函数优先使用它而非请求来源，使 OAuth 源站在自定义域名、`*.pages.dev` 预览域名和本地 `wrangler pages dev` 间保持一致）
    - `CMS_ORIGIN`（**自 0.3.0 起必填**）—— 令牌回传的目标源站，如 `https://example.com`。必须为 `https`（本地开发可为 `http://localhost`）。这是唯一允许的 `postMessage` 目标源；接收方仍须校验 `event.origin === CMS_ORIGIN`。

4. 重新部署。CMS 登录按钮现在使用 GitHub OAuth；Sveltia 通过 `authorization:github:success:` 的 postMessage（以及 `#access_token=` 回退）接收令牌。生成的配置使用 `base_url: {siteUrl}` 和 `auth_endpoint: auth`，即由 `functions/auth.js` 提供的路由。

#### EdgeOne Pages

EdgeOne Pages 的部署流程相同，只有两处差异：函数位于 `edge-functions/`，环境变量在 EdgeOne 后台配置。

1. 带平台参数执行 init 命令：

    ```bash
    pnpm exec astro-sveltia-pages init --platform edgeone --site-url https://example.com
    ```

    该命令将 EdgeOne 模板复制到 `edge-functions/auth.js`，并向 `.env.example` 写入同样的四个变量。默认平台为 `cloudflare`，因此 `--platform cloudflare`（或不带参数）保持原有行为。

2. 在 <https://github.com/settings/developers> 创建 GitHub OAuth App，授权回调地址填 **EdgeOne 域名**：`https://{your-edgeone-domain}/auth`。

3. 在 **EdgeOne Pages 后台**（Project settings → Environment variables）配置环境变量：

    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ENVIRONMENT=production`
    - `SITE_URL`（生产站点的完整源站，如 `https://example.com`）
    - `CMS_ORIGIN`（**自 0.3.0 起必填**）—— 含义见 Cloudflare 小节；它是唯一允许的 `postMessage` 目标源。

    EdgeOne 边缘函数从运行时 `env` 对象读取这些变量，因此由平台注入 —— 不要把它们内联进打包产物。

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

5. 重新部署。CMS 登录按钮的使用方式与 Cloudflare Pages 完全一致。

#### 与 Cloudflare Pages 部署的差异

| 主题         | Cloudflare Pages                           | EdgeOne Pages                                                      |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| 函数目录     | `functions/auth.js`                        | `edge-functions/auth.js`                                           |
| 入口         | `export async function onRequest(context)` | `export async function onRequest({ request, env })`（+ `default`） |
| 环境变量     | `context.env`                              | `context.env`，回退到全局 `env` 对象                               |
| 客户端 IP    | `CF-Connecting-IP` 请求头                  | 仅 `request.eo.clientIp`（无请求头回退；缺失时为 unknown）         |
| 限流         | 每隔离环境、内存级、尽力而为               | 每隔离环境、内存级、尽力而为                                       |
| Astro 适配器 | `@astrojs/cloudflare`                      | `@edgeone/astro`                                                   |

两个平台都**按隔离环境**对认证端点限流：计数器存在于处理该请求的单个隔离环境的内存中，因此限流为尽力而为，当请求落到另一个隔离环境时计数器会重置。客户端 IP 仅用作限流键 —— 当平台隐藏它时，适配器回退为 `unknown`，此类请求共享同一个桶。

若 EdgeOne 上无法确定 IP，限流便会退化为针对这些请求的全局限流。请保持 `ENVIRONMENT=production`，使 CORS 预检只应答你自己的源站。

#### 自行托管认证端点

平台适配器与 OAuth 处理器均由本包导出，因此你可以自行托管认证端点：

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

`astro-sveltia-pages/functions`（稳定 API）导出 `createAuthHandler()`、`signState()`、`verifyState()` 以及 `PlatformAdapter` 类型。传入 `platform: "cloudflare" | "edgeone" | "auto"` 可固定或按请求自动检测平台。

更底层的组成部分 —— 平台适配器（`cloudflareAdapter`、`edgeoneAdapter`、`autoAdapter`、`detectAdapter`）、加密辅助函数（`hmacSha256Hex`、`timingSafeEqual`）、`createRateLimiter()` 与 `normalizeContext()` —— 位于 `astro-sveltia-pages/functions/internal`。它们**不属于**稳定 API，可能在任意版本中变动；仅当你需要构建自定义适配器或处理器时才导入它们。

### Cloudflare R2 媒体存储

传入 `r2` 配置项以生成 Sveltia 的外部媒体库配置（`media_libraries.cloudflare_r2`）。四个字段均为必填，并在启动时校验：

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

> **重要安全说明：**
> R2 **密钥（Secret Access Key）绝不会写入配置**。Sveltia CMS 会在用户首次访问媒体库时提示其在 CMS 界面中输入，且仅存储于浏览器本地存储。

需额外手动完成的配置（此处说明，不由生成器处理）：

- **R2 CORS**：在 Cloudflare 后台（bucket → Settings → CORS policy）允许你的站点源站，针对 `GET`、`PUT`、`DELETE`、`OPTIONS` 方法，并携带 `authorization` 与 `content-type` 请求头。
- **`publicUrl`** 必须可公开访问：使用 bucket 的 `r2.dev` 开发地址，或为该 bucket 绑定自定义域名。

若你的主机发送严格的 `Content-Security-Policy`，至少为 `/admin/*` 放行以下内容（本包**不会**生成响应头）：

- 脚本：`unpkg.com`（若更换 CDN 则为 `cdn.jsdelivr.net`）
- 连接：`api.github.com`、`github.com`、`raw.githubusercontent.com`、你的 R2 公开域名、`unpkg.com`
- 图片：`data:`、`blob:`、`https:`（媒体预览）

## Content Loader

`astro-sveltia-pages/loader` 将你的 CMS 内容加载进 Astro，并自动生成 Zod schema，无需手写 schema 即可获得类型安全的条目。

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

export const collections = {
    posts: defineCollection({ loader: sveltiaLoader("posts") }),
};
```

也可以直接传入集合对象而非名称：

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

**基于名称的查找** 会读取集成生成的 `config.json`（位于 Astro 的 `.astro/integrations/` 目录），相对于工作目录解析。请从站点根目录运行 Astro 并使用其默认的生成文件目录，或直接向 loader 传入集合对象。

**限制：**

- 集合必须包含非空的 `folder` 和 `fields` 数组。不支持基于文件的集合与 `{{locale}}` 文件夹占位符。
- 省略 `extension` 时，loader 对 YAML 使用 `yml`、JSON 使用 `json`、TOML 使用 `toml`、原始文件使用 `txt`，其余使用 `md`。Astro 必须为所选扩展名注册条目解析器；推断扩展名不会自动添加解析器。
- 关联（relations）被转换为 Astro 引用，前提是存储值与目标条目 ID 匹配且 CMS 集合名称与 Astro 集合键匹配。不会解析自定义的 `value_field` 映射。
- 不支持顶层列表 / 键值存储（`root: true`）。除 `multiple_folders` 之外的 i18n 结构均不支持。

## 使用指南

### 多语言（i18n）

通过 `i18n` 配置项（或 `extraConfig`，或集合级）传入 Sveltia 的 i18n 选项：

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

然后按语言用 loader 加载内容：

```ts
export const collections = {
    blog_en: defineCollection({ loader: sveltiaLoader("blog", { locale: "en" }) }),
    blog_zh: defineCollection({ loader: sveltiaLoader("blog", { locale: "zh" }) }),
};
```

**注意：**

- 若 CMS 配置使用 `multiple_folders`，但你忘记传 `{ locale: "..." }`，loader 会显式抛出错误，防止加载错误数据。
- 若某个集合在 CMS 配置中设置了 `i18n: false`，它会退出本地化，无论全局 i18n 设置如何都从根文件夹加载。

### 自动翻译（i18n-translate）

当 CMS 只维护英文源文件（见下方的 Sveltia 设置）后，即可让 CI 自动翻译其它所有语言。本包内置一套基于
[`pelikhan/action-continuous-translation`](https://github.com/pelikhan/action-continuous-translation)（由 DeepSeek 驱动）的现成工作流，外加术语表与回写脚本；`init:i18n` 命令可一键接入，无需手工改路径。

1.  在项目根目录运行：

        ```bash
        pnpm exec astro-sveltia-pages init:i18n
        ```

        它会自动探测 `sveltia-cms.config.mjs`（可用 `--config <path>` 覆盖），读取
        `i18n.default_locale`、`i18n.locales` 与 `i18n.structure`，填充模板占位符，
        并写出三份文件（0.4.0 起**不再解析集合**，是否翻译由每篇 md 的 frontmatter 决定）：

        - `.github/workflows/i18n-translate.yml`
        - `i18n/glossary.md`
        - `scripts/remap-translations.sh`

        可用参数：

        - `--content-root <path>` — 内容根目录（默认 `src/content`）
        - `--default-locale <lang>` — 源语言（默认 `en`）
        - `--project-name <name>` — 用于术语表标题
        - `--force` — 覆盖已存在的文件
        - `--check` — 只校验生成文件是否为最新版本（过期则非零退出，可用于 CI）

        成功执行时**绝不会没有输出**：每份文件会打印一行 `已写入 …`（或
        `⬆ 已升级 …`），随后输出 `i18n 自动翻译已初始化（模板 …，源语言 … → …）`
        摘要与后续配置清单。`--check` 会打印 `✅ i18n 模板均为最新版本 …`（退出码 0）
        或 `STALE i18n TEMPLATES` 提示（退出码 1）。未知子命令会输出
        `Unknown command: <name>` 并以退出码 1 结束；`--help` 列出全部命令。
        如果命令**完全没有输出**，说明 CLI 根本没有执行。0.3.6 及更早版本在 pnpm
        下会触发此问题，请升级到 0.3.7+；临时可改用
        `node node_modules/astro-sveltia-pages/dist/cli.mjs init:i18n`。

        生成的文件都带版本标记。重跑 `init:i18n` 会**自动升级**过期的生成文件
        （原文件备份为 `*.bak`）；供用户编辑的 `i18n/glossary.md` 不会自动覆盖。
        `--force` 会强制覆盖全部文件。

> ⚠️ **每次升级 `astro-sveltia-pages` 后都必须重跑 `init:i18n`。** 这三份文件是提交进你仓库的生成快照，
> 只升级依赖**不会**更新它们，工作流会继续跑旧版（可能是有 bug 的）文件。自 0.3.5 起集成会在
> `astro dev` / `astro build` 时主动告警；自 0.3.6 起 workflow 会在 CI 内自检模板版本，不一致直接失败。
> 可在 CI 中加入 `pnpm exec astro-sveltia-pages init:i18n --check` 自动拦截过期模板
> （或设置 `i18nTemplateCheck: "error"`）。

2.  在仓库添加 GitHub Secret（**Settings → Secrets and variables → Actions → New repository secret**）：

    - `DEEPSEEK_API_KEY` — DeepSeek API Key（`sk-…` 开头），申请地址
      <https://platform.deepseek.com>。端点由 `env.OPENAI_API_BASE` 配置
      （默认 `https://api.deepseek.com`），模型由 `env.TRANSLATION_MODEL` 配置
      （默认 `deepseek-flash`，旧名 `deepseek-v4-flash` 已退役）。
      翻译步骤会把 Key 注入为 `OPENAI_API_KEY`、把模型注入为
      `GENAISCRIPT_MODEL_TRANSLATION` / `GENAISCRIPT_MODEL_VALIDATION`——这些
      变量名是 GenAIScript 硬性要求的；只写 action 的 `with:` 输入
      （`openai_api_key` / `model_alias`）会静默回退到 `github:openai/gpt-4o`，
      导致一篇译文都产不出（0.4.1 已修）。翻译前还有
      **Preflight translation credentials** 步骤校验 Key 并打印可用模型列表。

        **0.4.2 起**：翻译先做一次非致命校验；若个别语言因为模型没按
        ` ```Tnnn ` 代码围栏输出而缺译文，工作流会清掉坏缓存、只对这些语言
        干净重试一次。重试后仍缺失时按 `ALLOW_PARTIAL_TRANSLATIONS`（默认
        `"true"`）告警并发布已成功的语言，不会因为 1 个语言失败丢掉其余 14 个；
        设 `"false"` 可恢复「缺一即失败」的严格模式。落盘后还会用
        **Verify destination layout** 校验译文确实位于
        `<content-root>/<collection>/<lang>/<slug>.md`（例如
        `src/content/blog/fr/<slug>.md`）。

        **翻译缓存（0.4.4 起）**：`i18n-translations/<lang>.json` 是「源片段 → 译文」
        字典，源文本没变就不调用模型、不重复计费。它同时存在三处：run 内工作目录、
        GitHub Actions cache、以及 `if: always()` 上传的 artifact
        `translation-logs-<run_id>-<shard>`（发布失败也一定在，默认保留 90 天）。
        0.4.4 把缓存拆成 `actions/cache/restore@v4` + `actions/cache/save@v4`，
        **发布失败也保存缓存**，重跑不必重新付费调用模型。若日志开头是
        `Cache not found`、结尾没有 `Cache saved`，就到该 run 页面下载 artifact，
        把 `*.json` 放回 `i18n-translations/` 再重跑即可恢复。
        Actions cache 7 天未访问会被清理、总配额 10GB 按 LRU 淘汰；只有需要永久
        留存才把该目录提交进仓库（默认不建议，每次翻译会多出 15 个 JSON 的 diff）。

3.  给 Sveltia CMS 的**每个集合**加一个「自动翻译」开关（并写进 `_template.md`，
    让新建文章默认关闭）：

    ```js
    { label: '自动翻译', name: 'autoTranslate', widget: 'boolean',
      default: false, i18n: 'duplicate' }
    ```

    **开关语义（0.4.0 起）**：

    - EN 文件 frontmatter 里 `autoTranslate: true` → 送翻，并覆盖全部目标语言译文；
    - 不写 / `false` → 普通修改，CI 完全不碰这篇文章；
    - 修改其它语言版本（`fr` / `de` / …）的文件 → 永远不触发工作流，后台可随意改。

    工作流用 `on.push.paths: <content-root>/**/en/**` 一条通配覆盖所有集合，
    不再按集合区分，所以产品、博客、页面一视同仁。不可翻译字段（`slug`、
    图片路径等）仍标记 `i18n: duplicate`，backend **不要**设置 `skip_ci: true`。

    > **删除文章（0.4.3 起）**：`on.push.paths` 对删除的文件同样匹配，所以删掉
    > 一篇 EN 文章也会启动工作流。detect 会先过滤掉已不存在的路径，translate /
    > publish 显示 Skipped，不会再出现「源文件不存在」的假失败与误报 issue。
    > 但删除 EN 源文件**不会**自动删除其它语言目录下已发布的译文；要彻底移除
    > 文章，请连同各语言目录里的同名 md 一起提交删除。

    > **保护人工译文**：默认 `OVERWRITE_MODE: "all"`，开关打开的文章每次 EN
    > 变更都会重新生成并覆盖全部译文。若要保留后台改过的译文，把工作流里的
    > `OVERWRITE_MODE` 改为 `"missing"`（只补写尚不存在的译文），或在某个译文
    > 文件的 frontmatter 里加 `translateLock: true`（该语言版本永不覆盖）。

4.  ⚠️ **提交信息规则（重要）：** 提交信息里绝对不能出现方括号包裹的 CI 跳过标记，如 `[skip ci]` / `[ci skip]` / `skip-checks`。在 GitHub Actions + Cloudflare Pages 上，这类标记会让整次 push 的工作流 **和** Cloudflare 部署一起被跳过，导致翻译推送（或任何部署）静默不执行。

5.  向 `main` 推送一个**打开了 `autoTranslate: true`** 的 EN 文件（例如 `src/content/blog/en/my-post.md`）即会触发 `i18n-translate`：它会把变更翻译成全部目标语言，自检通过后提交回 `main`（`PUBLISH_MODE: "commit"`）。没打开开关的 EN 变更只是普通修改，detect 会打印跳过原因、`translate` / `publish` 显示 Skipped。若想保留人工合并闸门，可在生成的工作流中把 `PUBLISH_MODE` 改为 `"pr"`。英文源会立即上线，其余语言在同一次后续提交中一起发布。自 0.3.5 起，若一篇译文都没产出，工作流会**显式失败并自动建 issue**，不再出现"全绿但没翻译"。

> **增量与存量回填：** 工作流通过 `actions/cache` 缓存 pelikhan 的逐语言翻译缓存（`i18n-translations/<lang>.json`），重跑只会重新翻译发生变化的节点 —— 这省的是 API 调用，**写回时仍是整篇重新生成**。pelikhan 并不读取已存在的译文 Markdown，因此 `OVERWRITE_MODE: "all"` 下人工修改过的译文会被覆盖（用 `translateLock: true` 或 `"missing"` 模式保护）。若要为已填充的存量站点引导翻译，先给目标 EN 文件打开 `autoTranslate: true`，再手动运行工作流（`workflow_dispatch`），勾选 `force` 并填写 `scope` 正则（如 `posts`）分批回填；只有打开开关的文件会进入清单。

### 只读模式

在部署、内容迁移或故障处理期间将 CMS 切换为只读。编辑者仍可浏览和搜索，但保存与发布被禁用：

```js
sveltia({
    repo: "my-org/my-site",
    readonly: true,
    collections: [
        /* ... */
    ],
});
```

`readonly` 映射到 Sveltia 顶层的 `readonly` 标志；默认值为 `false`。维护结束后改回 `false` 即可。

### 单文件配置（singletons）

使用 `singletons` 表示非列表形式的单文件配置页（站点设置、导航、SEO 等）。每个 singleton 指向一个文件，并转发到 Sveltia 的 `singletons` 键：

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

声明后的 `singletons` 原样出现在生成的 `config.yml` 中，在 CMS 里表现为单条目的设置页。该配置项原样透传；完整字段结构请参考 Sveltia 的 `singletons` 文档。

### 其他已提升的配置项

其余已提升的配置项会原样转发到对应的 Sveltia 配置键。常见形态如下：

```js
sveltia({
    repo: "my-org/my-site",
    assetCollections: [{ name: "images", label: "Images", folder: "src/assets" }],
    editor: { preview: false },
    publishMode: "editorial_workflow", // 或 { mode: "editorial_workflow" }
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

每一项仅在设置时输出；各项映射到的具体 Sveltia 键见[配置项参考](#配置项参考)。

## 生成的 `config.yml`

首行仅是编辑器用的 schema 提示；Sveltia CMS 运行时不依赖它：

```yaml
# yaml-language-server: $schema=https://unpkg.com/@sveltia/cms/schema/sveltia-cms.json
```

生成的 `index.html` 中的 `<link rel="cms-config-url" href="/admin/config.yml">`，与 Sveltia 默认的配置文件发现机制（后台页同级的 `config.yml`），都解析到同一文件，因此无论 CMS 版本偏好哪种机制，配置都能被正确加载。

## 本地开发

```bash
vp install
vp check
vp test
vp pack
```

`vp run build:templates` 从 `src/functions` 重新生成可部署的函数模板（`templates/functions/auth.js` 与 `templates/edge-functions/auth.js`），并把 i18n 工作流模板从 `templates/i18n/` 复制到 `dist/templates/i18n/`；`vp run build` 会在打包前执行它。

使用 `vp run format` 格式化代码，使用 `vp run format:check` 校验格式。格式化器配置与不支持的规则见[代码风格](docs/code-style.md)。

完整 Astro 示例见 `example` 目录。

## 许可证

MIT —— 分叉自 Johannes Knoll 的 [`astro-loader-sveltia-cms`](https://github.com/joknoll/astro-loader-sveltia-cms)。

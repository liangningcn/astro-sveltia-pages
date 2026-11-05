# 更新日志

本项目的所有重要变更记录于此，遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

English documentation: [CHANGELOG.md](CHANGELOG.md).

各版本之间的升级指引见每项的 **迁移** 小节。

---

## 0.3.5

内置 i18n 翻译工作流的紧急修复版本。0.3.4 虽然加入了绕过上游文件过滤的暂存方案，但从未在真实 CI 中验证过；多项缺陷导致**即使重新生成工作流也可能一篇译文都产不出来**。

### 修复

- **暂存目录是隐藏目录。** 0.3.4 使用 `.i18n-staging`（以点开头）。GenAIScript 的文件 glob 默认忽略点目录，导致 `pelikhan/action-continuous-translation` 拿不到任何文件，报 `No files or not matching languages selected.`。现改为普通目录 `i18n-staging/`，并在翻译前增加自检：暂存路径若含两位语言码目录段或 `.{lang}.md` 文件名后缀，直接报错。
- **Docker root 权限。** 翻译 Action 以 root 运行并创建 `.genaiscript/`，随后的 `mkdir -p .genaiscript/cache` 报 `mkdir: Permission denied`，直接让 translate job 失败。现在用 `sudo chown` 收回所有生成目录的归属权，清理步骤带 `sudo` 兜底，宿主侧不再执行任何 `mkdir`。
- **"全绿但零译文"的静默失败。** `genaiscript: cancelled` 退出码为 0，此前整条流水线会显示成功。新增 `Verify translations were produced` 步骤，逐个断言（源文件 × 目标语言）译文存在且非空；`Fail when no translations were published` 闸门会让 publish job 显式失败。失败仍自动建 issue，并附带可操作的排查清单。
- **`remap-translations.sh` 对未跟踪的暂存文件使用 `git mv`**，会报 `not under version control`。现改为普通 `mv`（由工作流的 `git add -A` 负责纳入版本控制），通过 `.sources` 清单排除英文源，用 `TARGET_LANGS` 白名单而非宽松正则校验语言，并在零映射时失败。
- **翻译缓存路径错误。** 旧模板缓存 `.genaiscript/cache`，而 pelikhan 的增量缓存实际写在 `<translations_dir>/<lang>.json`。现显式设置 `translations_dir: i18n-translations` 并缓存该目录。
- **上游 Action 未固定 / 模型已退役。** `pelikhan/...@v0` 固定为 `@v0.2.11`；显式设置 `filename_template`，避免 remap 与上游默认值漂移。模型 id 改为 `deepseek-flash`（DeepSeek 已让 `deepseek-v4-flash` 退役）。
- **`init:i18n` 语言解析错误。** 对象形式的正则 `/locale:/` 会误匹配 `default_locale: "en"` 的尾部，导致数组形式 `locales: ["en","fr"]` 只解析出 `["en"]`，命令报错"没有可翻译的目标语言"。CLI 与工作流校验脚本现都要求词边界，且只匹配独立的 `locales:` 键。
- **生成工作流的 detect 步骤**在读取 frontmatter 前未确认文件存在，遇到"仅删除文件"的 push 会因 `sh()` 报错而崩溃。现补上 `fs.existsSync` 守卫。
- **预拷已有译文会让失败闸门失效。** 暂存步骤原本会把已有译文复制进暂存目录；但 pelikhan 从不读取目标译文 Markdown（增量状态在 `translations_dir/<lang>.json` 里），这些旧文件会让 `Verify translations were produced` 在"本次一篇都没产出"时依然通过，重新制造静默成功。现在暂存目录只放英文源。
- **带大写区域码的语言码。** pelikhan 用 `to.toLowerCase()` 渲染 `{{lang}}`，所以 `zh-CN` 实际产出 `{slug}.zh-cn.md`；而校验与 `remap-translations.sh` 用的是 `TARGET_LANGS` 原始大小写，会找不到文件。现在两处比对统一转小写，remap 在写入 `multiple_folders` 目录时再把语言码映射回 Sveltia 配置里的原始写法。

### 新增

- **生成文件版本标记与升级检测。** 三份生成文件都带 `astro-sveltia-pages i18n template vX.Y.Z` 标记。重跑 `init:i18n` 会**自动升级**过期的生成文件（旧文件备份为 `*.bak`），而不是静默跳过；供用户编辑的 `i18n/glossary.md` 永不自动覆盖。这修复了"包升级了但翻译还是坏"的根本原因——消费方仓库里的 workflow 是提交进 git 的生成快照，升级依赖不会替换它。
- **`init:i18n --check`** — CI 门禁：任一生成文件缺失或过期即以非零码退出。
- `check:templates` 现在断言 0.3.5 的所有修复点仍在，并拒绝已知的 0.3.4 破坏性写法（隐藏暂存目录、退役模型 id、宿主侧 `.genaiscript` mkdir）。
- **构建时升级告警。** `astro dev` / `astro build` 会比对已安装包的版本与三份已提交 i18n 文件的版本标记，过期时打印醒目提示。这正是 `pnpm up` 之后使用者必然会执行的命令，提示不再只躺在 README 里。新增集成选项 `i18nTemplateCheck: "warn" | "error" | "off"`（默认 `warn`），`"error"` 可直接让构建失败、兼作 CI 门禁；未启用 i18n 时完全静默。
- **工作流自报版本。** 每次运行都会打印本文件由哪个模板版本生成（`Report i18n template version`），Actions 日志里一眼就能看出是否还在跑旧版。`init:i18n --check` 现在输出同一份标准提示与确切的修复命令，不再是笼统报错。
- **统一使用 pnpm 命令。** 所有面向使用者的示例、生成文件头注释与 CLI 输出统一为 `pnpm exec astro-sveltia-pages ...`。

### 迁移（从 0.3.4）

- **在每一个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n`，这是必须步骤。** 只升级依赖不会替换已提交的 `.github/workflows/i18n-translate.yml`、`i18n/glossary.md`、`scripts/remap-translations.sh`。该命令会检测旧文件、自动升级，并保留 `*.bak` 备份供核对（确认无误后删除或加入 `.gitignore`）。
- 可选：在 CI 中加入 `pnpm exec astro-sveltia-pages init:i18n --check`，防止今后再出现"包升级了、模板没跟上"。
- CMS 配置无需改动。提交信息仍须避免方括号包裹的 CI 跳过标记（`[skip ci]` 等）。

---

## 0.3.4

### 新增

- 将 i18n 自动翻译工作流产品化，消费方不再需要手工复制文件。三份产物
  （`.github/workflows/i18n-translate.yml`、`i18n/glossary.md`、
  `scripts/remap-translations.sh`）现作为模板存放于 `templates/i18n/`，并由
  `vp run build:templates` 复制到 `dist/templates/i18n/`，从而随 npm 包一起发布。
- 新增 `init:i18n` CLI 命令（亦可写作 `init --i18n`）。它会读取消费方的 Sveltia CMS
  配置（默认 `sveltia-cms.config.mjs`，可用 `--config` 覆盖），提取
  `i18n.default_locale`、`i18n.locales`（同时支持 `["en","fr"]` 与
  `[{locale:"en"}]` 两种写法）以及各集合的 `folder`，自动填充模板占位符
  （`__CONTENT_ROOT__`、`__COLLECTION_EN_PATH__`、`__TARGET_LANGS__`、
  `__CONFIG_FILE__`、`__SKIP_COLLECTIONS__`、`__I18N_STRUCTURE__`、
  `__PROJECT_NAME__`），并写出三份文件。已存在文件默认跳过，除非传入 `--force`；命令还会打印所需的
  `DEEPSEEK_API_KEY` Secret 与强制的 Sveltia CMS 配置要求。
- 修复了内置工作流中 `pelikhan/action-continuous-translation` 的兼容性 bug：该 Action
  会静默丢弃路径中含两位语言目录（如 `/en/`）或文件名带 `.{lang}.` 后缀的文件，导致
  Sveltia `multiple_folders` 的英文源被过滤掉（“No files or not matching languages
  selected”）。工作流现改为在翻译前把英文源暂存到扁平的 `.i18n-staging/` 目录（无
  `/xx/` 语言段），并植入已有译文以支持增量复用，再由 `remap-translations.sh` 回写为
  `multiple_folders` 结构。
- 文档新增硬性要求：提交信息中绝不出现方括号包裹的 CI 跳过标记（`[skip ci]`、`[ci skip]`
  等）。在 GitHub Actions + Cloudflare Pages 上，此类标记会跳过整次 push 的工作流
  **以及** Cloudflare 部署。

### 变更

- `check:templates` 现会在打包前校验每个 i18n 模板仍包含所需的占位符。

---

## 0.3.3

维护版本，整合了 0.3.2 之后对 i18n 翻译工作流的加固，并钉定正确的 DeepSeek 模型别名：

- 钉定 `model_alias: "translation: openai:deepseek-v4-flash"`，并补充了 `DEEPSEEK_API_KEY`
  Secret 与 DeepSeek OpenAI 兼容端点的文档。
- 变更检测现在会跳过草稿条目（`draft: true`）与模板文件，并保留人工润色的已有译文
  （仅更新英文源发生变动的段落）。
- 新增可在 CMS 内开关的 `autoTranslate` 字段，以及 `workflow_dispatch` 的 `scope` 输入，
  用于对存量站点分批、增量地引导翻译。
- 加固发布流程：恢复 `.genaiscript/cache` 缓存、失败时自动建 issue 告警、语言单一来源
  校验、翻译排除 `authors` 集合，以及 `force-with-lease` 推送重试。

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
  子目录，并 将 `sveltiaLoader` 指向 `locale: "en"`。现在向 `main` 推送 `en/`
  下的文件即会触发翻译工作流。
- 在 example 的 `posts` 集合启用 Sveltia 编辑工作流
  （`publish_mode: "editorial_workflow"`）：CMS 中保存会开出
  `cms/posts/[slug]` 的 Pull Request 而不触碰 `main`，因此部署与翻译工作流仅在该
  条目被发布（合并）后才会运行。`authors` 与单例保持默认 `simple` 模式。
- 重构翻译工作流的发布流程：改为“自检通过后**直接提交到 `main`**”
  （新增默认开关 `PUBLISH_MODE: "commit"`），不再仅开 PR。译文在发布时自动上线，
  无需 CMS 二次操作；设为 `PUBLISH_MODE: "pr"` 可保留人工合并闸门。新增串行
  `concurrency` 锁（`cancel-in-progress: false`），使连续发布的多篇文章排队逐一翻译，
  避免翻译 API 限流风暴与运行中被取消导致的错乱。发布步骤会先校验目标语言译文非空再提交。
- 新增两个“不翻译”开关：全局 `AUTO_TRANSLATE` 环境变量（`false` 时整体暂停翻译）；
  以及单篇 frontmatter 标记 `autoTranslate: false`（可在 CMS 内勾选），使该条目不触发翻译。
  两者都在变更检测阶段过滤，被跳过的条目仍以英文发布、只是不被自动翻译，之后可用
  `workflow_dispatch`（force）补翻。无待翻译文件时翻译步骤整体跳过。
- 为 `workflow_dispatch` 新增 `scope` 输入：可对**已存在（存量）站点**分批引导翻译
  （例如先 `scope: posts`、再 `scope: products`），避免一次性巨量翻译导致超时/限流。
  已存在于 `main` 的 EN 文件不会自动触发翻译，需用手动 dispatch（force + scope）引导；
  运行具备增量续翻能力（读取仓库中已有译文、只补缺失部分），中断后可安全重跑。
- 在 example 的 `posts` 与 `authors` 集合加入 `autoTranslate` 布尔字段，使该开关可在
  CMS 界面勾选（默认开启）。
- 变更检测步骤新增自动排除：**草稿**（`draft: true`）与**模板文件**
  （`_template.md` / `template.md` 或 `templates/` / `_templates/` 目录下），
  这些条目仍以英文发布、只是不送翻。同时给翻译模型加入指令：保留已有的人工译文，
  仅更新“英文源发生变动”的段落，避免 CI 把人工修正的机翻整体覆盖重写。
- 将翻译工作流的默认引擎切换为 **DeepSeek**（OpenAI 兼容端点
  `https://api.deepseek.com`），通过 `openai_api_key` / `openai_api_base`
  接入，并用 `model_alias: "translation: openai:deepseek-v4-flash"` 指定模型。
  `deepseek-v4-flash` 为非思维模式（最便宜、低延迟、128K 上下文），最契合批量
  Markdown 翻译；`deepseek-v4-pro` / `reasoner` 会增加成本与延迟而对翻译无益，故不选。
  GitHub Models 保留为注释形式的回退方案。凭证位于仓库 Secrets（`DEEPSEEK_API_KEY`）；
  百度翻译作为非 LLM 的降级方案记录在案——它无法直接驱动 pelikhan。

### 优化（0.3.2 续）

- 将翻译工作流重构为 **检测 → 矩阵翻译 → 发布** 三段式流水线：
  翻译阶段按 `CHUNK_SIZE` 切片为并行的 matrix 分片，存量站 `force` 引导不再有
  6 小时超时或单参数过大的风险；各分片写入同一个 `i18n/batch-<run>` 分支后再一次性合并。
- **（1）恢复缓存**：通过 `actions/cache` 恢复 `.genaiscript/cache`，使增量翻译状态
  跨运行保留（更快、更省 token）。
- **（2）失败告警**：翻译或发布任一步骤失败时自动建 issue（`labels: i18n, ci-failure`），
  避免“静默失败没人知道”。
- **（3）语言单一来源校验**：Sveltia 配置里的 `locales` 必须与工作流的 `TARGET_LANGS`
  完全一致，不一致直接失败并给出两边差异（用 `CONFIG_FILE` 指向你的配置文件）。一次改对，永不漂移。
- **（4）`authors` 不再翻译**：push 触发器现在只监听 `posts/**/en/**`，`SKIP_COLLECTIONS:
authors` 在 `force` 模式也兜底跳过；并从 `authors` 集合移除误导性的 `autoTranslate` 字段
  （保留在 `posts`）。
- **（5）修正 remap 脚本对 `multiple_files` 的处理**：pelikhan 始终把译文产出在 `en/`
  下，两种结构都需把译文移出 `en/`（folders → `{lang}/`，files → 集合根目录）。旧注释
  “无需移动”是错误的。
- **（6）加固发布**：对 `origin/main`（以及分片对 batch 分支）采用
  `git push --force-with-lease` + 重试循环，避免运行期间 `main` 被改动导致的 rebase/push 冲突。

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

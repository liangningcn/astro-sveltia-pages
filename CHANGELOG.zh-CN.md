# 更新日志

本项目的所有重要变更记录于此，遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

English documentation: [CHANGELOG.md](CHANGELOG.md).

各版本之间的升级指引见每项的 **迁移** 小节。

---

## 0.5.0

### 新增

- **Content Loader 多格式支持。** `sveltiaLoader` 现已支持 Sveltia CMS 可配置的全部条目存储格式，不再仅限 Markdown 文件夹集合：
    - folder 集合 + 纯数据文件 —— `json`、`yaml`/`yml`、`toml`（每条一个文件）；
    - folder 集合 + 带 frontmatter 的 Markdown —— `frontmatter`（默认值）、`yaml-frontmatter`、`toml-frontmatter`；
    - file 集合（`file`）—— 单个 JSON 数组存放全部条目，每条作为一条条目加载，ID 为 0 起算的数组下标（与 Sveltia 按位置定义的 slug 一致）。
      无论何种格式，Zod schema 均由 CMS 的 `fields` 自动生成；`body` 字段仅在前置 frontmatter 类格式下排除，与此前一致。现有 Markdown folder 集合行为**完全不变**，对存量用户零影响。
- 新增 `resolveFormat()`：归一化 `yml` 别名（`yml` 与 `yaml` 是同一种格式），并在 format 省略时按扩展名推断，与 Sveltia 自身语义一致。

### 变更

- **`@sveltia/cms` 固定到 `0.270.0`**（原 `^0.256.1`），`DEFAULT_SVELTIA_VERSION` 由 `0.256.1` 提升至 `0.270.0`。从 unpkg 加载的 CMS UI 现与构建期使用的 `@sveltia/cms` 类型定义对齐，消除了此前的类型/运行时漂移。
- 同 major 内的依赖升级（均停留在各自当前主版本内）：`astro` `^7.4.13`、`vitest` `^4.1.12`、`js-yaml` `^4.3.2`、`zod-to-ts` `^2.1.0`、`@types/node` `^26.6.6`。`typescript` 6.0.3 已是 6.x 最新；`bumpp` 与 `@typescript/native-preview` 不动（更高主版本 / 预览版风险）。
- `SveltiaCollection` 现接受 `folder` **或** `file`（加 `fields`）；集成启动校验不再拒绝基于文件的 entry collection。folder 集合复用 `glob()` loader，file 集合复用 Astro 内置 `file()` loader（配一个按下标建 key 的 parser），不重复造解析逻辑。
- i18n 模板版本升至 **0.5.0**，为下游站点仓库提供明确的升级信号；本次未改动 i18n 模板内容。

### 限制（中英 README 均已注明）

- **不支持 `json-frontmatter`**：Astro 内置 glob 解析器只识别 `---` 与 `+++` 分隔符，不识别 `{ }`。需要 JSON 数据请改用 `json` 的 folder 集合（每条一个 `.json` 文件），该路径完全可用。
- `raw` 格式会报错：Astro 没有内置的纯文本解析器。如有需要，请先为对应扩展名注册自定义 content entry type。
- file 集合不支持 `locale` 参数（所有语言都存放在同一个 JSON 数组里），传入会报错。
- `files` 形式的集合（多个互不相关、各有一组字段的文件）、`{{locale}}` 文件夹占位符、顶层列表 / 键值存储（`root: true`）仍被拒绝。

### 迁移

- **无需改动 CMS 配置、frontmatter 或 Secret。** 现有 Markdown folder 集合继续按原样工作——本次升级为纯增量。
- 要使用新格式，在集合上设置 `format`（可选 `extension`），或用 `file` 指向单个 JSON 数组。格式表与示例见任一 README 的「Content Loader」章节。
- 升级后**必须在每个站点仓库重跑 `pnpm exec astro-sveltia-pages init:i18n`** 并提交三份重新生成的快照；模板版本戳升至 `0.5.0`，CI 可用 `init:i18n --check` 拦截过期模板。模板内容本身未变——这只是标准升级步骤，不涉及工作流迁移。

## 0.4.9

### 变更

- **清理 `package.json`、统一强制 pnpm。** `package.json` 不再含 `pnpm` 字段（0.4.8 已移除：pnpm 11 不再读取该字段，`overrides` 已迁至 `pnpm-workspace.yaml`）；保留 `devEngines.packageManager: pnpm` 作为唯一的包管理器约束。无功能性变更，无破坏性变更。
- 版本与 i18n 模板版本同步升至 **0.4.9**，为下游站点仓库提供明确的升级信号与新的模板快照。

### 迁移

- 升级依赖后**必须在每个站点仓库重跑 `pnpm exec astro-sveltia-pages init:i18n`** 并提交三份重新生成的快照；CI 可用 `init:i18n --check` 拦截过期模板。

## 0.4.8

### 修复

- **全面依赖安全升级。** 将 `zod` 锁定到 `4.6.6`、`source-map-js` 锁定到 `1.2.2`，清除了真正进入发布 tarball 运行时依赖传播链的两条 high 漏洞（`zod-to-ts → zod`、`@sveltia/cms → svgo/csso → css-tree → source-map-js`）；`svgo` 锁定到 `^4.0.1`（当前已解析为 `4.1.0`）。无功能性变更，无破坏性变更。
- overrides 落位从 `package.json` 改为 `pnpm-workspace.yaml`：pnpm 11 已不再读取 `package.json` 的 `pnpm` 字段，写在 `pnpm.overrides` 里的配置会被静默忽略、完全不生效。

### 迁移

- i18n 模板版本升至 **0.4.8**。升级依赖后**必须在每个站点仓库重跑 `pnpm exec astro-sveltia-pages init:i18n`** 并提交三份重新生成的快照；CI 可用 `init:i18n --check` 拦截过期模板。不重跑会导致工作流的 `TEMPLATE_VERSION` 与已安装版本不一致。
- **有意不对 `tinypool` 与 `vite` 做 override。** `tinypool@^1.1.0` 实测解析为 `1.1.1`，仍落在 critical 漏洞范围内（`<2.1.2`，修复版本 `>=2.1.2`），并且会把 Vitest 4 所需的 `2.1.0` 强制降级；`vite@^7.0.3` 实测解析为 `7.3.7`，会替换 catalog 锁定的 `@voidzero-dev/vite-plus-core@0.2.2`（`vp test` / `vp pack` 的核心）。二者都修不了漏洞，却会打断工具链。

### 依赖审计

- 升级后 `pnpm audit --prod --registry=https://registry.npmjs.org` 不再出现 `zod` 与 `source-map-js`。`--prod` 的其余条目全部来自 workspace 内 `example/` 示例应用（`sharp`、`nanoid`、`postcss`、`undici`）与 `packageManagerDependencies>pnpm`，均不进入只含 `dist/` 与 3 个运行时依赖的 tarball。

## 0.4.7

### 新增

- **`init:i18n` 回退解析 `astro.config.{mjs,js,mts,ts}` 里内联的 `sveltia({...})`（方案 C）。** CMS 配置只在构建期产出的仓库不再报「未找到配置」。支持重命名过的默认导入；解析范围限定在集成的 options 对象内，避免把 sitemap 等其它集成的 `locales` 数组误当成 CMS 语言。无法静态解析的情形（变量参数 `sveltia(options)`、展开运算符、非字面量 `locales`）一律明确报错并提示用 `--config <path>`，绝不猜测。独立的 CMS 配置文件仍优先于 astro.config。
- **实际语言探测。** `TARGET_LANGS` 按明确优先级确定并在日志里说明来源：`--locales` 优先；否则取 `i18n.locales` 与 `<content-root>/<collection>/<lang>/` 下实测语言的**并集**（非 `multiple_folders` 结构还会读 frontmatter 的 `locale`）。空目录、只有 `.gitkeep` 的目录、隐藏目录一律忽略；`zh-CN` 与 `zh` 保持独立；大小写按小写 key 比较。「配置声明但目录不存在」「目录存在但配置未声明」两类差异都会逐条输出。除源语言外一个语言都拿不到时明确报错并给出修复建议，不生成翻译零语言的工作流。`--content-root` 现在同时驱动探测与工作流占位符。
- **CLI 与 CI 校验器共用同一份解析层。** `src/i18n-config.ts` 是唯一事实来源，`scripts/build-templates.mjs` 把它编译为无依赖 JS 并注入工作流 `Validate TARGET_LANGS` 步骤的两个生成标记之间；原先需要人工同步的两份手写实现已删除，`pnpm check:templates` 会在漂移时失败。工作流新增 `DETECTED_LANGS` / `LANGS_OVERRIDE` / `DEFAULT_LOCALE` 快照，校验器据此重算并集再与 `TARGET_LANGS` 比对。
- **`--version` / `-v`** 打印包版本号并 exit 0。

### 修复

- `--version` 此前被当成未知 flag（exit 1）。未知 flag 仍然是「报错 + usage + exit 1 + 零文件写入」，仅新增两个版本 flag。
- CI 校验器此前在配置解析失败时**静默跳过**（exit 0），现在与 CLI 报同一段错误文本，包括「astro.config.mjs 含 `sveltia(options)` 但读不到 locales」的场景。
- `--default-locale` 此前只要配置里声明了 `default_locale` 就会被覆盖，现改为显式 CLI 优先。
- 「配置文件不存在」与「文件存在但无法静态解析」现在是两条不同的错误，各自给出修复建议。
- 修正中英 README 中「只有 `i18n.locales` 生成 `TARGET_LANGS`」的过时说明。

### 迁移

- i18n 模板版本升至 **0.4.7**。升级依赖后**必须在每个站点仓库重跑 `pnpm exec astro-sveltia-pages init:i18n`** 并提交三份重新生成的快照；CLI 会自动升级旧文件并保留 `*.bak`，CI 可用 `init:i18n --check` 拦截过期模板。不重跑会导致工作流的 `TEMPLATE_VERSION` 与已安装版本不一致，detect 阶段提前终止。
- 已使用 `sveltia-cms.config.mjs` / `sveltia.config.mjs` / `public/admin/config.yml` 的仓库，配置发现行为不变。`TARGET_LANGS` 现在可能额外并入「目录存在但配置未声明」的语言，日志会列出，便于补进 `i18n.locales`（或用 `--locales` 强制指定精确列表）。

### 依赖审计

- `pnpm audit --registry=https://registry.npmjs.org` 对全 workspace 报 31 条（3 critical / 16 high / 11 moderate / 1 low）。发布 tarball 只含 `dist/`，运行时依赖仅 3 个（`@sveltia/cms`、`js-yaml`、`zod-to-ts`）。3 个 critical 全在 dev 链（`@vitest/browser`、`tinypool`）；`sharp` / `nanoid` / `postcss` / `undici` / `pnpm` 都来自 workspace 内 `example/` 示例应用的 Astro/Vite 链，**不进入发布物**。真正进入运行时依赖传播链且命中 high 的有 2 个：`zod@4.6.5`（`zod-to-ts` 的 peer，4.6.6 修复）与 `source-map-js@1.2.1`（`@sveltia/cms → svgo → csso → css-tree`，1.2.2 修复）；二者都不在本包运行时代码路径上（CMS 仅浏览器端、`zod-to-ts` 仅构建期），升级需等上游或配 `pnpm overrides`。0.4.7 **未捆绑依赖升级**。

## 0.4.6

### 变更

- **脱敏（无功能变动）。** 从 README、更新日志、源码注释、测试、生成的工作流模板以及
  已发布的 Release 说明中，移除所有对私有消费方仓库与个人身份的引用；提交署名示例改为
  通用占位符（`Your Name <you@users.noreply.github.com>`）。`scripts/build-templates.mjs`
  新增构建期隐私扫描，任何私有项目名/个人邮箱在发布前都会被直接拦截。

## 0.4.5

### 新增

- **`init:i18n --postinstall`：升级依赖时自动同步三份生成快照。**
  在 `package.json` 配一行 `postinstall` 钩子后，本地 `pnpm add` / `pnpm install`
  会自动跑；改动随升级那次 commit 进入仓库。钩子幂等（最新版不写文件）、
  未启用 i18n 的仓库静默跳过、不生成 `.bak`、配置异常只告警且**不阻断 install**；
  另提供独立 `--no-backup`。CI 建议改用 `git diff --exit-code` 闸门，因为
  postinstall 会把 runner 里的副本修好，之后的 `--check` 反而会误判通过。
- **译文提交署名可配置。** 0.4.4 及更早写死一个固定 bot 账号，GitHub 按该邮箱
  把译文 commit 关联到 bot 上。现在默认署名为触发工作流的人（`github.actor` +
  push 作者邮箱），也可用 `--commit-author "Name <email>"` 或工作流 env
  `COMMIT_AUTHOR_NAME` / `COMMIT_AUTHOR_EMAIL` 固定成自己的账号；升级会保留已填值。
  commit 模式与 PR 模式使用同一身份。
- **支持经典 YAML CMS 配置。** `init:i18n` 自动探测 `public/admin/config.yml`，
  兼容无引号的 `locales: [en, fr]`、`default_locale: en`、`structure: multiple_folders`
  与 `#` 注释；CI 的 `Validate TARGET_LANGS` 使用同一算法（已用经典 YAML 配置实测）。

### 修复

- **`locale: 'zh'`（CMS 界面语言）被误当成语言列表。** `init:i18n` 与工作流里的
  `Validate TARGET_LANGS` 都曾全文扫描 `/locale:/`：只要配置里出现顶层
  `locale: 'zh'`，就会优先返回 `['zh']` 并跳过真正的 `i18n.locales` 数组，
  生成 `TARGET_LANGS: "zh"`，其余 14 个目标语言被静默跳过（已用多语言配置实测）。
  现改为**只在 `locales: [...]` 列表块内解析**（括号平衡，兼容数组与对象数组），
  解析前先剥离注释；CLI 与 CI 校验保持同一算法，并有静态守卫防止两边漂移。
- 新增闸门：解析出的语言列表若不包含 `default_locale`，CLI 与 CI 都会明确失败，
  不再静默生成错误的语言清单。
- `init:i18n` 现在也会自动探测 `sveltia.config.mjs` / `.js` 与
  `public/admin/config.yml`，此前这类项目必须手动传 `--config`。
- **Windows 下子目录配置文件会生成非法 YAML。** `relative(cwd, configPath)` 在
  Windows 返回 `public\admin\config.yml`，写进 workflow 的双引号标量后 `\a`
  被当成未知转义，整个 YAML 解析失败。现统一输出 POSIX 分隔符，并对所有
  占位符值做 YAML 转义。

### 迁移

- Sveltia 配置无需更改：`locale: 'zh'` 是合法的 CMS 界面语言选项，不必再改成
  常量来绕过（此前用于绕过的 `CMS_LOCALE` 常量可以还原）。
- 升级到 0.4.5 后重跑一次 `pnpm exec astro-sveltia-pages init:i18n` 并提交三份
  生成文件；之后建议配置 `postinstall` 钩子，升级即可自动同步。
- 想让译文 commit 显示为自己的账号，重跑时加
  `--commit-author "你的名字 <你的 GitHub 关联邮箱>"`；不加则署名为触发者。
- 模板版本闸门要求 `TEMPLATE_VERSION` 与已装包版本一致，因此**所有消费方都需要
  重跑一次 `init:i18n`**，否则下一次翻译会在 CI 直接失败。

## 0.4.4

### 修复

- **译文全部翻完，却一篇都发不出去。** 实测 run `<run-id>`：15 个语言各 13 条
  全部成功、`remap 完成：写入 15 个译文`、落盘路径校验通过；最后
  `Self-check & commit to batch branch` 报 `推送 batch 分支失败` / `exit 1`，
  publish 失败并建 issue，15 篇译文随 runner 一起被丢弃。
  根因：`i18n/batch-<run_id>` 是**每次运行新建**的分支，远端本来就不存在；
  旧逻辑在重试循环里无条件 `git rebase origin/$BR`，于是 5 次都报
  `fatal: couldn't find remote ref i18n/batch-...`，永远推不出去。
- 推送循环改为先判断远端分支是否存在：不存在就 `git push -u` 直接创建；
  存在才 `git rebase` + `git push --force-with-lease`。并发分片竞争失败时下一轮
  fetch 后会自动切回 rebase 路径，rebase 失败会 `git rebase --abort` 清理状态。
  本地用真实 git 仓库实跑「首次创建」与「分支已存在（并发分片）」两种场景均通过。
- **翻译缓存不再因发布失败而丢失。** `actions/cache@v4` 组合 action 的 post-save
  只在 job 成功时执行，上述失败会把 `i18n-translations/*.json` 整份丢掉，重跑必须
  重新付费调用模型。现拆成 `actions/cache/restore@v4` + `actions/cache/save@v4`，
  save 用 `if: always()`；并先检查目录里确实有 `*.json` 才保存，避免空目录被存成
  「最近一次缓存」污染 restore-keys。
- 失败 issue 的排查顺序补充 batch 分支首次推送特征与缓存恢复办法。

### 翻译缓存在哪里 / 如何处理

- 三份副本：① run 内工作目录 `i18n-translations/`（runner 销毁即消失）；
  ② GitHub Actions cache（0.4.4 起失败也保存；7 天未访问会被清理、10GB 按 LRU 淘汰）；
  ③ 每分片 artifact `translation-logs-<run_id>-<shard>`（`if: always()`，
  默认保留 90 天，**发布失败也一定在**）。
- 本次 run `<run-id>`：日志开头 `Cache not found`、结尾没有 `Cache saved`，
  所以 ② 里没有；但 artifact `translation-logs-<run-id>-0`（16 文件 / 28.7 KB）
  已上传成功，15 个 `<lang>.json` 都在里面。
- 恢复：下载该 artifact → 把 `*.json` 放进仓库根目录 `i18n-translations/` →
  重跑工作流（或 Actions → i18n-translate → Run workflow 勾 force）。命中缓存时
  几乎不调用模型，即可重建并发布 15 篇译文。
- 不建议默认把缓存提交进仓库：每次翻译都会多出 15 个 JSON 的 diff；只有需要
  跨 Actions 缓存淘汰周期永久留存时才这么做。

### 迁移

- 每个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n` 并提交重新生成的
  三份文件（模板版本 `0.4.4`）。Secret、CMS 配置、frontmatter 都不用改。
- 升级后建议手动触发一次 `Run workflow`（勾 force）把上次未发布的译文补发。

## 0.4.3

### 修复

- **删除 EN 文章会触发一次假的翻译失败。** GitHub `on.push.paths` 对【被删除】的
  文件同样匹配：删除 `src/content/blog/en/xxx.md` 仍会启动工作流，而 0.4.2 的
  detect 只处理「文件存在时读 frontmatter」这一分支，文件不存在时 `reason`
  保持为空 → 该路径被当成待译文件送进 `Stage EN sources`，随即报
  `源文件不存在` / `exit 1`，publish 失败并自动建一条 `ci-failure` issue。
- detect 现在在读取 frontmatter **之前**显式排除工作树里已不存在的 EN 路径
  （删除 / 重命名的旧路径），输出 `has_files=false`，translate / publish 显示
  Skipped；跳过原因统计新增「已删除/重命名」，并用 notice 说明这是正常跳过。
- detect 顺手加固两个边界：新建分支首次 push（`github.event.before` 全 0，
  `git diff 000…0 AFTER` 会 `fatal: bad object`）改为回退 `git ls-files`；
  仓库里一个 EN 文件都没有时 `grep` 无匹配不再让 `execSync` 抛错。
- `Stage EN sources` 的「源文件不存在」错误改为带排查指引：0.4.3 正常情况下
  不会再走到这里，若仍出现则提示重跑 `init:i18n` 升级工作流。
- 明确一个行为边界：删除 EN 源文件**不会**自动删除其它语言目录下已发布的译文；
  若要彻底移除该文章，需连同各语言目录里的同名 md 一起提交删除。

### 迁移

- 每个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n` 并提交重新生成的
  三份文件（模板版本 `0.4.3`）。Secret、CMS 配置、frontmatter 都不用改。

## 0.4.2

### 修复

- **偶发「某几个语言 0 篇译文」会拖垮整次发布。** 0.4.1 的凭证修复生效后，
  消费方实测 15 个语言里 13 个成功、`de` / `pl` 失败，publish 报
  `译文缺失 2 项`，结果 13 篇已完成的译文也全部没有发布。
  根因在上游 `pelikhan/action-continuous-translation@v0.2.11`：它把待译节点包成
  `┌T000┐…└T000┘` 标记，要求模型用 ` ```T000 … ``` ` 代码围栏逐条返回；
  DeepSeek 偶尔把输入标记原样抄回（德语 / 波兰语日志里全是 `┌T000┐`），
  上游只从代码围栏解析译文 → `translations: 0` / `No translations found`。
  它内部的 5 次重试又命中 `runPrompt(cache:true)` 的同一份坏响应
  （`usage.jsonl` 里 4 条 `total:0`），永远无法自愈。
- `instructions` 增加强制输出格式约束：每个 HASH 单独一个 ` ```Tnnn ` 代码围栏，
  禁止回显 `┌` / `└` / `┐` / `┘` 标记，禁止把所有译文塞进一个代码块，
  禁止把整个响应包进代码块。
- `Verify translations were produced` 改为两段式：先做**非致命**校验并输出
  缺失语言清单；`Prepare clean retry for missing languages` 清掉 `.genaiscript`
  响应缓存与对应 `<lang>.json` 增量缓存，再用 `Retry missing languages once`
  只重跑这些语言（新进程 + 新 prompt hash，不再是坏响应回放）；重试后用
  hard 模式收口。校验脚本写在 `$RUNNER_TEMP`，不新增需要提交的模板文件。
- 新增 `env.ALLOW_PARTIAL_TRANSLATIONS`（默认 `"true"`）：重试后仍缺失时告警并
  发布已成功的语言，不再因为 1 个语言失败丢掉其余 14 个；设 `"false"` 恢复
  严格模式。两种模式都会打印缺失清单并写入 Step Summary。
- 新增 **`Verify destination layout`**：remap 后逐条校验 git 暂存区里的译文都位于
  `<content_root>/<collection>/<lang>/<slug>.md`（例如
  `src/content/blog/fr/<slug>.md`）；`remap-translations.sh` 也在写入前断言
  目标目录名就是目标语言码。彻底排除「译文被写成 `.../blog/<slug>.fr.md`」。
- 失败 issue 的排查顺序补充 `┌T000┐` 回显 / `No translations found` 特征与
  `Verify destination layout`。

### 迁移

- 每个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n` 并提交重新生成的
  三份文件（模板版本 `0.4.2`）。Secret、CMS 配置、frontmatter 都不用改。
- `translation-logs-*` 产物里的 `<lang>.json` 是翻译缓存（源片段 → 译文），
  可用来核对完成度与逐句质量；`{}` 表示该语言本次 0 篇。最终 md 仍存放在
  对应语言目录，不在该产物里。

## 0.4.1

### 修复

- **翻译引擎始终没收到 DeepSeek 凭证，静默回退到了 GitHub Models。**
  `pelikhan/action-continuous-translation@v0.2.11` 把 `openai_api_key`、
  `openai_api_base`、`model_alias` 声明为 action 输入，GitHub 会把它们注入成
  `INPUT_OPENAI_API_KEY` 等变量；但其内置的 GenAIScript 2.3.9 读取 OpenAI
  provider 用的是**无前缀**的 `OPENAI_API_KEY` / `OPENAI_API_BASE`，模型别名用
  `GENAISCRIPT_MODEL_<ID>`。只传 `with:` 时
  `host.resolveLanguageModel('translation')` 找不到可用 provider，
  `genaisrc/src/models.mts` 便回退到硬编码默认值 `github:openai/gpt-4o`；而模板
  又没有传 `github_token`，于是 15 个语言逐一报
  `GitHub authentication required`，一篇译文都没写出，genaiscript 却仍打印
  `success` 并以 exit 0 结束 —— 直到 `Verify translations were produced` 才失败，
  且错误信息误导性地指向「检查 API Key」。
  真实现象（消费方仓库，2026-11-06）：
  `Error connecting to translation model github:openai/gpt-4o: GitHub authentication required`。
- 翻译步骤改为通过 step 级 `env:` 显式注入 `OPENAI_API_KEY`、`OPENAI_API_BASE`、
  `GENAISCRIPT_DEFAULT_MODEL`、`GENAISCRIPT_MODEL_TRANSLATION`、
  `GENAISCRIPT_MODEL_VALIDATION`（Docker action 会原样透传）。`with:` 里的三项
  保留只为兼容上游未来版本，不再是凭证来源。
- 新增 `env.TRANSLATION_MODEL`（默认 `deepseek-flash`）与 `env.OPENAI_API_BASE`，
  模型退役时只改一处即可。
- 新增 **Preflight translation credentials** 步骤：Key 缺失或 `/models` 返回
  401/403 时立即失败；打印配置的模型与端点；模型不在服务商模型列表时给出告警。
  不再等 15 个语言各失败一次才发现 provider 配错。
- `Verify translations were produced` 与自动创建的 issue 的排查顺序改为先看
  预检结果和 `github:openai/gpt-4o` 回退特征，不再默认怀疑 API Key。

### 迁移

- 在每个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n` 并提交重新生成的
  三份文件（模板版本 `0.4.1`）。**不需要**改 CMS 配置、frontmatter 或 Secret：
  `DEEPSEEK_API_KEY` 保持在原处即可。
- 若 DeepSeek 更名模型，改 `env.TRANSLATION_MODEL` 后重跑；预检步骤会打印可用
  模型 id 列表。

## 0.4.0

### 破坏性变更

- **是否翻译改为「每篇 md 自带开关」，不再按集合判断。** 工作流完全不再解析
  CMS 集合：`on.push.paths` 改成一条通配 `<content-root>/**/en/**`，覆盖所有
  集合；detect 只保留 frontmatter 里写了 `autoTranslate: true` 的 EN 文件。
  没打开开关的 EN 变更就是普通修改，不触发翻译；修改其它语言版本的文件
  永远不触发工作流，后台人工改译文是安全的。
- 生成的工作流不再有 `env.SKIP_COLLECTIONS`，CLI 的 `--collections` /
  `--skip-collections` 参数一并移除。集合也不再需要配置
  `i18n: { save_all_locales: false, ... }`。
- **默认值反转为 opt-in**：0.3.x 里用 `autoTranslate: false` 关闭翻译的文件，
  现在必须把值改成 `true` 才会送翻。

### 新增

- `env.OVERWRITE_MODE`：`all`（默认）在开关打开的文章每次 EN 变更时覆盖已有
  译文；`missing` 只补写尚不存在的译文。
- 译文文件 frontmatter 里写 `translateLock: true`，则两种模式下都永不覆盖，
  该语言版本交回 CMS 后台独占维护。
- detect 为每个被跳过的 EN 文件打印具体原因（未开开关 / 草稿 / 模板），并在
  零文件时用 `::warning::` 输出各类计数，不再静默。

### 修复

- 0.3.7 / 0.3.8 那一整类集合解析 bug 彻底消失：`media_folder:` 幽灵条目、
  待翻译集合名泄漏进排除列表、末尾全局 `i18n` 块或注释里的
  `initial_locales` 把最后一个集合误判。CLI 里已经没有集合解析代码。

### 迁移

1. 升级后在每个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n`，
   并提交重新生成的三份文件（模板版本 `0.4.0`）。
2. 给每个 CMS 集合的 `fields` 加一个开关字段，并写进 `_template.md`
   让新建文章默认关闭：
   `{ label: '自动翻译', name: 'autoTranslate', widget: 'boolean', default: false, i18n: 'duplicate' }`。
3. 存量 EN 文件**默认不会被翻译**，只有显式设了 `autoTranslate: true` 才会。
   不要一次性给全仓库打开开关；用 `workflow_dispatch` + `force` + `scope`
   分批回填。
4. 若某些语言版本是人工维护的，把 `OVERWRITE_MODE` 设为 `"missing"`，或给
   这些译文加 `translateLock: true`。否则开关打开的文章每次 EN 变更都会
   重新生成并覆盖全部目标语言。

---

## 0.3.7

### 修复

- **pnpm 环境下 CLI 静默退出（退出码 0、无任何输出）。** `dist/cli.mjs` 用
  `fileURLToPath(import.meta.url) === process.argv[1]` 判断是否为主入口。pnpm
  通过符号链接（Windows 上是 junction）安装包，Node 会把 ESM 主模块解析到
  `.pnpm` store 里的真实路径，而 `process.argv[1]` 保留
  `node_modules/<pkg>` 的 shim 路径。严格字符串比较失败后，整个分发逻辑被跳过，
  所有命令（包括 `init:i18n`）都立即返回：没有日志、没有报错、没有生成文件。
  现在改为比较规范化后的真实路径（Windows 下忽略大小写），同时兼容 `..` 路径段
  与盘符差异。
- **未知子命令之前会被静默当作 `init` 执行。** 现在会输出
  `Unknown command: <name>`、列出可用命令并以退出码 1 结束。新增 `--help` / `-h`
  用法输出，`init:i18n`（及 `init --i18n`）作为正式命令列出。即使没有符号链接
  问题，CLI 也不再"静默失败"。
- README（中 / 英）补充 `init:i18n` 成功执行与 `--check` 的预期输出，以及
  「完全没有输出 = CLI 根本没执行」的排查提示。
- 新增回归测试：通过符号链接路径启动构建产物，断言 CLI 不再静默。

### 迁移

- **升级到 0.3.7 后请重跑 `pnpm exec astro-sveltia-pages init:i18n`。**
  `I18N_TEMPLATE_VERSION` 跟随包版本，0.3.6 用户仓库里提交的三份生成文件标记为
  `0.3.6`，`init:i18n --check` 会判定为过期。workflow 内容本身未变，这是每次
  升级后的标准步骤。
- 仍停留在 0.3.6 且遇到静默退出的用户，可用
  `node node_modules/astro-sveltia-pages/dist/cli.mjs init:i18n` 绕过。
  `pnpm exec` 附近打印的 `Already up to date` 来自 pnpm 的依赖检查，不是 CLI 的
  输出，也不代表 CLI 被跳过。

---

## 0.3.6

修复 0.3.5 引入的「升级检测」缺陷。消费方仓库（运行
`<run-id>`，2026-11-06）的真实 CI 日志显示：包已经装到 0.3.5，仓库里提交的
却仍是 **0.3.4 的 workflow 快照**，失败表现和 API Key 出问题几乎无法区分。

### 日志诊断

- `detect` 检出 1 个英文源、切成 1 片。
- `translate` 把 `src/content/blog/en/<slug>.md` 直接传给
  `pelikhan/action-continuous-translation@v0.2.11`。该 Action 会过滤路径中含
  两位语言码目录的文件（`/\/[a-z]{2,2}(-[a-zA-Z]{2,3})?\//`），于是打印
  `No files or not matching languages selected.`，`genaiscript: cancelled`
  但退出码为 0。
- `remap` 移动 0 个文件，自检发现「本分片无译文变动」跳过提交；紧接着宿主侧
  `mkdir -p .genaiscript/cache` 因 Docker 以 root 创建了该目录而报
  `mkdir: Permission denied`，translate job 失败。`publish` 找不到 batch 分支，
  自动建的 issue 只提示检查 `DEEPSEEK_API_KEY`、限流和译文自检。
- 日志里没有 0.3.5 模板的任何一个步骤（版本自检、暂存、译文完整性校验、
  归属权收回、publish 失败闸门）。**根因：升级 npm 依赖不会替换已提交的
  workflow 快照。** 0.3.5 的过期检测全部依赖用户主动在本地执行
  （`astro dev` / `astro build`、`init:i18n --check`），而 CMS 直接 push 内容时
  这两条通道都不会被触发。

### 修复

- **CI 内版本闸门。** 生成的 workflow 新增 `TEMPLATE_VERSION` 环境变量与
  `Verify i18n template version` 步骤：依次从 `pnpm-lock.yaml` /
  `package-lock.json` / `yarn.lock`、`node_modules/astro-sveltia-pages/package.json`、
  `package.json` 解析实际安装的包版本，与模板版本不一致时立即 `::error::`
  终止并给出可复制的修复命令；只拿到 `^0.3.x` 这类范围声明时退化为
  `major.minor` 宽松比对并给出警告，避免误报。
- **失败 issue 可定位。** 自动创建的 issue 现在打印模板版本，并列出上述两个
  典型症状，把排查方向指向 workflow 快照而不是 API 凭证。
- **`init:i18n --check` 不再误伤未启用 i18n 的仓库。**
  `inspectI18nTemplates` 在三份文件全缺失时返回 `outdated: true`，构建期检查
  已用 `status.enabled` 正确跳过，但 CLI 门禁没有，导致任何没用过 i18n 的仓库
  加这条 CI 检查都会失败。
- **翻译缓存按分片隔离。** `actions/cache` 的 key 与 `restore-keys` 前缀都加入
  `${{ matrix.i }}`。旧写法让并行分片恢复同一份旧缓存、又各自保存只含本分片
  记录的缓存，下一次运行只能恢复其中一份，其余分片增量状态丢失、被重复翻译。
- `check:templates` 与模板测试新增上述全部回归守护，0.3.5 的守护项保持。

### 迁移（从 0.3.5）

- **在每个消费方仓库重跑 `pnpm exec astro-sveltia-pages init:i18n` 并提交重新
  生成的三个文件，这是必须步骤。** 上面的日志证明只升级依赖会继续跑坏掉的
  workflow。从 0.3.6 起，忘记这一步会在下一次翻译时以「版本不一致」明确失败，
  不再出现全绿但零译文。
- CMS 配置与 Secret 无需改动。

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

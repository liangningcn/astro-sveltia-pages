# 贡献指南 / Contributing

## 开发流程

```bash
pnpm install
pnpm build          # 生成 templates/auth.js、把共享 i18n 解析层注入 workflow 模板、打包 dist/
pnpm check          # 格式 + lint + 类型检查
pnpm exec vitest run
pnpm check:templates # 校验 templates/ 与构建脚本生成结果一致
```

改动 `src/i18n-config.ts` 后**必须**跑 `pnpm build` 再提交：`templates/i18n/i18n-translate.yml`
里 `// BEGIN/END GENERATED I18N PARSER` 之间的代码由该源码编译注入，CI validator 与 CLI
共用这一份实现。`check:templates` 会在两者漂移时失败。

## 已知问题（Known issues）

### Windows：`pnpm build` 输出 `error TS5033 ... Access is denied`，但退出码为 0

**现象**

```
error TS5033: Could not write file
'C:/Users/<user>/AppData/Local/Temp/rolldown-plugin-dts-XXXX/vite.config.d.ts':
open ...: Access is denied.
```

**影响范围**：仅日志噪音。`pnpm build` 退出码仍为 0，`dist/`、`templates/auth.js`、
`dist/templates/i18n/` 与所有 `.d.mts` 类型产物均完整生成；`pnpm check` 与测试不受影响。
首次出现于 0.4.6 那轮修复，0.4.7 复现一致。

**触发条件**：Windows + 当前用户对系统临时目录（`%TEMP%`）的写入被拒绝，
常见于受限沙箱、安全软件或临时目录残留只读文件。`rolldown-plugin-dts` 在构建期
把 `vite.config.d.ts` 写入临时目录，失败后由打包器吞掉。

**规避方式**（任选其一）：

1. 把 `TMP` / `TEMP` 指向当前用户可写目录后重跑 `pnpm build`；
2. 清理 `%TEMP%/rolldown-plugin-dts-*` 残留目录；
3. 在不受限的终端（非沙箱）中执行构建。

**判定是否可忽略**：`pnpm build` 退出码为 0，且 `pnpm check`、`pnpm exec vitest run`、
`pnpm check:templates` 全过即可。若退出码非 0 或 `dist/` 文件数异常，则不是此已知问题。

**状态**：上游 `rolldown-plugin-dts` 的临时目录写入行为，待上游修复后移除本条。
不要为了消除这条日志而跳过构建或改写 `vite.config.ts`。

### 沙箱环境下 `wmic.exe` 被拦截

`pnpm check` / `pnpm audit` 内部可能触发 `wmic.exe`。若安全策略拦截，会打印
`PROGRAM BLOCKED BY SECURITY POLICY`。检查本身仍会完成，不要重试或绕过该程序；
如需干净日志，请从安全中心调整程序黑名单。

/**
 * Single source of truth for the i18n template version and the upgrade notice.
 *
 * `init:i18n` writes three files into the consumer repository. They are
 * committed snapshots: upgrading the dependency never replaces them, which is
 * the root cause of "I upgraded the package but translation is still broken".
 * This module powers the CLI `--check` gate, the CLI output and the build-time
 * warning emitted by the Astro integration, so the notice reaches users who
 * never open the README.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Must match `version` in package.json (guarded by tests). */
export const I18N_TEMPLATE_VERSION = "0.3.5";

export const I18N_TEMPLATE_MARKER = "astro-sveltia-pages i18n template v";

/** Files stamped by `init:i18n`. Shared by the writer and every check. */
export const I18N_GENERATED_FILES = [
    join(".github", "workflows", "i18n-translate.yml"),
    join("i18n", "glossary.md"),
    join("scripts", "remap-translations.sh"),
] as const;

/** pnpm is the documented package manager for consumers. */
export const I18N_UPGRADE_COMMAND = "pnpm exec astro-sveltia-pages init:i18n";
export const I18N_CHECK_COMMAND = "pnpm exec astro-sveltia-pages init:i18n --check";

/**
 * The canonical upgrade notice. Every surface renders these exact lines so the
 * message is identical in the CLI, build logs, CI errors and file headers.
 */
export const I18N_UPGRADE_NOTICE = [
    `⚠️ 升级 astro-sveltia-pages 后必须重新运行 \`${I18N_UPGRADE_COMMAND}\``,
    "   （CLI 会自动检测旧版模板并升级，同时备份原文件）。只升级依赖不会更新这些文件。",
    "   继续用旧 workflow 会导致翻译静默失败，而且极难排查。",
].join("\n");

export type I18nTemplateIssue = {
    rel: string;
    /** `null` means the file has no version marker at all (pre-0.3.5). */
    found: string | null;
};

export type I18nTemplateStatus = {
    /** At least one generated file exists -> i18n is in use. */
    enabled: boolean;
    /** Something is missing, unstamped or older than the installed package. */
    outdated: boolean;
    missing: string[];
    stale: I18nTemplateIssue[];
};

/** Compares dotted numeric versions. Returns -1 / 0 / 1. */
export function compareVersions(a: string, b: string): number {
    const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
    const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);

    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);

        if (diff !== 0) {
            return diff < 0 ? -1 : 1;
        }
    }

    return 0;
}

/** Reads the stamped template version, or `null` when the file is not ours. */
export function readI18nTemplateVersion(content: string): string | null {
    const index = content.indexOf(I18N_TEMPLATE_MARKER);

    if (index === -1) {
        return null;
    }

    const rest = content.slice(index + I18N_TEMPLATE_MARKER.length);
    const match = rest.match(/^\d+(?:\.\d+)*/);

    return match ? match[0] : null;
}

/**
 * Inspects the three generated files in `cwd`. Returns a status object instead
 * of throwing so callers can choose between a warning and a hard failure.
 */
export function inspectI18nTemplates(cwd: string): I18nTemplateStatus {
    const missing: string[] = [];
    const stale: I18nTemplateIssue[] = [];
    let present = 0;

    for (const rel of I18N_GENERATED_FILES) {
        const target = join(cwd, rel);

        if (!existsSync(target)) {
            missing.push(rel);
            continue;
        }

        present += 1;
        const found = readI18nTemplateVersion(readFileSync(target, "utf-8"));

        if (found === null) {
            stale.push({ rel, found: null });
        } else if (compareVersions(found, I18N_TEMPLATE_VERSION) < 0) {
            stale.push({ rel, found });
        }
    }

    return {
        enabled: present > 0,
        outdated: missing.length > 0 || stale.length > 0,
        missing,
        stale,
    };
}

/** Renders a prominent, copy-pasteable notice for build logs and CI errors. */
export function formatI18nUpgradeNotice(status: I18nTemplateStatus): string {
    const line = "=".repeat(72);
    const detail = [
        ...status.missing.map((rel) => `   • 缺失: ${rel}`),
        ...status.stale.map(
            (item) =>
                `   • 过期: ${item.rel}（${item.found ?? "旧版·无版本标记"} → ${I18N_TEMPLATE_VERSION}）`,
        ),
    ].join("\n");

    return [
        line,
        ` ⚠️  i18n 模板已过期 / STALE i18n TEMPLATES  (需要 v${I18N_TEMPLATE_VERSION})`,
        "    你刚升级过 astro-sveltia-pages 吗？这三份文件是提交进仓库的生成快照，",
        "    升级依赖不会替换它们，工作流会继续跑旧版。",
        detail,
        "",
        I18N_UPGRADE_NOTICE,
        "",
        `    → 立即修复 : ${I18N_UPGRADE_COMMAND}`,
        `    → CI 拦截  : ${I18N_CHECK_COMMAND}`,
        "    若某个文件是自定义而非本包生成的，加 --force 覆盖，或在文件头加入版本标记。",
        line,
    ].join("\n");
}

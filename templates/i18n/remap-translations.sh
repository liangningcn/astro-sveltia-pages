#!/usr/bin/env bash
# astro-sveltia-pages i18n template v__TEMPLATE_VERSION__
# scripts/remap-translations.sh —— 由 `astro-sveltia-pages init:i18n` 生成。
#
# ⚠️ 升级 astro-sveltia-pages 后必须重新运行 `pnpm exec astro-sveltia-pages init:i18n`
#    （CLI 会自动检测旧版模板并升级，同时备份原文件）。只升级依赖不会更新本文件。
#
# 将 pelikhan/action-continuous-translation 在暂存目录里产出的
#   {staging}/{collection}/{slug}.{lang}.md
# 重新映射为 Sveltia 的 multiple_folders 结构
#   {content_root}/{collection}/{lang}/{slug}.md
#
# 用法:
#   bash scripts/remap-translations.sh "<content_root>" "<staging_dir>"
#     content_root: 内容根目录，如 "src/content"
#     staging_dir:  翻译步骤的暂存目录，如 "i18n-staging"
#
# 说明:
#   - pelikhan 按 filename_template={{dirname}}/{{basename}}.{{lang}}{{extname}}
#     把译文写在源文件同目录、命名为 {slug}.{lang}.md（扁平，无语言目录），
#     这样能绕过 pelikhan 会过滤掉 /xx/ 语言目录文件的兼容性 bug。
#   - 暂存步骤会写出 .sources 清单（每行一个英文源路径）。本脚本借此排除源文件，
#     并用 TARGET_LANGS 环境变量作为语言白名单，避免把 slug 中含点的文件名误判。
#   - pelikhan 用 to.toLowerCase() 渲染 {{lang}}，所以 zh-CN 的译文文件名是
#     {slug}.zh-cn.md；而 Sveltia 的目录名必须与配置里的写法一致。比对时统一
#     小写，落盘时再映射回 TARGET_LANGS 中的原始写法。
#   - 一律用普通 mv（不要用 git 的 mv 子命令）：暂存文件是 untracked 的，
#     git 的 mv 会报 "not under version control"；后续工作流的
#     `git add -A "$CONTENT_ROOT"` 会正确识别新增/修改。
#   - 覆盖策略（工作流 env.OVERWRITE_MODE）：
#       all     —— 默认，覆盖已存在的译文（开关打开即由 CI 维护全部语言）；
#       missing —— 只补缺失译文，已存在的一律保留。
#     译文 frontmatter 里写了 `translateLock: true` 的语言版本，无论哪种模式
#     都永不覆盖，交给 CMS 后台独占维护。

set -euo pipefail

CONTENT_ROOT="${1:?usage: remap-translations.sh <content_root> <staging_dir>}"
STAGE="${2:?usage: remap-translations.sh <content_root> <staging_dir>}"

if [ ! -d "$STAGE" ]; then
    echo "暂存目录不存在，无需 remap: $STAGE"
    exit 0
fi

# 目标语言白名单（来自工作流 env.TARGET_LANGS，逗号分隔）。
LANGS="${TARGET_LANGS:-}"
if [ -z "$LANGS" ]; then
    echo "::warning::TARGET_LANGS 未设置，退回宽松的语言码校验。"
fi

# 读入源文件清单，用于排除未翻译的英文源。
declare -A SOURCES=()
if [ -f "$STAGE/.sources" ]; then
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        SOURCES["$line"]=1
    done < "$STAGE/.sources"
fi

lower() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

is_target_lang() {
    local candidate
    candidate="$(lower "$1")"
    [ -n "$LANGS" ] || {
        echo "$candidate" | grep -Eq '^[a-z]{2,3}(-[a-z]{2,3})?$'
        return
    }
    local l
    for l in $(echo "$LANGS" | tr ',' ' '); do
        [ "$(lower "$l")" = "$candidate" ] && return 0
    done
    return 1
}

# 把译文文件名里的小写语言码还原成 Sveltia 配置里的原始语言码。
canonical_lang() {
    local candidate
    candidate="$(lower "$1")"
    [ -n "$LANGS" ] || { printf '%s' "$candidate"; return; }
    local l
    for l in $(echo "$LANGS" | tr ',' ' '); do
        if [ "$(lower "$l")" = "$candidate" ]; then
            printf '%s' "$l"
            return
        fi
    done
    printf '%s' "$candidate"
}

# all = 覆盖（默认）；missing = 只补缺失译文。
OVERWRITE_MODE="${OVERWRITE_MODE:-all}"
LOCK_RE='^translateLock:[[:space:]]*true[[:space:]]*$'

moved=0
skipped=0
while IFS= read -r -d '' f; do
    # 跳过英文源文件本身（有清单时按清单，无清单时按文件名形状兜底）。
    if [ "${#SOURCES[@]}" -gt 0 ]; then
        [ -n "${SOURCES[$f]:-}" ] && continue
    fi

    base="$(basename "$f")"          # slug.fr.md
    [ "${base##*.}" = "md" ] || continue
    name="${base%.md}"               # slug.fr
    [[ "$name" == *.* ]] || continue  # 无 .{lang}. 段 → 是源文件
    lang="${name##*.}"               # fr
    slug="${name%.*}"                # slug
    is_target_lang "$lang" || continue
    [ -s "$f" ] || { echo "::warning::跳过空译文: $f"; continue; }

    # collection = 暂存目录下的相对路径（可能含多级子目录，如 docs/guides）
    rel="${f#"$STAGE"/}"            # docs/guides/slug.fr.md
    coll="$(dirname "$rel")"        # docs/guides
    dest_lang="$(canonical_lang "$lang")"
    dest_dir="$CONTENT_ROOT/$coll/$dest_lang"
    dest="$dest_dir/$slug.md"

    # 已存在的译文：按比例决定是否保留。人工锁定优先级最高。
    if [ -f "$dest" ]; then
        if head -n 40 "$dest" | grep -Eq "$LOCK_RE"; then
            echo "保留（translateLock: true，后台独占）: $dest"
            skipped=$((skipped + 1))
            rm -f "$f"
            continue
        fi
        if [ "$OVERWRITE_MODE" = "missing" ]; then
            echo "保留（OVERWRITE_MODE=missing）: $dest"
            skipped=$((skipped + 1))
            rm -f "$f"
            continue
        fi
    fi

    mkdir -p "$dest_dir"
    mv -f "$f" "$dest"
    moved=$((moved + 1))
done < <(find "$STAGE" -type f -name '*.md' -print0)

handled=$((moved + skipped))
echo "remap 完成：写入 $moved 个译文，保留已有 $skipped 个（OVERWRITE_MODE=$OVERWRITE_MODE）。"

if [ "$handled" -eq 0 ]; then
    echo "::error::没有任何译文被映射，请检查翻译步骤是否产出 {slug}.{lang}.md。"
    exit 1
fi

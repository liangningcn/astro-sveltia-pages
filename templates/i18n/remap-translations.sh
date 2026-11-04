#!/usr/bin/env bash
# scripts/remap-translations.sh —— 由 `astro-sveltia-pages init:i18n` 生成。
#
# 将 pelikhan/action-continuous-translation 在暂存目录里产出的
#   {staging}/{collection}/{slug}.{lang}.md
# 重新映射为 Sveltia 的 multiple_folders 结构
#   {content_root}/{collection}/{lang}/{slug}.md
#
# 用法:
#   bash scripts/remap-translations.sh "<content_root>" "<staging_dir>"
#     content_root: 内容根目录，如 "src/content"
#     staging_dir:  翻译步骤产出的暂存目录，如 ".i18n-staging"
#
# 说明:
#   - pelikhan 把译文写在暂存目录下、命名为 {slug}.{lang}.md（扁平，无语言目录），
#     这样能绕过 pelikhan 会过滤掉 /xx/ 语言目录文件的兼容性 bug。
#   - 本脚本只移动形如 {slug}.{lang}.md 的文件（lang 为 2~5 位语言代码），
#     源文件 {slug}.md（无语言后缀）会被忽略。

set -euo pipefail

CONTENT_ROOT="${1:?usage: remap-translations.sh <content_root> <staging_dir>}"
STAGE="${2:?usage: remap-translations.sh <content_root> <staging_dir>}"

if [ ! -d "$STAGE" ]; then
    echo "暂存目录不存在，无需 remap: $STAGE"
    exit 0
fi

moved=0
while IFS= read -r -d '' f; do
    base="$(basename "$f")"          # slug.fr.md
    [ "${base##*.}" = "md" ] || continue
    name="${base%.md}"               # slug.fr
    lang="${name##*.}"              # fr
    slug="${name%.*}"               # slug
    # 仅处理形如 {slug}.{lang}.md 的文件，避免误移源文件 / 其他文件
    echo "$lang" | grep -Eq '^[a-z]{2,3}(-[a-zA-Z]{2,3})?$' || continue
    # collection = staging 目录下的相对路径（可能含多级子目录，如 docs/guides）
    rel="${f#"$STAGE"/}"            # docs/guides/slug.fr.md
    coll="$(dirname "$rel")"        # docs/guides
    dest_dir="$CONTENT_ROOT/$coll/$lang"
    mkdir -p "$dest_dir"
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && \
       git ls-files --error-unmatch "$dest_dir/$slug.md" >/dev/null 2>&1; then
        git mv -f "$f" "$dest_dir/$slug.md"
    else
        mv -f "$f" "$dest_dir/$slug.md"
    fi
    moved=$((moved + 1))
done < <(find "$STAGE" -type f -name '*.md' -print0)

echo "remap 完成，共移动 $moved 个文件。"

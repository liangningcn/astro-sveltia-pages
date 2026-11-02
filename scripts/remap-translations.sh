#!/usr/bin/env bash
# scripts/remap-translations.sh
#
# 将 pelikhan/action-continuous-translation 的默认输出
#   content/{collection}/en/{slug}.{lang}.md
# 重新映射为 Sveltia 的 multiple_folders 结构
#   content/{collection}/{lang}/{slug}.md
#
# 用法:
#   bash scripts/remap-translations.sh "<langs>" "<content_root>" [structure]
#     langs:          逗号分隔的目标语言，如 "fr,de,es"
#     content_root:   内容根目录，如 "example/src/content"
#     structure:      multiple_folders（默认）| multiple_files
#
# 说明:
#   - pelikhan 默认把译文放在源文件同目录、命名为 {slug}.{lang}.md；
#     这里把它移动到“与英文源同级的 {lang}/ 目录”下，文件名恢复为 {slug}.md。
#   - 若你的 Sveltia 使用 multiple_files 结构（content/{slug}.{lang}.md），
#     把 structure 传 non-multiple_folders，脚本会把译文留在集合目录内、
#     命名为 {slug}.{lang}.md（即 pelikhan 的默认形态，无需移动）。

set -euo pipefail

LANGS="${1:-}"
CONTENT_ROOT="${2:-example/src/content}"
STRUCTURE="${3:-multiple_folders}"

if [ -z "$LANGS" ]; then
  echo "用法: $0 <逗号分隔的目标语言> [content_root] [structure]" >&2
  exit 1
fi

IFS=',' read -ra LANG_ARR <<< "$LANGS"

if [ "$STRUCTURE" != "multiple_folders" ]; then
  echo "structure=$STRUCTURE：pelikhan 默认产出已符合 multiple_files，无需移动。"
  exit 0
fi

moved=0
for lang in "${LANG_ARR[@]}"; do
  # 找出所有形如 {slug}.{lang}.md 的译文（lang 命中目标语言）
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    dir="$(dirname "$f")"                       # .../collection/en
    parent="$(dirname "$dir")"                  # .../collection
    slug="$(basename "$f" ".${lang}.md")"       # slug
    dest_dir="$parent/$lang"                    # .../collection/fr
    dest="$dest_dir/$slug.md"
    mkdir -p "$dest_dir"
    if git mv -f "$f" "$dest" 2>/dev/null; then
      echo "remap: $f -> $dest"
      moved=$((moved + 1))
    else
      mv -f "$f" "$dest"
      echo "remap (no git): $f -> $dest"
      moved=$((moved + 1))
    fi
  done < <(find "$CONTENT_ROOT" -type f -name "*.${lang}.md")
done

echo "remap 完成，共移动 $moved 个文件。"

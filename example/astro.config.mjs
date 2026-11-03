import sveltia from "astro-sveltia-pages";
// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
    site: "https://example.com",
    integrations: [
        sveltia({
            repo: "username/repo",
            branch: "main",
            // siteUrl is optional when Astro's `site` is set above.
            // siteUrl: "https://example.com",

            mediaFolder: "public/images",
            publicFolder: "/images",
            appTitle: "My CMS",
            // sveltiaVersion defaults to the pinned 0.256.1; override only if needed.

            // Optional: Cloudflare R2 external media library.
            // The secret access key is entered in the CMS UI on first use,
            // never written into the generated config.
            r2: {
                accountId: "your-cloudflare-account-id",
                accessKeyId: "your-r2-access-key-id",
                bucket: "my-r2-bucket",
                publicUrl: "https://img.example.com",
            },

            // ── 多语言：Sveltia 只负责编辑英文源（default_locale: en）。
            //    其余 15 种语言由 .github/workflows/i18n-translate.yml 在 CI 中翻译，
            //    自检通过后直接提交 main 自动发布，避免 CMS 手动逐语言点击。
            //    `multiple_folders` 结构下文件路径为 content/{collection}/{locale}/{slug}.md。
            i18n: {
                structure: "multiple_folders",
                default_locale: "en",
                locales: [
                    { locale: "en", label: "English" },
                    { locale: "fr", label: "Français" },
                    { locale: "de", label: "Deutsch" },
                    { locale: "es", label: "Español" },
                    { locale: "ja", label: "日本語" },
                    { locale: "zh", label: "中文" },
                    { locale: "pt", label: "Português" },
                    { locale: "ru", label: "Русский" },
                    { locale: "ar", label: "العربية" },
                    { locale: "ko", label: "한국어" },
                    { locale: "it", label: "Italiano" },
                    { locale: "nl", label: "Nederlands" },
                    { locale: "pl", label: "Polski" },
                    { locale: "tr", label: "Türkçe" },
                    { locale: "vi", label: "Tiếng Việt" },
                    { locale: "th", label: "ไทย" },
                ],
            },

            collections: [
                {
                    name: "authors",
                    label: "Authors",
                    label_singular: "Author",
                    folder: "src/content/authors",
                    // 作者集合【不纳入 CI 自动翻译】：push 触发器已排除，force 模式也由
                    // i18n-translate.yml 的 SKIP_COLLECTIONS=authors 兜底跳过。
                    i18n: { save_all_locales: false, initial_locales: ["en"] },
                    create: true,
                    identifier_field: "name",
                    slug: "{{slug}}",
                    fields: [
                        // 姓名/头像为 locale 无关的引用，原样复制、永不被翻译。
                        {
                            label: "Name",
                            name: "name",
                            widget: "string",
                            i18n: "duplicate",
                        },
                        { label: "Bio", name: "bio", widget: "text", required: false },
                        {
                            label: "Avatar",
                            name: "avatar",
                            widget: "image",
                            required: false,
                            i18n: "duplicate",
                        },
                    ],
                },
                {
                    name: "posts",
                    label: "Posts",
                    folder: "src/content/posts",
                    // 编辑工作流：CMS 中 Save 只开 PR（分支 cms/posts/[slug]），不碰 main，
                    // 不触发部署；点 Publish 合并后才进 main 并触发构建/翻译。
                    // authors 与单例保持默认 simple（保存即发布）。
                    publish_mode: "editorial_workflow",
                    // 只提交英文源；CI 负责其余语言（见 i18n-translate.yml）。
                    i18n: { save_all_locales: false, initial_locales: ["en"] },
                    create: true,
                    slug: "{{slug}}",
                    sortable_fields: ["title", "date"],
                    fields: [
                        // 是否纳入 CI 自动翻译（默认开启）；取消勾选则发布后只上英文、不触发翻译。
                        {
                            label: "Auto Translate",
                            name: "autoTranslate",
                            widget: "boolean",
                            default: true,
                            required: false,
                        },
                        // title / body 可翻译（默认）；其余字段为 locale 无关，标记 duplicate。
                        { label: "Title", name: "title", widget: "string" },
                        {
                            label: "Date",
                            name: "date",
                            widget: "datetime",
                            i18n: "duplicate",
                        },
                        {
                            label: "Author",
                            name: "author",
                            widget: "relation",
                            collection: "authors",
                            search_fields: ["name"],
                            value_field: "{{slug}}",
                            display_fields: ["name"],
                            i18n: "duplicate",
                        },
                        {
                            label: "Draft",
                            name: "draft",
                            widget: "boolean",
                            required: false,
                            i18n: "duplicate",
                        },
                        {
                            label: "Cover Image",
                            name: "cover",
                            widget: "image",
                            required: false,
                            i18n: "duplicate",
                        },
                        { label: "Body", name: "body", widget: "markdown" },
                    ],
                },
            ],

            // New first-class options (previously only reachable via extraConfig):
            showPreviewLinks: true,
            readonly: false,
            singletons: [
                {
                    name: "site",
                    label: "Site Settings",
                    file: "src/data/site.json",
                    fields: [{ label: "Site Title", name: "title", widget: "string" }],
                },
            ],

            // Escape hatch: shallowly merged into the generated CMS config.
            // Keys that collide with generated values override them (with a warning).
            extraConfig: { display_url: "https://example.com" },
        }),
    ],
});

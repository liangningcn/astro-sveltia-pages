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
            locale: "zh",
            appTitle: "My CMS",
            sveltiaVersion: "latest",

            // Optional: Cloudflare R2 external media library.
            // The secret access key is entered in the CMS UI on first use,
            // never written into the generated config.
            r2: {
                accountId: "your-cloudflare-account-id",
                accessKeyId: "your-r2-access-key-id",
                bucket: "my-r2-bucket",
                publicUrl: "https://img.example.com",
            },

            collections: [
                {
                    name: "authors",
                    label: "Authors",
                    label_singular: "Author",
                    folder: "src/content/authors",
                    create: true,
                    identifier_field: "name",
                    slug: "{{slug}}",
                    fields: [
                        { label: "Name", name: "name", widget: "string" },
                        { label: "Bio", name: "bio", widget: "text", required: false },
                        {
                            label: "Avatar",
                            name: "avatar",
                            widget: "image",
                            required: false,
                        },
                    ],
                },
                {
                    name: "posts",
                    label: "Posts",
                    folder: "src/content/posts",
                    create: true,
                    slug: "{{slug}}",
                    sortable_fields: ["title", "date"],
                    fields: [
                        { label: "Title", name: "title", widget: "string" },
                        { label: "Date", name: "date", widget: "datetime" },
                        {
                            label: "Author",
                            name: "author",
                            widget: "relation",
                            collection: "authors",
                            search_fields: ["name"],
                            value_field: "{{slug}}",
                            display_fields: ["name"],
                        },
                        {
                            label: "Draft",
                            name: "draft",
                            widget: "boolean",
                            required: false,
                        },
                        {
                            label: "Cover Image",
                            name: "cover",
                            widget: "image",
                            required: false,
                        },
                        { label: "Body", name: "body", widget: "markdown" },
                    ],
                },
            ],

            // Escape hatch: shallowly merged into the generated CMS config.
            // Keys that collide with generated values override them (with a warning).
            extraConfig: { display_url: "https://example.com" },
        }),
    ],
});

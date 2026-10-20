# astro-sveltia-pages

> **Attribution**
> This package is a fork of [`astro-loader-sveltia-cms`](https://github.com/joknoll/astro-loader-sveltia-cms) by Johannes Knoll, licensed under the MIT License.
> Significant modifications have been made, including built-in GitHub OAuth routes, automatic route conflict resolution, and Cloudflare Pages optimization.

Zero-config Sveltia CMS integration for Astro, optimized for Cloudflare Pages.

> **Note for Cloudflare Pages users:** This integration runs OAuth directly within
> your Astro API routes via the `@astrojs/cloudflare` adapter. You do NOT need a
> separate Cloudflare Worker.

Sveltia CMS integration for Astro 7.
This serves the [Sveltia CMS](https://sveltiacms.app) admin UI and provides a
content loader for Astro content collections, including automatic Zod schema generation.

## Quick Start

```bash
pnpm add astro-sveltia-pages
```

Register the integration in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import sveltia from "astro-sveltia-pages";

export default defineConfig({
    integrations: [
        sveltia({
            config: {
                backend: { name: "github", repo: "my-org/my-site", branch: "main" },
                media_folder: "public/images",
                collections: [
                    {
                        name: "posts",
                        folder: "src/content/posts",
                        fields: [
                            { name: "title", widget: "string" },
                            { name: "date", widget: "datetime" },
                            { name: "draft", widget: "boolean", required: false },
                            { name: "body", widget: "markdown" },
                        ],
                    },
                ],
            },
        }),
    ],
});
```

Use the content loader in `src/content.config.ts`:

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

const posts = defineCollection({ loader: sveltiaLoader("posts") });

export const collections = { posts };
```

## Multi-language Support (i18n)

This package supports Sveltia CMS's multi-language folder structure (`multiple_folders`).

### 1. Configure CMS i18n

Define the languages in your `astro.config.mjs`:

```js
sveltia({
    config: {
        backend: { name: "github", repo: "user/repo", branch: "main" },
        i18n: {
            structure: "multiple_folders",
            locales: ["en", "zh"],
            default_locale: "en",
        },
        collections: [
            /* ... */
        ],
    },
});
```

### 2. Load Content Per Locale

In your `src/content.config.ts`, define separate collections for each language. Use the
`locale` option in `sveltiaLoader` to instruct the loader to read from the corresponding
subfolder.

```ts
import { defineCollection } from "astro:content";
import { sveltiaLoader } from "astro-sveltia-pages/loader";

export const collections = {
    // English collections (reads from src/content/blog/en/)
    blog_en: defineCollection({
        loader: sveltiaLoader("blog", { locale: "en" }),
    }),
    products_en: defineCollection({
        loader: sveltiaLoader("products", { locale: "en" }),
    }),

    // Chinese collections (reads from src/content/blog/zh/)
    blog_zh: defineCollection({
        loader: sveltiaLoader("blog", { locale: "zh" }),
    }),
    products_zh: defineCollection({
        loader: sveltiaLoader("products", { locale: "zh" }),
    }),
};
```

**Notes:**

- If the CMS config uses `multiple_folders` but you forget to pass `{ locale: "..." }`, the loader throws an explicit error to prevent loading the wrong data.
- If a specific collection has `i18n: false` in its CMS config, it opts out of localization and loads from the root folder regardless of the global i18n settings.

## Loader support and limitations

- Collections must have a non-empty `folder` and a `fields` array. File-backed collections and `{{locale}}` folder placeholders are rejected.
- When `extension` is omitted, the loader uses `yml` for YAML, `json` for JSON, `toml` for TOML, `txt` for raw files, and `md` otherwise. Astro must have an entry parser registered for the selected extension; inferring an extension does not add a parser.
- Name-based lookup currently reads the integration's generated `config.json` (inside Astro's `.astro/integrations/` directory) relative to the working directory. Run Astro from the site root with its default generated-files directory, or pass a collection object directly to the loader.
- Relations are converted to Astro references assuming the stored value matches the target entry ID and the CMS collection name matches the Astro collection key. Custom `value_field` mappings are not resolved.
- Top-level list/key-value storage (`root: true`) is not supported. i18n structures other than `multiple_folders` are not supported.

## Development

```bash
vp install
vp check
vp test
vp pack
```

Use `vp run format` to format code and `vp run format:check` to verify formatting.
See [Code style](docs/code-style.md) for the formatter profile and unsupported rules.

See the `example` directory for a complete Astro setup.

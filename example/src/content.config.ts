import { sveltiaLoader } from "astro-sveltia-pages/loader";
import { defineCollection } from "astro:content";

// `locale: "en"` is required: the CMS uses the `multiple_folders` i18n
// structure, so the loader resolves content under `src/content/{collection}/en`.
// The other 15 locales are produced by .github/workflows/i18n-translate.yml.
const authors = defineCollection({
    loader: sveltiaLoader("authors", { locale: "en" }),
});

const posts = defineCollection({ loader: sveltiaLoader("posts", { locale: "en" }) });

export const collections = { authors, posts };

// Usage example — in a page like src/pages/blog/[slug].astro:
//
// import { getCollection, getEntry, render } from "astro:content";
//
// export async function getStaticPaths() {
//   const posts = await getCollection("posts");
//   return posts.map((post) => ({
//     params: { slug: post.id },
//     props: { post },
//   }));
// }
//
// const { post } = Astro.props;
// const { Content } = await render(post);
// const { data } = post;
//
// // data.author is typed as { collection: "authors"; id: string }
// // so getEntry() resolves it without a type error:
// const author = await getEntry(data.author);

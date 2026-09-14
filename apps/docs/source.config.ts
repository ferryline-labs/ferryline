import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

// Fumadocs' own real, current Mermaid recipe (fumadocs.dev/docs/markdown/mermaid) — this plugin
// converts a plain ```mermaid code fence into a <Mermaid chart="..."/> call automatically, so
// .mdx files never reference the component by name; see mdx-components.tsx for the real component
// it resolves to.
export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
  },
});

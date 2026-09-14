import type { MDXComponents } from "mdx/types";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { Mermaid } from "@/components/mdx/mermaid";

/** fumadocs-mdx calls this (per-file, via the `useMDXComponents` convention) to resolve the
 * component set an .mdx file's tags render with. `Mermaid` renders real architecture/sequence
 * diagrams — see source.config.ts's `remarkMdxMermaid` plugin, which converts a plain ```mermaid
 * code fence into a `<Mermaid chart="...">` call automatically, so pages never reference this
 * component by name themselves. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Mermaid,
    ...components,
  };
}

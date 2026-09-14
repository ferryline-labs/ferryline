import type { MDXComponents } from "mdx/types";
import defaultMdxComponents from "fumadocs-ui/mdx";

/** fumadocs-mdx calls this (per-file, via the `useMDXComponents` convention) to resolve the
 * component set an .mdx file's tags render with. Only fumadocs-ui's own defaults are needed today
 * (headings, code blocks, callouts, tables); real, project-specific components (e.g. a runnable
 * code-sample block wired to actual package versions) get added here as pages need them. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
  };
}

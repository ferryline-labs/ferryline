import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  // @creit.tech/stellar-wallets-kit's own ESM build does a static named import from
  // @stellar/freighter-api, which ships only a single webpack-bundled CJS file with no `exports`
  // map and no ESM build of its own (confirmed by reading its real package.json). Left external
  // (the default, tsup's usual behavior for a package's real dependencies), this breaks for any
  // consumer using a plain Node ESM `import` outside a bundler: Node's static cjs-module-lexer
  // can't synthesize named exports from that particular CJS bundle's shape, even though the
  // exports genuinely exist (confirmed directly: a plain `require()` of the same file works fine,
  // and esbuild/webpack/Vite-style bundlers, which resolve this interop dynamically rather than
  // via static analysis, handle it correctly). This was already found and shimmed for this
  // package's own test suite only (see vitest.config.ts, shims/stellar-freighter-api.ts) by an
  // earlier phase, with an explicit note flagging it as a real risk for real consumers, not fixed
  // here until the widget's first real npm publish (0.1.0) made it a live, reproduced bug instead
  // of a predicted one. Inlining stellar-wallets-kit resolves this interop at build time instead,
  // so it never reaches a consumer's own runtime/bundler at all, regardless of their own tooling.
  noExternal: ["@creit.tech/stellar-wallets-kit"],
});

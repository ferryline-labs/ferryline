// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "contracts/**",
      "coverage/**",
      "apps/docs/.source/**", // fumadocs-mdx codegen output, not our source
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Money-movement code: be explicit about every unhandled promise and every any.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Operator-run scripts talk to a terminal on purpose.
    files: ["experiments/**/*.ts", "**/scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // The two Next.js apps are the React surfaces in the repo: enable JSX-aware hooks linting
    // there only.
    files: ["apps/site/**/*.{ts,tsx}", "apps/docs/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ["apps/site/**/*.test.{ts,tsx}", "apps/docs/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/require-await": "off",
      "no-console": "off",
    },
  },
  {
    files: ["eslint.config.js", "**/*.config.ts", "**/*.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Plain Node scripts run directly via `node`, not part of any tsconfig project (no type
    // information available, nor needed, for a script rather than a package's own source). Real
    // Node globals (process, fetch, setTimeout) plus real browser globals (window, document) are
    // both genuinely used here: these scripts drive a real Playwright browser context, and
    // `page.evaluate()` callbacks execute inside that real browser, not in the Node process
    // running the script itself.
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Same reasoning as experiments/**: these are real operator/developer-run scripts that talk
      // to a terminal on purpose, not application code that should stay quiet in production.
      "no-console": "off",
    },
  },
  prettier,
);

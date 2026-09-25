import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jest from "eslint-plugin-jest";
import testingLibrary from "eslint-plugin-testing-library";

// ESLint 9 flat config. Replaces `.eslintrc.json`, which ESLint 9 no longer reads,
// and `next lint`, which Next 16 removed.
//
// INTENT: this reproduces the previous enforcement level exactly. The toolchain
// upgrade brought three kinds of *new* signal that are not regressions in the
// code, and each is handled explicitly rather than absorbed silently:
//
//   1. eslint-plugin-react-hooks v5 added rules that did not exist in v4 —
//      set-state-in-effect, purity, immutability, refs. They flag 19 existing
//      call sites. Adopting them is a real code change and a deliberate decision,
//      so they are OFF here and recorded as outstanding work. Do not treat this
//      as "these patterns are fine"; treat it as "this upgrade is not the place
//      to fix them".
//   2. ESLint 9 reports unused disable directives by default. That is a new
//      default, not a new problem, so it is turned off to keep the gate
//      comparable.
//   3. Lint scope is `src`, matching the directories `next lint` covered by
//      default. Running `eslint .` also swept `scripts/` and config files, which
//      were never part of the gate.
//
// The rule set below is otherwise copied verbatim from `.eslintrc.json`, which is
// kept alongside this file as the reference for what was reproduced.
export default [
  ...nextCoreWebVitals,
  jest.configs["flat/recommended"],
  testingLibrary.configs["flat/react"],
  {
    // `next/core-web-vitals` registers @typescript-eslint only for TS files, so a
    // rules block without `files` cannot see it. Registering it here keeps the
    // plugin in scope for the object that uses its rules.
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: {
      // New in ESLint 9; off to preserve the previous gate.
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "react/no-unused-prop-types": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // New in eslint-plugin-react-hooks v5 — see the note above.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Build output and generated files are not source.
    ignores: [".next/**", "out/**", "dist/**", "src-tauri/**", "coverage/**"],
  },
];

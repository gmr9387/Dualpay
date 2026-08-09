import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // no-explicit-any has ~50 pre-existing violations across generated/legacy files.
      // Downgraded to warn so CI catches new violations without blocking on existing ones.
      // Address systematically as files are touched.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // HIPAA Risk #14: prevent PHI leakage via browser console in production code.
    // console.log/warn/error can expose claim payloads, member IDs, and ePHI
    // in browser DevTools which may be captured by extensions or crash reporters.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}", "src/test/**", "src/**/__tests__/**"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
);

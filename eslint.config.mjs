import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/**", ".next/**", "dist/**", "artifacts/**"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      globals: {
        React: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        URL: "readonly",
        Request: "readonly",
        Response: "readonly",
        document: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off"
    }
  }
];

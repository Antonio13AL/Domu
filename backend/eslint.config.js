// Configuración ESLint (flat config) — Domu Backend
// Reglas mínimas para JavaScript moderno con ES Modules.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "warn",
    },
  },
  {
    // Los scripts CLI de `database/` (migraciones, seed) comunican por consola.
    files: ["database/**/*.js"],
    rules: {
      "no-console": "off",
    },
  },
];

// Configuración ESLint (flat config) — Domu Backend
// Reglas mínimas para JavaScript moderno con ES Modules.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    // `._*` son ficheros AppleDouble de macOS que aparecen en el
    // montaje y ni siquiera se pueden leer (`EPERM`); sin este patrón
    // ESLint aborta el lint entero.
    ignores: ["node_modules/**", "coverage/**", "**/._*"],
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
    // Los scripts CLI (`database/` y `server.js`) y el manejador de
    // errores global comunican por consola (los 5xx deben quedar en
    // el registro del servidor).
    files: ["database/**/*.js", "server.js", "src/middlewares/errorHandler.js"],
    rules: {
      "no-console": "off",
    },
  },
];

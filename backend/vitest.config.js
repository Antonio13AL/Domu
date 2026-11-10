// Configuración de Vitest — Domu Backend.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // Reset único de `domu_test` antes de ejecutar todos los tests
    // (ver `tests/global-setup.js`).
    globalSetup: ["tests/global-setup.js"],
    // Todos los ficheros usan la misma base de datos de pruebas y el
    // mismo servidor: se ejecutan en serie para que los resets y las
    // escrituras no se pisen.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

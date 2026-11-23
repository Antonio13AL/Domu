// =============================================================
// Configuración global de Vitest — reset único de la BD de pruebas.
// =============================================================
//
// Se ejecuta una sola vez antes de que arranque cualquier
// fichero de test, de modo que todos comparten el mismo `domu_test`
// recién creado. Así se evita que dos ficheros se pisen mutuamente con
//  un DROP mientras el otro está consultando.
//
// El script exige `DB_TEST_NAME !== DB_NAME`, por eso el proceso
// hijo recibe `DB_NAME=domu`.
// El resto de variables las pone cada fichero de test antes de
//  importar la aplicación.
// =============================================================

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  const resetScript = fileURLToPath(new URL("../database/reset-test.js", import.meta.url));

  execFileSync(process.execPath, [resetScript], {
    env: { ...process.env, DB_NAME: "domu" },
    stdio: "inherit",
  });
}

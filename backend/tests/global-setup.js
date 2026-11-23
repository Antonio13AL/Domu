// =============================================================
// Configuración global de la suite (BE-10).
// =============================================================
//
// `vitest.config.js` declara `globalSetup: ["tests/global-setup.js"]`:
// este módulo se ejecuta UNA VEZ, en el proceso principal y antes de
// cualquier test. Prepara la base de datos de pruebas:
//
//   1. `database/reset-test.js` → borra y recrea `domu_test` y aplica
//      todas las migraciones pendientes.
//   2. `database/seed.js`        → carga los datos demo sobre
//      `domu_test` (comunidad 1, presidente, vecinos, junta cerrada
//      y votaciones de referencia).
//
// Los tests hablan con esa base de datos porque `tests/setup-env.js`
// fija `DB_NAME` antes de que `src/app.js` cree el pool.
//
// Si MySQL no está disponible, la suite falla de forma explícita y
// con un mensaje accionable: la cobertura de BE-10 es de
// integración y necesita una base de datos real, no un doble.
// =============================================================

// Ejecuta `dotenv.config()` en el proceso principal, igual que hace
// `src/app.js`, para que los hijos reciban las `DB_*` de `.env`.
import "../src/config/env.js";

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * -----------------------------------------------------------------
 * Función: runDatabaseScript
 * Propósito: ejecutar un script de `database/` contra la base de
 * datos de pruebas y abortar la suite si falla.
 * @param {string} script - Nombre del fichero dentro de `database/`.
 * @param {string} [dbName] - Valor de `DB_NAME` para el hijo; si no
 *   se indica, el script usa el de `.env`.
 * @returns {void}
 * @throws {Error} Con la salida capturada, si el script devuelve un
 *   código distinto de cero (p. ej. MySQL caído).
 * -----------------------------------------------------------------
 */
function runDatabaseScript(script, dbName) {
  const result = spawnSync(process.execPath, [path.join("database", script)], {
    cwd: projectRoot,
    env: { ...process.env, ...(dbName ? { DB_NAME: dbName } : {}) },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `No se pudo preparar la base de datos de pruebas (database/${script}).\n` +
        "Compruebe que MySQL está arrancado y que DB_TEST_NAME apunta a una base de datos separada de DB_NAME.\n" +
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }

  process.stdout.write(result.stdout ?? "");
}

/**
 * -----------------------------------------------------------------
 * Función: globalSetup
 * Propósito: resetear y sembrar `domu_test` antes de la suite.
 * @returns {void}
 * -----------------------------------------------------------------
 */
export default function globalSetup() {
  const testDatabase = process.env.DB_TEST_NAME || "domu_test";

  // `reset-test.js` apunta él mismo el pool a `DB_TEST_NAME` y
  // comprueba que no coincide con `DB_NAME` (protección frente a un
  // reset accidental de la base de desarrollo): hay que dejarle leer
  // el entorno de `.env` sin redefinirle nada.
  runDatabaseScript("reset-test.js");

  // El seed, en cambio, escribe en `DB_NAME` tal cual: se le fija
  // explícitamente la base de datos de pruebas.
  runDatabaseScript("seed.js", testDatabase);
}

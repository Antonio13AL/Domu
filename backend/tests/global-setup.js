// =============================================================
// Configuración global de Vitest — reset único de la BD de pruebas.
// =============================================================
//
// Se ejecuta una sola vez antes de que arranque cualquier
// fichero de test, de modo que todos comparten el mismo `domu_test`
// recién creado. Así se evita que dos ficheros se pisen mutuamente con
// un DROP mientras el otro está consultando.
//
// Secuencia: `reset-test.js` (DROP + CREATE + migraciones) y, después,
// `seed.js` sobre la base de pruebas, que es la que los tests esperan
// encontrar. El destino de los tests lo fija `tests/setup-env.js` vía
// `test.setupFiles`, antes de que ningún test importe `src/app.js`.
// =============================================================

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "../src/config/env.js";

export default function globalSetup() {
  const testDatabase = process.env.DB_TEST_NAME || "domu_test";

  // `reset-test.js` apunta él mismo el pool a `DB_TEST_NAME` y
  // comprueba que no coincide con `DB_NAME` (protección frente a un
  // reset accidental de la base de desarrollo): hay que dejarle leer
  // el entorno de `.env` sin redefinirle nada.
  runDatabaseScript("reset-test.js");

  // El seed, en cambio, escribe en `DB_NAME` tal cual: se le fija
  // explícitamente la base de datos de pruebas. Debe ser el último
  // paso: un reset posterior dejaría `domu_test` sin datos de demo.
  runDatabaseScript("seed.js", testDatabase);
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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

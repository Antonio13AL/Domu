// =============================================================
// Reset de la base de datos de pruebas (`DB_TEST_NAME`)
// =============================================================
//
// Uso:
//   npm run db:test:reset
//
// Qué hace:
//   1. Valida el destino: `DB_TEST_NAME` obligatoria, identificador
//      SQL seguro y distinto de `DB_NAME` (nunca se borra la BD de
//      desarrollo). Aborta también si `NODE_ENV=production`.
//   2. Abre una conexión al servidor SIN base de datos seleccionada
//      (el destino todavía puede no existir) y ejecuta
//      `DROP DATABASE IF EXISTS` + `CREATE DATABASE` con el charset
//      del proyecto (`utf8mb4` / `utf8mb4_0900_ai_ci`).
//   3. Apunta el pool de la aplicación a la BD de pruebas y aplica
//      las migraciones con el runner compartido (`runMigrations`).
//   4. Cierra el pool y resume el resultado.
//
// =============================================================

import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ quiet: true });

// Identificador SQL admitido: letras, dígitos y guion bajo, 1-64
// caracteres (límite de MySQL). MySQL no admite parámetros de consulta
// en identificadores, por eso se aplica esta regla explícita antes de
// interpolar el nombre en el DDL.
const VALID_DATABASE_NAME = /^[A-Za-z0-9_]{1,64}$/;

/**
 * -----------------------------------------------------------------
 * Función: resolveTargetDatabase
 * Propósito: valida la variable `DB_TEST_NAME` antes de tocar nada.
 * Lanza errores con código (`PRODUCTION_RESET_BLOCKED`,
 * `MISSING_ENV_VARS`, `INVALID_ENV_VAR`, `UNSAFE_TARGET`) para que el
 * mensaje de consola indique la causa sin stack trace.
 * @returns {string} Nombre de la base de datos de pruebas.
 * -----------------------------------------------------------------
 */
function resolveTargetDatabase() {
  if (process.env.NODE_ENV === "production") {
    const error = new Error(
      "Reset bloqueado: NODE_ENV=production. Este script solo debe ejecutarse en desarrollo y CI.",
    );
    error.code = "PRODUCTION_RESET_BLOCKED";
    throw error;
  }

  const target = process.env.DB_TEST_NAME;

  if (!target) {
    const error = new Error(
      "Falta la variable DB_TEST_NAME. Defínela en `backend/.env` (p. ej. DB_TEST_NAME=domu_test).",
    );
    error.code = "MISSING_ENV_VARS";
    throw error;
  }

  if (!VALID_DATABASE_NAME.test(target)) {
    const error = new Error(
      `DB_TEST_NAME no es un identificador seguro: "${target}". ` +
        "Usa solo letras, dígitos y guion bajo (máximo 64 caracteres).",
    );
    error.code = "INVALID_ENV_VAR";
    throw error;
  }

  const development = process.env.DB_NAME;
  if (development && target.toLowerCase() === development.toLowerCase()) {
    const error = new Error(
      `DB_TEST_NAME coincide con DB_NAME ("${target}"): el reset borraría la base de datos ` +
        "de desarrollo. Usa un nombre distinto para las pruebas.",
    );
    error.code = "UNSAFE_TARGET";
    throw error;
  }

  return target;
}

/**
 * -----------------------------------------------------------------
 * Función: recreateDatabase
 * Propósito: elimina (si existe) y vuelve a crear la base de datos de
 * pruebas con el charset del proyecto. Usa una conexión de nivel
 * servidor, sin base seleccionada, porque el destino puede no existir.
 * @param {object} poolOptions - Opciones del pool (`src/config/database.js`).
 * @param {string} target - Nombre ya validado de la BD de pruebas.
 * -----------------------------------------------------------------
 */
async function recreateDatabase(poolOptions, target) {
  // Copia de las opciones del pool sin la base de datos seleccionada.
  const serverOptions = { ...poolOptions };
  delete serverOptions.database;

  const server = await mysql.createConnection(serverOptions);
  try {
    // `target` cumple `VALID_DATABASE_NAME` (letras, dígitos y `_`),
    // por eso es seguro interpolarlo: los identificadores no admiten
    // marcadores de parámetro en MySQL.
    await server.query(`DROP DATABASE IF EXISTS \`${target}\``);
    await server.query(
      `CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await server.end();
  }
}

/**
 * -----------------------------------------------------------------
 * Función: printSummary
 * Propósito: comprueba el resultado del reset consultando
 * `information_schema` y `schema_migrations`, y lo resume en consola.
 * @param {object} pool - Pool de la aplicación apuntando a la BD de pruebas.
 * @param {string} target - Nombre de la BD de pruebas recreada.
 * -----------------------------------------------------------------
 */
async function printSummary(pool, target) {
  const [tables] = await pool.query(
    "SELECT table_name AS tableName FROM information_schema.tables " +
      "WHERE table_schema = ? ORDER BY table_name",
    [target],
  );

  const [migrations] = await pool.query("SELECT COUNT(*) AS total FROM schema_migrations");

  console.log(`==> Base de datos de pruebas lista: ${target}`);
  console.log(`    · ${tables.length} tabla(s): ${tables.map((row) => row.tableName).join(", ")}`);
  console.log(`    · ${migrations[0].total} migración(es) registrada(s)`);
}

async function main() {
  const target = resolveTargetDatabase();

  console.log("==> Reset de la base de datos de pruebas");
  console.log(`    · Destino: ${target} (DB_NAME de desarrollo preservada)`);

  // El pool debe apuntar al destino ANTES de cargar el resto de módulos:
  // `src/config/database.js` lee `DB_NAME` al importarse.
  process.env.DB_NAME = target;

  const { dbDestination, closePool, pool, poolOptions } = await import(
    "../src/config/database.js"
  );

  await recreateDatabase(poolOptions, target);
  console.log(`    · Recreada desde cero (${dbDestination})`);

  try {
    const { runMigrations } = await import("./migrate.js");
    await runMigrations();
    await printSummary(pool, target);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(`✗ Error en el reset [${error.code ?? "UNKNOWN"}]: ${error.message}`);
  if (error.cause) {
    console.error(`  Causa: ${error.cause.message}`);
  }
  process.exitCode = 1;
});

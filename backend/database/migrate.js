// Script de migración de base de datos
// =============================================================
//
// Uso:
//   npm run db:migrate
//
// Qué hace:
//   1. Conecta a MySQL con las variables de `.env`.
//   2. Asegura la tabla de control `schema_migrations`.
//   3. Lee los ficheros `.sql` de `database/migrations` en orden
//      alfabético (prefijos numéricos: 001_, 002_, ...).
//   4. Comprueba el checksum (SHA-256) de las migraciones ya
//      aplicadas: si un fichero cambió después de aplicarse, aborta.
//   5. Aplica solo las pendientes y las registra (filename + checksum).
//
// =============================================================

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import database from "../src/config/database.js";

// Los ficheros `.sql` en `database/migrations`
const MIGRATION_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

// `001_init.sql` (necesaria para arrancar en una base vacía,
// antes de aplicar ninguna migración).
const CREATE_MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    filename    VARCHAR(255)    NOT NULL,
    checksum    VARCHAR(64)     NOT NULL,
    applied_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_schema_migrations_filename (filename)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

/**
 * -----------------------------------------------------------------
 * Función: getMigrations
 * Propósito: Lee de forma asíncrona el directorio de migraciones, filtra
 * únicamente los ficheros con extensión `.sql` y los devuelve ordenados
 * alfabéticamente para asegurar que se ejecuten en la secuencia correcta.
 * -----------------------------------------------------------------
 */
async function getMigrations() {
  let files;
  try {
    files = await readdir(MIGRATION_PATH);
  } catch (error) {
    throw new Error(`No se puede leer el directorio de migraciones: ${MIGRATION_PATH}`, { cause: error });
  }

  return files.filter((file) => file.endsWith(".sql")).sort();
}

/**
 * -----------------------------------------------------------------
 * Función: calculateChecksum
 * Propósito: Genera una firma única (hash SHA-256 en formato hexadecimal)
 * basada en el contenido textual de cada fichero de migración. Esto permite
 * detectar si un script ya aplicado ha sido modificado posteriormente.
 * -----------------------------------------------------------------
 */
function calculateChecksum(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * -----------------------------------------------------------------
 * Función: getAppliedMigrations
 * Propósito: Consulta la base de datos para obtener el listado de migraciones
 * que ya se ejecutaron previamente. Devuelve un objeto Map asociando cada
 * nombre de fichero (`filename`) con su respectivo `checksum` registrado.
 * -----------------------------------------------------------------
 */
async function getAppliedMigrations(connection) {
  const [rows] = await connection.query(
    "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
  );
  return new Map(rows.map((row) => [row.filename, row.checksum]));
}

/**
 * -----------------------------------------------------------------
 * Función: verifyChecksums
 * Propósito: Compara los checksums actuales de los ficheros locales frente
 * a los almacenados en la base de datos para las migraciones ya aplicadas.
 * Si encuentra discrepancias (un fichero cambió tras aplicarse), lanza
 * un error y detiene el proceso por seguridad.
 * -----------------------------------------------------------------
 */
function verifyChecksums(migrations, applied) {
  for (const { file, checksum } of migrations) {
    if (!applied.has(file)) continue;

    if (applied.get(file) !== checksum) {
      throw new Error(`El fichero "${file}" cambió después de haberse aplicado ` +
          "(checksum distinto al registrado en schema_migrations). " +
          "No se puede continuar: crea una nueva migración en lugar de editar una aplicada.",);
    }
  }
}

/**
 * -----------------------------------------------------------------
 * Función: warnOrphaned
 * Propósito: Detecta si existen registros en la base de datos correspondientes
 * a migraciones que ya no se encuentran en el disco local (ficheros borrados
 * o movidos), emitiendo una advertencia en la consola.
 * -----------------------------------------------------------------
 */
function warnOrphaned(applied, migrations) {
  const existing = new Set(migrations.map((m) => m.file));
  for (const file of applied.keys()) {
    if (!existing.has(file)) {
      console.warn(`  ⚠ Registrada pero ausente en disco: ${file}`);
    }
  }
}

/**
 * -----------------------------------------------------------------
 * Función: applyMigration
 * Propósito: Ejecuta las sentencias SQL contenidas en un fichero de migración
 * dentro de la base de datos y, si tiene éxito, inserta un registro en la
 * tabla `schema_migrations` guardando el nombre del fichero y su checksum.
 * -----------------------------------------------------------------
 */
async function applyMigration(connection, { file, content, checksum }) {
  try {
    await connection.query(content);
    await connection.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)",
      [file, checksum],
    );
  } catch (error) {
    throw new Error (`Fallo al aplicar "${file}": ${error.message}. ` +
        "Revisa el estado de la base de datos antes de reintentar.",
      { cause: error });
  }
}

/**
 * -----------------------------------------------------------------
 * Función: main
 * Propósito: Función principal que coordina todo el flujo de ejecución:
 * 1. Importa la configuración y establece la conexión con MySQL.
 * 2. Carga y procesa los ficheros de migración locales.
 * 3. Asegura la existencia de la tabla de control.
 * 4. Valida integridad (checksums y huérfanos).
 * 5. Filtra e invoca la ejecución de las migraciones pendientes.
 * -----------------------------------------------------------------
 */
async function main() {
  const { dbDestination, poolOptions } = database;

  console.log(`==> Migraciones en ${MIGRATION_PATH}`);
  console.log(`==> Destino: ${dbDestination}`);

  const files = await getMigrations();
  const migrations = [];
  
  for (const file of files) {
    const content = await readFile(path.join(MIGRATION_PATH, file), "utf8");
    migrations.push({ file, content, checksum: calculateChecksum(content) });
  }

  console.log(
    `==> ${migrations.length} archivo(s) encontrados (orden alfabético)`,
  );

  const connection = await mysql.createConnection({
    ...poolOptions,
    multipleStatements: true,
  });

  try {
    await connection.query(CREATE_MIGRATION_TABLE);
    const applied = await getAppliedMigrations(connection);

    verifyChecksums(migrations, applied);
    warnOrphaned(applied, migrations);

    const pending = migrations.filter((m) => !applied.has(m.file));

    if (pending.length === 0) {
      console.log(
        `==> Sin cambios: ${applied.size} migración(es) ya aplicada(s). Base de datos al día.`,
      );
      return;
    }

    console.log(`==> ${pending.length} pendiente(s) de ${migrations.length}`);

    for (const migration of pending) {
      const start_date = Date.now();
      console.log(`  [APLICAR] ${migration.file} (${migration.checksum.slice(0, 12)}…)`);
      await applyMigration(connection, migration);
      const duration = Date.now() - start_date;
      console.log(`           ✓ aplicada y registrada (${duration} ms)`);
    }

    const total = applied.size + pending.length;
    console.log(`==> Listo: ${pending.length} aplicada(s); ${total}/${migrations.length} en total.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`✗ Error en la migración [${error.code ?? "UNKNOWN"}]: ${error.message}`);
  if (error.cause) {
    console.error(`  Causa: ${error.cause.message}`);
  }
  process.exitCode = 1;
});
// Script de migración de base de datos
// =============================================================
//
// Uso:
//   npm run db:migrate
//
// Qué hace:
//   1. Toma una conexión exclusiva del pool compartido
//      (`src/config/database.js`) y la devuelve al terminar.
//   2. Asegura la tabla de control `schema_migrations`.
//   3. Lee los ficheros `.sql` de `database/migrations` en orden
//      alfabético (prefijos numéricos: 001_, 002_, ...).
//   4. Comprueba el checksum (SHA-256) de las migraciones ya
//      aplicadas: si un fichero cambió después de aplicarse, aborta.
//   5. Parte cada fichero en sentencias y aplica solo las pendientes,
//      una a una, registrando filename + checksum.
//
// El SQL se divide en sentencias para poder usar el pool de la
// aplicación.
// =============================================================

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, dbDestination, pool } from "../src/config/database.js";

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
    const wrapped = new Error(
      `No se puede leer el directorio de migraciones: ${MIGRATION_PATH}`,
      { cause: error },
    );
    wrapped.code = "MIGRATIONS_DIR_NOT_FOUND";
    throw wrapped;
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
      const error = new Error(
        `El fichero "${file}" cambió después de haberse aplicado ` +
          "(checksum distinto al registrado en schema_migrations). " +
          "No se puede continuar: crea una nueva migración en lugar de editar una aplicada.",
      );
      error.code = "CHECKSUM_MISMATCH";
      throw error;
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
 * Función: findStringEnd
 * Propósito: Devuelve la posición de cierre de un literal entrecomillado
 * (`'`, `"` o `` ` ``), respetando los escapes con barra invertida (`\'`)
 * y las comillas duplicadas (`''`).
 * @param {string} content - Contenido completo del fichero.
 * @param {number} start - Posición de la comilla de apertura.
 * @param {string} quote - Comilla utilizada.
 * @returns {number} Índice justo después del literal (o fin del texto).
 * -----------------------------------------------------------------
 */
function findStringEnd(content, start, quote) {
  let index = start + 1;

  while (index < content.length) {
    const char = content[index];

    // Barra invertida: salta el siguiente carácter (no aplica a backticks)
    if (char === "\\" && quote !== "`") {
      index += 2;
      continue;
    }

    // Comilla duplicada dentro del literal: no cierra la cadena
    if (char === quote && content[index + 1] === quote) {
      index += 2;
      continue;
    }

    if (char === quote) {
      return index + 1;
    }

    index += 1;
  }

  return content.length;
}

/**
 * -----------------------------------------------------------------
 * Función: hasExecutableSql
 * Propósito: Comprueba que un fragmento contiene SQL real (y no solo
 * comentarios o espacios), para no acumular sentencias vacías al
 * dividir el fichero.
 * @param {string} fragment - Fragmento de SQL.
 * @returns {boolean}
 * -----------------------------------------------------------------
 */
function hasExecutableSql(fragment) {
  return (
    fragment
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .replace(/#[^\n]*/g, " ")
      .trim().length > 0
  );
}

/**
 * -----------------------------------------------------------------
 * Función: splitStatements
 * Propósito: Parte el contenido de un fichero `.sql` en sentencias
 * individuales para poder ejecutarlas con el pool de la aplicación,
 * que no habilita `multipleStatements`. Ignora comentarios de línea
 * (`--`, `#`), comentarios de bloque y comillas, de modo que
 * un `;` dentro de un literal o un comentario no corta la sentencia.
 * Limitación: no soporta bloques `DELIMITER` (migraciones con
 * procedimientos, triggers o funciones); el DDL de este proyecto no
 * los incluye.
 * @param {string} content - Contenido completo del fichero `.sql`.
 * @returns {string[]} Sentencias listas para `connection.query()`.
 * -----------------------------------------------------------------
 */
function splitStatements(content) {
  const statements = [];
  let buffer = "";
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    const nextChar = content[index + 1];

    // Comentario de línea: `--` seguido de espacio, o `#`
    const isLineComment =
      char === "#" || (char === "-" && nextChar === "-" && /\s/.test(content[index + 2] ?? " "));
    if (isLineComment) {
      const lineEnd = content.indexOf("\n", index);
      const stop = lineEnd === -1 ? content.length : lineEnd;
      buffer += content.slice(index, stop);
      index = stop;
      continue;
    }

    // Comentario de bloque: `/* ... */`
    if (char === "/" && nextChar === "*") {
      const blockEnd = content.indexOf("*/", index + 2);
      const stop = blockEnd === -1 ? content.length : blockEnd + 2;
      buffer += content.slice(index, stop);
      index = stop;
      continue;
    }

    // Literal entrecomillado: se copia entero, sin interpretar el `;`
    if (char === "'" || char === '"' || char === "`") {
      const stringEnd = findStringEnd(content, index, char);
      buffer += content.slice(index, stringEnd);
      index = stringEnd;
      continue;
    }

    // Fin de sentencia
    if (char === ";") {
      buffer += ";";
      if (hasExecutableSql(buffer)) {
        statements.push(buffer.trim());
      }
      buffer = "";
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  if (hasExecutableSql(buffer)) {
    statements.push(buffer.trim());
  }

  return statements;
}

/**
 * -----------------------------------------------------------------
 * Función: statementPreview
 * Propósito: Vista compacta de una sentencia para los mensajes de error
 * (una sola línea, máximo 80 caracteres).
 * @param {string} statement - Sentencia SQL.
 * @returns {string}
 * -----------------------------------------------------------------
 */
function statementPreview(statement) {
  const flat = statement.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

/**
 * -----------------------------------------------------------------
 * Función: applyMigration
 * Propósito: Divide el fichero de migración en sentencias y las ejecuta
 * una a una sobre la misma conexión (DDL en autocommit). Si todas
 * tienen éxito, inserta un registro en `schema_migrations` con el
 * nombre del fichero y su checksum. Ante cualquier fallo, el error
 * indica qué sentencia falló y no se registra la migración.
 * -----------------------------------------------------------------
 */
async function applyMigration(connection, { file, content, checksum }) {
  const statements = splitStatements(content);

  if (statements.length === 0) {
    const error = new Error(`El fichero "${file}" no contiene sentencias SQL ejecutables.`);
    error.code = "MIGRATION_FAILED";
    throw error;
  }

  for (const [position, statement] of statements.entries()) {
    try {
      await connection.query(statement);
    } catch (error) {
      const wrapped = new Error(
        `Fallo al aplicar "${file}" (sentencia ${position + 1} de ${statements.length}: ` +
          `${statementPreview(statement)}): ${error.message}. ` +
          "Revisa el estado de la base de datos antes de reintentar.",
        { cause: error },
      );
      wrapped.code = "MIGRATION_FAILED";
      throw wrapped;
    }
  }

  try {
    await connection.query("INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)", [
      file,
      checksum,
    ]);
  } catch (error) {
    const wrapped = new Error(
      `No se pudo registrar la migración "${file}": ${error.message}.`,
      { cause: error },
    );
    wrapped.code = "MIGRATION_FAILED";
    throw wrapped;
  }
}

/**
 * -----------------------------------------------------------------
 * Función: runMigrations
 * Propósito: coordina todo el flujo de ejecución:
 * 1. Obtiene una conexión exclusiva del pool compartido
 *    (`src/config/database.js`) y la devuelve al terminar.
 * 2. Carga y procesa los ficheros de migración locales.
 * 3. Asegura la existencia de la tabla de control.
 * 4. Valida integridad (checksums y huérfanos).
 * 5. Filtra e llama la ejecución de las migraciones pendientes.
 *
 * Se exporta para reutilizarla desde `database/reset-test.js`; el
 * cierre del pool lo gestiona quien la llama (nunca aquí, para no
 * cerrar un pool que aún necesita el script llamante).
 * -----------------------------------------------------------------
 */
export async function runMigrations() {
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

  const connection = await pool.getConnection();

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
      const startTime = Date.now();
      console.log(`  [APLICAR] ${migration.file} (${migration.checksum.slice(0, 12)}…)`);
      await applyMigration(connection, migration);
      const duration = Date.now() - startTime;
      console.log(`           ✓ aplicada y registrada (${duration} ms)`);
    }

    const total = applied.size + pending.length;
    console.log(`==> Listo: ${pending.length} aplicada(s); ${total}/${migrations.length} en total.`);
  } finally {
    // Devuelve la conexión al pool compartido. El cierre del pool
    // corresponde al script que llama a esta función (CLI o reset).
    connection.release();
  }
}

/**
 * -----------------------------------------------------------------
 * Función: cli
 * Propósito: ejecución del fichero como script (`npm run db:migrate`).
 * Formatea el error en consola, marca el código de salida y cierra el
 * pool de forma ordenada en cualquier ruta (éxito o fallo), de modo que
 * nunca queda un socket abierto tras terminar.
 * -----------------------------------------------------------------
 */
async function cli() {
  try {
    await runMigrations();
  } catch (error) {
    console.error(`✗ Error en la migración [${error.code ?? "UNKNOWN"}]: ${error.message}`);
    if (error.cause) {
      console.error(`  Causa: ${error.cause.message}`);
    }
    process.exitCode = 1;
  } finally {
    try {
      await closePool();
    } catch {
      // El pool ya estaba cerrado: no hay nada que liberar.
    }
  }
}

// Autoejecución solo cuando el fichero se invoca directamente
// (`node database/migrate.js`), nunca al importarlo desde otro módulo
// como `database/reset-test.js`.
const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  cli();
}
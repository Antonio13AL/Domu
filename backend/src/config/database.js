// =============================================================
// Configuración y pool de conexiones a MySQL.
// =============================================================
//
// · La validación de las variables se hace en `env.js`
//   (`validateDatabaseEnv`): aquí solo se consume el resultado.
// · El pool se encapsula en un campo privado `#pool` de la clase
//   `DatabaseConfig`: fuera solo se exporta la referencia y las
//   funciones de acceso.
// · Los scripts de BD (`migrate`, `seed`, `reset-test`) importan
//   `pool`, `poolOptions`, `dbDestination` y `closePool` desde aquí.
// =============================================================

import dotenv from "dotenv";
import mysql from "mysql2/promise";

import { validateDatabaseEnv } from "./env.js";

dotenv.config({ quiet: true });

// Charset de conexión utf8mb4 (4 bytes). La collation del proyecto
// se fija a nivel de base de datos en las migraciones.
const DB_CHARSET = "utf8mb4";

class DatabaseConfig {
  #pool;
  #options;
  #destination;

  /**
   * @param {object} config - Salida de `validateDatabaseEnv()` (ya validada).
   */
  constructor(config) {
    // Impedir modificaciones externas a las opciones del pool una vez creado.
    this.#options = Object.freeze({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.name,
      charset: DB_CHARSET,
      waitForConnections: true,
      connectionLimit: config.connectionLimit,
      queueLimit: 0, // 0 = peticiones ilimitadas en cola si el pool está lleno.
      timezone: "Z", // Fechas UTC.
    });

    // Identificación segura del destino, sin credenciales, para logs.
    this.#destination = `${config.user}@${config.host}:${config.port}/${config.name}`;

    // Ahora `mysql2` crea las conexiones: Crear el pool no abre ningún socket hasta la primera petición.
    this.#pool = mysql.createPool(this.#options);
  }

  /** Pool compartido por todos los repositorios. */
  get pool() {
    return this.#pool;
  }

  /** Opciones listas para `mysql.createPool()` y `mysql.createConnection()`. */
  get poolOptions() {
    return this.#options;
  }

  /** Destino de conexión para mensajes de log. */
  get destination() {
    return this.#destination;
  }

  /** Cierra el pool de forma ordenada. */
  async close() {
    await this.#pool.end();
  }
}

// Validación mínima: Los scripts de base de datos no exigen variables de la API como `JWT_SECRET`.
const databaseConfig = new DatabaseConfig(validateDatabaseEnv(process.env));

export const pool = databaseConfig.pool;
export const poolOptions = databaseConfig.poolOptions;
export const dbDestination = databaseConfig.destination;

/** Cierra el pool de forma ordenada. */
export async function closePool() {
  await databaseConfig.close();
}

/**
 * -----------------------------------------------------------------
 * Función: checkDatabaseConnection
 * Propósito: comprueba que MySQL responde antes de aceptar tráfico.
 * La llama a `server.js` al arrancar para fallar de forma clara si
 * el servidor no está disponible o las `DB_*` de `.env` son
 * incorrectas.
 * @returns {Promise<string>} Versión del servidor MySQL.
 * @throws {Error} Código `DATABASE_UNAVAILABLE`.
 * -----------------------------------------------------------------
 */
export async function checkDatabaseConnection() {
  let connection;

  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query("SELECT VERSION() AS version");
    return rows[0].version;
  } catch (cause) {
    const error = new Error(
      `No se pudo conectar a MySQL (${dbDestination}): ${cause.message}. ` +
        "Comprueba que el servidor esté levantado y que las variables DB_* de `.env` sean correctas.",
      { cause },
    );
    error.code = "DATABASE_UNAVAILABLE";
    throw error;
  } finally {
    // Si `getConnection()` falló no hay conexión que devolver.
    connection?.release();
  }
}

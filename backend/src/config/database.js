// =============================================================
// Configuración y pool de conexiones a MySQL.
// =============================================================

import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ quiet: true });

// Mínimo imprescindible para poder abrir cualquier conexión.
const DB_ENV = ["DB_HOST", "DB_USER", "DB_NAME"];

// Configuración de juego de caracteres e intercalación.
const DB_CHARSET = "utf8mb4";
const DB_COLLATION = "utf8mb4_0900_ai_ci";

class DatabaseConfig {
  #host;
  #port;
  #user;
  #password;
  #database;
  #connectionLimit;

  constructor() {
    const missingVars = DB_ENV.filter(
      (variable) => process.env[variable] === undefined || process.env[variable] === "",
    );

    if (missingVars.length > 0) {
      throw this.#missingEnvVarsError(missingVars);
    }

    this.#host = process.env.DB_HOST;
    this.#port = this.#parsePositiveInteger(process.env.DB_PORT ?? "3306", "DB_PORT");
    this.#user = process.env.DB_USER;
    // La contraseña puede ser vacía (p. ej. MySQL local sin contraseña),
    // pero la variable debe existir en `.env`.
    this.#password = process.env.DB_PASSWORD ?? "";
    this.#database = process.env.DB_NAME;
    this.#connectionLimit = this.#parsePositiveInteger(
      process.env.DB_CONNECTION_LIMIT ?? "10",
      "DB_CONNECTION_LIMIT",
    );
  }

  /**
   * Opciones listas para `mysql.createPool()` o `mysql.createConnection()`.
   * Se devuelve una copia congelada para impedir modificaciones externas.
   */
  get poolOptions() {
    return Object.freeze({
      host: this.#host,
      port: this.#port,
      user: this.#user,
      password: this.#password,
      database: this.#database,
      charset: DB_CHARSET,
      collation: DB_COLLATION,
      waitForConnections: true,
      connectionLimit: this.#connectionLimit,
      queueLimit: 0, // 0 = Peticiones ilimitadas en cola si el pool está lleno
      timezone: "Z", // Manejo consistente de fechas UTC (coincide con SET time_zone = '+00:00')
    });
  }

  /** Identificación segura del destino (sin credenciales) para logs. */
  get destination() {
    return `${this.#user}@${this.#host}:${this.#port}/${this.#database}`;
  }

  #missingEnvVarsError(missingVars) {
    const error = new Error(
      `Faltan variables de entorno obligatorias: ${missingVars.join(", ")}. ` +
        "Copia `backend/.env.example` a `backend/.env` y completa los valores.",
    );
    error.code = "MISSING_ENV_VARS";
    return error;
  }

  #parsePositiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
      const error = new Error(
        `La variable ${name} debe ser un entero positivo; valor recibido: "${value}".`,
      );
      error.code = "INVALID_ENV_VAR";
      throw error;
    }
    return number;
  }
}

const databaseConfig = new DatabaseConfig();

// Pool compartido por todos los repositories (`pool.query(sql, [params])`).
export const pool = mysql.createPool(databaseConfig.poolOptions);

// Opciones reutilizables por los scripts de base de datos (migraciones, seed).
export const poolOptions = databaseConfig.poolOptions;

// Destino de conexión para mensajes de log (nunca incluye la contraseña).
export const dbDestination = databaseConfig.destination;

/** Cierra el pool de forma ordenada (apagado limpio / fin de tests). */
export async function closePool() {
  await pool.end();
}
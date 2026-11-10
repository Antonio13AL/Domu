// =============================================================
// Variables de entorno de la aplicación.
// =============================================================
//
// Aquí se carga `.env` y valida el contrato completo de variables antes de
// arrancar. Si falta una o el valor no es válido, el proceso se cancela
// con un mensaje y un código de error.
//
// Tiene dos niveles de validación:
//
//   · `validateDatabaseEnv(): Solo conexión MySQL con las mismas
//     variables mínimas que ya exigía `database.js`. La usan los
//     scripts de BD `migrate`, `seed`, `reset-test`.
//
//   · `validateEnv()` y `loadEnv()`: Son Las 16 variables de `.env.example`. Lo usa `server.js` al arrancar.
//
// `loadEnv()` memoiza y lo llama dentro del `try/catch`
// del arranque para que el error salga limpio.
// =============================================================

import dotenv from "dotenv";

dotenv.config({ quiet: true });

// Las 16 variables de `.env.example`. Todas menos `DB_PASSWORD`
// deben tener valor no vacío. La contraseña de
// MySQL puede ser vacía en local, pero la clave debe estar definida.
const REQUIRED_ENV_VARS = [
  "NODE_ENV",
  "PORT",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_TEST_NAME",
  "DB_CONNECTION_LIMIT",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "CORS_ORIGIN",
  "BCRYPT_ROUNDS",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX",
  "AUTH_RATE_LIMIT_MAX",
];

// Clave que debe existir pero puede quedarse vacía.
const PRESENT_ONLY_ENV_VARS = new Set(["DB_PASSWORD"]);

// Valores de plantilla de `.env.example`.
const ENV_PLACEHOLDERS = {
  JWT_SECRET: "cambiar_por_un_secreto_de_32_caracteres_o_mas",
  DB_PASSWORD: "cambiar_en_local",
};

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);

// Identificador SQL seguro compuesto por letras, dígitos. Tiene máx. 64 caracteres.
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

// Duración de token (`8h`, `30m`, `7d`…).
const DURATION_PATTERN = /^\d{1,4}[smhdwy]$/;

// El secreto JWT debe tener al menos 32 caracteres.
const MINIMUM_JWT_SECRET_LENGTH = 32;

// bcrypt admite 4-31 rondas.
const MINIMUM_BCRYPT_ROUNDS = 10;
const MAXIMUM_BCRYPT_ROUNDS = 31;

/**
 * -----------------------------------------------------------------
 * Función: isBlank
 * Propósito: detecta una variable ausente, `null` o vacía.
 * @param {*} value - Valor a comprobar.
 * @returns {boolean}
 * -----------------------------------------------------------------
 */
function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

/**
 * -----------------------------------------------------------------
 * Función: buildMissingError
 * Propósito: construye el error estándar cuando faltan variables,
 * incluyendo la pista de cómo crear el fichero `.env`.
 * @param {string[]} missing - Nombres de las variables ausentes.
 * @returns {Error}
 * -----------------------------------------------------------------
 */
function buildMissingError(missing) {
  const error = new Error(
    `Faltan variables de entorno obligatorias: ${missing.join(", ")}. ` +
      "Copia `backend/.env.example` a `backend/.env` y completa los valores.",
  );
  error.code = "MISSING_ENV_VARS";
  return error;
}

/**
 * -----------------------------------------------------------------
 * Función: buildInvalidError
 * Propósito: construye el error estándar cuando el valor de alguna
 * variable no cumple su regla, listando todos los problemas a la vez.
 * @param {string[]} problems - Descripciones de cada problema.
 * @returns {Error}
 * -----------------------------------------------------------------
 */
function buildInvalidError(problems) {
  const error = new Error(
    `Variables de entorno inválidas:\n · ${problems.join("\n · ")}`,
  );
  error.code = "INVALID_ENV_VAR";
  return error;
}

/**
 * -----------------------------------------------------------------
 * Función: parseInteger
 * Propósito: convierte una variable a entero dentro de un rango,
 * acumulando el problema en `problems` en lugar de lanzar, para que
 * el usuario vea todos los errores de una sola vez.
 * @param {object} source - Entorno a validar.
 * @param {string} name - Nombre de la variable.
 * @param {object} range - `{ minimum, maximum }` (ambos opcionales).
 * @param {string[]} problems - Lista acumuladora de errores.
 * @returns {number|null} Valor convertido o `null` si es inválido.
 * -----------------------------------------------------------------
 */
function parseInteger(source, name, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER }, problems) {
  const raw = source[name];
  const value = Number(raw);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    const rangeText =
      maximum === Number.MAX_SAFE_INTEGER
        ? `un entero mayor o igual que ${minimum}`
        : `un entero entre ${minimum} y ${maximum}`;
    problems.push(`"${name}" debe ser ${rangeText}; valor recibido: "${raw}".`);
    return null;
  }

  return value;
}

/**
 * -----------------------------------------------------------------
 * Función: parseOrigins
 * Propósito: convierte `CORS_ORIGIN` (lista separada por comas) en un
 * array de orígenes validados y normalizados: se elimina la barra
 * final, porque las cabeceras `Origin` nunca la llevan y compararlos
 * con ella provocaría un CORS rechazado en silencio.
 * @param {string} raw - Valor de `CORS_ORIGIN`.
 * @param {string[]} problems - Lista acumuladora de errores.
 * @returns {string[]|null}
 * -----------------------------------------------------------------
 */
function parseOrigins(raw, problems) {
  const origins = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    problems.push(`"CORS_ORIGIN" debe listar al menos un origen; valor recibido: "${raw}".`);
    return null;
  }

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push(`"CORS_ORIGIN" contiene un origen no válido: "${origin}".`);
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      problems.push(`"CORS_ORIGIN" solo admite orígenes http/https: "${origin}".`);
    }
  }

  return origins;
}

/**
 * -----------------------------------------------------------------
 * Función: inspectDatabaseEnv
 * Propósito: valida y normaliza las variables de conexión MySQL sin
 * lanzar: devuelve los valores convertidos junto con las listas de
 * problemas. Es la base compartida por ambos validadores públicos.
 * @param {object} source - Entorno a validar (por defecto `process.env`).
 * @returns {{ db: object, missing: string[], problems: string[] }}
 * -----------------------------------------------------------------
 */
function inspectDatabaseEnv(source) {
  const missing = [];
  const problems = [];

  for (const name of ["DB_HOST", "DB_USER", "DB_NAME"]) {
    if (isBlank(source[name])) {
      missing.push(name);
    }
  }

  const dbPort = isBlank(source.DB_PORT)
    ? 3306
    : parseInteger(source, "DB_PORT", { minimum: 1, maximum: 65535 }, problems);

  const connectionLimit = isBlank(source.DB_CONNECTION_LIMIT)
    ? 10
    : parseInteger(source, "DB_CONNECTION_LIMIT", { minimum: 1 }, problems);

  if (!isBlank(source.DB_NAME) && !SQL_IDENTIFIER_PATTERN.test(String(source.DB_NAME).trim())) {
    problems.push(
      `"DB_NAME" no es un identificador SQL seguro: "${source.DB_NAME}" ` +
        "(solo letras, dígitos y guion bajo, máximo 64 caracteres).",
    );
  }

  if (!isBlank(source.DB_TEST_NAME) && !SQL_IDENTIFIER_PATTERN.test(String(source.DB_TEST_NAME).trim())) {
    problems.push(
      `"DB_TEST_NAME" no es un identificador SQL seguro: "${source.DB_TEST_NAME}" ` +
        "(solo letras, dígitos y guion bajo, máximo 64 caracteres).",
    );
  }

  const db = Object.freeze({
    host: isBlank(source.DB_HOST) ? "" : String(source.DB_HOST).trim(),
    port: dbPort ?? 3306,
    user: isBlank(source.DB_USER) ? "" : String(source.DB_USER).trim(),
    // Puede ser vacía (MySQL local sin contraseña); la clave debe existir.
    password: source.DB_PASSWORD === undefined || source.DB_PASSWORD === null
      ? ""
      : String(source.DB_PASSWORD),
    name: isBlank(source.DB_NAME) ? "" : String(source.DB_NAME).trim(),
    testName: isBlank(source.DB_TEST_NAME) ? "" : String(source.DB_TEST_NAME).trim(),
    connectionLimit: connectionLimit ?? 10,
  });

  return { db, missing, problems };
}

/**
 * -----------------------------------------------------------------
 * Función: validateDatabaseEnv
 * Propósito: validador mínimo de conexión MySQL para los scripts de
 * base de datos. Exige `DB_HOST`, `DB_USER` y `DB_NAME`; el resto usa
 * los mismos valores por defecto que `database.js`.
 * @param {object} [source] - Entorno a validar.
 * @returns {object} Configuración de base de datos congelada.
 * -----------------------------------------------------------------
 */
export function validateDatabaseEnv(source = process.env) {
  const { db, missing, problems } = inspectDatabaseEnv(source);

  if (missing.length > 0) {
    throw buildMissingError(missing);
  }

  if (problems.length > 0) {
    throw buildInvalidError(problems);
  }

  return Object.freeze({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    name: db.name,
    connectionLimit: db.connectionLimit,
  });
}

/**
 * -----------------------------------------------------------------
 * Función: validateEnv
 * Propósito: valida el contrato completo de las 16 variables de
 * `.env.example` y devuelve la configuración tipada y congelada.
 * Acumula todos los problemas en un único error.
 * @param {object} [source] - Entorno a validar.
 * @returns {object} Configuración congelada de la aplicación.
 * -----------------------------------------------------------------
 */
export function validateEnv(source = process.env) {
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    if (isBlank(source[name])) {
      // `DB_PASSWORD` solo debe existir (puede ser vacía en local).
      return !PRESENT_ONLY_ENV_VARS.has(name) || source[name] === undefined;
    }
    return false;
  });

  if (missing.length > 0) {
    throw buildMissingError(missing);
  }

  const { db, problems } = inspectDatabaseEnv(source);

  if (isBlank(source.NODE_ENV) || !VALID_NODE_ENVS.has(String(source.NODE_ENV).trim())) {
    problems.push(
      `"NODE_ENV" debe ser uno de: development, test, production; ` +
        `valor recibido: "${source.NODE_ENV}".`,
    );
  }

  const port = parseInteger(source, "PORT", { minimum: 1, maximum: 65535 }, problems);

  const jwtSecret = String(source.JWT_SECRET);
  if (jwtSecret.length < MINIMUM_JWT_SECRET_LENGTH) {
    problems.push(
      `"JWT_SECRET" debe tener al menos ${MINIMUM_JWT_SECRET_LENGTH} caracteres ` +
        `(actual: ${jwtSecret.length}).`,
    );
  }

  const jwtExpiresIn = String(source.JWT_EXPIRES_IN).trim();
  if (!DURATION_PATTERN.test(jwtExpiresIn)) {
    problems.push(
      `"JWT_EXPIRES_IN" debe tener formato número + unidad (s, m, h, d); ` +
        `valor recibido: "${source.JWT_EXPIRES_IN}".`,
    );
  }

  const corsOrigins = parseOrigins(String(source.CORS_ORIGIN), problems);

  const bcryptRounds = parseInteger(
    source,
    "BCRYPT_ROUNDS",
    { minimum: MINIMUM_BCRYPT_ROUNDS, maximum: MAXIMUM_BCRYPT_ROUNDS },
    problems,
  );

  const windowMs = parseInteger(source, "RATE_LIMIT_WINDOW_MS", { minimum: 1 }, problems);
  const rateLimitMax = parseInteger(source, "RATE_LIMIT_MAX", { minimum: 1 }, problems);
  const authRateLimitMax = parseInteger(
    source,
    "AUTH_RATE_LIMIT_MAX",
    { minimum: 1 },
    problems,
  );

  // En producción no se aceptan valores de plantilla ni secretos débiles.
  const nodeEnv = String(source.NODE_ENV).trim();
  if (nodeEnv === "production") {
    if (jwtSecret === ENV_PLACEHOLDERS.JWT_SECRET) {
      problems.push(
        `"JWT_SECRET" sigue con el valor de plantilla de \`.env.example\`; genera un secreto propio.`,
      );
    }
    if (isBlank(source.DB_PASSWORD) || source.DB_PASSWORD === ENV_PLACEHOLDERS.DB_PASSWORD) {
      problems.push(
        `"DB_PASSWORD" no puede quedar vacía ni con el valor de plantilla en producción.`,
      );
    }
  }

  if (problems.length > 0) {
    throw buildInvalidError(problems);
  }

  return Object.freeze({
    nodeEnv,
    port,
    db: Object.freeze({
      ...db,
      port: db.port,
    }),
    jwt: Object.freeze({ secret: jwtSecret, expiresIn: jwtExpiresIn }),
    corsOrigins: Object.freeze(corsOrigins),
    bcryptRounds,
    rateLimit: Object.freeze({
      windowMs,
      max: rateLimitMax,
      authMax: authRateLimitMax,
    }),
  });
}

let cachedEnv = null;

/**
 * -----------------------------------------------------------------
 * Función: loadEnv
 * Propósito: punto de entrada cómodo para la aplicación. Valida una
 * sola vez y devuelve siempre la misma configuración congelada.
 * Es perezosa a propósito: importar este módulo nunca lanza, de modo
 * que `server.js` puede capturar el error y mostrarlo sin stack.
 * @returns {object} Configuración congelada de la aplicación.
 * -----------------------------------------------------------------
 */
export function loadEnv() {
  if (cachedEnv === null) {
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
}

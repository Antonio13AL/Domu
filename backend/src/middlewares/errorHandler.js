// =============================================================
// Manejador global de errores (último middleware de Express).
// =============================================================
//
// Responsabilidades:
//
//   1. Formato estándar: `{ status: "error", error: { code,
//      message, details } }`.
//   2. Mapeo de errores de MySQL a códigos HTTP de la API:
//        · `ER_DUP_ENTRY` (1062)          → 409 `CONFLICT`
//        · `ER_ROW_IS_REFERENCED` (1451)  → 409 `CONFLICT`
//        · resto de violaciones de datos  → 400 `VALIDATION_ERROR`
//   3. Errores lanzados por servicios (`AppError`, `BE-03`): se
//      respetan `statusCode`, `code` y `details` tal cual.
//   4. Errores del body parser (`entity.too.large`, JSON inválido):
//      → 400 `VALIDATION_ERROR`. No define un código 413,
//      así que se trata como datos inválidos.
//   5. Los 5xx se registran en consola; los 4xx no generan ruido.
//      Nunca se filtran detalles internos de MySQL al cliente.
// =============================================================

/**
 * -----------------------------------------------------------------
 * Constante: MYSQL_ERROR_MESSAGES
 * Propósito: traducción al español de los errores de MySQL que la
 * API puede devolver de forma controlada. El texto original de MySQL
 * (en inglés) nunca se expone: puede contener valores internos.
 * @type {Record<string, { statusCode: number, code: string, message: string }>}
 * -----------------------------------------------------------------
 */
const MYSQL_ERROR_MESSAGES = {
  ER_DUP_ENTRY: {
    statusCode: 409,
    code: "CONFLICT",
    message: "Ya existe un registro con estos datos.",
  },
  // mysql2 expone el código `ER_ROW_IS_REFERENCED_2` (errno 1451);
  // `ER_ROW_IS_REFERENCED` se mantiene por si cambia el driver.
  ER_ROW_IS_REFERENCED_2: {
    statusCode: 409,
    code: "CONFLICT",
    message: "No se puede eliminar el recurso porque está vinculado a otros registros.",
  },
  ER_ROW_IS_REFERENCED: {
    statusCode: 409,
    code: "CONFLICT",
    message: "No se puede eliminar el recurso porque está vinculado a otros registros.",
  },
  ER_NO_REFERENCED_ROW_2: {
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "El registro relacionado no existe.",
  },
  ER_CHECK_CONSTRAINT_VIOLATED: {
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "Los datos no cumplen las restricciones permitidas.",
  },
  ER_DATA_TOO_LONG: {
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "Un dato supera la longitud permitida.",
  },
  ER_BAD_NULL_ERROR: {
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "Falta un dato obligatorio.",
  },
};

/**
 * -----------------------------------------------------------------
 * Función: normalizeError
 * Propósito: convertir cualquier error recibido en la forma
 * `{ statusCode, code, message, details }`. Primero los errores ya
 * controlados por la aplicación, después los de MySQL, después los
 * del body parser y, por último, un 500 genérico.
 * @param {Error & object} error - Error recibido del middleware
 * anterior o de una promesa rechazada.
 * @returns {{ statusCode: number, code: string, message: string, details: null | object }}
 * -----------------------------------------------------------------
 */
function normalizeError(error) {
  // 1. Error de aplicación controlado (`AppError` o un  error de
  // servicio con `statusCode`/`code` explícitos).
  if (error && typeof error.statusCode === "number" && error.code) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    };
  }

  // 2. Errores de MySQL identificados por nombre o número errno.
  if (error && typeof error.code === "string" && MYSQL_ERROR_MESSAGES[error.code]) {
    return { ...MYSQL_ERROR_MESSAGES[error.code], details: null };
  }

  // 3. Cuerpo demasiado grande (`express.json({ limit: "1mb" })`).
  if (error && error.type === "entity.too.large") {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "El cuerpo de la petición supera el tamaño máximo permitido (1 MB).",
      details: null,
    };
  }

  // 4. JSON inválido o codificación no soportada (body parser).
  if (error && (error.type === "encoding.unsupported" || (error instanceof SyntaxError && typeof error.status === "number" && error.status < 500))) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "El cuerpo de la petición no contiene JSON válido.",
      details: null,
    };
  }

  // 5. Sin conexión con MySQL (el pool está caído o se perdió).
  if (error && (error.code === "ECONNREFUSED" || error.code === "PROTOCOL_CONNECTION_LOST")) {
    return {
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "No hay conexión con la base de datos. Inténtelo de nuevo más tarde.",
      details: null,
    };
  }

  // 6. Cualquier otro fallo: 500 sin detalles internos.
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Se ha producido un error interno. Inténtelo de nuevo más tarde.",
    details: null,
  };
}

/**
 * -----------------------------------------------------------------
 * Middleware: errorHandler
 * Propósito: enviar la respuesta de error con el formato estándar y
 * registrar en consola los fallos 5xx (con stack solo en desarrollo).
 *
 * Express la reconoce como manejador de errores únicamente por su aridad.
 * @param {Error & object} error - Error capturado.
 * @param {object} _req - Petición HTTP (solo para el registro).
 * @param {object} res - Respuesta HTTP de Express.
 * @param {Function} next - Siguiente middleware (para propagar si las
 * cabeceras ya se enviaron).
 * @returns {void}
 * -----------------------------------------------------------------
 */
export function errorHandler(error, _req, res, next) {
  // Si la respuesta ya empezó a emitirse no se puede reescribir:
  // se deja el error para el manejador por defecto de Express.
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);

  // Registro solo de errores no controlados (5xx). Los 4xx son
  // comportamiento esperado y no deben ensuciar los logs.
  if (normalized.statusCode >= 500) {
    console.error(
      `[error] ${_req.method} ${_req.originalUrl} → ${normalized.code}: ${normalized.message}`,
    );
    if (process.env.NODE_ENV !== "production" && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  }

  const payload = {
    status: "error",
    error: {
      code: normalized.code,
      message: normalized.message,
      // `details` solo se emite para `VALIDATION_ERROR`.
      details: normalized.code === "VALIDATION_ERROR" ? normalized.details : null,
    },
  };

  res.status(normalized.statusCode).json(payload);
}

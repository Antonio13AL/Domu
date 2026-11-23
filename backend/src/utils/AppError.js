// =============================================================
// Error de aplicación.
// =============================================================
//
// Los servicios nunca responden HTTP: Lanzan `AppError` y el
// middleware `src/middlewares/errorHandler.js` traduce la instancia
// a `{ status: "error", error: { code, message, details } }`.
//
// `AppError` conserva exactamente las tres propiedades: `statusCode`, `code` y `details`.
// =============================================================

/**
 * -----------------------------------------------------------------
 * La constante es: ErrorCodes
 * El propósito es mostrar los códigos de error de la API, congelados. Son los
 * únicos valores admitidos en `AppError.code`.
 * @type {Readonly<Record<string, string>>}
 * -----------------------------------------------------------------
 */
export const ErrorCodes = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

/**
 * -----------------------------------------------------------------
 * La clase es: AppError
 * El propósito es mostrar el error controlado con estado HTTP, código de la API y
 * detalles opcionales. Se lanza en services y se propaga hasta el manejador global de errores.
 *
 * Se usa de la siguiente manera:
 *   throw AppError.notFound("La incidencia solicitada no existe.");
 *   throw AppError.validation("El título es obligatorio.", { field: "title" });
 * -----------------------------------------------------------------
 */
export class AppError extends Error {
  /**
   * @param {string} message - Mensaje en español para el cliente.
   * @param {object} options - Opciones del error.
   * @param {number} options.statusCode - Estado HTTP (400-599).
   * @param {string} options.code - Código de error.
   * @param {null | object} [options.details] - Detalle adicional;
   * solo se emite en respuestas `VALIDATION_ERROR`.
   * @param {unknown} [options.cause] - Error original, si lo hubiera.
   */
  constructor(message, { statusCode, code, details = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });

    if (typeof message !== "string" || message.trim() === "") {
      throw new TypeError("AppError requiere un mensaje no vacío.");
    }
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new TypeError(`AppError requiere un statusCode entre 400 y 599 (recibido: ${statusCode}).`);
    }
    if (!Object.hasOwn(ErrorCodes, code)) {
      throw new TypeError(`Código de error no permitido: "${code}".`);
    }

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  /** 400 — datos de entrada inválidos. */
  static validation(message, details = null) {
    return new AppError(message, {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      details,
    });
  }

  /** 401 — token ausente, inválido o expirado. */
  static unauthorized(message = "Debe autenticarse para acceder a este recurso.") {
    return new AppError(message, { statusCode: 401, code: ErrorCodes.UNAUTHORIZED });
  }

  /** 403 — rol u ownership insuficiente. */
  static forbidden(message = "No tiene permisos para realizar esta operación.") {
    return new AppError(message, { statusCode: 403, code: ErrorCodes.FORBIDDEN });
  }

  /** 404 — recurso inexistente. */
  static notFound(message = "El recurso solicitado no existe.") {
    return new AppError(message, { statusCode: 404, code: ErrorCodes.NOT_FOUND });
  }

  /** 409 — duplicado, solapamiento o transición inválida. */
  static conflict(message = "La operación entra en conflicto con el estado actual del recurso.") {
    return new AppError(message, { statusCode: 409, code: ErrorCodes.CONFLICT });
  }

  /** 429 — demasiadas peticiones. */
  static rateLimited(message = "Demasiadas peticiones. Inténtelo de nuevo más tarde.") {
    return new AppError(message, { statusCode: 429, code: ErrorCodes.RATE_LIMITED });
  }

  /** 500 — fallo no controlado (el mensaje se muestra al cliente). */
  static internal(message = "Se ha producido un error interno. Inténtelo de nuevo más tarde.") {
    return new AppError(message, { statusCode: 500, code: ErrorCodes.INTERNAL_ERROR });
  }
}

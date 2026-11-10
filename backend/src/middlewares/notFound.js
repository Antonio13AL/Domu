// =============================================================
// Middleware de ruta no encontrada (404).
// =============================================================
//
// Se monta después de todas las rutas y antes del `errorHandler`.
// Respeta el formato de error: `status` + `error.code` +
// `error.message` + `details`.
//
// El mensaje es fijo (no se refleja `req.originalUrl`) para no
// devolver contenido entrante en la respuesta.
// =============================================================

/**
 * -----------------------------------------------------------------
 * Middleware: notFound
 * Propósito: responder `404 NOT_FOUND` para cualquier ruta que no
 * haya sido registrada por la capa de rutas.
 * @param {object} _req - Petición HTTP (no se usa).
 * @param {object} res - Respuesta HTTP de Express.
 * @returns {void}
 * -----------------------------------------------------------------
 */
export function notFound(_req, res) {
  return res.status(404).json({
    status: "error",
    error: {
      code: "NOT_FOUND",
      message: "La ruta solicitada no existe.",
      details: null,
    },
  });
}

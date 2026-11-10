// =============================================================
// Middlewares de autenticación y autorización.
// =============================================================
//
// `authenticateToken`:
//   1. Exige cabecera `Authorization: Bearer <token>`.
//   2. Verifica firma y caducidad (`security/token.js`).
//   3. Carga el usuario activo desde la base de datos
//      (`services/authService.js` → `repositories/authRepository.js`).
//   4. Adjunta `req.user = { id, role, email }`.
//   Cualquier fallo → 401 `UNAUTHORIZED` con cabecera
//   `WWW-Authenticate: Bearer`.
//
// `authorizeRoles(roles)`:
//   · 401 si no hay `req.user` (se olvidó `authenticateToken`).
//   · 403 `FORBIDDEN` si el rol no está en la lista blanca.
//
// Los mensajes son genéricos: no distinguen entre «token inválido»,
// «cuenta desactivada» y «usuario inexistente» ante el cliente.
// =============================================================

import { isRole } from "../enums/Role.js";
import { AppError } from "../utils/AppError.js";
import { verifyToken } from "../security/token.js";
import { AuthService } from "../services/authService.js";

// Instancia única: el servicio no guarda estado por petición.
const authService = new AuthService();

/**
 * -----------------------------------------------------------------
 * Middleware: authenticateToken
 * Propósito: validar el token Bearer y cargar el usuario activo en
 * `req.user`.
 * @param {object} req - Petición HTTP.
 * @param {object} res - Respuesta HTTP.
 * @param {Function} next - Siguiente middleware.
 * @returns {Promise<void>}
 * -----------------------------------------------------------------
 */
export async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (typeof header !== "string") {
      throw AppError.unauthorized("Falta la cabecera Authorization.");
    }

    // Un único token.
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) {
      throw AppError.unauthorized('La cabecera Authorization debe contener un token Bearer.');
    }

    const payload = verifyToken(match[1]);
    const user = await authService.getAuthenticatedUser(payload.sub);

    req.user = user;
    next();
  } catch (error) {
    // Los 401 llevan la cabecera `WWW-Authenticate`.
    if (error instanceof AppError && error.statusCode === 401 && !res.headersSent) {
      res.setHeader("WWW-Authenticate", "Bearer");
    }
    next(error);
  }
}

/**
 * -----------------------------------------------------------------
 * Función: authorizeRoles
 * Propósito: fabricar un middleware que comprueba el rol de
 * `req.user` contra una lista blanca.
 * @param {readonly string[]} roles - Roles permitidos
 * (`NEIGHBOR`, `PRESIDENT`).
 * @returns {(req: object, res: object, next: Function) => void}
 * Middleware de autorización.
 * @throws {TypeError} Si la lista está vacía o contiene un rol que
 * no existe (error de programación, no de usuario).
 * -----------------------------------------------------------------
 */
export function authorizeRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new TypeError("authorizeRoles requiere una lista de roles no vacía.");
  }
  for (const role of roles) {
    if (!isRole(role)) {
      throw new TypeError(`authorizeRoles: rol no válido "${String(role)}".`);
    }
  }

  const allowed = new Set(roles);

  return function authorizeRole(req, res, next) {
    if (!req.user) {
      // No se puede autorizar sin haberse autenticado antes.
      next(AppError.unauthorized("Debe autenticarse para acceder a este recurso."));
      return;
    }

    if (!allowed.has(req.user.role)) {
      next(AppError.forbidden("No tiene permisos para realizar esta operación."));
      return;
    }

    next();
  };
}

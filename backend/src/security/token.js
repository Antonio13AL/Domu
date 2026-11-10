// =============================================================
// Firma y verificación de JWT.
// =============================================================
//
// Contrato del token:
//   · Payload mínimo: `sub` (id de usuario, string), `role`,
//     `iat` y `exp`. Sin datos sensibles (nada de email, contraseña
//     ni vivienda).
//   · Secreto y caducidad desde `JWT_SECRET` / `JWT_EXPIRES_IN`
//     (8 h por defecto), ya validados por `env.js`.
//   · Cualquier fallo de verificación se traduce en `AppError` 401
//     con mensaje en español; el motivo técnico de jsonwebtoken
//     (firma, caducidad, mal formato) no se expone al cliente.
//
// El `role` viaja en el payload por contrato, pero la autorización
// usa siempre el valor de la base de datos (lo carga
// `authenticateToken`), de modo que un cambio de rol surte efecto
// sin esperar a que caduque el token.
// =============================================================

import jwt from "jsonwebtoken";

import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

/**
 * -----------------------------------------------------------------
 * Función: signToken
 * Propósito: firmar un token de sesión para un usuario.
 * @param {object} input - Datos del usuario.
 * @param {number | string} input.userId - Identificador (`sub`).
 * @param {string} input.role - Rol del usuario (`NEIGHBOR`|`PRESIDENT`).
 * @returns {string} Token JWT firmado.
 * -----------------------------------------------------------------
 */
export function signToken({ userId, role }) {
  if ((typeof userId !== "number" && typeof userId !== "string") || String(userId).length === 0) {
    throw new TypeError("signToken requiere un userId.");
  }
  if (typeof role !== "string" || role.length === 0) {
    throw new TypeError("signToken requiere un role.");
  }

  const { jwt: jwtConfig } = loadEnv();

  // `subject` coloca el id en `sub`; `expiresIn` añade `exp` y el
  // propio jsonwebtoken registra `iat`.
  return jwt.sign({ role }, jwtConfig.secret, {
    subject: String(userId),
    expiresIn: jwtConfig.expiresIn,
  });
}

/**
 * -----------------------------------------------------------------
 * Función: verifyToken
 * Propósito: verificar firma y caducidad de un token y devolver su
 * payload. Lanza `AppError` 401 ante cualquier problema.
 * @param {string} token - Token recibido en `Authorization`.
 * @returns {{ sub: string, role: string, iat: number, exp: number }}
 * Payload verificado.
 * -----------------------------------------------------------------
 */
export function verifyToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw AppError.unauthorized("El token de autenticación no es válido.");
  }

  const { jwt: jwtConfig } = loadEnv();

  let payload;
  try {
    payload = jwt.verify(token, jwtConfig.secret);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized("El token de autenticación ha expirado. Inicie sesión de nuevo.");
    }
    // `JsonWebTokenError`, `NotBeforeError` y cualquier otro fallo
    // de verificación: mismo mensaje, sin detalles internos.
    throw AppError.unauthorized("El token de autenticación no es válido.");
  }

  if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw AppError.unauthorized("El token de autenticación no es válido.");
  }

  return payload;
}

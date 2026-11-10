// =============================================================
// Cifrado de contraseñas — bcrypt.
// =============================================================
//
// • Coste tomado de `BCRYPT_ROUNDS`: determina la complejidad del
//   hash y el tiempo de cálculo.
// • `verifyPassword` devuelve `false` ante entradas no válidas en
//   lugar de lanzar: un hash corrupto no debe tumbar el login ni
//   revelar información distinta según el tipo de dato recibido.
// • bcrypt ya integra el salt en el hash; no se genera aparte.
// =============================================================

import bcrypt from "bcryptjs";

import { loadEnv } from "../config/env.js";

/**
 * -----------------------------------------------------------------
 * Función: hashPassword
 * Propósito: generar el hash de una contraseña con el coste
 * configurado en el entorno.
 * @param {string} password - Contraseña en texto plano.
 * @returns {Promise<string>}`Hash` bcrypt.
 * -----------------------------------------------------------------
 */
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("hashPassword requiere una contraseña no vacía de tipo string.");
  }

  const { bcryptRounds } = loadEnv();
  return bcrypt.hash(password, bcryptRounds);
}

/**
 * -----------------------------------------------------------------
 * Función: verifyPassword
 * Propósito: comparar una contraseña en texto plano con su hash
 * (comparación en tiempo constante que realiza bcrypt).
 * @param {string} password - Contraseña candidata.
 * @param {string} hash - Hash almacenado.
 * @returns {Promise<boolean>} `true` si coinciden.
 * -----------------------------------------------------------------
 */
export async function verifyPassword(password, hash) {
  if (typeof password !== "string" || typeof hash !== "string" || hash.length === 0) {
    return false;
  }

  return bcrypt.compare(password, hash);
}

/**
 * -----------------------------------------------------------------
 * Función: getPasswordRounds
 * Propósito: exponer el coste configurado.
 * @returns {number} Coste bcrypt vigente.
 * -----------------------------------------------------------------
 */
export function getPasswordRounds() {
  return loadEnv().bcryptRounds;
}

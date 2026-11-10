// =============================================================
// Límite de peticiones para la autenticación.
// =============================================================
//
// Los límites NO van aquí: se leen del entorno, que es donde ya
// estaban definidos en `.env`:
//
//   · `RATE_LIMIT_WINDOW_MS` = 900000 (15 minutos)
//   · `AUTH_RATE_LIMIT_MAX`  = 5       (intentos por ventana)
//
// Aplicación:
//
//   · `/auth/login`    → `authMax` intentos por IP + correo
//   · `/auth/register` → `authMax` intentos por IP
//
// El límite de login se agrupa también por correo para que un
// atacante no pueda fuerza-bruta una cuenta concreta desde muchas
// IPs, y para que una IP no bloquee a todos los usuarios legítimos
// detrás de ella. Cada limitador lleva su propia tienda, así que
// login y registro cuentan por separado.
//
// La tienda en memoria (`MemoryStore`) es suficiente para el MVP,
// que se despliega en una sola instancia de Node.
//
// Respuesta: `429 RATE_LIMITED` con el formato estándar, delegando
// en el `errorHandler` global.
// =============================================================

import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const { rateLimit: rateLimitEnv } = loadEnv();

/**
 * -----------------------------------------------------------------
 * Constante: AUTH_RATE_LIMITS
 * Propósito: límites congelados que vienen del entorno.
 * @type {Readonly<{ windowMs: number, authMax: number }>}
 * -----------------------------------------------------------------
 */
export const AUTH_RATE_LIMITS = Object.freeze({
  windowMs: rateLimitEnv.windowMs,
  authMax: rateLimitEnv.authMax,
});

/**
 * -----------------------------------------------------------------
 * Función: createAuthRateLimit
 * Propósito: fabricar un limitador con el formato de error del
 * proyecto (en lugar de la respuesta por defecto de la librería).
 * @param {object} options - Opciones del limitador.
 * @param {string} options.message - Mensaje.
 * @param {(req: object) => string} options.keyGenerator - Clave.
 * @returns {Function} Middleware de Express.
 * -----------------------------------------------------------------
 */
function createAuthRateLimit({ message, keyGenerator }) {
  return rateLimit({
    windowMs: AUTH_RATE_LIMITS.windowMs,
    max: AUTH_RATE_LIMITS.authMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res, next) => next(AppError.rateLimited(message)),
  });
}

/** Limitador de `POST /auth/login` (IP + correo). */
export const loginRateLimit = createAuthRateLimit({
  message: "Demasiados intentos de acceso. Inténtelo de nuevo en unos minutos.",
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
});

/** Limitador de `POST /auth/register` (IP). */
export const registerRateLimit = createAuthRateLimit({
  message: "Demasiadas peticiones de registro. Inténtelo de nuevo en unos minutos.",
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

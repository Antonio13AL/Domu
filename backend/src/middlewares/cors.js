// =============================================================
// Middleware de CORS con allowlist.
// =============================================================
//
// Solo se aceptan los orígenes declarados en `CORS_ORIGIN` (ya
// validados y normalizados por `env.js`, sin barra final). Cualquier
// otro origen se rechaza devolviendo `false`, lo que omite las
// cabeceras CORS: el navegador bloquea la petición y no hay cabeceras
// reflejadas que un atacante pueda explotar.
//
// Sin `credentials`: la API usa tokens JWT en la cabecera
// `Authorization`, no cookies, así que `Access-Control-Allow-Credentials`
// no es necesario y se evita el riesgo de sitios con credenciales.
// =============================================================

import cors from "cors";
import { loadEnv } from "../config/env.js";

/**
 * -----------------------------------------------------------------
 * Función: createCorsPolicy
 * Propósito: construye el middleware CORS con la allowlist cargada
 * desde las variables de entorno.
 *
 * Se crea en tiempo de arranque (y no en tiempo de importación del
 * módulo) para que `loadEnv()` se ejecute después de que `server.js`
 * haya validado el entorno: así un error de configuración sigue
 * fallando con código claro y no dentro de Express.
 * @returns {Function} Middleware de CORS de Express.
 * -----------------------------------------------------------------
 */
export function createCorsPolicy() {
  const { corsOrigins } = loadEnv();

  return cors({
    origin(origin, callback) {
      // Peticiones sin cabecera `Origin` (curl, server-to-server,
      // healthchecks): se permiten, no son navegadores.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, corsOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    optionsSuccessStatus: 204,
  });
}

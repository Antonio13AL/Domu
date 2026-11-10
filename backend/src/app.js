// =============================================================
// Aplicación Express: montaje de middlewares y rutas.
// =============================================================
//
//   1. `trust proxy` — detrás de Apache, para que `req.ip` y el
//      rate limit futuro vean la IP real.
//   2. `morgan` — logger de peticiones (formato según `NODE_ENV`).
//   3. `helmet` — cabeceras de seguridad por defecto.
//   4. CORS con allowlist desde `CORS_ORIGIN`.
//   5. `express.json({ limit: "1mb" })` — cuerpo JSON limitado.
//   6. Router de la API en `/api/v1`.
//   7. `notFound` — 404 con formato estándar.
//   8. `errorHandler` — errores → `{ status, error }` y mapeo de
//      MySQL (`ER_DUP_ENTRY`, `ER_ROW_IS_REFERENCED`, …).
//
// El entorno ya está validado cuando `server.js` importa este
// módulo, por lo que `loadEnv()` aquí no puede fallar.
// =============================================================

import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { loadEnv } from "./config/env.js";
import { createCorsPolicy } from "./middlewares/cors.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import apiRouter from "./routes/index.js";

const env = loadEnv();

const app = express();

// Detrás de Apache: confía en el primer proxy inverso para
// que `req.ip` refleje el cliente real y no la IP del proxy.
app.set("trust proxy", 1);

// `x-powered-by` revela el framework; `helmet` ya lo desactiva, pero
// se apaga además a nivel de aplicación por si se retira `helmet`.
app.disable("x-powered-by");

// 1. Logger: `dev` en desarrollo (coloreado, conciso), `combined` en
//    producción. Nunca registra cuerpos ni cabeceras `Authorization`.
//    En `test` no se registra: inundaría la salida de la suite de integración.
if (env.nodeEnv !== "test") {
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
}

// 2. Cabeceras de seguridad (CSP, HSTS, X-Frame-Options, …).
app.use(helmet());

// 3. CORS: solo orígenes de la allowlist.
app.use(createCorsPolicy());

// 4. Cuerpo JSON limitado a 1 MB.
app.use(express.json({ limit: "1mb" }));

// 5. API versionada.
app.use("/api/v1", apiRouter);

// 6. Ruta no encontrada.
app.use(notFound);

// 7. Manejador global de errores (siempre el último).
app.use(errorHandler);

export default app;

// =============================================================
// Punto de entrada del backend Domu.
// =============================================================
//
// Uso:
//   npm run dev     (node --watch server.js)
//   npm start       (node server.js)
//
// Secuencia de arranque:
//   1. `loadEnv()` valida las 16 variables de `.env.example`.
//      Si falta o sobra algo, el proceso termina con código 1 y un
//      mensaje en español sin stack trace.
//   2. `checkDatabaseConnection()` comprueba que MySQL responde
//      (código `DATABASE_UNAVAILABLE` si no).
//   3. Se carga la aplicación (`src/app.js`) y se abre el puerto HTTP.
// =============================================================

/**
 * -----------------------------------------------------------------
 * Función: listen
 * Propósito: abre el servidor HTTP devolviendo una promesa, para
 * poder tratar los errores de arranque (p. ej. puerto ocupado) con el
 * mismo flujo que el resto de fallos.
 *
 * IMPORTANTE: no se pasa callback a `app.listen()`. Express registra
 * ese callback también como oyente de `error` (lo envuelve en `once`
 * y lo invoca con el error como primer argumento), por lo que con un
 * callback la promesa se resolvería incluso cuando el bind falla y el
 * `reject` posterior llegaría tarde. Se usan los eventos `listening`
 * y `error` de forma explícita.
 * @param {object} app - Aplicación Express.
 * @param {number} port - Puerto a escuchar.
 * @returns {Promise<object>} Servidor HTTP de Node.
 * -----------------------------------------------------------------
 */
function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

// Módulo de base de datos una vez cargado. Se guarda fuera de
// `bootstrap()` para que el `catch` pueda cerrar el pool: si no se
// cierra, el proceso no terminaría porque el pool mantiene al menos
// una conexión abierta en el event loop.
let databaseModule = null;

async function bootstrap() {
  // 1. Configuración (validación de variables de entorno).
  const { loadEnv } = await import("./src/config/env.js");
  const env = loadEnv();

  console.log(`==> Entorno: ${env.nodeEnv} · Puerto ${env.port}`);

  // 2. Base de datos (falla claro si MySQL no responde).
  databaseModule = await import("./src/config/database.js");
  const { checkDatabaseConnection, dbDestination } = databaseModule;
  const mysqlVersion = await checkDatabaseConnection();
  console.log(`==> MySQL ${mysqlVersion} disponible en ${dbDestination}`);

  // 3. Aplicación y servidor HTTP.
  const { default: app } = await import("./src/app.js");
  const server = await listen(app, env.port);

  console.log(`==> API escuchando en http://127.0.0.1:${env.port}`);

  return server;
}

bootstrap().catch(async (error) => {
  // Cerrar el pool si llegó a crearse (sin él, el proceso quedaría
  // vivo con el event loop ocupado por la conexión de MySQL).
  if (databaseModule) {
    await databaseModule.closePool().catch(() => {});
  }

  const code = error.code === "EADDRINUSE" ? "PORT_IN_USE" : (error.code ?? "UNKNOWN");

  if (code === "PORT_IN_USE") {
    console.error(
      `✗ Error de arranque [${code}]: el puerto ${error.port ?? error.address ?? ""} ya está en uso. ` +
        "Cierra el proceso que lo ocupa o cambia la variable PORT.",
    );
  } else {
    console.error(`✗ Error de arranque [${code}]: ${error.message}`);
    if (error.cause && process.env.NODE_ENV !== "production") {
      console.error(`  Causa: ${error.cause.message}`);
    }
  }

  process.exitCode = 1;
});

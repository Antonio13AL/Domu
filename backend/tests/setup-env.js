// =============================================================
// Entorno de los tests — se ejecuta ANTES de cada fichero de test.
// =============================================================
//
// Los ficheros de test importan `src/app.js`, que a su vez importa
// `src/config/env.js` y construye el pool en `src/config/database.js`
// al evaluarse. Como los `import` se hoistean, cualquier asignación a
// `process.env` escrita en el cuerpo del test llega **después** de que
// el pool ya se haya creado con el `DB_NAME` del `.env` (la base de
// desarrollo), de modo que los tests acababan escribiendo en `domu`.
//
// Este módulo lo registra Vitest en `test.setupFiles`
// (`vitest.config.js`), que se ejecuta antes de cargar el fichero de
// test y, por tanto, antes de que se cree el pool. Así todos los tests
// apuntan a `DB_TEST_NAME` (`domu_test`) sin repetir la asignación en
// cada fichero.
// =============================================================

import dotenv from "dotenv";

// Mismas variables que `src/config/env.js`; no pisa las ya definidas.
dotenv.config({ quiet: true });

const testDatabase = process.env.DB_TEST_NAME ?? "domu_test";

if (testDatabase === process.env.DB_NAME) {
  throw new Error(
    `DB_TEST_NAME no puede coincidir con DB_NAME ("${testDatabase}"): los tests ` +
      "borrarían la base de datos de desarrollo. Revisa `backend/.env`.",
  );
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = testDatabase;

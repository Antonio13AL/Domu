// =============================================================
// Fijación del entorno de pruebas (BE-10).
// =============================================================
//
// Este módulo es el PRIMERO que importa `tests/meeting.test.js`, y
// en ESM los módulos se evalúan en orden de importación. Por eso
// aquí, y no en el test, se decide la base de datos:
//
//   1. Se carga `.env` (mismo `dotenv` que `src/config/env.js`).
//   2. Se fija `DB_NAME = DB_TEST_NAME` (`domu_test`).
//
// `config/database.js` valida y usa `process.env.DB_NAME` en el
// momento en que se importa, es decir, cuando `src/app.js` arrastra
// el grafo de módulos. Si el pool apuntara a `domu` (la de
// desarrollo), los tests borrarían datos reales, así que este
// orden no es decorativo: es lo que garantiza el aislamiento.
//
// `dotenv` no sobreescribe variables ya presentes en `process.env`,
// de modo que el valor que fijamos aquí gana sobre el `DB_NAME=domu`
// del fichero `.env`.
// =============================================================

import dotenv from "dotenv";

dotenv.config({ quiet: true });

process.env.DB_NAME = process.env.DB_TEST_NAME || "domu_test";

// =============================================================
// Tests de integración de autenticación.
// =============================================================
//
// Nivel: integración — Vitest + Supertest + MySQL `domu_test`,
// contra la pila real: helmet, CORS, `authenticateToken`,
// `authorizeRoles`, rate limit y `errorHandler`.
//
// Aislamiento del rate limit: `AUTH_RATE_LIMIT_MAX` (5 por ventana)
// es un límite por clave y en memoria. Cada test limpia las claves
// locales con `resetKey` para que ningún caso dependa del consumo
// de los anteriores; los tests de rate limit, en cambio, agotan su
// propio presupuesto dentro del `it` (authMax + 1 intentos) y
// comprueban el 429.
// =============================================================

import { ipKeyGenerator } from "express-rate-limit";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------
// 1. Entorno: apuntar a `domu_test` ANTES de cargar la aplicación.
//    `dotenv` no pisa las variables ya definidas, así que este
//    `DB_NAME` gana sobre el de `.env`.
//
//    El reset de la BD (DROP + CREATE + migraciones) lo ejecuta
//    `tests/global-setup.js`una única vez para toda la suite:
//    así los ficheros de test (`auth`, `user`, …) comparten el mismo
//    `domu_test` sin pisarse con DROPs simultáneos.
// ---------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.DB_NAME = "domu_test";

// 2. La app se importa después: su pool ya apunta a `domu_test`.
const { default: app } = await import("../src/app.js");
const { default: apiRouter } = await import("../src/routes/index.js");
const { authenticateToken, authorizeRoles } =
  await import("../src/middlewares/auth.js");
const { loginRateLimit, registerRateLimit } =
  await import("../src/middlewares/rateLimit.js");
const { pool, closePool } = await import("../src/config/database.js");

// Ruta efímera para el 403: permite ejercitar `authorizeRoles`
// directamente sin acoplarse a una ruta de negocio (las rutas reales
// de administración viven en `tests/user.test.js`).
apiRouter.get(
  "/test/presidente",
  authenticateToken,
  authorizeRoles(["PRESIDENT"]),
  (req, res) => {
    res.status(200).json({ status: "success", data: { ok: true } });
  },
);

// ---------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------
const PASSWORD = "Vecino1234!";
const INVALID_CREDENTIALS = "Las credenciales no son válidas.";
const stamp = Date.now();

const emailA = `domu_test_vecino@domu.es`;
const emailB = `domu_test_presidente@domu.es`;
const emailUnknown = `domu_test_nocuenta@domu.es`;
const emailRate = `domu_test_ratelimit@domu.es`;

// Claves candidatas: supertest conecta por IPv4, pero se limpian
// también las formas IPv4-mapped/IPv6 por si Express las reporta
// distintas detrás de `trust proxy`.
const LOCAL_IPS = ["127.0.0.1", "::ffff:127.0.0.1", "::1"];
const LOGIN_EMAILS = [
  emailA,
  emailB,
  emailUnknown,
  emailRate,
  "no-es-un-correo",
];

let inviteCode;
let userA;

beforeAll(async () => {
  inviteCode = `DOMU${String(stamp).slice(-8)}`; // 12 alfanuméricos

  // El registro con `invite_code` exige que la comunidad exista y
  // esté activa (`authService.register` → 400 si no corresponde a
  // una comunidad activa). La BD de pruebas solo trae esquema, así
  // que se crea aquí la comunidad que usará el vecino de prueba.
  await pool.query(
    `INSERT INTO communities (name, address, city, postal_code, invite_code, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      "Comunidad DOMU",
      "Calle de la Autenticación 5",
      "Madrid",
      "28005",
      inviteCode,
    ],
  );
});

beforeEach(() => {
  for (const ip of LOCAL_IPS) {
    registerRateLimit.resetKey(ipKeyGenerator(ip));
    for (const email of LOGIN_EMAILS) {
      loginRateLimit.resetKey(`${ipKeyGenerator(ip)}|${email}`);
    }
  }
});

afterAll(async () => {
  await closePool();
});

// ===============================================================
describe("POST /api/v1/auth/register", () => {
  // Define un caso de prueba individual para el endpoint de registro de vecinos
  it("crea el vecino, devuelve JWT y no expone la contraseña", async () => {
    // Simula una petición HTTP POST con Supertest enviando los datos de registro
    const res = await request(app).post("/api/v1/auth/register").send({
      name: "Ana",
      surname: "Vecina",
      email: emailA,
      password: PASSWORD,
      phone: "600 111 222",
      invite_code: inviteCode,
    });

    // Comprueba que el código de estado HTTP sea 201 Created
    expect(res.status).toBe(201);
    // Valida que el campo 'status' de la respuesta sea "success"
    expect(res.body.status).toBe("success");
    // Asegura que el token JWT devuelto sea una cadena de texto
    expect(typeof res.body.data.token).toBe("string");
    // Verifica que el token tenga una longitud válida (mayor de 20 caracteres)
    expect(res.body.data.token.length).toBeGreaterThan(20);
    // Comprueba que el ID de usuario asignado por la base de datos sea mayor que 0
    expect(res.body.data.user.id_user).toBeGreaterThan(0);
    // Valida que el rol asignado por defecto sea el de vecino ("NEIGHBOR")
    expect(res.body.data.user.role).toBe("NEIGHBOR");
    // Comprueba que el email devuelto coincida exactamente con el enviado
    expect(res.body.data.user.email).toBe(emailA);
    // Comprobación de seguridad 1: El objeto de usuario NO debe incluir la
    // propiedad 'password'
    expect(res.body.data.user).not.toHaveProperty("password");
    // Comprobación de seguridad 2: Convierte toda la respuesta a JSON en texto
    // plano y verifica que la palabra "password" no aparezca en ningún sitio
    expect(JSON.stringify(res.body)).not.toMatch(/"password"/);

    // Guarda el usuario creado en una variable externa para reutilizarlo en
    // tests posteriores
    userA = res.body.data.user;
  });

  // Define un caso de prueba individual para verificar el comportamiento ante
  // un intento de registro con un correo duplicado
  it("responde 409 genérico si el correo ya está registrado", async () => {
    // Envía una petición HTTP POST simulada a la ruta de registro intentando
    // usar un correo que ya existe (emailA)
    const res = await request(app).post("/api/v1/auth/register").send({
      name: "Ana",
      surname: "Vecina",
      email: emailA,
      password: PASSWORD,
    });

    // Comprueba que el código de estado HTTP recibido sea 409 Conflict
    expect(res.status).toBe(409);
    // Valida que la propiedad general 'status' dentro del cuerpo de la respuesta
    // sea "error"
    expect(res.body.status).toBe("error");
    // Asegura que el código de error estandarizado del sistema devuelto sea
    // exactamente "CONFLICT"
    expect(res.body.error.code).toBe("CONFLICT");
    // Comprobación de seguridad defensiva: el mensaje de error no debe confirmar
    // la existencia explícita del correo.
    // Verifica mediante una expresión regular insensible a mayúsculas/minúsculas
    // (/i) que el mensaje NO contenga palabras como "existe", "ya está" o
    // "registrado", evitando filtrar información a posibles atacantes.
    expect(res.body.error.message).not.toMatch(/existe|ya está|registrado/i);
  });
});

// ===============================================================
describe("POST /api/v1/auth/login", () => {
  // Define un caso de prueba individual para verificar el inicio de sesión exitoso
  // con credenciales correctas
  it("acepta credenciales válidas y devuelve JWT + usuario", async () => {
    // Envía una petición HTTP POST simulada al endpoint de login utilizando el
    // correo y contraseña del usuario ya registrado (emailA, PASSWORD)
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: emailA, password: PASSWORD });

    // Comprueba que el código de estado HTTP recibido sea 200 OK (petición exitosa)
    expect(res.status).toBe(200);
    // Valida que el token devuelto dentro del objeto de datos sea una cadena de
    // texto (string)
    expect(typeof res.body.data.token).toBe("string");
    // Comprueba que el ID del usuario devuelto en la respuesta coincida exactamente
    // con el id del usuario creado previamente (userA)
    expect(res.body.data.user.id_user).toBe(userA.id_user);
    // Validación crítica de seguridad: asegura que el objeto de usuario devuelto NO
    // contenga la propiedad 'password' (ni hasheada)
    expect(res.body.data.user).not.toHaveProperty("password");
  });

  // Define un caso de prueba individual para verificar el rechazo de inicio de sesión
  // cuando la contraseña no es válida
  it("devuelve 401 con contraseña incorrecta", async () => {
    // Envía una petición HTTP POST simulada al endpoint de login con un correo válido
    // (emailA), pero con una contraseña errónea ("OtraClave123")
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: emailA, password: "OtraClave123" });

    // Comprueba que el código de estado HTTP recibido sea 401 Unauthorized (no autorizado)
    expect(res.status).toBe(401);
    // Valida que el código de error estandarizado dentro del cuerpo de la respuesta sea
    // exactamente "UNAUTHORIZED"
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    // Asegura que el mensaje de error coincida con la constante genérica INVALID_CREDENTIALS
    // ("Las credenciales no son válidas."), evitando revelar si falló el usuario
    // o la contraseña
    expect(res.body.error.message).toBe(INVALID_CREDENTIALS);
  });
});

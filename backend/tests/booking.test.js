// =============================================================
// Tests de integración de reservas — prueba de concurrencia.
// =============================================================
//
// Nivel: integración — Vitest + Supertest + MySQL `domu_test`,
// contra la pila real (Route → Controller → Service → Repository),
// que es por donde tiene que pasar una petición de verdad.
//
// Cobertura exigida:
//   · dos creaciones **simultáneas** de la misma franja → solo una
//     es efectiva; la otra responde `409 CONFLICT` y en la base de
//     datos queda UNA sola fila.
//   · control: dos creaciones simultáneas en franjas distintas →
//     ambas se crean (el bloqueo no serializa de más).
//
// La simultaneidad se consigue lanzando las dos peticiones con
// `Promise.all` sobre `supertest`: ambas entran en el servidor antes
// de que ninguna termine, y cada una abre su propia conexión y su
// propia transacción, de modo que el `SELECT ... FOR UPDATE` del
// repositorio es lo único que puede impedir el doble alta.
//
// Aislamiento: este fichero crea su propia comunidad, su propio
// vecino, su propio espacio y su propia fecha (hoy + 5 días, dentro
// de la ventana de 30 días que fija el modelo), así que no toca los
// datos del seed ni los de los demás ficheros de test. La BD se
// reinicia una sola vez en `tests/global-setup.js`.
// =============================================================

import { ipKeyGenerator } from "express-rate-limit";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------
// 1. Entorno: apuntar a `domu_test` ANTES de cargar la aplicación.
// ---------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.DB_NAME = "domu_test";

// 2. La app se importa después: su pool ya apunta a `domu_test`.
const { default: app } = await import("../src/app.js");
const { pool, closePool } = await import("../src/config/database.js");
const { hashPassword } = await import("../src/security/encryption.js");
const { loginRateLimit } = await import("../src/middlewares/rateLimit.js");

// ---------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------
const BASE = "/api/v1";
const PASSWORD = "Vecino1234!";
const stamp = Date.now();

const neighborEmail = `domu_reservas_vecino_${stamp}@domu.es`;
const LOGIN_EMAILS = [neighborEmail];
const LOCAL_IPS = ["127.0.0.1", "::ffff:127.0.0.1", "::1"];

// Espacio y fecha propios de este fichero: el seed no usa ni una ni
// la otra, y la fecha se desplaza 5 días para que la prueba no caduque.
const SPACE = "Piscina (concurrencia)";
const bookingDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

let communityId;
let neighborToken;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Login directo para obtener el JWT del vecino de prueba. */
async function login(email) {
  const res = await request(app)
    .post(`${BASE}/auth/login`)
    .send({ email, password: PASSWORD });

  if (res.status !== 200) {
    throw new Error(
      `Login fallido (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.token;
}

/** Cuerpo de alta para la franja indicada. */
const bookingBody = (start_time, end_time) => ({
  space_name: SPACE,
  booking_date: bookingDate,
  start_time,
  end_time,
});

/** Reservas efectivas de una franja concreta en la base de datos. */
async function countSlot(start_time, end_time) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM bookings
     WHERE id_community = ?
       AND space_name = ?
       AND booking_date = ?
       AND start_time = ?
       AND end_time = ?`,
    [communityId, SPACE, bookingDate, start_time, end_time],
  );
  return Number(rows[0]?.total ?? 0);
}

// ---------------------------------------------------------------
// Preparación: comunidad + vecino + token
// ---------------------------------------------------------------
beforeAll(async () => {
  const [community] = await pool.query(
    `INSERT INTO communities (name, address, city, postal_code, invite_code, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      "Comunidad Reservas",
      "Calle de la Piscina 1",
      "Madrid",
      "28011",
      `RESV${String(stamp).slice(-8)}`,
    ],
  );
  communityId = community.insertId;

  const hash = await hashPassword(PASSWORD);
  await pool.query(
    `INSERT INTO users (name, surname, email, password, role, id_community, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ["Vecina", "Reservas", neighborEmail, hash, "NEIGHBOR", communityId],
  );

  neighborToken = await login(neighborEmail);
});

// El límite de login vive en memoria: se limpia su clave antes de
// cada test para que ningún caso dependa del consumo de los anteriores.
beforeEach(() => {
  for (const ip of LOCAL_IPS) {
    for (const email of LOGIN_EMAILS) {
      loginRateLimit.resetKey(`${ipKeyGenerator(ip)}|${email}`);
    }
  }
});

afterAll(async () => {
  await closePool();
});

// ===============================================================
describe("POST /communities/:communityId/bookings — concurrencia", () => {
  it("dos altas simultáneas de la misma franja: solo una es efectiva", async () => {
    const url = `${BASE}/communities/${communityId}/bookings`;

    const [first, second] = await Promise.all([
      request(app).post(url).set(auth(neighborToken)).send(bookingBody("16:00", "18:00")),
      request(app).post(url).set(auth(neighborToken)).send(bookingBody("16:00", "18:00")),
    ]);

    // Una crea (201) y la otra choca con el bloqueo (409 CONFLICT):
    // ninguna puede responder 500 por interbloqueo.
    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const created = first.status === 201 ? first : second;
    const rejected = first.status === 409 ? first : second;

    expect(created.body.status).toBe("success");
    expect(created.body.data.booking.status).toBe("PENDING");
    expect(created.body.data.booking.space_name).toBe(SPACE);
    expect(created.body.data.booking.booking_date).toBe(bookingDate);

    expect(rejected.body.status).toBe("error");
    expect(rejected.body.error.code).toBe("CONFLICT");

    // Evidencia en base de datos: una sola fila para esa franja.
    expect(await countSlot("16:00:00", "18:00:00")).toBe(1);
  });

  it("dos altas simultáneas en franjas distintas: ambas se crean", async () => {
    const url = `${BASE}/communities/${communityId}/bookings`;

    const [morning, evening] = await Promise.all([
      request(app).post(url).set(auth(neighborToken)).send(bookingBody("09:00", "11:00")),
      request(app).post(url).set(auth(neighborToken)).send(bookingBody("19:00", "21:00")),
    ]);

    expect(morning.status).toBe(201);
    expect(evening.status).toBe(201);
    expect(await countSlot("09:00:00", "11:00:00")).toBe(1);
    expect(await countSlot("19:00:00", "21:00:00")).toBe(1);
  });
});

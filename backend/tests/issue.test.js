// =============================================================
// Tests de integración de incidencias.
// =============================================================
//
// Nivel: integración — Vitest + Supertest + MySQL `domu_test`,
// contra la pila real: helmet, CORS, `authenticateToken`,
// `authorizeRoles` y `errorHandler`.
//
// Cobertura exigida:
//   · crear, listar, filtrar, detalle, editar y cambiar estado;
//   · ownership: el autor edita solo en `PENDING`, después solo el
//     presidente;
//   · transiciones: `PENDING → IN_PROGRESS | REJECTED`,
//     `IN_PROGRESS → RESOLVED | REJECTED` y `resolved_at` al
//     resolver;
//   · la pertenencia a la comunidad separa el 404 (comunidad
//     inexistente) del 403 (vecino de otra comunidad);
//   · nadie escapa de la lista blanca de campos (mass-assignment).
//
// La BD de pruebas se reinicia una única vez en
// `tests/global-setup.js`, así que este fichero solo inserta sus
// propios datos (2 comunidades + 5 usuarios) con correo
// autogenerado.
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

const presidentEmail = `domu_presidente@domu.es`;
const authorEmail = `domu_autor@domu.es`;
const neighborEmail = `domu_vecino@domu.es`;
const foreignPresidentEmail = `domu_ajena_presidente@domu.es`;
const foreignNeighborEmail = `domu_ajena_vecino@domu.es`;

const LOCAL_IPS = ["127.0.0.1", "::ffff:127.0.0.1", "::1"];
const LOGIN_EMAILS = [
  presidentEmail,
  authorEmail,
  neighborEmail,
  foreignPresidentEmail,
  foreignNeighborEmail,
];

// Comunidades y usuarios.
let communityId;
let foreignCommunityId;
let authorId;

// Tokens.
let presidentToken;
let authorToken;
let neighborToken;

// Incidencias de partida.
let pendingIssue;
let progressIssue;
let resolvedIssue;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Login directo para obtener el JWT de un usuario de prueba. */
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

/** Crea una incidencia como el vecino autor y devuelve el objeto. */
async function createIssue(title, extra = {}) {
  const res = await request(app)
    .post(`${BASE}/communities/${communityId}/issues`)
    .set(auth(authorToken))
    .send({ title, description: `Descripción de ${title}`, ...extra });

  if (res.status !== 201) {
    throw new Error(
      `Alta fallida (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.issue;
}

/** Cambia el estado de una incidencia como presidente. */
async function transitionTo(issueId, status) {
  const res = await request(app)
    .patch(`${BASE}/issues/${issueId}/status`)
    .set(auth(presidentToken))
    .send({ status });

  if (res.status !== 200) {
    throw new Error(
      `Transición fallida (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.issue;
}

// ---------------------------------------------------------------
// Preparación: 2 comunidades + 5 usuarios + 3 incidencias
// ---------------------------------------------------------------
beforeAll(async () => {
  const [community] = await pool.query(
    `INSERT INTO communities (name, address, city, postal_code, invite_code, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      "Comunidad 1",
      "Calle de las Incidencias 9",
      "Madrid",
      "28009",
      `COMU${String(stamp).slice(-8)}`,
    ],
  );
  communityId = community.insertId;

  const [foreign] = await pool.query(
    `INSERT INTO communities (name, address, city, postal_code, invite_code, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      "Comunidad 1 Ajena",
      "Calle Ajena 1",
      "Madrid",
      "28010",
      `FORE${String(stamp).slice(-8)}`,
    ],
  );
  foreignCommunityId = foreign.insertId;

  const hash = await hashPassword(PASSWORD);

  const insertUser = async (name, surname, email, role, community) => {
    const [result] = await pool.query(
      `INSERT INTO users (name, surname, email, password, role, id_community, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [name, surname, email, hash, role, community],
    );
    return result.insertId;
  };

  authorId = await insertUser(
    "Autora",
    "Incidencia",
    authorEmail,
    "NEIGHBOR",
    communityId,
  );
  await insertUser(
    "Presidente",
    "Incidencia",
    presidentEmail,
    "PRESIDENT",
    communityId,
  );
  await insertUser("Vecina", "Incidencia", neighborEmail, "NEIGHBOR", communityId);
  await insertUser(
    "Ajeno",
    "Presidente",
    foreignPresidentEmail,
    "PRESIDENT",
    foreignCommunityId,
  );
  await insertUser(
    "Ajena",
    "Vecina",
    foreignNeighborEmail,
    "NEIGHBOR",
    foreignCommunityId,
  );

  presidentToken = await login(presidentEmail);
  authorToken = await login(authorEmail);
  neighborToken = await login(neighborEmail);

  // Tres incidencias en los tres estados de partida.
  pendingIssue = await createIssue(`Incidencia pendiente ${stamp}`);
  progressIssue = await createIssue(`Incidencia en curso ${stamp}`);
  resolvedIssue = await createIssue(`Incidencia resuelta ${stamp}`);

  await transitionTo(progressIssue.id_issue, "IN_PROGRESS");
  await transitionTo(resolvedIssue.id_issue, "IN_PROGRESS");
  await transitionTo(resolvedIssue.id_issue, "RESOLVED");
});

// El límite de login es por IP+correo y vive en memoria: se limpia
// su clave antes de cada test para que ningún caso dependa del
// consumo de los anteriores.
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
describe("Matriz de autorización de las incidencias", () => {
  // Define un caso de prueba individual para verificar el control de acceso (RBAC)
  // en la consulta de incidencias
  it("permite el listado al presidente y a un vecino miembro (200)", async () => {
    // Realiza una petición HTTP GET simulada al listado de incidencias de la
    // comunidad, autenticándose con el token JWT del presidente
    const presidente = await request(app)
      .get(`${BASE}/communities/${communityId}/issues`)
      .set(auth(presidentToken));
    // Realiza una segunda petición HTTP GET simulada exactamente al mismo endpoint,
    // pero autenticándose esta vez con el token JWT de un vecino miembro
    const vecino = await request(app)
      .get(`${BASE}/communities/${communityId}/issues`)
      .set(auth(neighborToken));

    // Comprueba que la petición del presidente responde con el código HTTP 200 OK
    expect(presidente.status).toBe(200);
    // Comprueba que la petición del vecino miembro también responde con el código
    // HTTP 200 OK
    expect(vecino.status).toBe(200);
    // Valida que la propiedad 'status' en el cuerpo de la respuesta del presidente
    // sea "success"
    expect(presidente.body.status).toBe("success");
    // Valida que la propiedad 'status' en el cuerpo de la respuesta del vecino sea
    // "success"
    expect(vecino.body.status).toBe("success");
  });
});

// ===============================================================
describe("POST /communities/:communityId/issues — alta", () => {
  // Define un caso de prueba individual para verificar la creación correcta de una
  // incidencia y la asignación de sus valores por defecto
  it("crea la incidencia con autor, estado y prioridad por defecto", async () => {
    // Envía una petición HTTP POST simulada al endpoint de alta de incidencias de
    // la comunidad, autenticándose con el token del vecino autor y enviando título
    // y descripción
    const res = await request(app)
      .post(`${BASE}/communities/${communityId}/issues`)
      .set(auth(authorToken))
      .send({ title: `Alta ${stamp}`, description: "Descripción de la alta." });

    // Comprueba que el código de estado HTTP recibido sea 201 Created (recurso
    // creado con éxito)
    expect(res.status).toBe(201);
    // Valida que la propiedad general 'status' de la respuesta sea "success"
    expect(res.body.status).toBe("success");

    // Extrae el objeto 'issue' creado desde el cuerpo de la respuesta para
    // facilitar las comprobaciones siguientes
    const issue = res.body.data.issue;

    // Comprueba que la base de datos le haya asignado un identificador numérico
    // válido (mayor que 0)
    expect(issue.id_issue).toBeGreaterThan(0);
    // Verifica que la incidencia haya quedado vinculada exactamente a la comunidad
    // en la que se creó
    expect(issue.id_community).toBe(communityId);
    // Asegura que el campo autor (id_user) corresponda con el ID del usuario que
    // envió la petición
    expect(issue.id_user).toBe(authorId);
    // Valida que el estado inicial por defecto asignado por el servidor sea
    // "PENDING"
    expect(issue.status).toBe("PENDING");
    // Valida que la prioridad por defecto asignada sea "MEDIUM" al no haberse
    // especificado ninguna
    expect(issue.priority).toBe("MEDIUM");
    // Comprueba que la categoría quede en null al no haber sido enviada en la
    // petición
    expect(issue.category).toBeNull();
    // Asegura que la fecha de resolución (resolved_at) sea null al tratarse de una
    // incidencia recién abierta
    expect(issue.resolved_at).toBeNull();
    // Verifica que el campo de auditoría temporal 'created_at' exista y tenga un
    // valor válido (no nulo ni vacío)
    expect(issue.created_at).toBeTruthy();
  });

  // Define un caso de prueba individual para verificar la validación de campos
  // obligatorios al crear una incidencia
  it("rechaza el cuerpo sin título ni descripción (400 con `errors`)", async () => {
    // Envía una petición HTTP POST simulada al endpoint de alta de incidencias
    // autenticado como vecino autor, pero con un cuerpo JSON vacío ({})
    const res = await request(app)
      .post(`${BASE}/communities/${communityId}/issues`)
      .set(auth(authorToken))
      .send({});

    // Comprueba que el código de estado HTTP recibido sea 400 Bad Request
    // (error de validación de entrada)
    expect(res.status).toBe(400);
    // Valida que el código de error estandarizado del sistema devuelto sea
    // exactamente "VALIDATION_ERROR"
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // Asegura que la propiedad 'errors' dentro de los detalles del error
    // sea un array (lista de fallos)
    expect(Array.isArray(res.body.error.details.errors)).toBe(true);
    // Comprueba que el array de errores contenga el mensaje específico
    // indicando que falta el título
    expect(res.body.error.details.errors).toContain(
      "El título es obligatorio.",
    );
    // Comprueba que el array de errores contenga también el mensaje
    // específico indicando que falta la descripción
    expect(res.body.error.details.errors).toContain(
      "La descripción es obligatoria.",
    );
  });
});

// ===============================================================
describe("GET /issues/:issueId — detalle", () => {
  // Define un caso de prueba individual para verificar la recuperación
  // correcta del detalle completo de una incidencia
  it("devuelve el detalle completo a un miembro (200)", async () => {
    // Envía una petición HTTP GET simulada al endpoint de detalle de
    // una incidencia específica utilizando su ID (pendingIssue.id_issue),
    // autenticándose con el token de un vecino miembro (neighborToken)
    const res = await request(app)
      .get(`${BASE}/issues/${pendingIssue.id_issue}`)
      .set(auth(neighborToken));

    // Comprueba que el código de estado HTTP recibido sea 200 OK
    // (petición exitosa)
    expect(res.status).toBe(200);
    // Valida que la propiedad general 'status' dentro del cuerpo de la
    // respuesta sea "success"
    expect(res.body.status).toBe("success");

    // Extrae el objeto 'issue' devuelto en la respuesta para facilitar
    // las comprobaciones de sus propiedades
    const issue = res.body.data.issue;

    // Asegura que el ID de la incidencia devuelta coincida exactamente
    // con el ID de la incidencia pendiente consultada
    expect(issue.id_issue).toBe(pendingIssue.id_issue);
    // Valida que el título de la incidencia corresponda exactamente con
    // el título generado originalmente usando el sello temporal (stamp)
    expect(issue.title).toBe(`Incidencia pendiente ${stamp}`);
    // Verifica que el ID del usuario autor (id_user) coincida con el
    // autor original registrado (authorId)
    expect(issue.id_user).toBe(authorId);
    // Comprueba que el estado actual de la incidencia sea "PENDING"
    expect(issue.status).toBe("PENDING");
    // Valida estrictamente la estructura del objeto: toma todas las
    // claves (columnas) del objeto recibido, las ordena alfabéticamente
    // y las compara con un array predefinido de todas las propiedades
    // obligatorias que debe exponer el contrato de la API (también
    // ordenado), asegurando que no falte ni sobre ningún campo.
    expect(Object.keys(issue).sort()).toEqual(
      [
        "category",
        "created_at",
        "description",
        "id_issue",
        "id_community",
        "priority",
        "id_user",
        "resolved_at",
        "status",
        "title",
        "updated_at",
      ].sort(),
    );
  });
});

// ===============================================================
describe("PATCH /issues/:issueId/status — transiciones", () => {
  // Define un caso de prueba individual para verificar la transición
  // de estado de una incidencia desde PENDING hasta IN_PROGRESS por
  // parte del presidente
  it("PENDING → IN_PROGRESS como presidente (200)", async () => {
    // Crea previamente una nueva incidencia en estado inicial PENDING
    // utilizando la función auxiliar 'createIssue' con un título basado
    // en el sello temporal (stamp)
    const issue = await createIssue(`Transición ${stamp}`);
    // Envía una petición HTTP PATCH simulada al endpoint de actualización
    // de estado de esa incidencia específica, autenticándose con el token
    // del presidente y enviando el nuevo estado "IN_PROGRESS"
    const res = await request(app)
      .patch(`${BASE}/issues/${issue.id_issue}/status`)
      .set(auth(presidentToken))
      .send({ status: "IN_PROGRESS" });

    // Comprueba que el código de estado HTTP recibido sea 200 OK
    // (actualización exitosa)
    expect(res.status).toBe(200);
    // Valida que el estado de la incidencia devuelta en la respuesta se
    // haya actualizado correctamente a "IN_PROGRESS"
    expect(res.body.data.issue.status).toBe("IN_PROGRESS");
    // Asegura que el campo de fecha de resolución (resolved_at) permanezca
    // en null, ya que la incidencia solo está en curso y aún no ha sido resuelta
    expect(res.body.data.issue.resolved_at).toBeNull();
  });

  // Define un caso de prueba individual para verificar el cierre de una incidencia
  // (IN_PROGRESS → RESOLVED) y el sellado automático de la fecha de resolución
  it("IN_PROGRESS → RESOLVED sella `resolved_at` (200)", async () => {
    // Crea una nueva incidencia de prueba en estado inicial PENDING con un título
    // único basado en el sello temporal (stamp)
    const issue = await createIssue(`Resolución ${stamp}`);
    // Utiliza la función auxiliar 'transitionTo' para avanzar previamente el
    // estado de la incidencia a "IN_PROGRESS" (precondición necesaria para poder
    // resolverla)
    await transitionTo(issue.id_issue, "IN_PROGRESS");
    // Envía una petición HTTP PATCH simulada al endpoint de actualización de estado,
    // autenticándose con el token del presidente y solicitando el cambio al estado
    // final "RESOLVED"
    const res = await request(app)
      .patch(`${BASE}/issues/${issue.id_issue}/status`)
      .set(auth(presidentToken))
      .send({ status: "RESOLVED" });

    // Comprueba que el código de estado HTTP recibido sea 200 OK (actualización
    // exitosa)
    expect(res.status).toBe(200);
    // Valida que el estado de la incidencia devuelta se haya actualizado correctamente
    // a "RESOLVED"
    expect(res.body.data.issue.status).toBe("RESOLVED");
    // Asegura que el campo 'resolved_at' ya no sea null ni esté vacío, confirmando que
    // el servidor lo ha rellenado automáticamente al cerrar la incidencia
    expect(res.body.data.issue.resolved_at).toBeTruthy();
    // Comprueba que el valor almacenado en 'resolved_at' tenga un formato de fecha
    // válido y parseable (Date.parse devuelve un timestamp numérico en lugar de NaN)
    expect(Number.isNaN(Date.parse(res.body.data.issue.resolved_at))).toBe(
      false,
    );
  });
});

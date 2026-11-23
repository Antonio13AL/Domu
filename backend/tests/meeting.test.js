// =============================================================
// Tests de integración — reuniones, asistencia y votaciones.
// =============================================================
//
// Ejecuta el servidor Express real contra una base de datos MySQL
// real (`domu_test`, preparada por `tests/global-setup.js`). No hay
// dobles: se comprueban las 14 rutas, la matriz de roles
// de la leyenda («Miembro» = NEIGHBOR, «Admin» = PRESIDENT), los
// códigos HTTP de error y las reglas de negocio:
//
//   · pertenencia a la comunidad (403 sin revelar existencia),
//   · transiciones de estado y 409 en las inválidas,
//   · acta (`minutes`) editable solo en `CLOSED`,
//   · asistencia solo del propio vecino y bloqueada en `CANCELLED`,
//   · ventana `opens_at`–`closes_at`, voto único y resultados por rol,
//   · cierre en cascada de las votaciones abiertas.
//
// Los identificadores y las respuestas van en `snake_case`, tal como
// los devuelve la API.
// =============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import app from "../src/app.js";
import { closePool, pool } from "../src/config/database.js";

const API = "/api/v1";

// ---------------------------------------------------------------
// 1. Entorno: apuntar a `domu_test` ANTES de cargar la aplicación.
// ---------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.DB_NAME = "domu_test";

/** Reuniones creadas por la suite (se resetea la BD en cada run). */
let lifecycleMeetingId;
let operationalMeetingId;
let cancelledMeetingId;

/** Votaciones creadas por la suite (leídas por varios tests). */
let firstVoteId;
let futureVoteId;

let presidentToken;
let neighborToken;
let outsiderToken;

/**
 * -----------------------------------------------------------------
 * Función: login
 * Propósito: abrir sesión y devolver el token Bearer.
 * @param {string} email - Correo de la cuenta demo.
 * @param {string} password - Contraseña demo.
 * @returns {Promise<string>} Token JWT.
 * -----------------------------------------------------------------
 */
async function login(email, password) {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.token;
}

/**
 * -----------------------------------------------------------------
 * Función: auth
 * Propósito: cabecera de autorización para supertest.
 * @param {string} token - Token JWT.
 * @returns {object} Cabeceras de la petición.
 * -----------------------------------------------------------------
 */
function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * -----------------------------------------------------------------
 * Función: createMeeting
 * Propósito: crear una reunión válida como presidente de la
 * comunidad 1 y devolver su identificador.
 * @param {string} title - Título de la reunión.
 * @returns {Promise<number>} `meetings.id_meeting`.
 * -----------------------------------------------------------------
 */
async function createMeeting(title) {
  const response = await request(app)
    .post(`${API}/communities/1/meetings`)
    .set(auth(presidentToken))
    .send({
      date: "2027-01-15",
      start_time: "18:00",
      end_time: "19:30",
      title,
      agenda: "Puntos del orden del día.",
    });

  expect(response.status).toBe(201);
  return response.body.data.meeting.id_meeting;
}

/**
 * -----------------------------------------------------------------
 * Función: createVote
 * Propósito: crear una votación como presidente y devolver su
 * identificador.
 * @param {number} meetingId - Reunión propietaria.
 * @param {object} [window] - Ventana opcional `opens_at`/`closes_at`.
 * @returns {Promise<number>} `votes.id_vote`.
 * -----------------------------------------------------------------
 */
async function createVote(meetingId, window = {}) {
  const response = await request(app)
    .post(`${API}/meetings/${meetingId}/votes`)
    .set(auth(presidentToken))
    .send({ title: "Votación de prueba", description: "Desarrollo.", ...window });

  expect(response.status).toBe(201);
  return response.body.data.vote.id_vote;
}

/**
 * -----------------------------------------------------------------
 * Función: changeVoteStatus
 * Propósito: cambiar el estado de una votación como presidente.
 * @param {number} voteId - Votación.
 * @param {string} state - Estado destino.
 * @returns {Promise<import("supertest").Response>} Respuesta.
 * -----------------------------------------------------------------
 */
async function changeVoteStatus(voteId, state) {
  return request(app)
    .patch(`${API}/votes/${voteId}/status`)
    .set(auth(presidentToken))
    .send({ status: state });
}

/**
 * -----------------------------------------------------------------
 * Función: utcTimestamp
 * Propósito: fecha y hora UTC en el formato que espera la API
 * (`YYYY-MM-DD HH:mm:ss`), desplazada los días indicados.
 * @param {number} days - Días desde hoy (negativos = pasado).
 * @returns {string} Marca de tiempo normalizada.
 * -----------------------------------------------------------------
 */
function utcTimestamp(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

beforeAll(async () => {
  presidentToken = await login("admin@domu.es", "Admin1234!");
  neighborToken = await login("vecino1@domu.es", "Vecino1234!");
  outsiderToken = await login("vecino5@domu.es", "Vecino1234!");

  lifecycleMeetingId = await createMeeting("Junta de ciclo de vida");
  operationalMeetingId = await createMeeting("Junta operativa");
  cancelledMeetingId = await createMeeting("Junta cancelada");

  const cancel = await request(app)
    .patch(`${API}/meetings/${cancelledMeetingId}/status`)
    .set(auth(presidentToken))
    .send({ state: "CANCELLED" });
  expect(cancel.status).toBe(200);
});

afterAll(async () => {
  await closePool();
});

describe("GET /communities/:communityId/meetings", () => {
  it("devuelve 401 sin token", async () => {
    const response = await request(app).get(`${API}/communities/1/meetings`);

    expect(response.status).toBe(401);
    expect(response.body.status).toBe("error");
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("lista las reuniones de la comunidad para cualquier miembro", async () => {
    const response = await request(app)
      .get(`${API}/communities/1/meetings`)
      .set(auth(neighborToken));

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("success");

    const { meetings, page, limit, total, total_pages } = response.body.data;
    expect(Array.isArray(meetings)).toBe(true);
    // Junta del seed + tres creadas por la suite.
    expect(meetings).toHaveLength(4);
    expect(page).toBe(1);
    expect(limit).toBeGreaterThan(0);
    expect(total).toBe(4);
    expect(total_pages).toBe(1);

    const first = meetings[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.start_time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(first.state).toBe("CLOSED");
    expect(typeof first.minutes).toBe("string");
  });

  it("devuelve 403 a un miembro de otra comunidad", async () => {
    const response = await request(app)
      .get(`${API}/communities/1/meetings`)
      .set(auth(outsiderToken));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("devuelve 403 si la comunidad no existe, sin revelar su existencia", async () => {
    const response = await request(app)
      .get(`${API}/communities/99999/meetings`)
      .set(auth(neighborToken));

    expect(response.status).toBe(403);
  });

  it("rechaza un filtro de estado inválido", async () => {
    const response = await request(app)
      .get(`${API}/communities/1/meetings?state=NOPE`)
      .set(auth(neighborToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /communities/:communityId/meetings", () => {
  it("prohíbe crear reuniones a un vecino", async () => {
    const response = await request(app)
      .post(`${API}/communities/1/meetings`)
      .set(auth(neighborToken))
      .send({
        date: "2027-02-01",
        start_time: "18:00",
        end_time: "19:00",
        title: "No autorizada",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("valida los datos de la reunión", async () => {
    const response = await request(app)
      .post(`${API}/communities/1/meetings`)
      .set(auth(presidentToken))
      .send({
        date: "2027-02-30",
        start_time: "19:00",
        end_time: "18:00",
        title: "",
        state: "CLOSED",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(response.body.error.details.errors)).toBe(true);
    // `state` no se acepta en el cuerpo: solo cambia por su endpoint.
    expect(response.body.error.details.errors.some((text) => text.includes("state"))).toBe(true);
  });

  it("crea la reunión en estado SCHEDULED", async () => {
    const response = await request(app)
      .post(`${API}/communities/1/meetings`)
      .set(auth(presidentToken))
      .send({
        date: "2027-03-01",
        start_time: "17:30",
        end_time: "19:00",
        title: "Junta creada por el test",
        agenda: "Único punto.",
      });

    expect(response.status).toBe(201);

    const meeting = response.body.data.meeting;
    expect(meeting.state).toBe("SCHEDULED");
    expect(meeting.date).toBe("2027-03-01");
    expect(meeting.start_time).toBe("17:30:00");
    expect(meeting.end_time).toBe("19:00:00");
    expect(meeting.minutes).toBeNull();
    expect(meeting.id_community).toBe(1);
  });

  it("impide al presidente de una comunidad gestionar otra", async () => {
    const response = await request(app)
      .post(`${API}/communities/2/meetings`)
      .set(auth(presidentToken))
      .send({
        date: "2027-03-02",
        start_time: "18:00",
        end_time: "19:00",
        title: "Fuera de su comunidad",
      });

    expect(response.status).toBe(403);
  });
});

describe("GET y PATCH /meetings/:meetingId", () => {
  it("devuelve el detalle de la reunión", async () => {
    const response = await request(app)
      .get(`${API}/meetings/${operationalMeetingId}`)
      .set(auth(neighborToken));

    expect(response.status).toBe(200);
    expect(response.body.data.meeting.id_meeting).toBe(operationalMeetingId);
    expect(response.body.data.meeting.state).toBe("SCHEDULED");
  });

  it("devuelve 400 con un identificador no numérico", async () => {
    const response = await request(app).get(`${API}/meetings/abc`).set(auth(neighborToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("devuelve 404 si la reunión no existe", async () => {
    const response = await request(app)
      .get(`${API}/meetings/999999`)
      .set(auth(neighborToken));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("devuelve 403 al vecino al editar", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}`)
      .set(auth(neighborToken))
      .send({ title: "Intento vecino" });

    expect(response.status).toBe(403);
  });

  it("edita la reunión para el presidente", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}`)
      .set(auth(presidentToken))
      .send({ title: "Junta operativa (editada)", agenda: "Acta pendiente." });

    expect(response.status).toBe(200);
    expect(response.body.data.meeting.title).toBe("Junta operativa (editada)");
  });

  it("devuelve 400 si el cuerpo no indica ningún campo", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}`)
      .set(auth(presidentToken))
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /meetings/:meetingId/status", () => {
  it("prohíbe el cambio de estado a un vecino", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}/status`)
      .set(auth(neighborToken))
      .send({ state: "IN_PROGRESS" });

    expect(response.status).toBe(403);
  });

  it("permite SCHEDULED → IN_PROGRESS", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "IN_PROGRESS" });

    expect(response.status).toBe(200);
    expect(response.body.data.meeting.state).toBe("IN_PROGRESS");
  });

  it("permite IN_PROGRESS → CLOSED", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "CLOSED" });

    expect(response.status).toBe(200);
    expect(response.body.data.meeting.state).toBe("CLOSED");
  });

  it("devuelve 409 si la reunión ya está en ese estado", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "CLOSED" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("devuelve 409 en una transición inversa (CLOSED → SCHEDULED)", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "SCHEDULED" });

    expect(response.status).toBe(409);
  });
});

describe("Acta de la reunión (minutes)", () => {
  it("guarda el acta cuando la reunión está cerrada", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}`)
      .set(auth(presidentToken))
      .send({ minutes: "Se aprueba el acta por unanimidad." });

    expect(response.status).toBe(200);
    expect(response.body.data.meeting.minutes).toBe("Se aprueba el acta por unanimidad.");
  });

  it("devuelve 409 al editar otros campos en una reunión cerrada", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${lifecycleMeetingId}`)
      .set(auth(presidentToken))
      .send({ title: "No se puede reabrir" });

    expect(response.status).toBe(409);
  });

  it("devuelve 409 al redactar el acta en una reunión no cerrada", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}`)
      .set(auth(presidentToken))
      .send({ minutes: "Todavía no ha terminado." });

    expect(response.status).toBe(409);
  });

  it("devuelve el acta en el detalle", async () => {
    const response = await request(app)
      .get(`${API}/meetings/${lifecycleMeetingId}`)
      .set(auth(neighborToken));

    expect(response.status).toBe(200);
    expect(response.body.data.meeting.minutes).toBe("Se aprueba el acta por unanimidad.");
  });
});

describe("Asistencia", () => {
  it("devuelve 403 al presidente: confirmar es acción de vecino", async () => {
    const response = await request(app)
      .put(`${API}/meetings/${operationalMeetingId}/attendance`)
      .set(auth(presidentToken))
      .send({ attendance_status: "ATTENDED" });

    expect(response.status).toBe(403);
  });

  it("rechaza un estado de asistencia no confirmable", async () => {
    const response = await request(app)
      .put(`${API}/meetings/${operationalMeetingId}/attendance`)
      .set(auth(neighborToken))
      .send({ attendance_status: "PENDING" });

    expect(response.status).toBe(400);
    expect(response.body.error.details.errors).toBeDefined();
  });

  it("confirma la asistencia del propio vecino", async () => {
    const response = await request(app)
      .put(`${API}/meetings/${operationalMeetingId}/attendance`)
      .set(auth(neighborToken))
      .send({ attendance_status: "ATTENDED" });

    expect(response.status).toBe(200);

    const attendance = response.body.data.attendance;
    expect(attendance.id_meeting).toBe(operationalMeetingId);
    expect(attendance.id_user).toBe(2);
    expect(attendance.attendance_status).toBe("ATTENDED");
    expect(attendance.confirmed_at).toBeTruthy();
    expect(typeof attendance.name).toBe("string");
    expect(typeof attendance.surname).toBe("string");
  });

  it("actualiza la confirmación previa (upsert)", async () => {
    const response = await request(app)
      .put(`${API}/meetings/${operationalMeetingId}/attendance`)
      .set(auth(neighborToken))
      .send({ attendance_status: "ABSENT" });

    expect(response.status).toBe(200);
    expect(response.body.data.attendance.attendance_status).toBe("ABSENT");
  });

  it("devuelve 403 al vecino al listar la asistencia", async () => {
    const response = await request(app)
      .get(`${API}/meetings/${operationalMeetingId}/attendance`)
      .set(auth(neighborToken));

    expect(response.status).toBe(403);
  });

  it("lista la asistencia de la comunidad para el presidente", async () => {
    const response = await request(app)
      .get(`${API}/meetings/${operationalMeetingId}/attendance`)
      .set(auth(presidentToken));

    expect(response.status).toBe(200);

    const { attendees } = response.body.data;
    expect(Array.isArray(attendees)).toBe(true);
    // Los cinco miembros de la comunidad 1 (presidente + 4 vecinos).
    expect(attendees).toHaveLength(5);

    const confirmed = attendees.find((row) => row.id_user === 2);
    expect(confirmed.attendance_status).toBe("ABSENT");

    const untouched = attendees.find((row) => row.id_user === 3);
    expect(untouched.attendance_status).toBe("PENDING");
    expect(untouched.confirmed_at).toBeNull();
  });

  it("devuelve 409 al confirmar en una reunión cancelada", async () => {
    const response = await request(app)
      .put(`${API}/meetings/${cancelledMeetingId}/attendance`)
      .set(auth(neighborToken))
      .send({ attendance_status: "ATTENDED" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });
});

describe("Votaciones de una reunión", () => {
  it("lista las votaciones de la reunión", async () => {
    const response = await request(app)
      .get(`${API}/meetings/${operationalMeetingId}/votes`)
      .set(auth(neighborToken));

    expect(response.status).toBe(200);
    expect(response.body.data.votes).toHaveLength(0);
    expect(response.body.data.total).toBe(0);
  });

  it("prohíbe crear votaciones a un vecino", async () => {
    const response = await request(app)
      .post(`${API}/meetings/${operationalMeetingId}/votes`)
      .set(auth(neighborToken))
      .send({ title: "No autorizada" });

    expect(response.status).toBe(403);
  });

  it("devuelve 409 al crear votaciones en una reunión cerrada", async () => {
    const response = await request(app)
      .post(`${API}/meetings/${lifecycleMeetingId}/votes`)
      .set(auth(presidentToken))
      .send({ title: "Sobre junta cerrada" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("crea la votación en estado DRAFT", async () => {
    const response = await request(app)
      .post(`${API}/meetings/${operationalMeetingId}/votes`)
      .set(auth(presidentToken))
      .send({ title: "Ampliación de la cubierta" });

    expect(response.status).toBe(201);

    const vote = response.body.data.vote;
    expect(vote.status).toBe("DRAFT");
    expect(vote.id_meeting).toBe(operationalMeetingId);
    expect(vote.opens_at).toBeNull();
    expect(vote.closes_at).toBeNull();

    firstVoteId = vote.id_vote;
  });

  it("devuelve 403 al vecino al editar la votación", async () => {
    const response = await request(app)
      .patch(`${API}/votes/${firstVoteId}`)
      .set(auth(neighborToken))
      .send({ title: "Intento vecino" });

    expect(response.status).toBe(403);
  });

  it("edita la votación mientras está en DRAFT", async () => {
    const response = await request(app)
      .patch(`${API}/votes/${firstVoteId}`)
      .set(auth(presidentToken))
      .send({ description: "Presupuesto estimado: 12.000 €." });

    expect(response.status).toBe(200);
    expect(response.body.data.vote.description).toBe("Presupuesto estimado: 12.000 €.");
  });

  it("devuelve 400 al abrir una votación sin ventana", async () => {
    const response = await request(app)
      .patch(`${API}/votes/${firstVoteId}/status`)
      .set(auth(presidentToken))
      .send({ status: "OPEN" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("devuelve 400 si la ventana llega incompleta", async () => {
    const response = await request(app)
      .patch(`${API}/votes/${firstVoteId}`)
      .set(auth(presidentToken))
      .send({ opens_at: utcTimestamp(-1) });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("opens_at");
  });

  it("acepta la ventana completa en una votación en DRAFT", async () => {
    const response = await request(app)
      .patch(`${API}/votes/${firstVoteId}`)
      .set(auth(presidentToken))
      .send({ opens_at: utcTimestamp(-1), closes_at: utcTimestamp(3) });

    expect(response.status).toBe(200);
    expect(response.body.data.vote.opens_at).toBeTruthy();
    expect(response.body.data.vote.closes_at).toBeTruthy();
  });

  it("abre la votación (DRAFT → OPEN)", async () => {
    const response = await changeVoteStatus(firstVoteId, "OPEN");

    expect(response.status).toBe(200);
    expect(response.body.data.vote.status).toBe("OPEN");
  });

  it("devuelve 409 al editar una votación que ya no está en DRAFT", async () => {
    const response = await request(app)
      .patch(`${API}/votes/${firstVoteId}`)
      .set(auth(presidentToken))
      .send({ title: "Ya abierta" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("devuelve 409 si la votación ya está abierta", async () => {
    const response = await changeVoteStatus(firstVoteId, "OPEN");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });
});

describe("Voto del vecino", () => {
  it("devuelve 400 con una opción de voto inválida", async () => {
    const response = await request(app)
      .post(`${API}/votes/${firstVoteId}/responses`)
      .set(auth(neighborToken))
      .send({ vote_option: "MAYBE" });

    expect(response.status).toBe(400);
    expect(response.body.error.details.errors).toBeDefined();
  });

  it("devuelve 403 al presidente: votar es acción de vecino", async () => {
    const response = await request(app)
      .post(`${API}/votes/${firstVoteId}/responses`)
      .set(auth(presidentToken))
      .send({ vote_option: "AGREE" });

    expect(response.status).toBe(403);
  });

  it("registra el voto del vecino", async () => {
    const response = await request(app)
      .post(`${API}/votes/${firstVoteId}/responses`)
      .set(auth(neighborToken))
      .send({ vote_option: "AGREE" });

    expect(response.status).toBe(201);
    expect(response.body.data.response.vote_option).toBe("AGREE");
    expect(response.body.data.response.id_user).toBe(2);
  });

  it("devuelve 409 si el vecino ya había votado", async () => {
    const response = await request(app)
      .post(`${API}/votes/${firstVoteId}/responses`)
      .set(auth(neighborToken))
      .send({ vote_option: "DISAGREE" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("devuelve 403 al vecino al ver resultados de una votación abierta", async () => {
    const response = await request(app)
      .get(`${API}/votes/${firstVoteId}/results`)
      .set(auth(neighborToken));

    expect(response.status).toBe(403);
  });

  it("devuelve los resultados al presidente mientras está abierta", async () => {
    const response = await request(app)
      .get(`${API}/votes/${firstVoteId}/results`)
      .set(auth(presidentToken));

    expect(response.status).toBe(200);
    expect(response.body.data.results.AGREE).toBe(1);
    expect(response.body.data.total_responses).toBe(1);
  });

  it("devuelve 403 al vecino de otra comunidad", async () => {
    const response = await request(app)
      .get(`${API}/votes/${firstVoteId}`)
      .set(auth(outsiderToken));

    expect(response.status).toBe(403);
  });

  it("devuelve 404 para una votación inexistente", async () => {
    const response = await request(app)
      .get(`${API}/votes/999999`)
      .set(auth(neighborToken));

    expect(response.status).toBe(404);
  });

  it("cierra la votación (OPEN → CLOSED) y permite los resultados al vecino", async () => {
    const closed = await changeVoteStatus(firstVoteId, "CLOSED");
    expect(closed.status).toBe(200);
    expect(closed.body.data.vote.status).toBe("CLOSED");

    const response = await request(app)
      .get(`${API}/votes/${firstVoteId}/results`)
      .set(auth(neighborToken));

    expect(response.status).toBe(200);
    expect(response.body.data.results.AGREE).toBe(1);
    expect(response.body.data.results.DISAGREE).toBe(0);
    expect(response.body.data.total_responses).toBe(1);
  });

  it("devuelve 409 al votar sobre una votación cerrada", async () => {
    const response = await request(app)
      .post(`${API}/votes/${firstVoteId}/responses`)
      .set(auth(neighborToken))
      .send({ vote_option: "AGREE" });

    expect(response.status).toBe(409);
  });

  it("devuelve 409 al cerrar una votación en DRAFT", async () => {
    const draftVoteId = await createVote(operationalMeetingId, {
      opens_at: utcTimestamp(1),
      closes_at: utcTimestamp(2),
    });

    const response = await changeVoteStatus(draftVoteId, "CLOSED");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("devuelve 409 al abrir una votación cuya ventana ya finalizó", async () => {
    const expiredVoteId = await createVote(operationalMeetingId, {
      opens_at: "2020-01-01 00:00:00",
      closes_at: "2020-01-02 00:00:00",
    });

    const response = await changeVoteStatus(expiredVoteId, "OPEN");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("impide votar antes de que se abra la ventana", async () => {
    futureVoteId = await createVote(operationalMeetingId, {
      opens_at: utcTimestamp(1),
      closes_at: utcTimestamp(2),
    });

    const opened = await changeVoteStatus(futureVoteId, "OPEN");
    expect(opened.status).toBe(200);

    const response = await request(app)
      .post(`${API}/votes/${futureVoteId}/responses`)
      .set(auth(neighborToken))
      .send({ vote_option: "AGREE" });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain("no se ha abierto");
  });

  it("impide votar después de que la ventana haya finalizado", async () => {
    const closingVoteId = await createVote(operationalMeetingId, {
      opens_at: utcTimestamp(-1),
      closes_at: utcTimestamp(1),
    });

    const opened = await changeVoteStatus(closingVoteId, "OPEN");
    expect(opened.status).toBe(200);

    // Se adelantan los dos extremos por vía directa: con la API no
    // hay forma de llegar a este estado, porque abrir exige una
    // ventana todavía viva.
    await pool.query("UPDATE votes SET opens_at = ?, closes_at = ? WHERE id_vote = ?", [
      "2020-01-01 00:00:00",
      "2020-01-02 00:00:00",
      closingVoteId,
    ]);

    const response = await request(app)
      .post(`${API}/votes/${closingVoteId}/responses`)
      .set(auth(neighborToken))
      .send({ vote_option: "AGREE" });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain("ha finalizado");
  });
});

describe("Cierre de la reunión con votaciones abiertas", () => {
  it("cierra en cascada las votaciones abiertas de la reunión", async () => {
    const start = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "IN_PROGRESS" });
    expect(start.status).toBe(200);

    const close = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "CLOSED" });
    expect(close.status).toBe(200);

    // `futureVoteId` estaba OPEN: la transacción de cierre la cierra
    // junto con la reunión.
    const response = await request(app)
      .get(`${API}/votes/${futureVoteId}`)
      .set(auth(neighborToken));

    expect(response.status).toBe(200);
    expect(response.body.data.vote.status).toBe("CLOSED");
  });

  it("devuelve 409 al cancelar una reunión ya cerrada", async () => {
    const response = await request(app)
      .patch(`${API}/meetings/${operationalMeetingId}/status`)
      .set(auth(presidentToken))
      .send({ state: "CANCELLED" });

    expect(response.status).toBe(409);
  });
});

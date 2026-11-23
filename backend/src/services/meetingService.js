// =============================================================
// Servicio de reuniones y asistencia.
// =============================================================
//
// Dominio propio: `meetings` y `meeting_attendees`. Las
// votaciones se atienden en `voteService.js`.
//
// Reglas de negocio aplicadas aquí:
//
//   · Pertenencia: cada petición se acota a la comunidad del usuario
//     (`users.id_community`). Quien no pertenece recibe 403, también
//     cuando la reunión o la comunidad no existen, para no revelar
//     su existencia. Esas comprobaciones están en `MembershipService`
//     y las comparten los dos dominios.
//   · Autorización: crear, editar y cambiar el estado de una reunión
//     es exclusivo del `PRESIDENT` de esa comunidad; confirmar
//     asistencia es acción de vecino.
//   · Asistencia: solo se confirma la propia fila; la asistencia se
//     cierra cuando la reunión se cancela.
//   · Transiciones: `SCHEDULED → IN_PROGRESS|CANCELLED` e
//     `IN_PROGRESS → CLOSED|CANCELLED`. `CLOSED` y `CANCELLED` son
//     terminales; cualquier otra salta 409.
//   · Cierre: en la misma transacción se cierran las votaciones
//     abiertas de la reunión (ver
//     `MeetingRepository.changeMeetingStatus`).
//   · Edición: `CANCELLED` no admite cambios, `CLOSED` solo admite el
//     acta (`minutes`) y en reuniones abiertas el acta aún no existe.
//
// Sin objetos `req`/`res` y sin SQL: todo se delega en los
// repositorios.
// =============================================================

import { AppError } from "../utils/AppError.js";
import { MeetingStatus, isMeetingStatus } from "../enums/State.js";
import { MEETING_SORT_FIELDS, MeetingModel } from "../models/Meeting.js";
import {
  currentTimestamp,
  formatTime,
  normalizeDate,
  normalizeTime,
} from "../utils/datetime.js";
import { buildPagination, parseListParams } from "../utils/pagination.js";
import { MeetingRepository } from "../repositories/meetingRepository.js";
import { MembershipService } from "./membershipService.js";

/**
 * -----------------------------------------------------------------
 * Constante: MEETING_TRANSITIONS
 * Propósito: transiciones de estado admitidas en una reunión.
 * `CLOSED` y `CANCELLED` son estados terminales.
 * @type {Readonly<Record<string, readonly string[]>>}
 * -----------------------------------------------------------------
 */
const MEETING_TRANSITIONS = Object.freeze({
  [MeetingStatus.SCHEDULED]: [MeetingStatus.IN_PROGRESS, MeetingStatus.CANCELLED],
  [MeetingStatus.IN_PROGRESS]: [MeetingStatus.CLOSED, MeetingStatus.CANCELLED],
  [MeetingStatus.CLOSED]: [],
  [MeetingStatus.CANCELLED]: [],
});

export class MeetingService {
  #meetingRepository;
  #membership;

  constructor() {
    this.#meetingRepository = new MeetingRepository();
    this.#membership = new MembershipService();
  }

  /**
   * -----------------------------------------------------------------
   * Método: #parseId
   * Propósito: convertir un segmento de ruta en identificador válido.
   * @param {unknown} value - Valor de `req.params`.
   * @param {string} field - Nombre del parámetro (para el mensaje).
   * @param {string} label - Nombre visible del recurso.
   * @returns {number} Identificador positivo.
   * @throws {AppError} 400 si el identificador no es numérico.
   * -----------------------------------------------------------------
   */
  #parseId(value, field, label) {
    const raw = typeof value === "string" ? value.trim() : "";
    const id = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isSafeInteger(id) || id < 1) {
      throw AppError.validation(`El identificador de ${label} no es válido.`, {
        field,
        received: String(value),
      });
    }

    return id;
  }

  /**
   * -----------------------------------------------------------------
   * Método: #loadMeeting
   * Propósito: recuperar una reunión o fallar con 404.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @returns {Promise<object>} Fila de `meetings`.
   * @throws {AppError} 404 si no existe.
   * -----------------------------------------------------------------
   */
  async #loadMeeting(meetingId) {
    const meeting = await this.#meetingRepository.findById(meetingId);

    if (!meeting) {
      throw AppError.notFound("La reunión solicitada no existe.");
    }

    return meeting;
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertMeetingEditable
   * Propósito: aplicar las reglas de edición según el estado.
   *   · `CANCELLED` no admite cambios.
   *   · `CLOSED` solo admite el acta (`minutes`).
   *   · `SCHEDULED`/`IN_PROGRESS` no admiten `minutes`: el acta se
   *     redacta cuando la reunión termina.
   * @param {object} meeting - Fila de `meetings`.
   * @param {object} body - Cuerpo ya validado.
   * @returns {void}
   * @throws {AppError} 409 si el estado no permite la edición.
   * -----------------------------------------------------------------
   */
  #assertMeetingEditable(meeting, body) {
    const keys = Object.keys(body);

    if (meeting.state === MeetingStatus.CANCELLED) {
      throw AppError.conflict("La reunión está cancelada y no admite cambios.");
    }

    if (meeting.state === MeetingStatus.CLOSED) {
      if (!keys.every((key) => key === "minutes")) {
        throw AppError.conflict("La reunión está cerrada: solo puede modificarse el acta.");
      }
      return;
    }

    if (keys.includes("minutes")) {
      throw AppError.conflict("El acta solo puede guardarse cuando la reunión está cerrada.");
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: listMeetings
   * Propósito: listado paginado de reuniones de una comunidad
   * (`GET /communities/:communityId/meetings`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} query - `req.query`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ meetings: object[], pagination: object }>}
   * @throws {AppError} 400 si un filtro no vale, 403 si no pertenece.
   * -----------------------------------------------------------------
   */
  async listMeetings(communityId, query = {}, requesterId) {
    const id = this.#parseId(communityId, "communityId", "comunidad");
    await this.#membership.assertCommunityMember(requesterId, id);

    const params = parseListParams(query, {
      allowed: MEETING_SORT_FIELDS,
      defaultField: "date",
      defaultOrder: "asc",
    });

    const filters = {};

    if (query.state !== undefined && query.state !== "") {
      if (typeof query.state !== "string" || !isMeetingStatus(query.state)) {
        throw AppError.validation("El filtro state no es válido.", {
          field: "state",
          received: Array.isArray(query.state) ? "[]" : String(query.state),
        });
      }
      filters.state = query.state;
    }

    const [total, rows] = await Promise.all([
      this.#meetingRepository.countByCommunity(id, filters),
      this.#meetingRepository.findByCommunityId(id, { ...params, ...filters }),
    ]);

    return {
      meetings: rows.map((row) => MeetingModel.toSafeMeeting(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: createMeeting
   * Propósito: crear una reunión (`POST /communities/:communityId/meetings`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ meeting: object }>} Recién creada (`SCHEDULED`).
   * @throws {AppError} 400 si los datos no valen, 403 si no es el presidente.
   * -----------------------------------------------------------------
   */
  async createMeeting(communityId, input, requesterId) {
    const id = this.#parseId(communityId, "communityId", "comunidad");
    const user = await this.#membership.assertCommunityMember(requesterId, id);
    this.#membership.assertPresident(user);

    const errors = MeetingModel.validateMeetingCreate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la reunión no son válidos.", { errors });
    }

    const body = input;
    const meetingId = await this.#meetingRepository.createMeeting({
      idCommunity: id,
      date: normalizeDate(body.date),
      startTime: normalizeTime(body.start_time),
      endTime: normalizeTime(body.end_time),
      title: body.title.trim(),
      agenda: typeof body.agenda === "string" && body.agenda.trim() !== "" ? body.agenda : null,
    });

    const created = await this.#loadMeeting(meetingId);
    return { meeting: MeetingModel.toSafeMeeting(created) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getMeeting
   * Propósito: detalle y acta (`GET /meetings/:meetingId`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ meeting: object }>}
   * @throws {AppError} 400, 403 o 404.
   * -----------------------------------------------------------------
   */
  async getMeeting(meetingId, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    await this.#membership.assertCommunityMember(requesterId, Number(meeting.id_community));

    return { meeting: MeetingModel.toSafeMeeting(meeting) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateMeeting
   * Propósito: editar una reunión (`PATCH /meetings/:meetingId`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ meeting: object }>} Reunión actualizada.
   * @throws {AppError} 400, 403 o 409.
   * -----------------------------------------------------------------
   */
  async updateMeeting(meetingId, input, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(meeting.id_community),
    );
    this.#membership.assertPresident(user);

    const errors = MeetingModel.validateMeetingUpdate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la reunión no son válidos.", { errors });
    }

    const body = input;
    this.#assertMeetingEditable(meeting, body);

    const fields = {};
    if (body.date !== undefined) fields.date = normalizeDate(body.date);
    if (body.start_time !== undefined) fields.start_time = normalizeTime(body.start_time);
    if (body.end_time !== undefined) fields.end_time = normalizeTime(body.end_time);
    if (body.title !== undefined) fields.title = body.title.trim();
    if (body.agenda !== undefined) {
      fields.agenda = body.agenda === null || body.agenda === "" ? null : body.agenda;
    }
    if (body.minutes !== undefined) {
      fields.minutes = body.minutes === null || body.minutes === "" ? null : body.minutes;
    }

    // `chk_meetings_time` exige start_time < end_time sobre el par
    // definitivo (cuerpo + fila guardada).
    const finalStart = formatTime(fields.start_time ?? meeting.start_time);
    const finalEnd = formatTime(fields.end_time ?? meeting.end_time);
    if (!(finalStart < finalEnd)) {
      throw AppError.validation("La hora de finalización debe ser posterior a la de inicio.", {
        field: "end_time",
      });
    }

    await this.#meetingRepository.updateMeeting(id, fields);
    const updated = await this.#loadMeeting(id);

    return { meeting: MeetingModel.toSafeMeeting(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeMeetingStatus
   * Propósito: cambiar el estado de una reunión
   * (`PATCH /meetings/:meetingId/status`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ meeting: object }>} Reunión actualizada.
   * @throws {AppError} 400, 403 o 409 (transición inválida).
   * -----------------------------------------------------------------
   */
  async changeMeetingStatus(meetingId, input, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(meeting.id_community),
    );
    this.#membership.assertPresident(user);

    const errors = MeetingModel.validateMeetingStatusChange(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de estado no son válidos.", { errors });
    }

    const next = input.state;
    const current = meeting.state;

    if (current === next) {
      throw AppError.conflict("La reunión ya está en ese estado.");
    }

    const allowed = MEETING_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw AppError.conflict(`No se puede pasar de ${current} a ${next}.`);
    }

    await this.#meetingRepository.changeMeetingStatus(id, next);
    const updated = await this.#loadMeeting(id);

    return { meeting: MeetingModel.toSafeMeeting(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: listAttendance
   * Propósito: listado de asistencia (`GET /meetings/:meetingId/attendance`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ attendees: object[] }>}
   * @throws {AppError} 400, 403 o 404.
   * -----------------------------------------------------------------
   */
  async listAttendance(meetingId, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(meeting.id_community),
    );
    this.#membership.assertPresident(user);

    const rows = await this.#meetingRepository.listAttendees(id, Number(meeting.id_community));

    return {
      attendees: rows.map((row) =>
        MeetingModel.toSafeAttendance({ ...row, id_meeting: id }),
      ),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: confirmAttendance
   * Propósito: confirmar la asistencia del propio vecino
   * (`PUT /meetings/:meetingId/attendance`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ attendance: object }>}
   * @throws {AppError} 400, 403, 404 o 409.
   * -----------------------------------------------------------------
   */
  async confirmAttendance(meetingId, input, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(meeting.id_community),
    );

    const errors = MeetingModel.validateAttendanceConfirmation(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de asistencia no son válidos.", { errors });
    }

    if (meeting.state === MeetingStatus.CANCELLED) {
      throw AppError.conflict("La reunión está cancelada y no admite confirmación de asistencia.");
    }

    const userId = Number(user.id_user);
    await this.#meetingRepository.upsertAttendance(
      id,
      userId,
      input.attendance_status,
      currentTimestamp(),
    );

    const row = await this.#meetingRepository.findAttendance(id, userId);
    return { attendance: MeetingModel.toSafeAttendance(row) };
  }
}

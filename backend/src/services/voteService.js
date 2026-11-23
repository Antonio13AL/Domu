// =============================================================
// Servicio de votaciones (capa 3 — sin objetos Express).
// =============================================================
//
// Dominio propio de BE-10: `votes` y `vote_responses`. Las reglas de
// reuniones y asistencia viven en `meetingService.js`; la pertenencia
// a la comunidad y el rol se delegan en `MembershipService`.
//
// Reglas de negocio aplicadas aquí:
//
//   · Creación: solo en una reunión `SCHEDULED` o `IN_PROGRESS`; si
//     la reunión ya terminó o se canceló responde 409.
//   · Edición: solo mientras la votación está en `DRAFT`.
//   · Transiciones: `DRAFT → OPEN → CLOSED`, sin vuelta atrás;
//     cualquier otra salta 409.
//   · Apertura: exige `opens_at` y `closes_at` definidos, una
//     reunión activa y una ventana que aún no haya vencido.
//   · Ventana: el par tiene que llegar completo y en orden, tanto en
//     el cuerpo como en el resultado de combinarlo con la fila.
//   · Votación: solo con estado `OPEN` y dentro de la ventana; un
//     segundo voto devuelve 409 (más la clave única como red final).
//   · Resultados: el presidente los ve siempre; el vecino solo cuando
//     la votación está `CLOSED`.
//
// Sin objetos `req`/`res` y sin SQL: todo se delega en los
// repositorios.
// =============================================================

import { AppError } from "../utils/AppError.js";
import { Role } from "../enums/Role.js";
import { MeetingStatus, VoteStatus } from "../enums/State.js";
import { VoteModel, VOTE_SORT_FIELDS } from "../models/Vote.js";
import {
  currentTimestamp,
  isValidWindow,
  normalizeDateTime,
  toComparableDateTime,
} from "../utils/datetime.js";
import { buildPagination, parseListParams } from "../utils/pagination.js";
import { MeetingRepository } from "../repositories/meetingRepository.js";
import { VoteRepository } from "../repositories/voteRepository.js";
import { MembershipService } from "./membershipService.js";

/**
 * -----------------------------------------------------------------
 * Constante: VOTE_TRANSITIONS
 * Propósito: transiciones de estado admitidas en una votación. Un
 * borrador se abre y una abierta se cierra; no hay vuelta atrás.
 * @type {Readonly<Record<string, readonly string[]>>}
 * -----------------------------------------------------------------
 */
const VOTE_TRANSITIONS = Object.freeze({
  [VoteStatus.DRAFT]: [VoteStatus.OPEN],
  [VoteStatus.OPEN]: [VoteStatus.CLOSED],
  [VoteStatus.CLOSED]: [],
});

/**
 * -----------------------------------------------------------------
 * Constante: ACTIVE_MEETING_STATES
 * Propósito: estados de la reunión en los que admite nuevas
 * votaciones o puede abrirse una existente.
 * @type {ReadonlyArray<string>}
 * -----------------------------------------------------------------
 */
const ACTIVE_MEETING_STATES = Object.freeze([
  MeetingStatus.SCHEDULED,
  MeetingStatus.IN_PROGRESS,
]);

export class VoteService {
  #voteRepository;
  #meetingRepository;
  #membership;

  constructor() {
    this.#voteRepository = new VoteRepository();
    // La reunión se lee porque es el padre de la votación: de ella
    // sale la comunidad que acota la petición y el estado que decide
    // si se puede crear o abrir una votación.
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
   * Propósito: recuperar la reunión padre o fallar con 404.
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
   * Método: #loadVote
   * Propósito: recuperar una votación con su reunión o fallar 404.
   * @param {number} voteId - `votes.id_vote`.
   * @returns {Promise<object>} Fila con la votación y su comunidad.
   * @throws {AppError} 404 si no existe.
   * -----------------------------------------------------------------
   */
  async #loadVote(voteId) {
    const vote = await this.#voteRepository.findByIdWithMeeting(voteId);

    if (!vote) {
      throw AppError.notFound("La votación solicitada no existe.");
    }

    return vote;
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertActiveMeeting
   * Propósito: impedir crear o abrir votaciones sobre una reunión que
   * ya terminó o se canceló.
   * @param {object} meeting - Fila de `meetings`.
   * @returns {void}
   * @throws {AppError} 409 si la reunión no está activa.
   * -----------------------------------------------------------------
   */
  #assertActiveMeeting(meeting) {
    if (!ACTIVE_MEETING_STATES.includes(meeting.state)) {
      throw AppError.conflict(
        "Solo se admiten votaciones en reuniones programadas o en curso.",
      );
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: listVotes
   * Propósito: listado paginado de votaciones de una reunión
   * (`GET /meetings/:meetingId/votes`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {object} query - `req.query`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ votes: object[], pagination: object }>}
   * @throws {AppError} 400, 403 o 404.
   * -----------------------------------------------------------------
   */
  async listVotes(meetingId, query = {}, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    await this.#membership.assertCommunityMember(requesterId, Number(meeting.id_community));

    const params = parseListParams(query, {
      allowed: VOTE_SORT_FIELDS,
      defaultField: "created_at",
      defaultOrder: "desc",
    });

    const [total, rows] = await Promise.all([
      this.#voteRepository.countByMeetingId(id),
      this.#voteRepository.listByMeetingId(id, params),
    ]);

    return {
      votes: rows.map((row) => VoteModel.toSafeVote(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: createVote
   * Propósito: crear una votación en borrador
   * (`POST /meetings/:meetingId/votes`).
   * @param {unknown} meetingId - `req.params.meetingId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ vote: object }>} Recién creada (`DRAFT`).
   * @throws {AppError} 400, 403, 404 o 409.
   * -----------------------------------------------------------------
   */
  async createVote(meetingId, input, requesterId) {
    const id = this.#parseId(meetingId, "meetingId", "reunión");
    const meeting = await this.#loadMeeting(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(meeting.id_community),
    );
    this.#membership.assertPresident(user);

    const errors = VoteModel.validateVoteCreate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la votación no son válidos.", { errors });
    }

    this.#assertActiveMeeting(meeting);

    const body = input;
    const voteId = await this.#voteRepository.createVote({
      idMeeting: id,
      createdBy: Number(user.id_user),
      title: body.title.trim(),
      description:
        typeof body.description === "string" && body.description.trim() !== ""
          ? body.description
          : null,
      opensAt: body.opens_at === undefined ? null : normalizeDateTime(body.opens_at),
      closesAt: body.closes_at === undefined ? null : normalizeDateTime(body.closes_at),
    });

    const created = await this.#loadVote(voteId);
    return { vote: VoteModel.toSafeVote(created) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getVote
   * Propósito: detalle de una votación (`GET /votes/:voteId`).
   * @param {unknown} voteId - `req.params.voteId`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ vote: object }>}
   * @throws {AppError} 400, 403 o 404.
   * -----------------------------------------------------------------
   */
  async getVote(voteId, requesterId) {
    const id = this.#parseId(voteId, "voteId", "votación");
    const vote = await this.#loadVote(id);
    await this.#membership.assertCommunityMember(requesterId, Number(vote.id_community));

    return { vote: VoteModel.toSafeVote(vote) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateVote
   * Propósito: editar una votación en borrador (`PATCH /votes/:voteId`).
   * @param {unknown} voteId - `req.params.voteId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ vote: object }>} Votación actualizada.
   * @throws {AppError} 400, 403, 404 o 409.
   * -----------------------------------------------------------------
   */
  async updateVote(voteId, input, requesterId) {
    const id = this.#parseId(voteId, "voteId", "votación");
    const vote = await this.#loadVote(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(vote.id_community),
    );
    this.#membership.assertPresident(user);

    if (vote.status !== VoteStatus.DRAFT) {
      throw AppError.conflict("La votación solo puede editarse mientras está en DRAFT.");
    }

    const errors = VoteModel.validateVoteUpdate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la votación no son válidos.", { errors });
    }

    const body = input;
    const fields = {};

    for (const key of ["title", "description", "opens_at", "closes_at"]) {
      if (body[key] === undefined) continue;

      if (key === "title") {
        fields.title = body.title.trim();
      } else if (key === "description") {
        fields.description = body.description === null || body.description === "" ? null : body.description;
      } else {
        fields[key] =
          body[key] === null || body[key] === "" ? null : normalizeDateTime(body[key]);
      }
    }

    // La ventana definitiva (cuerpo + fila) debe seguir completa y
    // en orden: el CHECK `chk_votes_window` de la base de datos lo
    // exige, y sin el par entero la votación no podría abrirse.
    const finalOpens = toComparableDateTime(
      "opens_at" in fields ? fields.opens_at : vote.opens_at,
    );
    const finalCloses = toComparableDateTime(
      "closes_at" in fields ? fields.closes_at : vote.closes_at,
    );

    if ((finalOpens === null) !== (finalCloses === null)) {
      throw AppError.validation("opens_at y closes_at deben indicarse juntos.", {
        field: "opens_at",
      });
    }
    if (!isValidWindow(finalOpens, finalCloses)) {
      throw AppError.validation("opens_at debe ser anterior a closes_at.", { field: "opens_at" });
    }

    await this.#voteRepository.updateVote(id, fields);
    const updated = await this.#loadVote(id);

    return { vote: VoteModel.toSafeVote(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeVoteStatus
   * Propósito: abrir o cerrar una votación
   * (`PATCH /votes/:voteId/status`).
   * @param {unknown} voteId - `req.params.voteId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ vote: object }>} Votación actualizada.
   * @throws {AppError} 400, 403, 404 o 409.
   * -----------------------------------------------------------------
   */
  async changeVoteStatus(voteId, input, requesterId) {
    const id = this.#parseId(voteId, "voteId", "votación");
    const vote = await this.#loadVote(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(vote.id_community),
    );
    this.#membership.assertPresident(user);

    const errors = VoteModel.validateVoteStatusChange(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de estado no son válidos.", { errors });
    }

    const next = input.status;
    const current = vote.status;

    if (current === next) {
      throw AppError.conflict("La votación ya está en ese estado.");
    }

    const allowed = VOTE_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw AppError.conflict(`No se puede pasar de ${current} a ${next}.`);
    }

    if (next === VoteStatus.OPEN) {
      if (!vote.opens_at || !vote.closes_at) {
        throw AppError.validation(
          "La votación debe indicar opens_at y closes_at antes de abrirse.",
          { field: "opens_at" },
        );
      }

      if (!ACTIVE_MEETING_STATES.includes(vote.meeting_state)) {
        throw AppError.conflict(
          "Solo se admiten votaciones en reuniones programadas o en curso.",
        );
      }

      const now = currentTimestamp();
      if (!(now < toComparableDateTime(vote.closes_at))) {
        throw AppError.conflict("El periodo de votación ya ha finalizado.");
      }
    }

    await this.#voteRepository.changeVoteStatus(id, next);
    const updated = await this.#loadVote(id);

    return { vote: VoteModel.toSafeVote(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: castVote
   * Propósito: emitir el voto del propio vecino
   * (`POST /votes/:voteId/responses`).
   * @param {unknown} voteId - `req.params.voteId`.
   * @param {object} input - `req.body`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ response: object }>} Voto registrado.
   * @throws {AppError} 400, 403, 404 o 409 (voto único o ventana).
   * -----------------------------------------------------------------
   */
  async castVote(voteId, input, requesterId) {
    const id = this.#parseId(voteId, "voteId", "votación");
    const vote = await this.#loadVote(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(vote.id_community),
    );

    const errors = VoteModel.validateVoteResponse(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos del voto no son válidos.", { errors });
    }

    if (vote.status !== VoteStatus.OPEN) {
      throw AppError.conflict("La votación no está abierta.");
    }

    const userId = Number(user.id_user);
    const now = currentTimestamp();
    const opensAt = toComparableDateTime(vote.opens_at);
    const closesAt = toComparableDateTime(vote.closes_at);

    if (opensAt !== null && now < opensAt) {
      throw AppError.conflict("La votación aún no se ha abierto.");
    }
    if (closesAt !== null && now > closesAt) {
      throw AppError.conflict("El periodo de votación ha finalizado.");
    }

    const existing = await this.#voteRepository.findResponse(id, userId);
    if (existing) {
      throw AppError.conflict("Ya ha emitido su voto en esta votación.");
    }

    // La clave única `(id_vote, id_user)` es la garantía final ante
    // peticiones simultáneas: `ER_DUP_ENTRY` → 409 en errorHandler.
    await this.#voteRepository.createResponse(id, userId, input.vote_option);

    const row = await this.#voteRepository.findResponse(id, userId);
    return { response: VoteModel.toSafeResponse(row) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getResults
   * Propósito: resultados de una votación (`GET /votes/:voteId/results`).
   * El presidente los ve siempre; el vecino solo con la votación
   * cerrada.
   * @param {unknown} voteId - `req.params.voteId`.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<{ vote: object, results: object, total_responses: number }>}
   * @throws {AppError} 400, 403 o 404.
   * -----------------------------------------------------------------
   */
  async getResults(voteId, requesterId) {
    const id = this.#parseId(voteId, "voteId", "votación");
    const vote = await this.#loadVote(id);
    const user = await this.#membership.assertCommunityMember(
      requesterId,
      Number(vote.id_community),
    );

    if (user.role !== Role.PRESIDENT && vote.status !== VoteStatus.CLOSED) {
      throw AppError.forbidden("Los resultados solo están disponibles cuando la votación está cerrada.");
    }

    const rows = await this.#voteRepository.countResponsesByVote(id);
    const results = { AGREE: 0, DISAGREE: 0, NULL: 0 };
    let totalResponses = 0;

    for (const row of rows) {
      const option = row.vote_option;
      if (option in results) {
        results[option] = row.total;
        totalResponses += row.total;
      }
    }

    return {
      vote: VoteModel.toSafeVote(vote),
      results,
      total_responses: totalResponses,
    };
  }
}

// =============================================================
// Servicio del panel — cálculo de KPIs y filtrado por rol.
// =============================================================
//
// Reglas de negocio:
//   · `GET /communities/:communityId/dashboard/summary` es
//     exclusivo para miembros activos de la comunidad: la
//     pertenencia se comprueba contra `users.id_community` mediante
//     `MembershipService` (403 genérico también cuando la comunidad
//     no existe, para no revelarla).
//   · El resumen se calcula por rol:
//       - `NEIGHBOR`: sus propias incidencias abiertas, sus
//         votaciones todavía sin responder, su próxima reserva y la
//         próxima reunión de la comunidad.
//       - `PRESIDENT`: métricas de la comunidad (incidencias y
//         reservas por estado, miembros activos por rol, próximas
//         reuniones y votaciones abiertas).
//   · «Abierta» significa `PENDING` o `IN_PROGRESS` en incidencias;
//     «pendiente de aprobar» es la reserva en `PENDING`.
//   · El reloj (hoy, hora actual y marca UTC) se calcula aquí con
//     `utils/datetime.js` y se pasa al repositorio, de modo que los
//     tests pueden fijarlo sin tocar el sistema.
//   · Sin objetos `req`/`res` y sin SQL: todo se delega en los
//     repositorios.
// =============================================================

import { Role } from "../enums/Role.js";
import { BookingStatus, IssueStatus } from "../enums/State.js";
import { AppError } from "../utils/AppError.js";
import { currentTimestamp, formatDate, formatTime } from "../utils/datetime.js";
import { DashboardRepository } from "../repositories/dashboardRepository.js";
import { MembershipService } from "./membershipService.js";

/** Estados de incidencia que cuentan como «abiertas». */
const OPEN_ISSUE_STATES = Object.freeze([IssueStatus.PENDING, IssueStatus.IN_PROGRESS]);

/** Estados de reserva, en el orden en que se devuelven los totales. */
const BOOKING_STATES = Object.freeze([
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CANCELLED,
  BookingStatus.REJECTED,
]);

/** Estados de incidencia, en el orden en que se devuelven los totales. */
const ISSUE_STATES = Object.freeze([
  IssueStatus.PENDING,
  IssueStatus.IN_PROGRESS,
  IssueStatus.RESOLVED,
  IssueStatus.REJECTED,
]);

/** Filas de las listas cortas del panel. */
const UPCOMING_MEETINGS_LIMIT = 5;
const OPEN_VOTES_LIMIT = 5;

/** Formato de la marca UTC que puede recibir el test como reloj. */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * -----------------------------------------------------------------
 * Función: countOpenIssues
 * Propósito: sumar los totales de los estados «abiertos» de una
 * agrupación `[{ status, total }]`.
 * @param {Array<{ status: string, total: number }>} rows - Agregados.
 * @returns {number} Cantidad de incidencias abiertas.
 * -----------------------------------------------------------------
 */
function countOpenIssues(rows) {
  return rows.reduce(
    (sum, row) => (OPEN_ISSUE_STATES.includes(row.status) ? sum + row.total : sum),
    0,
  );
}

/**
 * -----------------------------------------------------------------
 * Función: toStatusMap
 * Propósito: convertir una agrupación `[{ status, total }]` en un
 * mapa con todas las claves del enum, a `0` cuando no hay filas:
 * el panel puede pintar la leyenda completa sin ramas en cliente.
 * @param {Array<{ status: string, total: number }>} rows - Agregados.
 * @param {ReadonlyArray<string>} statuses - Estados en orden fijo.
 * @returns {Record<string, number>} Mapa estado → total.
 * -----------------------------------------------------------------
 */
function toStatusMap(rows, statuses) {
  const map = Object.fromEntries(statuses.map((status) => [status, 0]));

  for (const row of rows) {
    if (Object.hasOwn(map, row.status)) {
      map[row.status] = row.total;
    }
  }

  return map;
}

/**
 * -----------------------------------------------------------------
 * Función: toMembersSummary
 * Propósito: convertir la agrupación `[{ role, total }]` en el
 * bloque de miembros activos, con total y desglose por rol.
 * @param {Array<{ role: string, total: number }>} rows - Agregados.
 * @returns {{ total: number, by_role: Record<string, number> }}
 * -----------------------------------------------------------------
 */
function toMembersSummary(rows) {
  const byRole = {
    [Role.NEIGHBOR]: 0,
    [Role.PRESIDENT]: 0,
  };
  let total = 0;

  for (const row of rows) {
    if (Object.hasOwn(byRole, row.role)) {
      byRole[row.role] = row.total;
      total += row.total;
    }
  }

  return { total, by_role: byRole };
}

/**
 * -----------------------------------------------------------------
 * Función: toMeetingSummary
 * Propósito: forma de respuesta de una fila de `meetings` usada en
 * el panel (sin acta ni timestamps: el resumen no los necesita).
 * @param {object} row - Fila de `meetings`.
 * @returns {object} Reunión resumida.
 * -----------------------------------------------------------------
 */
function toMeetingSummary(row) {
  return {
    id_meeting: Number(row.id_meeting),
    date: formatDate(row.date),
    start_time: formatTime(row.start_time),
    end_time: formatTime(row.end_time),
    title: row.title,
    state: row.state,
  };
}

/**
 * -----------------------------------------------------------------
 * Función: toBookingSummary
 * Propósito: forma de respuesta de una fila de `bookings` usada en
 * el panel (sin notas ni revisión: el resumen no los necesita).
 * @param {object} row - Fila de `bookings`.
 * @returns {object} Reserva resumida.
 * -----------------------------------------------------------------
 */
function toBookingSummary(row) {
  return {
    id_booking: Number(row.id_booking),
    space_name: row.space_name,
    booking_date: formatDate(row.booking_date),
    start_time: formatTime(row.start_time),
    end_time: formatTime(row.end_time),
    status: row.status,
  };
}

/**
 * -----------------------------------------------------------------
 * Función: toVoteSummary
 * Propósito: forma de respuesta de una fila de `votes` usada en el
 * panel (sin descripción ni auditoría).
 * @param {object} row - Fila de `votes`.
 * @returns {object} Votación resumida.
 * -----------------------------------------------------------------
 */
function toVoteSummary(row) {
  return {
    id_vote: Number(row.id_vote),
    id_meeting: Number(row.id_meeting),
    title: row.title,
    opens_at: row.opens_at ?? null,
    closes_at: row.closes_at ?? null,
  };
}

export class DashboardService {
  #dashboardRepository;
  #membership;

  constructor() {
    this.#dashboardRepository = new DashboardRepository();
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
   * @throws {AppError} 400 si no es numérico.
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
   * Método: #buildClock
   * Propósito: fijar la referencia temporal de los KPIs. Por
   * defecto se usa el reloj actual en UTC; los tests pueden
   * inyectar una marca exacta para que «próxima reunión» o «próxima
   * reserva» no dependan del día en que se ejecuten.
   * @param {null | string} now - Marca `YYYY-MM-DD HH:mm:ss`.
   * @returns {{ now: string, fromDate: string, nowTime: string }}
   * @throws {AppError} 400 si la marca inyectada no tiene el formato.
   * -----------------------------------------------------------------
   */
  #buildClock(now) {
    if (now === null || now === undefined) {
      const timestamp = currentTimestamp();
      return {
        now: timestamp,
        fromDate: timestamp.slice(0, 10),
        nowTime: timestamp.slice(11, 19),
      };
    }

    if (typeof now !== "string" || !TIMESTAMP_PATTERN.test(now)) {
      throw AppError.validation(
        "La marca de tiempo debe tener formato YYYY-MM-DD HH:mm:ss.",
        { field: "now", received: String(now) },
      );
    }

    return {
      now,
      fromDate: now.slice(0, 10),
      nowTime: now.slice(11, 19),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: #neighborSummary
   * Propósito: KPIs del vecino (su actividad, sin métricas ajenas).
   * @param {number} communityId - Comunidad del resumen.
   * @param {number} userId - Vecino solicitante.
   * @param {object} clock - Reloj ya calculado.
   * @returns {Promise<object>} Resumen del vecino.
   * -----------------------------------------------------------------
   */
  async #neighborSummary(communityId, userId, clock) {
    const [issueCounts, pendingVotes, upcomingMeetings, nextBooking] = await Promise.all([
      this.#dashboardRepository.countIssuesByStatusForUser(communityId, userId),
      this.#dashboardRepository.countOpenVotesForUser(communityId, userId, { now: clock.now }),
      this.#dashboardRepository.listUpcomingMeetings(communityId, {
        fromDate: clock.fromDate,
        limit: 1,
      }),
      this.#dashboardRepository.findNextBookingForUser(communityId, userId, {
        fromDate: clock.fromDate,
        nowTime: clock.nowTime,
      }),
    ]);

    return {
      role: Role.NEIGHBOR,
      generated_at: clock.now,
      kpis: {
        open_issues: countOpenIssues(issueCounts),
        pending_votes: pendingVotes,
        next_meeting: upcomingMeetings.length > 0 ? toMeetingSummary(upcomingMeetings[0]) : null,
        next_booking: nextBooking ? toBookingSummary(nextBooking) : null,
      },
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: #presidentSummary
   * Propósito: KPIs del presidente (métricas de la comunidad).
   * @param {number} communityId - Comunidad del resumen.
   * @param {object} clock - Reloj ya calculado.
   * @returns {Promise<object>} Resumen del presidente.
   * -----------------------------------------------------------------
   */
  async #presidentSummary(communityId, clock) {
    const [issueCounts, bookingCounts, memberCounts, upcomingMeetings, openVotes] =
      await Promise.all([
        this.#dashboardRepository.countIssuesByStatus(communityId),
        this.#dashboardRepository.countBookingsByStatus(communityId),
        this.#dashboardRepository.countActiveMembersByRole(communityId),
        this.#dashboardRepository.listUpcomingMeetings(communityId, {
          fromDate: clock.fromDate,
          limit: UPCOMING_MEETINGS_LIMIT,
        }),
        this.#dashboardRepository.listOpenVotes(communityId, {
          now: clock.now,
          limit: OPEN_VOTES_LIMIT,
        }),
      ]);

    const issuesByStatus = toStatusMap(issueCounts, ISSUE_STATES);
    const bookingsByStatus = toStatusMap(bookingCounts, BOOKING_STATES);
    const activeMembers = toMembersSummary(memberCounts);

    return {
      role: Role.PRESIDENT,
      generated_at: clock.now,
      kpis: {
        open_issues: countOpenIssues(issueCounts),
        pending_bookings: bookingsByStatus[BookingStatus.PENDING],
        issues_by_status: issuesByStatus,
        bookings_by_status: bookingsByStatus,
        active_members: activeMembers,
        upcoming_meetings: upcomingMeetings.map(toMeetingSummary),
        open_votes: openVotes.map(toVoteSummary),
      },
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getSummary
   * Propósito: resumen del panel `GET /communities/:communityId/dashboard/summary`.
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {number} requesterId - `req.user.id`.
   * @param {null | string} [now] - Reloj de prueba
   * (`YYYY-MM-DD HH:mm:ss`); por defecto, el actual.
   * @returns {Promise<{ role: string, generated_at: string, kpis: object }>}
   *   Resumen con el bloque `kpis` propio del rol.
   * @throws {AppError} 400 si la comunidad no es válida o el reloj
   * inyectado no lo está; 401/403 si no es miembro activo.
   * -----------------------------------------------------------------
   */
  async getSummary(communityId, requesterId, now = null) {
    const id = this.#parseId(communityId, "communityId", "comunidad");
    const user = await this.#membership.assertCommunityMember(requesterId, id);
    const clock = this.#buildClock(now);

    if (user.role === Role.PRESIDENT) {
      return this.#presidentSummary(id, clock);
    }

    return this.#neighborSummary(id, Number(user.id_user), clock);
  }
}

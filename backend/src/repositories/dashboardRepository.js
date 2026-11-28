// =============================================================
// Repositorio del panel — KPIs agregados, SQL parametrizado.
// =============================================================
// Reglas aplicadas aquí:
//   · Nunca se selecciona `*`: las columnas están explícitas.
//   · Todas las consultas usan placeholders `?` con `pool.query()`.
//   · Toda consulta de panel acota por `id_community` (el detalle
//     por usuario vuelve a acotar por `id_user`): ningún KPI cruza
//     comunidades.
//   · Los límites de las listas cortas son `?` y llegan validados
//     desde el servicio; el orden es fijo (no hay `sort` de usuario
//     en el panel).
//   · `now` (marca UTC `YYYY-MM-DD HH:mm:ss`) y `fromDate` (hoy,
//     `YYYY-MM-DD`) los calcula el servicio con `utils/datetime.js`,
//     para que los tests puedan fijar el reloj.
// =============================================================

import { pool } from "../config/database.js";
import { BookingStatus, VoteStatus } from "../enums/State.js";

/** Filas que devuelven las listas cortas del panel por defecto. */
const DEFAULT_LIMIT = 5;

export class DashboardRepository {
  /**
   * -----------------------------------------------------------------
   * Método: countIssuesByStatus
   * Propósito: KPI del panel presidencial — incidencias de la
   * comunidad agrupadas por estado.
   * @param {number} communityId - `issues.id_community`.
   * @returns {Promise<Array<{ status: string, total: number }>>}
   *   Una fila por estado presente en la comunidad.
   * -----------------------------------------------------------------
   */
  async countIssuesByStatus(communityId) {
    const query = `
      SELECT status, COUNT(*) AS total
      FROM issues
      WHERE id_community = ?
      GROUP BY status;
    `;
    const [rows] = await pool.query(query, [communityId]);
    return rows.map((row) => ({ status: row.status, total: Number(row.total) }));
  }

  /**
   * -----------------------------------------------------------------
   * Método: countIssuesByStatusForUser
   * Propósito: KPI del panel de vecino — incidencias que él mismo
   * abrió en la comunidad, agrupadas por estado. Con `PENDING` +
   * `IN_PROGRESS` el servicio calcula las «abiertas».
   * @param {number} communityId - `issues.id_community`.
   * @param {number} userId - `issues.id_user`.
   * @returns {Promise<Array<{ status: string, total: number }>>}
   * -----------------------------------------------------------------
   */
  async countIssuesByStatusForUser(communityId, userId) {
    const query = `
      SELECT status, COUNT(*) AS total
      FROM issues
      WHERE id_community = ? AND id_user = ?
      GROUP BY status;
    `;
    const [rows] = await pool.query(query, [communityId, userId]);
    return rows.map((row) => ({ status: row.status, total: Number(row.total) }));
  }

  /**
   * -----------------------------------------------------------------
   * Método: countBookingsByStatus
   * Propósito: KPI del panel presidencial — reservas de la
   * comunidad agrupadas por estado. El «pendiente de
   * aprobar» es el elemento `PENDING` del resultado.
   * @param {number} communityId - `bookings.id_community`.
   * @returns {Promise<Array<{ status: string, total: number }>>}
   * -----------------------------------------------------------------
   */
  async countBookingsByStatus(communityId) {
    const query = `
      SELECT status, COUNT(*) AS total
      FROM bookings
      WHERE id_community = ?
      GROUP BY status;
    `;
    const [rows] = await pool.query(query, [communityId]);
    return rows.map((row) => ({ status: row.status, total: Number(row.total) }));
  }

  /**
   * -----------------------------------------------------------------
   * Método: countActiveMembersByRole
   * Propósito: KPI del panel presidencial — vecinos activos por rol;
   * los dados de baja (`is_active = 0`) no cuentan.
   * @param {number} communityId - `users.id_community`.
   * @returns {Promise<Array<{ role: string, total: number }>>}
   * -----------------------------------------------------------------
   */
  async countActiveMembersByRole(communityId) {
    const query = `
      SELECT role, COUNT(*) AS total
      FROM users
      WHERE id_community = ? AND is_active = 1
      GROUP BY role;
    `;
    const [rows] = await pool.query(query, [communityId]);
    return rows.map((row) => ({ role: row.role, total: Number(row.total) }));
  }

  /**
   * -----------------------------------------------------------------
   * Método: listUpcomingMeetings
   * Propósito: reuniones por venir de la comunidad, la
   * primera de las cuales es la «próxima reunión» del panel.
   * @param {number} communityId - `meetings.id_community`.
   * @param {object} [params] - Parámetros ya validados.
   * @param {string} params.fromDate - Hoy en `YYYY-MM-DD`.
   * @param {number} [params.limit] - Filas a devolver.
   * @returns {Promise<object[]>} Reuniones ordenadas por fecha.
   * -----------------------------------------------------------------
   */
  async listUpcomingMeetings(communityId, { fromDate, limit = DEFAULT_LIMIT }) {
    const query = `
      SELECT id_meeting, \`date\`, start_time, end_time, title, state
      FROM meetings
      WHERE id_community = ? AND \`date\` >= ?
      ORDER BY \`date\` ASC, id_meeting ASC
      LIMIT ?;
    `;
    const [rows] = await pool.query(query, [communityId, fromDate, limit]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findNextBookingForUser
   * Propósito: próxima reserva del vecino (PENDING/CONFIRMED) que
   * aún no ha terminado: o es de un día posterior, o es de hoy y su
   * hora de fin todavía no ha pasado. Es la «próxima reserva» del
   * panel de vecino.
   * @param {number} communityId - `bookings.id_community`.
   * @param {number} userId - `bookings.id_user`.
   * @param {object} params - Reloj ya calculado por el servicio.
   * @param {string} params.fromDate - Hoy en `YYYY-MM-DD`.
   * @param {string} params.nowTime - Hora actual en `HH:mm:ss`.
   * @returns {Promise<null | object>} Reserva o `null`.
   * -----------------------------------------------------------------
   */
  async findNextBookingForUser(communityId, userId, { fromDate, nowTime }) {
    const query = `
      SELECT id_booking, space_name, booking_date, start_time, end_time, status
      FROM bookings
      WHERE id_community = ?
        AND id_user = ?
        AND status IN (?, ?)
        AND (booking_date > ? OR (booking_date = ? AND end_time > ?))
      ORDER BY booking_date ASC, start_time ASC, id_booking ASC
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [
      communityId,
      userId,
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      fromDate,
      fromDate,
      nowTime,
    ]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: listOpenVotes
   * Propósito: votaciones de la comunidad abiertas y dentro de su
   * ventana `opens_at`–`closes_at` (acotada a la comunidad
   * mediante su reunión), por orden de cierre.
   * @param {number} communityId - `meetings.id_community`.
   * @param {object} params - Reloj y límite ya validados.
   * @param {string} params.now - Marca UTC `YYYY-MM-DD HH:mm:ss`.
   * @param {number} [params.limit] - Filas a devolver.
   * @returns {Promise<object[]>} Votaciones abiertas.
   * -----------------------------------------------------------------
   */
  async listOpenVotes(communityId, { now, limit = DEFAULT_LIMIT }) {
    const query = `
      SELECT v.id_vote, v.id_meeting, v.title, v.opens_at, v.closes_at
      FROM votes v
      JOIN meetings m ON m.id_meeting = v.id_meeting
      WHERE m.id_community = ?
        AND v.status = ?
        AND v.opens_at <= ?
        AND v.closes_at > ?
      ORDER BY v.closes_at ASC, v.id_vote ASC
      LIMIT ?;
    `;
    const [rows] = await pool.query(query, [
      communityId,
      VoteStatus.OPEN,
      now,
      now,
      limit,
    ]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: countOpenVotesForUser
   * Propósito: votaciones abiertas de la comunidad a las que el
   * vecino todavía no ha respondido (KPI «votaciones pendientes»).
   * La exclusion se hace con `LEFT JOIN … IS NULL`, así no hay
   * subconsulta correlacionada ni doble conteo.
   * @param {number} communityId - `meetings.id_community`.
   * @param {number} userId - `vote_responses.id_user`.
   * @param {object} params - Reloj ya calculado por el servicio.
   * @param {string} params.now - Marca UTC `YYYY-MM-DD HH:mm:ss`.
   * @returns {Promise<number>} Cantidad de votaciones pendientes.
   * -----------------------------------------------------------------
   */
  async countOpenVotesForUser(communityId, userId, { now }) {
    const query = `
      SELECT COUNT(*) AS total
      FROM votes v
      JOIN meetings m ON m.id_meeting = v.id_meeting
      LEFT JOIN vote_responses r ON r.id_vote = v.id_vote AND r.id_user = ?
      WHERE m.id_community = ?
        AND v.status = ?
        AND v.opens_at <= ?
        AND v.closes_at > ?
        AND r.id_vot_res IS NULL;
    `;
    const [rows] = await pool.query(query, [
      userId,
      communityId,
      VoteStatus.OPEN,
      now,
      now,
    ]);
    return Number(rows[0]?.total ?? 0);
  }
}

// =============================================================
// Repositorio de reuniones y asistencia — SQL parametrizado.
// =============================================================
//
// Dominio propio: `meetings` y `meeting_attendees`. Las
// votaciones se consultan en `voteRepository.js`.
//
// Todas las consultas usan placeholders `?` con `pool.query()`, salvo
// `changeMeetingStatus` y `upsertAttendance`, que necesitan una sola
// transacción o una cláusula atómica.
//
// Reglas aplicadas aquí:
//   · Nunca se selecciona `*`: las columnas están explícitas.
//   · `sort`/`order` no admiten parámetros en MySQL: se interpolan
//     únicamente después de comprobarlos contra la lista blanca
//     (que el servicio ya validó) y con una columna de desempate
//     (`id_meeting`) para que la paginación sea estable.
//   · Los comodines `%`/`_` de `search` se escapan para que la
//     búsqueda literal no se convierta en un patrón accidental.
//   · `date` es palabra reservada en ciertos contextos: siempre va
//     entre comillas invertidas.
// =============================================================

import { pool } from "../config/database.js";
import { MeetingStatus } from "../enums/State.js";
import { VoteRepository } from "./voteRepository.js";

/** Columnas devueltas por el listado y el detalle de reuniones. */
const MEETING_COLUMNS = `
  id_meeting, id_community, \`date\`, start_time, end_time, title,
  agenda, minutes, state, created_at, updated_at
`;

/** Campos que puede ordenar el listado de reuniones. */
const MEETING_SORTABLE_FIELDS = Object.freeze({
  date: "`date`",
  created_at: "created_at",
  title: "title",
  state: "state",
});

/** Columnas editables de `meetings` (lista blanca anti mass-assignment). */
const MEETING_UPDATABLE_COLUMNS = Object.freeze({
  date: "`date`",
  start_time: "start_time",
  end_time: "end_time",
  title: "title",
  agenda: "agenda",
  minutes: "minutes",
});

/**
 * -----------------------------------------------------------------
 * Función: escapeLike
 * Propósito: escapar los comodines de `LIKE` para que `search` se
 * busque literalmente (MySQL usa `\` como escape por defecto).
 * @param {string} value - Texto del usuario.
 * @returns {string} Patrón apto para `LIKE ?`.
 * -----------------------------------------------------------------
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * -----------------------------------------------------------------
 * Función: buildMeetingWhere
 * Propósito: montar el `WHERE` del listado de reuniones de una
 * comunidad, siempre acotado por comunidad (aislamiento entre
 * comunidades).
 * @param {number} communityId - `communities.id_community`.
 * @param {object} [filters] - Filtros ya validados por el servicio.
 * @param {string} [filters.state] - Estado de la reunión.
 * @param {string} [filters.search] - Texto de búsqueda (≤ 100).
 * @returns {{ clause: string, values: unknown[] }} SQL y valores.
 * -----------------------------------------------------------------
 */
function buildMeetingWhere(communityId, filters = {}) {
  const clauses = ["id_community = ?"];
  const values = [communityId];

  if (filters.state) {
    clauses.push("state = ?");
    values.push(filters.state);
  }

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push("(title LIKE ? OR agenda LIKE ?)");
    values.push(pattern, pattern);
  }

  return { clause: `WHERE ${clauses.join(" AND ")}`, values };
}

/**
 * -----------------------------------------------------------------
 * Función: buildUpdateSet
 * Propósito: convertir un objeto de campos ya validados en la
 * cláusula `SET` con sus placeholders. Ignora cualquier clave que no
 * esté en la lista blanca de columnas.
 * @param {object} fields - Campos normalizados por el servicio.
 * @param {Record<string, string>} allowed - Mapa campo → columna.
 * @returns {{ clause: string, values: unknown[], keys: string[] }}
 *   SQL, valores y claves efectivamente escritas.
 * -----------------------------------------------------------------
 */
function buildUpdateSet(fields, allowed) {
  const keys = Object.keys(fields).filter((key) => allowed[key] !== undefined);
  const clause = keys.map((key) => `${allowed[key]} = ?`).join(", ");
  return { clause, values: keys.map((key) => fields[key]), keys };
}

/** Instancia para el cierre en cascada de votaciones (misma transacción). */
const voteRepository = new VoteRepository();

export class MeetingRepository {
  /**
   * -----------------------------------------------------------------
   * Método: countByCommunity
   * Propósito: total de reuniones de una comunidad para paginar.
   * @param {number} communityId - `communities.id_community`.
   * @param {object} [filters] - Filtros validados.
   * @returns {Promise<number>} Cantidad de reuniones.
   * -----------------------------------------------------------------
   */
  async countByCommunity(communityId, filters = {}) {
    const { clause, values } = buildMeetingWhere(communityId, filters);
    const query = `SELECT COUNT(*) AS total FROM meetings ${clause};`;
    const [rows] = await pool.query(query, values);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * Método: findByCommunityId
   * Propósito: página de reuniones de una comunidad.
   * @param {number} communityId - `communities.id_community`.
   * @param {object} params - Paginación, orden y filtros.
   * @returns {Promise<object[]>} Filas de `meetings`.
   * -----------------------------------------------------------------
   */
  async findByCommunityId(communityId, { limit, offset, sort, order, ...filters }) {
    const { clause, values } = buildMeetingWhere(communityId, filters);
    const sortColumn = MEETING_SORTABLE_FIELDS[sort] ?? MEETING_SORTABLE_FIELDS.date;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${MEETING_COLUMNS}
      FROM meetings
      ${clause}
      ORDER BY ${sortColumn} ${direction}, id_meeting ${direction}
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await pool.query(query, [...values, limit, offset]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findById
   * Propósito: detalle de una reunión.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findById(meetingId) {
    const query = `
      SELECT ${MEETING_COLUMNS}
      FROM meetings
      WHERE id_meeting = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [meetingId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: createMeeting
   * Propósito: insertar una reunión nueva (nace en `SCHEDULED`).
   * @param {object} fields - Datos ya normalizados.
   * @returns {Promise<number>} `meetings.id_meeting` generado.
   * -----------------------------------------------------------------
   */
  async createMeeting({ idCommunity, date, startTime, endTime, title, agenda }) {
    const query = `
      INSERT INTO meetings (id_community, \`date\`, start_time, end_time, title, agenda)
      VALUES (?, ?, ?, ?, ?, ?);
    `;
    const [result] = await pool.query(query, [
      idCommunity,
      date,
      startTime,
      endTime,
      title,
      agenda ?? null,
    ]);
    return Number(result.insertId);
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateMeeting
   * Propósito: actualizar los campos permitidos de una reunión.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {object} fields - Campos normalizados (lista blanca).
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateMeeting(meetingId, fields) {
    const { clause, keys } = buildUpdateSet(fields, MEETING_UPDATABLE_COLUMNS);
    if (keys.length === 0) return 0;

    const query = `UPDATE meetings SET ${clause} WHERE id_meeting = ? LIMIT 1;`;
    const values = keys.map((key) => fields[key]);
    const [result] = await pool.query(query, [...values, meetingId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeMeetingStatus
   * Propósito: cambiar el estado de una reunión y, si termina, cerrar
   * en la misma transacción sus votaciones abiertas (delegando la SQL
   * de `votes` en `VoteRepository`). Así no puede quedar una reunión
   * cerrada con una votación sigue abierta.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {string} state - Nuevo estado (ya validado).
   * @returns {Promise<number>} Filas afectadas en `meetings`.
   * -----------------------------------------------------------------
   */
  async changeMeetingStatus(meetingId, state) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        "UPDATE meetings SET state = ? WHERE id_meeting = ? LIMIT 1;",
        [state, meetingId],
      );

      if (state === MeetingStatus.CLOSED || state === MeetingStatus.CANCELLED) {
        await voteRepository.closeOpenByMeetingId(meetingId, connection);
      }

      await connection.commit();
      return result.affectedRows;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: listAttendees
   * Propósito: listado de asistencia para el presidente. Devuelve a
   * todos los miembros de la comunidad (los activos y los inactivos
   * que ya tengan fila), con `PENDING` cuando nadie ha confirmado.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {number} communityId - `communities.id_community`.
   * @returns {Promise<object[]>} Filas con usuario y asistencia.
   * -----------------------------------------------------------------
   */
  async listAttendees(meetingId, communityId) {
    const query = `
      SELECT
        u.id_user,
        u.name,
        u.surname,
        u.housing,
        COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
        a.confirmed_at
      FROM users u
      LEFT JOIN meeting_attendees a
        ON a.id_meeting = ? AND a.id_user = u.id_user
      WHERE u.id_community = ?
        AND (u.is_active = 1 OR a.id_meet_atte IS NOT NULL)
      ORDER BY u.surname ASC, u.name ASC, u.id_user ASC;
    `;
    const [rows] = await pool.query(query, [meetingId, communityId]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findAttendance
   * Propósito: asistencia de un usuario concreto en una reunión.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findAttendance(meetingId, userId) {
    const query = `
      SELECT
        a.id_meeting,
        a.id_user,
        a.attendance_status,
        a.confirmed_at,
        u.name,
        u.surname,
        u.housing
      FROM meeting_attendees a
      JOIN users u ON u.id_user = a.id_user
      WHERE a.id_meeting = ? AND a.id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [meetingId, userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: upsertAttendance
   * Propósito: confirmar la asistencia del propio usuario. La clave
   * única `(id_meeting, id_user)` convierte la confirmación en un
   * upsert: la segunda vez se actualiza el estado y la fecha.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {number} userId - `users.id_user`.
   * @param {string} status - `ATTENDED` | `ABSENT` | `EXCUSED`.
   * @param {string} confirmedAt - Marca UTC `YYYY-MM-DD HH:mm:ss`.
   * @returns {Promise<number>} Filas insertadas o afectadas.
   * -----------------------------------------------------------------
   */
  async upsertAttendance(meetingId, userId, status, confirmedAt) {
    const query = `
      INSERT INTO meeting_attendees (id_meeting, id_user, attendance_status, confirmed_at)
      VALUES (?, ?, ?, ?)
      AS new_row
      ON DUPLICATE KEY UPDATE
        attendance_status = new_row.attendance_status,
        confirmed_at = new_row.confirmed_at;
    `;
    const [result] = await pool.query(query, [meetingId, userId, status, confirmedAt]);
    return result.affectedRows;
  }
}

// =============================================================
// Repositorio de votaciones — SQL parametrizado.
// =============================================================
//
// Dominio propio: `votes` y `vote_responses`. Las reuniones
// y la asistencia se consultan en `meetingRepository.js`.
//
// Todas las consultas usan placeholders `?` con `pool.query()`. Las
// reglas generales de este repositorio son:
//
//   · Nunca se selecciona `*`: las columnas están explícitas.
//   · `sort`/`order` no admiten parámetros en MySQL: se interpolan
//     únicamente después de comprobarlos contra la lista blanca
//     (que el servicio ya validó) y con una columna de desempate
//     (`id_vote`) para que la paginación sea estable.
// =============================================================

import { pool } from "../config/database.js";

/** Columnas devueltas por el listado y el detalle de votaciones. */
const VOTE_COLUMNS = `
  id_vote, id_meeting, created_by, title, description, status,
  opens_at, closes_at, created_at, updated_at
`;

/** Campos que puede ordenar el listado de votaciones. */
const VOTE_SORTABLE_FIELDS = Object.freeze({
  created_at: "created_at",
  title: "title",
  status: "status",
});

/** Columnas editables de `votes` (lista blanca anti mass-assignment). */
const VOTE_UPDATABLE_COLUMNS = Object.freeze({
  title: "title",
  description: "description",
  opens_at: "opens_at",
  closes_at: "closes_at",
});

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

export class VoteRepository {
  /**
   * -----------------------------------------------------------------
   * Método: countByMeetingId
   * Propósito: total de votaciones de una reunión para paginar.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @returns {Promise<number>} Cantidad de votaciones.
   * -----------------------------------------------------------------
   */
  async countByMeetingId(meetingId) {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total FROM votes WHERE id_meeting = ?;",
      [meetingId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * Método: listByMeetingId
   * Propósito: página de votaciones de una reunión.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {object} params - Paginación y orden.
   * @returns {Promise<object[]>} Filas de `votes`.
   * -----------------------------------------------------------------
   */
  async listByMeetingId(meetingId, { limit, offset, sort, order }) {
    const sortColumn = VOTE_SORTABLE_FIELDS[sort] ?? VOTE_SORTABLE_FIELDS.created_at;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${VOTE_COLUMNS}
      FROM votes
      WHERE id_meeting = ?
      ORDER BY ${sortColumn} ${direction}, id_vote ${direction}
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await pool.query(query, [meetingId, limit, offset]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findByIdWithMeeting
   * Propósito: detalle de una votación junto con los datos que el
   * servicio necesita para autorizar (comunidad y estado de la
   * reunión) en una sola consulta.
   * @param {number} voteId - `votes.id_vote`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findByIdWithMeeting(voteId) {
    const query = `
      SELECT
        v.id_vote, v.id_meeting, v.created_by, v.title, v.description,
        v.status, v.opens_at, v.closes_at, v.created_at, v.updated_at,
        m.id_community AS id_community,
        m.state AS meeting_state
      FROM votes v
      JOIN meetings m ON m.id_meeting = v.id_meeting
      WHERE v.id_vote = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [voteId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: createVote
   * Propósito: insertar una votación (nace en `DRAFT`).
   * @param {object} fields - Datos ya normalizados.
   * @returns {Promise<number>} `votes.id_vote` generado.
   * -----------------------------------------------------------------
   */
  async createVote({ idMeeting, createdBy, title, description, opensAt, closesAt }) {
    const query = `
      INSERT INTO votes (id_meeting, created_by, title, description, opens_at, closes_at)
      VALUES (?, ?, ?, ?, ?, ?);
    `;
    const [result] = await pool.query(query, [
      idMeeting,
      createdBy,
      title,
      description ?? null,
      opensAt ?? null,
      closesAt ?? null,
    ]);
    return Number(result.insertId);
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateVote
   * Propósito: actualizar los campos permitidos de una votación.
   * @param {number} voteId - `votes.id_vote`.
   * @param {object} fields - Campos normalizados (lista blanca).
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateVote(voteId, fields) {
    const { clause, keys } = buildUpdateSet(fields, VOTE_UPDATABLE_COLUMNS);
    if (keys.length === 0) return 0;

    const query = `UPDATE votes SET ${clause} WHERE id_vote = ? LIMIT 1;`;
    const values = keys.map((key) => fields[key]);
    const [result] = await pool.query(query, [...values, voteId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeVoteStatus
   * Propósito: cambiar el estado (`DRAFT` → `OPEN` → `CLOSED`).
   * @param {number} voteId - `votes.id_vote`.
   * @param {string} status - Nuevo estado (ya validado).
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async changeVoteStatus(voteId, status) {
    const [result] = await pool.query(
      "UPDATE votes SET status = ? WHERE id_vote = ? LIMIT 1;",
      [status, voteId],
    );
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: closeOpenByMeetingId
   * Propósito: cierre en cascada de las votaciones abiertas de una
   * reunión. Recibe la conexión de la transacción que está abierta
   * en `MeetingRepository.changeMeetingStatus` para que el cambio de
   * estado de la reunión y el cierre de sus votaciones se validen o
   * se reviertan juntos (nunca puede quedar una reunión cerrada con
   * una votación abierta). El SQL vive aquí porque es una operación
   * sobre `votes`.
   * @param {number} meetingId - `meetings.id_meeting`.
   * @param {object} connection - Conexión con la transacción abierta.
   * @returns {Promise<number>} Filas afectadas en `votes`.
   * -----------------------------------------------------------------
   */
  async closeOpenByMeetingId(meetingId, connection) {
    // Las votaciones en DRAFT se conservan como borradores: ya no
    // podrán abrirse porque el servicio exige una reunión activa
    // para pasar a OPEN.
    const [result] = await connection.query(
      "UPDATE votes SET status = 'CLOSED' WHERE id_meeting = ? AND status = 'OPEN';",
      [meetingId],
    );
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findResponse
   * Propósito: voto ya emitido por un usuario (para impedir el doble
   * voto incluso antes de intentar insertar).
   * @param {number} voteId - `votes.id_vote`.
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findResponse(voteId, userId) {
    const query = `
      SELECT id_vote, id_user, vote_option, created_at
      FROM vote_responses
      WHERE id_vote = ? AND id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [voteId, userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: createResponse
   * Propósito: registrar el voto. La clave única `(id_vote, id_user)`
   * garantiza el voto único incluso ante peticiones simultáneas: la
   * segunda recibe `ER_DUP_ENTRY`, que el errorHandler traduce a 409.
   * @param {number} voteId - `votes.id_vote`.
   * @param {number} userId - `users.id_user`.
   * @param {string} option - `AGREE` | `DISAGREE` | `NULL`.
   * @returns {Promise<number>} Filas insertadas.
   * -----------------------------------------------------------------
   */
  async createResponse(voteId, userId, option) {
    const query = `
      INSERT INTO vote_responses (id_vote, id_user, vote_option)
      VALUES (?, ?, ?);
    `;
    const [result] = await pool.query(query, [voteId, userId, option]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: countResponsesByVote
   * Propósito: recuento de votos por opción para los resultados.
   * @param {number} voteId - `votes.id_vote`.
   * @returns {Promise<{ vote_option: string, total: number }[]>}
   *   Totales agrupados por opción.
   * -----------------------------------------------------------------
   */
  async countResponsesByVote(voteId) {
    const query = `
      SELECT vote_option, COUNT(*) AS total
      FROM vote_responses
      WHERE id_vote = ?
      GROUP BY vote_option;
    `;
    const [rows] = await pool.query(query, [voteId]);
    return rows.map((row) => ({ ...row, total: Number(row.total) }));
  }
}

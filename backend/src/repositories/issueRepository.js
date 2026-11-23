// =============================================================
// Repositorio de incidencias
// =============================================================
//
// Consultas de la tabla `issues`, cuyas columnas quedaron
// alineadas en la migración `003_issues_state_to_status.sql`
// (`id_issue`, `status`, `id_user`).
//
// Reglas aplicadas aquí:
//   · Todas las consultas usan placeholders `?` con `pool.query()`.
//   · Las columnas están explícitas: nunca `SELECT *`.
//   · `sort`/`order` no admiten parámetros en MySQL: se interpolan
//     únicamente después de comprobarlos contra la lista blanca
//     `ISSUE_SORT_FIELDS` (que el servicio ya validó) y con la PK
//     `id_issue` como desempate, para que la paginación sea estable.
//   · Los comodines `%`/`_` de `search` se escapan para que la
//     búsqueda literal no se convierta en un patrón accidental.
//   · `resolved_at` solo se rellena al pasar a `RESOLVED`
//     (`COALESCE(?, resolved_at)` conserva el valor anterior).
// =============================================================

import { pool } from "../config/database.js";

/** Columnas devueltas por el listado y el detalle. */
const ISSUE_COLUMNS = `
  id_issue, id_community, id_user, title, description, category,
  priority, status, resolved_at, created_at, updated_at
`;

/** Campos que puede ordenar el listado. */
const SORTABLE_FIELDS = Object.freeze({
  created_at: "created_at",
  updated_at: "updated_at",
  title: "title",
  priority: "priority",
  status: "status",
});

/** Columnas que `update` admite modificar (lista blanca propia). */
const UPDATABLE_COLUMNS = Object.freeze(
  new Set(["title", "description", "category", "priority"]),
);

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
 * Función: buildWhere
 * Propósito: montar la cláusula `WHERE` del listado con valores
 * parametrizados. La comunidad es obligatoria: el listado nunca
 * cruza comunidades.
 * @param {number} communityId - `issues.id_community`.
 * @param {object} [filters] - Filtros ya validados por el servicio.
 * @param {string} [filters.search] - Texto (≤ 100) en título o descripción.
 * @param {string} [filters.status] - `IssueStatus`.
 * @param {string} [filters.priority] - `IssuePriority`.
 * @param {string} [filters.category] - `IssueCategory`.
 * @returns {{ clause: string, values: unknown[] }} SQL y valores.
 * -----------------------------------------------------------------
 */
function buildWhere(communityId, filters = {}) {
  const clauses = ["id_community = ?"];
  const values = [communityId];

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push("(title LIKE ? OR description LIKE ?)");
    values.push(pattern, pattern);
  }

  if (filters.status) {
    clauses.push("status = ?");
    values.push(filters.status);
  }

  if (filters.priority) {
    clauses.push("priority = ?");
    values.push(filters.priority);
  }

  if (filters.category) {
    clauses.push("category = ?");
    values.push(filters.category);
  }

  return {
    clause: `WHERE ${clauses.join(" AND ")}`,
    values,
  };
}

export class IssueRepository {
  /**
   * -----------------------------------------------------------------
   * Método: countByCommunity
   * Propósito: total de incidencias de una comunidad para la
   * paginación (mismos filtros que el listado).
   * @param {number} communityId - `issues.id_community`.
   * @param {object} [filters] - Filtros validados.
   * @returns {Promise<number>} Cantidad de incidencias.
   * -----------------------------------------------------------------
   */
  async countByCommunity(communityId, filters = {}) {
    const { clause, values } = buildWhere(communityId, filters);
    const query = `SELECT COUNT(*) AS total FROM issues ${clause};`;
    const [rows] = await pool.query(query, values);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * Método: findAllByCommunity
   * Propósito: página de incidencias de una comunidad con filtros,
   * ordenación y búsqueda.
   * @param {number} communityId - `issues.id_community`.
   * @param {object} params - Paginación, orden y filtros.
   * @param {number} params.limit - Tamaño de página (1-100).
   * @param {number} params.offset - Desplazamiento.
   * @param {string} params.sort - Campo de la lista blanca.
   * @param {"asc" | "desc"} params.order - Dirección.
   * @param {string} [params.search] - Texto de búsqueda.
   * @param {string} [params.status] - Estado.
   * @param {string} [params.priority] - Prioridad.
   * @param {string} [params.category] - Categoría.
   * @returns {Promise<object[]>} Filas de `issues`.
   * -----------------------------------------------------------------
   */
  async findAllByCommunity(communityId, { limit, offset, sort, order, ...filters }) {
    const { clause, values } = buildWhere(communityId, filters);

    // `sort`/`order` llegan ya validados de `ISSUE_SORT_FIELDS` y del
    // validador `asc`/`desc` de `pagination.js`; se vuelve a mirar la
    // lista blanca aquí por si se invoca el repositorio directamente.
    const sortColumn = SORTABLE_FIELDS[sort] ?? SORTABLE_FIELDS.created_at;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${ISSUE_COLUMNS}
      FROM issues
      ${clause}
      ORDER BY ${sortColumn} ${direction}, id_issue ${direction}
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await pool.query(query, [...values, limit, offset]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findById
   * Propósito: detalle de una incidencia.
   * @param {number} issueId - `issues.id_issue`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findById(issueId) {
    const query = `
      SELECT ${ISSUE_COLUMNS}
      FROM issues
      WHERE id_issue = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [issueId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: create
   * Propósito: alta de incidencia. El estado inicial es siempre
   * `PENDING` (lo decide el servidor, no el cliente).
   * @param {object} data - Datos ya validados por el servicio.
   * @param {number} data.communityId - Comunidad.
   * @param {number} data.reporterId - Autor (`req.user.id`).
   * @param {string} data.title - Título (≤ 200).
   * @param {string} data.description - Descripción.
   * @param {null | string} data.category - Categoría o `null`.
   * @param {string} data.priority - Prioridad.
   * @returns {Promise<number>} `issues.id_issue` generado.
   * -----------------------------------------------------------------
   */
  async create({ communityId, reporterId, title, description, category, priority }) {
    const query = `
      INSERT INTO issues (id_community, id_user, title, description, category, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING');
    `;
    const [result] = await pool.query(query, [
      communityId,
      reporterId,
      title,
      description,
      category ?? null,
      priority,
    ]);
    return result.insertId;
  }

  /**
   * -----------------------------------------------------------------
   * Método: update
   * Propósito: editar campos de una incidencia (lista blanca; el
   * `status` no se toca aquí).
   * @param {number} issueId - `issues.id_issue`.
   * @param {object} fields - Campos ya validados.
   * @returns {Promise<number>} Filas afectadas (0 si no existe).
   * @throws {TypeError} Si un campo está fuera de la lista blanca.
   * -----------------------------------------------------------------
   */
  async update(issueId, fields) {
    const entries = Object.entries(fields);

    if (entries.length === 0) {
      throw new TypeError("IssueRepository.update: sin campos que actualizar.");
    }

    for (const [key] of entries) {
      if (!UPDATABLE_COLUMNS.has(key)) {
        throw new TypeError("IssueRepository.update: campo fuera de la lista blanca.");
      }
    }

    // Los nombres de columna salen de un conjunto cerrado, nunca del
    // cliente; los valores se pasan como parámetros `?`.
    const sets = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([, value]) => value);

    const query = `
      UPDATE issues
      SET ${sets.join(", ")}
      WHERE id_issue = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [...values, issueId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateStatus
   * Propósito: cambiar el estado y, solo al resolver, sellar
   * `resolved_at`. En el resto de transiciones el valor anterior se
   * conserva con `COALESCE`.
   * @param {number} issueId - `issues.id_issue`.
   * @param {string} status - `IssueStatus` destino.
   * @param {null | Date} resolvedAt - Fecha de resolución o `null`.
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateStatus(issueId, status, resolvedAt) {
    const query = `
      UPDATE issues
      SET status = ?, resolved_at = COALESCE(?, resolved_at)
      WHERE id_issue = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [status, resolvedAt ?? null, issueId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: delete
   * Propósito: eliminación física de una incidencia (endpoint de
   * administración; solo el presidente de la comunidad).
   * @param {number} issueId - `issues.id_issue`.
   * @returns {Promise<number>} Filas afectadas (0 si no existe).
   * -----------------------------------------------------------------
   */
  async delete(issueId) {
    const query = `
      DELETE FROM issues
      WHERE id_issue = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [issueId]);
    return result.affectedRows;
  }
}

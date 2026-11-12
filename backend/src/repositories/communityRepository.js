// =============================================================
// Repositorio de comunidades — SQL parametrizado.
// =============================================================
//
// Gestión de comunidades y de sus miembros. La pertenencia a una
// comunidad vive en `users.id_community`.
// =============================================================

import { pool } from "../config/database.js";

/** Columnas del listado sin `invite_code`. */
const COMMUNITY_LIST_COLUMNS = `
  id_community, name, address, city, postal_code, is_active, created_at
`;

/** Columnas del detalle con `invite_code`. */
const COMMUNITY_DETAIL_COLUMNS = `
  id_community, name, address, city, postal_code, invite_code,
  is_active, created_at, updated_at
`;

/** Columnas de miembro devueltas. */
const MEMBER_COLUMNS = `
  id_user, name, surname, email, phone, role, id_community,
  housing, is_active, created_at
`;

/** Campos que puede ordenar el listado de comunidades. */
const COMMUNITY_SORTABLE = Object.freeze({
  name: "name",
  city: "city",
  created_at: "created_at",
});

/** Campos que puede ordenar el listado de miembros. */
const MEMBER_SORTABLE = Object.freeze({
  name: "name",
  surname: "surname",
  role: "role",
  created_at: "created_at",
});

/**
 * -----------------------------------------------------------------
 * La función es: escapeLike
 * Lo usamos para escapar los comodines de `LIKE` para que `search` se
 * busque literalmente.
 * @param {string} value - Texto del usuario.
 * @returns {string} Patrón apto para `LIKE ?`.
 * -----------------------------------------------------------------
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export class CommunityRepository {
  /**
   * -----------------------------------------------------------------
   * El método es: countAll
   * Su propósito es contar el total de comunidades del listado para la paginación.
   * @param {object} [filters] - Filtros validados por el servicio.
   * @param {string} [filters.search] - Texto de búsqueda (≤ 100).
   * @param {boolean} [filters.isActive] - Estado de la comunidad.
   * @param {number} [filters.idCommunity] - Restringe a una
   * comunidad (listado del vecino: solo la suya).
   * @returns {Promise<number>} Cantidad de comunidades.
   * -----------------------------------------------------------------
   */
  async countAll(filters = {}) {
    const { clause, values } = buildCommunityWhere(filters);
    const query = `SELECT COUNT(*) AS total FROM communities ${clause};`;
    const [rows] = await pool.query(query, values);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * El método es: findAll
   * El propósito es encontrar la página de comunidades con filtros y ordenación.
   * @param {object} params - Paginación, orden y filtros.
   * @param {number} params.limit - Tamaño de página (1-100).
   * @param {number} params.offset - Desplazamiento.
   * @param {string} params.sort - Campo de la lista blanca.
   * @param {"asc" | "desc"} params.order - Dirección.
   * @param {string} [params.search] - Texto de búsqueda.
   * @param {boolean} [params.isActive] - Estado.
   * @param {number} [params.idCommunity] - Comunidad concreta.
   * @returns {Promise<object[]>} - Filas sin `invite_code`.
   * -----------------------------------------------------------------
   */
  async findAll({ limit, offset, sort, order, ...filters }) {
    const { clause, values } = buildCommunityWhere(filters);

    const sortColumn = COMMUNITY_SORTABLE[sort] ?? COMMUNITY_SORTABLE.created_at;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${COMMUNITY_LIST_COLUMNS}
      FROM communities
      ${clause}
      ORDER BY ${sortColumn} ${direction}, id_community ${direction}
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await pool.query(query, [...values, limit, offset]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * El método: findById
   * Su propósito es encontrar el detalle de una comunidad (con `invite_code`).
   * @param {number} communityId - `communities.id_community`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findById(communityId) {
    const query = `
      SELECT ${COMMUNITY_DETAIL_COLUMNS}
      FROM communities
      WHERE id_community = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [communityId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: findByInviteCode
   * Su propósito es comprobar unicidad del código en el alta y en la
   * rotación (`excludeId` descarta a la propia comunidad).
   * @param {string} inviteCode - Código normalizado en mayúsculas.
   * @param {number} [excludeId] - `id_community` a excluir.
   * @returns {Promise<null | { id_community: number, invite_code: string }>}
   *   Fila encontrada o `null`.
   * -----------------------------------------------------------------
   */
  async findByInviteCode(inviteCode, excludeId = null) {
    const query = `
      SELECT id_community, invite_code
      FROM communities
      WHERE invite_code = ?
        AND id_community <> ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [inviteCode, excludeId ?? 0]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: create
   * Su propósito es dar de alta de comunidad desde la API de administración.
   * @param {object} data - Datos ya validados.
   * @param {string} data.name - Nombre.
   * @param {string} data.address - Dirección.
   * @param {string} data.city - Ciudad.
   * @param {string} data.postalCode - Código postal.
   * @param {string} data.inviteCode - Código único de invitación.
   * @returns {Promise<number>} `communities.id_community` insertado.
   * -----------------------------------------------------------------
   */
  async create({ name, address, city, postalCode, inviteCode }) {
    const query = `
      INSERT INTO communities (name, address, city, postal_code, invite_code)
      VALUES (?, ?, ?, ?, ?);
    `;
    const [result] = await pool.query(query, [
      name,
      address,
      city,
      postalCode,
      inviteCode,
    ]);
    return result.insertId;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: update
   * Su propósito es actualizar los campos indicados.
   * @param {number} communityId - `communities.id_community`.
   * @param {object} fields - Campos ya validados por el servicio.
   * @returns {Promise<number>} - Filas afectadas (0 si no cambia).
   * @throws {TypeError} - Si aparece un campo fuera de la lista blanca.
   * -----------------------------------------------------------------
   */
  async update(communityId, fields) {
    const allowed = new Set(["name", "address", "city", "postal_code"]);
    const entries = Object.entries(fields).filter(([key]) => allowed.has(key));

    if (entries.length === 0 || Object.keys(fields).length !== entries.length) {
      throw new TypeError("CommunityRepository.update: campo fuera de la lista blanca.");
    }

    const sets = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([, value]) => value);

    const query = `
      UPDATE communities
      SET ${sets.join(", ")}
      WHERE id_community = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [...values, communityId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: updateStatus
   * Su propósito es archivar o activar una comunidad (`is_active`).
   * @param {number} communityId - `communities.id_community`.
   * @param {boolean} isActive - `true` para activar.
   * @returns {Promise<number>} - Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateStatus(communityId, isActive) {
    const query = `
      UPDATE communities
      SET is_active = ?
      WHERE id_community = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [isActive ? 1 : 0, communityId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: updateInviteCode
   * Su propósito es rotar el `invite_code` de una comunidad.
   * @param {number} communityId - `communities.id_community`.
   * @param {string} inviteCode - Código nuevo en mayúsculas.
   * @returns {Promise<number>} - Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateInviteCode(communityId, inviteCode) {
    const query = `
      UPDATE communities
      SET invite_code = ?
      WHERE id_community = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [inviteCode, communityId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * El método: findUserCommunityId
   * Su propósito es leer la comunidad del usuario autenticado. El token
   * solo lleva `id, role, email`, así que el servicio necesita
   * esta consulta para filtrar el listado del vecino y comprobar la
   * pertenencia a la comunidad.
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | { id_user: number, id_community: null | number }>}
   *   Fila o `null` si el usuario no existe.
   * -----------------------------------------------------------------
   */
  async findUserCommunityId(userId) {
    const query = `
      SELECT id_user, id_community
      FROM users
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: countMembers
   * Es el total de miembros de una comunidad.
   * @param {number} communityId - Comunidad.
   * @param {object} [filters] - Filtros validados.
   * @param {string} [filters.search] - Texto de búsqueda (≤ 100).
   * @returns {Promise<number>} Cantidad de miembros.
   * -----------------------------------------------------------------
   */
  async countMembers(communityId, filters = {}) {
    const { clause, values } = buildMemberWhere(communityId, filters);
    const query = `
      SELECT COUNT(*) AS total
      FROM users
      ${clause};
    `;
    const [rows] = await pool.query(query, values);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * El método es: findMembers
   * Es la página de miembros de una comunidad.
   * @param {object} params - Paginación, orden y filtros.
   * @param {number} params.communityId - Comunidad.
   * @param {number} params.limit - Tamaño de página (1-100).
   * @param {number} params.offset - Desplazamiento.
   * @param {string} params.sort - Campo de la lista blanca.
   * @param {"asc" | "desc"} params.order - Dirección.
   * @param {string} [params.search] - Texto de búsqueda.
   * @returns {Promise<object[]>} - Filas sin `password`.
   * -----------------------------------------------------------------
   */
  async findMembers({ communityId, limit, offset, sort, order, ...filters }) {
    const { clause, values } = buildMemberWhere(communityId, filters);

    const sortColumn = MEMBER_SORTABLE[sort] ?? MEMBER_SORTABLE.created_at;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${MEMBER_COLUMNS}
      FROM users
      ${clause}
      ORDER BY ${sortColumn} ${direction}, id_user ${direction}
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await pool.query(query, [...values, limit, offset]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: findUserById
   * Tiene el propósito de leer un usuario para decidir si puede vincularse.
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | object>} - Fila sin `password` o `null`.
   * -----------------------------------------------------------------
   */
  async findUserById(userId) {
    const query = `
      SELECT id_user, name, surname, email, role, id_community,
             housing, is_active
      FROM users
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: findMemberById
   * Tiene el propósito de leer un miembro de una comunidad concreta.
   * @param {number} communityId - Comunidad.
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | object>} - Fila sin `password` o `null`.
   * -----------------------------------------------------------------
   */
  async findMemberById(communityId, userId) {
    const query = `
      SELECT ${MEMBER_COLUMNS}
      FROM users
      WHERE id_community = ?
        AND id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [communityId, userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: linkMember
   * Tiene el propósito de vincular un usuario a la comunidad.
   * @param {number} communityId - Comunidad destino.
   * @param {number} userId - `users.id_user`.
   * @param {null | string} housing - Vivienda opcional.
   * @returns {Promise<number>} - Filas afectadas.
   * -----------------------------------------------------------------
   */
  async linkMember(communityId, userId, housing = null) {
    const query = `
      UPDATE users
      SET id_community = ?, housing = ?
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [communityId, housing, userId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: unlinkMember
   * Tiene el propósito de desvincular al usuario de esa comunidad concreta
   * (`users.id_community = NULL`). No borra la fila: el historial
   * se conserva.
   * @param {number} communityId - Comunidad de origen.
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<number>} - Filas afectadas (0 si no era miembro).
   * -----------------------------------------------------------------
   */
  async unlinkMember(communityId, userId) {
    const query = `
      UPDATE users
      SET id_community = NULL
      WHERE id_community = ?
        AND id_user = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [communityId, userId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: updateMemberHousing
   * Tiene el propósito de editar la vivienda de un miembro de la comunidad.
   * @param {number} communityId - Comunidad.
   * @param {number} userId - `users.id_user`.
   * @param {null | string} housing - Vivienda (`null` la vacía).
   * @returns {Promise<number>} - Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateMemberHousing(communityId, userId, housing) {
    const query = `
      UPDATE users
      SET housing = ?
      WHERE id_community = ?
        AND id_user = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [housing, communityId, userId]);
    return result.affectedRows;
  }
}

/**
 * -----------------------------------------------------------------
 * La función es: buildCommunityWhere
 * Tiene el propósito de montar el `WHERE` del listado de comunidades con
 * valores parametrizados.
 * @param {object} filters - Filtros ya validados por el servicio.
 * @returns {{ clause: string, values: unknown[] }} SQL y valores.
 * -----------------------------------------------------------------
 */
function buildCommunityWhere(filters = {}) {
  const clauses = [];
  const values = [];

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push("(name LIKE ? OR address LIKE ? OR city LIKE ?)");
    values.push(pattern, pattern, pattern);
  }

  if (typeof filters.isActive === "boolean") {
    clauses.push("is_active = ?");
    values.push(filters.isActive ? 1 : 0);
  }

  if (filters.idCommunity) {
    clauses.push("id_community = ?");
    values.push(filters.idCommunity);
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

/**
 * -----------------------------------------------------------------
 * La función es: buildMemberWhere
 * Tiene el propósito de montar el `WHERE` del listado de miembros. La
 * pertenencia es obligatoria: La comunidad siempre va en el SQL.
 * @param {number} communityId - Comunidad.
 * @param {object} filters - Filtros validados.
 * @returns {{ clause: string, values: unknown[] }} SQL y valores.
 * -----------------------------------------------------------------
 */
function buildMemberWhere(communityId, filters = {}) {
  const clauses = ["id_community = ?"];
  const values = [communityId];

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push("(name LIKE ? OR surname LIKE ? OR email LIKE ?)");
    values.push(pattern, pattern, pattern);
  }

  return { clause: `WHERE ${clauses.join(" AND ")}`, values };
}

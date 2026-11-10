// =============================================================
// Repositorio de usuarios — SQL parametrizado.
// =============================================================
//
// Gestión de usuarios de la API de administración:
// listado con filtros y paginación, detalle, alta, edición y
// activación/desactivación.
//
// Reglas aplicadas aquí:
//   · Todas las consultas usan placeholders `?` con `pool.query()`.
//   · Nunca se selecciona `password`: las columnas están
//     explícitas.
//   · `sort`/`order` no admiten parámetros en MySQL: se interpolan
//     únicamente después de comprobarlos contra la lista blanca
//     `USER_SORT_FIELDS` (que el servicio ya validó) y con una
//     columna de desempate (`id_user`) para que la paginación sea
//     estable.
//   · Los comodines `%`/`_` de `search` se escapan para que la
//     búsqueda literal no se convierta en un patrón accidental.
// =============================================================

import { pool } from "../config/database.js";

/** Columnas devueltas por el listado y el detalle. */
const USER_COLUMNS = `
  id_user, name, surname, email, phone, role, id_community,
  housing, is_active, created_at
`;

/** Campos que puede ordenar el listado. */
const SORTABLE_FIELDS = Object.freeze({
  name: "name",
  surname: "surname",
  email: "email",
  role: "role",
  created_at: "created_at",
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
 * Función: buildWhere
 * Propósito: montar la cláusula `WHERE` con valores parametrizados.
 * @param {object} filters - Filtros ya validados por el servicio.
 * @param {string} [filters.search] - Texto de búsqueda (≤ 100).
 * @param {string} [filters.role] - `NEIGHBOR` | `PRESIDENT`.
 * @param {boolean} [filters.isActive] - Estado de la cuenta.
 * @param {number} [filters.idCommunity] - Comunidad.
 * @returns {{ clause: string, values: unknown[] }} SQL y valores.
 * -----------------------------------------------------------------
 */
function buildWhere(filters = {}) {
  const clauses = [];
  const values = [];

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push("(name LIKE ? OR surname LIKE ? OR email LIKE ?)");
    values.push(pattern, pattern, pattern);
  }

  if (filters.role) {
    clauses.push("role = ?");
    values.push(filters.role);
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

export class UserRepository {
  /**
   * -----------------------------------------------------------------
   * Método: countAll
   * Propósito: total de filas del listado para la paginación.
   * @param {object} [filters] - Filtros validados.
   * @returns {Promise<number>} Cantidad de usuarios.
   * -----------------------------------------------------------------
   */
  async countAll(filters = {}) {
    const { clause, values } = buildWhere(filters);
    const query = `SELECT COUNT(*) AS total FROM users ${clause};`;
    const [rows] = await pool.query(query, values);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * Método: findAll
   * Propósito: página de usuarios con filtros y ordenación.
   * @param {object} params - Paginación, orden y filtros.
   * @param {number} params.limit - Tamaño de página (1-100).
   * @param {number} params.offset - Desplazamiento.
   * @param {string} params.sort - Campo de la lista blanca.
   * @param {"asc" | "desc"} params.order - Dirección.
   * @param {string} [params.search] - Texto de búsqueda.
   * @param {string} [params.role] - Rol.
   * @param {boolean} [params.isActive] - Estado.
   * @param {number} [params.idCommunity] - Comunidad.
   * @returns {Promise<object[]>} Filas sin `password`.
   * -----------------------------------------------------------------
   */
  async findAll({ limit, offset, sort, order, ...filters }) {
    const { clause, values } = buildWhere(filters);

    // `sort`/`order` llegan ya validados de `USER_SORT_FIELDS` y del
    // validador `asc`/`desc` de `pagination.js`; se vuelve a mirar la
    // lista blanca aquí por si se invoca el repositorio directamente.
    const sortColumn = SORTABLE_FIELDS[sort] ?? SORTABLE_FIELDS.created_at;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${USER_COLUMNS}
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
   * Método: findById
   * Propósito: detalle de un usuario (sin `password`).
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findById(userId) {
    const query = `
      SELECT ${USER_COLUMNS}
      FROM users
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findByEmail
   * Propósito: comprobar unicidad del correo en el alta y en la
   * edición (`excludeId` descarta al propio usuario).
   * @param {string} email - Correo normalizado.
   * @param {number} [excludeId] - `id_user` a excluir.
   * @returns {Promise<null | { id_user: number, email: string }>}
   *   Fila encontrada o `null`.
   * -----------------------------------------------------------------
   */
  async findByEmail(email, excludeId = null) {
    const query = `
      SELECT id_user, email
      FROM users
      WHERE email = ?
        AND id_user <> ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [email, excludeId ?? 0]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: create
   * Propósito: alta de usuario desde la API de administración.
   * @param {object} data - Datos ya validados.
   * @returns {Promise<number>} `users.id_user` insertado.
   * -----------------------------------------------------------------
   */
  async create({ name, surname, email, password, phone, role, idCommunity, housing }) {
    const query = `
      INSERT INTO users (name, surname, email, password, phone, role, id_community, housing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const [result] = await pool.query(query, [
      name,
      surname,
      email,
      password,
      phone ?? null,
      role,
      idCommunity ?? null,
      housing ?? null,
    ]);
    return result.insertId;
  }

  /**
   * -----------------------------------------------------------------
   * Método: update
   * Propósito: actualizar los campos indicados (parcial).
   * @param {number} userId - `users.id_user`.
   * @param {object} fields - Campos ya validados por el servicio.
   * @returns {Promise<number>} Filas afectadas (0 si no cambia nada).
   * @throws {TypeError} Si aparece un campo fuera de la lista blanca.
   * -----------------------------------------------------------------
   */
  async update(userId, fields) {
    const allowed = new Set(["name", "surname", "email", "phone", "role", "id_community", "housing"]);
    const entries = Object.entries(fields).filter(([key]) => allowed.has(key));

    if (entries.length === 0 || Object.keys(fields).length !== entries.length) {
      throw new TypeError("UserRepository.update: campo fuera de la lista blanca.");
    }

    // Los nombres de columna salen de un conjunto cerrado, nunca del
    // cliente; los valores se pasan como parámetros `?`.
    const sets = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([, value]) => value);

    const query = `
      UPDATE users
      SET ${sets.join(", ")}
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [...values, userId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateStatus
   * Propósito: activar o desactivar una cuenta (`is_active`).
   * @param {number} userId - `users.id_user`.
   * @param {boolean} isActive - `true` para activar.
   * @returns {Promise<number>} Filas afectadas (0 si ya estaba así).
   * -----------------------------------------------------------------
   */
  async updateStatus(userId, isActive) {
    const query = `
      UPDATE users
      SET is_active = ?
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [isActive ? 1 : 0, userId]);
    return result.affectedRows;
  }
}

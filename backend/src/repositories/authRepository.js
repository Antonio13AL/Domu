// =============================================================
// Repositorio de autenticación — SQL parametrizado.
// =============================================================
//
// Consultas que necesita el flujo de autenticación. Sin
// `SELECT *`: solo las columnas que consumen los servicios, y
// `password` únicamente en las filas destinadas a comparar o
// actualizar la contraseña — nunca se devuelve al cliente.
//
// Todas las consultas usan placeholders `?`.
// =============================================================

import { pool } from "../config/database.js";

export class AuthRepository {
  /**
   * -----------------------------------------------------------------
   * Método: findActiveUserById
   * Propósito: recuperar un usuario activo por su identificador
   * (se usa en `authenticateToken`).
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | { id_user: number, email: string,
   *   role: string, is_active: number }>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findActiveUserById(userId) {
    const query = `
      SELECT id_user, email, role, is_active
      FROM users
      WHERE id_user = ?
        AND is_active = 1
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findByEmail
   * Propósito: recuperar un usuario por correo (login, comprobación
   * de duplicado en registro y cambio de contraseña).
   * @param {string} email - Correo normalizado en minúsculas.
   * @returns {Promise<null | object>} Fila completa o `null`.
   * -----------------------------------------------------------------
   */
  async findByEmail(email) {
    const query = `
      SELECT id_user, name, surname, email, password, phone, role,
             id_community, housing, is_active
      FROM users
      WHERE email = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [email]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findProfile
   * Propósito: perfil del usuario autenticado junto con su
   * comunidad (`GET /auth/me` → «Perfil y comunidades»).
   * @param {number} userId - `users.id_user`.
   * @returns {Promise<null | object>} Fila con `user_*`/`community_*`.
   * -----------------------------------------------------------------
   */
  async findProfile(userId) {
    // Alias prefijados: en un LEFT JOIN ambas tablas tienen
    // `id_community` y mysql2 pisaría un valor con otro si no se
    // distinguen.
    const query = `
      SELECT u.id_user, u.name, u.surname, u.email, u.phone, u.role,
             u.id_community, u.housing, u.is_active,
             c.name  AS community_name,
             c.address AS community_address,
             c.city   AS community_city,
             c.invite_code AS community_invite_code
      FROM users u
      LEFT JOIN communities c
        ON c.id_community = u.id_community
      WHERE u.id_user = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [userId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findCommunityByInviteCode
   * Propósito: resolver el `invite_code` del registro. Solo las
   * comunidades activas admiten nuevos miembros.
   * @param {string} inviteCode - Código en mayúsculas.
   * @returns {Promise<null | { id_community: number, name: string }>}
   * -----------------------------------------------------------------
   */
  async findCommunityByInviteCode(inviteCode) {
    const query = `
      SELECT id_community, name
      FROM communities
      WHERE invite_code = ?
        AND is_active = 1
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [inviteCode]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: create
   * Propósito: crear un usuario (siempre rol `NEIGHBOR` en el
   * registro público; el rol lo decide el servicio).
   * @param {object} data - Datos ya validados.
   * @param {string} data.name - Nombre.
   * @param {string} data.surname - Apellidos.
   * @param {string} data.email - Correo normalizado.
   * @param {string} data.password - Hash bcrypt.
   * @param {null | string} data.phone - Teléfono opcional.
   * @param {string} data.role - Rol (`NEIGHBOR` en registro).
   * @param {null | number} data.idCommunity - Comunidad opcional.
   * @returns {Promise<number>} `users.id_user` insertado.
   * -----------------------------------------------------------------
   */
  async create({ name, surname, email, password, phone, role, idCommunity }) {
    const query = `
      INSERT INTO users (name, surname, email, password, phone, role, id_community)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `;
    const [result] = await pool.query(query, [
      name,
      surname,
      email,
      password,
      phone ?? null,
      role,
      idCommunity ?? null,
    ]);
    return result.insertId;
  }

  /**
   * -----------------------------------------------------------------
   * Método: updatePassword
   * Propósito: guardar el hash de la nueva contraseña.
   * @param {number} userId - `users.id_user`.
   * @param {string} passwordHash - Hash bcrypt nuevo.
   * @returns {Promise<boolean>} `true` si se actualizó una fila.
   * -----------------------------------------------------------------
   */
  async updatePassword(userId, passwordHash) {
    const query = `
      UPDATE users
      SET password = ?
      WHERE id_user = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [passwordHash, userId]);
    return result.affectedRows > 0;
  }
}

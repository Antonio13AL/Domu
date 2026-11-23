// =============================================================
// Repositorio de comunidades
// =============================================================
//
// Solo necesita saber si una comunidad existe, para poder
// responder 404 (comunidad inexistente) de forma distinguible del
// 403 (vecino de otra comunidad) en las rutas de incidencias. El
// CRUD completo de comunidades llega con BE-08 y ampliará este
// fichero.
//
// Todas las consultas usan placeholders `?` con `pool.query()`.
// =============================================================

import { pool } from "../config/database.js";

export class CommunityRepository {
  /**
   * -----------------------------------------------------------------
   * Método: existsById
   * Propósito: comprobar la existencia de una comunidad.
   * @param {number} communityId - `communities.id_community`.
   * @returns {Promise<boolean>} `true` si la comunidad existe.
   * -----------------------------------------------------------------
   */
  async existsById(communityId) {
    const query = "SELECT 1 AS ok FROM communities WHERE id_community = ? LIMIT 1;";
    const [rows] = await pool.query(query, [communityId]);
    return rows.length > 0;
  }
}

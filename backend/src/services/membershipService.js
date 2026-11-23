// =============================================================
// Pertenencia a la comunidad — servicio compartido entre dominios.
// =============================================================
//
// Tanto las reuniones como las votaciones se acotan a una comunidad
// (`users.id_community`) y distinguen al «Admin» (PRESIDENT) del
// «Miembro» (NEIGHBOR) según la leyenda de roles. Esas
// dos reglas viven aquí, en un único sitio, para que los servicios
// de cada dominio no acaben con copias que divergen.
//
// Nota: el token solo trae `{ id, role, email }`, así que la
// pertenencia hay que leerla de la base de datos en cada petición.
//
// Sin objetos `req`/`res`: solo reglas de ownership.
// =============================================================

import { AppError } from "../utils/AppError.js";
import { Role } from "../enums/Role.js";
import { UserRepository } from "../repositories/userRepository.js";

/** Mensaje único de autorización, sin detalles internos. */
const GENERIC_FORBIDDEN = "No tiene permisos para realizar esta operación.";

export class MembershipService {
  #userRepository;

  constructor() {
    this.#userRepository = new UserRepository();
  }

  /**
   * -----------------------------------------------------------------
   * Método: loadMember
   * Propósito: recuperar la fila del solicitante para conocer su
   * comunidad y su rol.
   * @param {number} requesterId - `req.user.id`.
   * @returns {Promise<object>} Fila de `users`.
   * @throws {AppError} 401 si la cuenta no existe o está desactivada.
   * -----------------------------------------------------------------
   */
  async loadMember(requesterId) {
    const user = await this.#userRepository.findById(requesterId);

    if (!user || (user.is_active !== 1 && user.is_active !== true)) {
      throw AppError.unauthorized("La cuenta asociada al token no existe o no está activa.");
    }

    return user;
  }

  /**
   * -----------------------------------------------------------------
   * Método: assertCommunityMember
   * Propósito: comprobar que el solicitante pertenece a la comunidad
   * indicada. Es la comprobación de aislamiento entre comunidades:
   * quien no pertenece recibe 403 también cuando la comunidad no
   * existe, para no revelar su existencia.
   * @param {number} requesterId - `req.user.id`.
   * @param {number} communityId - Comunidad del recurso.
   * @returns {Promise<object>} Fila de `users` del solicitante.
   * @throws {AppError} 403 si no pertenece.
   * -----------------------------------------------------------------
   */
  async assertCommunityMember(requesterId, communityId) {
    const user = await this.loadMember(requesterId);

    if (Number(user.id_community) !== communityId) {
      throw AppError.forbidden(GENERIC_FORBIDDEN);
    }

    return user;
  }

  /**
   * -----------------------------------------------------------------
   * Método: assertPresident
   * Propósito: comprobar el rol de presidente sobre un usuario que ya
   * pertenece a la comunidad.
   * @param {object} user - Fila de `users`.
   * @returns {void}
   * @throws {AppError} 403 si no es `PRESIDENT`.
   * -----------------------------------------------------------------
   */
  assertPresident(user) {
    if (user.role !== Role.PRESIDENT) {
      throw AppError.forbidden(GENERIC_FORBIDDEN);
    }
  }
}

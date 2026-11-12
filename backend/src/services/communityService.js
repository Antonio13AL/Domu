// =============================================================
// Servicio de comunidades y miembros.
// =============================================================
// Sin objetos `req`/`res` y sin SQL: todo se delega en el repositorio.
// =============================================================

import { AppError } from "../utils/AppError.js";
import {
  CommunityModel,
  COMMUNITY_SORT_FIELDS,
  MEMBER_SORT_FIELDS,
} from "../models/Community.js";
import { UserModel } from "../models/User.js";
import { buildPagination, parseListParams } from "../utils/pagination.js";
import { CommunityRepository } from "../repositories/communityRepository.js";
import { randomInt } from "node:crypto";

/**
 * -----------------------------------------------------------------
 * La constante es: INVITE_ALPHABET
 * Alfabeto del código generado (32 caracteres, sin
 * caracteres ambiguos `I`, `O`, `0`, `1` para que el código pueda
 * teclearse a mano). Longitud 8 ≤ 12 (`VARCHAR(12)`).
 * @type {Readonly<string>}
 * -----------------------------------------------------------------
 */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Intentos de generación antes de rendirse. */
const MAX_GENERATE_ATTEMPTS = 5;

export class CommunityService {
  #communityRepository;

  constructor() {
    this.#communityRepository = new CommunityRepository();
  }

  /**
   * -----------------------------------------------------------------
   * El método es: #parseId
   * El propósito es convertir un segmento de ruta numérico en un
   * identificador válido.
   * @param {unknown} value - Valor de `req.params`.
   * @param {string} field - Nombre del parámetro (para el error).
   * @returns {number} Identificador positivo.
   * @throws {AppError} 400 si el identificador no es numérico.
   * -----------------------------------------------------------------
   */
  #parseId(value, field) {
    const raw = typeof value === "string" ? value.trim() : "";
    const id = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isSafeInteger(id) || id < 1) {
      throw AppError.validation(`El identificador de ${field} no es válido.`, {
        field,
        received: String(value),
      });
    }

    return id;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: #generateInviteCode
   * Su propósito es fabricar un código aleatorio no repetido consultando
   * la unicidad en la base de datos.
   * @returns {Promise<string>} Código en mayúsculas.
   * @throws {AppError} 409 si no se consigue un código libre.
   * -----------------------------------------------------------------
   */
  async #generateInviteCode() {
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
      let code = "";
      for (let i = 0; i < 8; i += 1) {
        code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
      }

      const existing = await this.#communityRepository.findByInviteCode(code);
      if (!existing) {
        return code;
      }
    }

    throw AppError.conflict(
      "No se pudo generar un código de invitación único. Inténtelo de nuevo.",
    );
  }

  /**
   * -----------------------------------------------------------------
   * El método es: #assertCommunityReadable
   * Su propósito es autorizar la lectura de una comunidad: el presidente
   * entra siempre; el vecino, solo si es miembro.
   * @param {object} community - Fila de la comunidad.
   * @param {object} requester - `{ id, role }` del token.
   * @returns {Promise<void>}
   * @throws {AppError} 403 si el vecino no pertenece a la comunidad.
   * -----------------------------------------------------------------
   */
  async #assertCommunityReadable(community, requester) {
    if (requester.role === "PRESIDENT") {
      return;
    }

    const membership = await this.#communityRepository.findUserCommunityId(requester.id);

    if (!membership || membership.id_community !== community.id_community) {
      throw AppError.forbidden("No pertenece a esta comunidad.");
    }
  }

  /**
   * -----------------------------------------------------------------
   * El método es: #loadCommunity
   * Su propósito es leer una comunidad o lanzar 404 en caso de no existir.
   * @param {unknown} communityId - `req.params.communityId`.
   * @returns {Promise<object>} Fila de la comunidad.
   * @throws {AppError} 400 si el id no vale, 404 si no existe.
   * -----------------------------------------------------------------
   */
  async #loadCommunity(communityId) {
    const id = this.#parseId(communityId, "communityId");
    const community = await this.#communityRepository.findById(id);

    if (!community) {
      throw AppError.notFound("La comunidad solicitada no existe.");
    }

    return community;
  }

  /**
   * -----------------------------------------------------------------
   * El método es: list
   * Su ropósito es listar las comunidades (`GET /communities`).
   * El presidente recibe todas; el vecino, solo la suya.
   * @param {object} requester - `{ id, role }` del token.
   * @param {object} query - `req.query`.
   * @returns {Promise<{ communities: object[], pagination: object }>}.
   * @throws {AppError} 400 si un filtro o la paginación no valen.
   * -----------------------------------------------------------------
   */
  async list(requester, query = {}) {
    const params = parseListParams(query, {
      allowed: COMMUNITY_SORT_FIELDS,
      defaultField: "created_at",
      defaultOrder: "desc",
    });

    const filters = {};

    if (query.is_active !== undefined && query.is_active !== "") {
      const raw = query.is_active;
      if (raw === true || raw === "true") {
        filters.isActive = true;
      } else if (raw === false || raw === "false") {
        filters.isActive = false;
      } else {
        throw AppError.validation("El filtro is_active debe ser true o false.", {
          field: "is_active",
          received: typeof raw === "string" ? raw : typeof raw,
        });
      }
    }

    // El vecino solo ve la suya.
    if (requester.role !== "PRESIDENT") {
      const membership = await this.#communityRepository.findUserCommunityId(requester.id);

      if (!membership || !membership.id_community) {
        // Sin comunidad no hay nada que mostrar y no se debe caer a «todas las comunidades».
        return {
          communities: [],
          pagination: buildPagination({ page: params.page, limit: params.limit, total: 0 }),
        };
      }

      filters.idCommunity = membership.id_community;
    }

    const [total, rows] = await Promise.all([
      // El total debe aplicar los MISMOS filtros que la página.
      this.#communityRepository.countAll({ ...filters, search: params.search }),
      this.#communityRepository.findAll({ ...params, ...filters }),
    ]);

    return {
      communities: rows.map((row) => CommunityModel.toSafeCommunity(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: getById
   * Su propósito es el detalle de una comunidad (`GET /communities/:id`).
   * @param {object} requester - `{ id, role }` del token.
   * @param {unknown} communityId - `req.params.communityId`.
   * @returns {Promise<{ community: object }>} Con `invite_code`.
   * @throws {AppError} 400 si el id no vale, 404 si no existe,
   *   403 si el vecino no es miembro.
   * -----------------------------------------------------------------
   */
  async getById(requester, communityId) {
    const community = await this.#loadCommunity(communityId);
    await this.#assertCommunityReadable(community, requester);

    return { community: CommunityModel.toSafeCommunity(community) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: create
   * Su propósito es alta de comunidad (`POST /communities`, solo
   * presidente). El creador NO se vincula automáticamente: la
   * membresía se asigna de forma explícita.
   * @param {object} input - Cuerpo de la petición.
   * @returns {Promise<{ community: object }>} - Comunidad creada.
   * @throws {AppError} 400 con `details.errors` si los datos no
   *   valen; 409 si el `invite_code` ya está en uso.
   * -----------------------------------------------------------------
   */
  async create(input) {
    const errors = CommunityModel.validateCreate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la comunidad no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};

    const providedCode =
      typeof body.invite_code === "string" && body.invite_code.trim() !== ""
        ? body.invite_code.trim().toUpperCase()
        : null;

    let inviteCode = providedCode;

    if (inviteCode) {
      const existing = await this.#communityRepository.findByInviteCode(inviteCode);
      if (existing) {
        throw AppError.conflict("El código de invitación ya está en uso.");
      }
    } else {
      inviteCode = await this.#generateInviteCode();
    }

    let idCommunity;
    try {
      idCommunity = await this.#communityRepository.create({
        name: body.name.trim(),
        address: body.address.trim(),
        city: body.city.trim(),
        postalCode: body.postal_code.trim(),
        inviteCode,
      });
    } catch (error) {
  
      if (error?.errno === 1062 || error?.code === "ER_DUP_ENTRY") {
        throw AppError.conflict("El código de invitación ya está en uso.");
      }
      throw error;
    }

    const row = await this.#communityRepository.findById(idCommunity);
    return { community: CommunityModel.toSafeCommunity(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: update
   * Su propósito es la edición parcial (`PATCH /communities/:communityId`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} input - Cuerpo de la petición.
   * @returns {Promise<{ community: object }>} Comunidad actualizada.
   * @throws {AppError} 400 si los datos o los campos no valen,
   *   404 si no existe.
   * -----------------------------------------------------------------
   */
  async update(communityId, input) {
    const community = await this.#loadCommunity(communityId);

    const errors = CommunityModel.validateUpdate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la comunidad no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const fields = {};

    // Solo campos de la lista blanca (anti mass-assignment).
    for (const key of ["name", "address", "city", "postal_code"]) {
      if (Object.hasOwn(body, key)) {
        fields[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
      }
    }

    await this.#communityRepository.update(community.id_community, fields);

    const row = await this.#communityRepository.findById(community.id_community);
    return { community: CommunityModel.toSafeCommunity(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: changeStatus
   * Su propósito es archivar/activar (`PATCH /communities/:id/status`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} input - Cuerpo con `is_active`.
   * @returns {Promise<{ community: object }>} Comunidad con estado.
   * @throws {AppError} 400 si el cuerpo no vale, 404 si no existe.
   * -----------------------------------------------------------------
   */
  async changeStatus(communityId, input) {
    const community = await this.#loadCommunity(communityId);

    const errors = CommunityModel.validateStatusChange(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de estado no son válidos.", { errors });
    }

    await this.#communityRepository.updateStatus(community.id_community, input.is_active);

    const row = await this.#communityRepository.findById(community.id_community);
    return { community: CommunityModel.toSafeCommunity(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: rotateInviteCode
   * Su propósito es rotar el código de invitación
   * (`POST /communities/:communityId/invite-code`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} [input] - Cuerpo opcional.
   * @returns {Promise<{ community: object }>} Con el código nuevo.
   * @throws {AppError} 400 si el cuerpo no vale, 404 si no existe,
   *   409 si el código indicado ya pertenece a otra comunidad.
   * -----------------------------------------------------------------
   */
  async rotateInviteCode(communityId, input = {}) {
    const community = await this.#loadCommunity(communityId);

    const errors = CommunityModel.validateInviteRotation(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos del código de invitación no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};
    let inviteCode;

    if (typeof body.invite_code === "string" && body.invite_code.trim() !== "") {
      inviteCode = body.invite_code.trim().toUpperCase();

      const existing = await this.#communityRepository.findByInviteCode(
        inviteCode,
        community.id_community,
      );
      if (existing) {
        throw AppError.conflict("El código de invitación ya está en uso.");
      }
    } else {
      inviteCode = await this.#generateInviteCode();
    }

    try {
      await this.#communityRepository.updateInviteCode(community.id_community, inviteCode);
    } catch (error) {
      if (error?.errno === 1062 || error?.code === "ER_DUP_ENTRY") {
        throw AppError.conflict("El código de invitación ya está en uso.");
      }
      throw error;
    }

    const row = await this.#communityRepository.findById(community.id_community);
    return { community: CommunityModel.toSafeCommunity(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: listMembers
   * Su propósito es sacar el listado de miembros.
   * (`GET /communities/:communityId/members`).
   * @param {object} requester - `{ id, role }` del token.
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} query - `req.query`.
   * @returns {Promise<{ members: object[], pagination: object }>}.
   * @throws {AppError} 400 si un filtro no vale, 404 si la
   *   comunidad no existe, 403 si el vecino no es miembro.
   * -----------------------------------------------------------------
   */
  async listMembers(requester, communityId, query = {}) {
    const community = await this.#loadCommunity(communityId);
    await this.#assertCommunityReadable(community, requester);

    const params = parseListParams(query, {
      allowed: MEMBER_SORT_FIELDS,
      defaultField: "name",
      defaultOrder: "asc",
    });

    const [total, rows] = await Promise.all([
      this.#communityRepository.countMembers(community.id_community, { search: params.search }),
      this.#communityRepository.findMembers({
        communityId: community.id_community,
        ...params,
      }),
    ]);

    return {
      members: rows.map((row) => UserModel.toSafeUser(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: addMember
   * Su propósito es vincular un usuario a la comunidad
   * (`POST /communities/:communityId/members`, solo presidente).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} input - Cuerpo con `id_user` y `housing?`.
   * @returns {Promise<{ member: object }>} Miembro vinculado.
   * @throws {AppError} 400 con `details.errors` si los datos no
   *   valen, 404 si la comunidad o el usuario no existen, 409 si el
   *   usuario ya está vinculado aquí o en otra comunidad.
   * -----------------------------------------------------------------
   */
  async addMember(communityId, input) {
    const community = await this.#loadCommunity(communityId);

    const errors = CommunityModel.validateMemberLink(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos del miembro no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const user = await this.#communityRepository.findUserById(body.id_user);

    if (!user) {
      throw AppError.notFound("El usuario solicitado no existe.");
    }

    if (user.id_community === community.id_community) {
      throw AppError.conflict("El usuario ya es miembro de esta comunidad.");
    }

    if (user.id_community !== null) {
      // Una cuenta solo puede pertenecer a una comunidad. Antes de
      // vincularla aquí hay que desvincularla de la anterior.
      throw AppError.conflict(
        "El usuario ya pertenece a otra comunidad. Desvincúlelo antes de vincularlo aquí.",
      );
    }

    // Si no se indica vivienda se conserva la existente.
    const housing =
      body.housing !== undefined && body.housing !== null && body.housing !== ""
        ? body.housing.trim()
        : (user.housing ?? null);

    await this.#communityRepository.linkMember(community.id_community, body.id_user, housing);

    const member = await this.#communityRepository.findMemberById(
      community.id_community,
      body.id_user,
    );

    return { member: UserModel.toSafeUser(member) };
  }

  /**
   * -----------------------------------------------------------------
   * El método: updateMember
   * El propósito es editar la vivienda de un miembro
   * (`PATCH /communities/:communityId/members/:userId`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {unknown} userId - `req.params.userId`.
   * @param {object} input - Cuerpo con `housing`.
   * @returns {Promise<{ member: object }>} Miembro actualizado.
   * @throws {AppError} 400 si los datos no valen, 404 si la
   *   comunidad o el miembro no existen.
   * -----------------------------------------------------------------
   */
  async updateMember(communityId, userId, input) {
    const community = await this.#loadCommunity(communityId);
    const idUser = this.#parseId(userId, "userId");

    const errors = CommunityModel.validateMemberUpdate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos del miembro no son válidos.", { errors });
    }

    const member = await this.#communityRepository.findMemberById(
      community.id_community,
      idUser,
    );
    if (!member) {
      throw AppError.notFound("El miembro solicitado no existe en esta comunidad.");
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const housing =
      body.housing === null || body.housing === "" ? null : String(body.housing).trim();

    await this.#communityRepository.updateMemberHousing(
      community.id_community,
      idUser,
      housing,
    );

    const row = await this.#communityRepository.findMemberById(
      community.id_community,
      idUser,
    );

    return { member: UserModel.toSafeUser(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: removeMember
   * Su propósito es desvincular a un miembro
   * (`DELETE /communities/:communityId/members/:userId`). Solo se
   * pone `users.id_community = NULL`.
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {unknown} userId - `req.params.userId`.
   * @returns {Promise<{ member: object }>} Usuario ya desvinculado.
   * @throws {AppError} 
   * -----------------------------------------------------------------
   */
  async removeMember(communityId, userId) {
    const community = await this.#loadCommunity(communityId);
    const idUser = this.#parseId(userId, "userId");

    const member = await this.#communityRepository.findMemberById(
      community.id_community,
      idUser,
    );
    if (!member) {
      throw AppError.notFound("El miembro solicitado no existe en esta comunidad.");
    }

    await this.#communityRepository.unlinkMember(community.id_community, idUser);

    // Tras desvincular ya no es «miembro de esta comunidad»: Se relee por `id_user` para devolver el estado final.
    const row = await this.#communityRepository.findUserById(idUser);

    return { member: UserModel.toSafeUser(row) };
  }
}

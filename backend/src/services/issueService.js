// =============================================================
// Servicio de incidencias
// =============================================================
//
// Reglas de negocio:
//   · El vecino crea incidencias en sus comunidades; el presidente
//     las gestiona. La pertenencia se comprueba contra
//     `users.id_community` + `is_active` (el modelo real de
//     `001_init.sql`).
//   · El autor solo edita mientras la incidencia está `PENDING`;
//     a partir de ahí, solo el presidente.
//   · Transiciones: `PENDING → IN_PROGRESS | REJECTED`,
//     `IN_PROGRESS → RESOLVED | REJECTED`. Al resolver se guarda
//     `resolved_at`.
//   · Cambio de estado y borrado: solo el presidente de la
//     comunidad (la autorización de rol vive en la ruta; aquí se
//     comprueban membresía y ownership).
//   · Filtros, paginación y ordenación por lista blanca.
//
// Sin objetos `req`/`res` y sin SQL: todo se delega en los
// repositorios.
// =============================================================

import { Role } from "../enums/Role.js";
import {
  isIssueCategory,
  isIssuePriority,
  isIssueStatus,
  IssueStatus,
} from "../enums/State.js";
import { AppError } from "../utils/AppError.js";
import {
  IssueModel,
  ISSUE_SORT_FIELDS,
  ISSUE_TRANSITIONS,
  ISSUE_WRITABLE_FIELDS,
} from "../models/Issue.js";
import { buildPagination, parseListParams } from "../utils/pagination.js";
import { IssueRepository } from "../repositories/issueRepository.js";
import { CommunityRepository } from "../repositories/communityRepository.js";
import { UserRepository } from "../repositories/userRepository.js";

/** Etiqueta española de cada identificador de ruta (para el 400). */
const ID_LABELS = Object.freeze({
  communityId: "comunidad",
  issueId: "incidencia",
});

/** Prioridad aplicada cuando el alta no la envía. */
const DEFAULT_PRIORITY = "MEDIUM";

/**
 * -----------------------------------------------------------------
 * Función: parseIssueFilters
 * Propósito: convertir los filtros de `req.query` (`status`,
 * `priority`, `category`) en valores ya validados contra sus enums.
 * @param {object} [query] - `req.query`.
 * @returns {object} Filtros presentes (objeto vacío si no hay).
 * @throws {AppError} 400 si un filtro no pertenece a su enum.
 * -----------------------------------------------------------------
 */
function parseIssueFilters(query = {}) {
  const filters = {};
  const definitions = [
    { name: "status", isValid: isIssueStatus },
    { name: "priority", isValid: isIssuePriority },
    { name: "category", isValid: isIssueCategory },
  ];

  for (const { name, isValid } of definitions) {
    const raw = query[name];
    if (raw === undefined || raw === "") continue;

    if (typeof raw !== "string" || !isValid(raw)) {
      throw AppError.validation(`El filtro ${name} no es válido.`, {
        field: name,
        received: Array.isArray(raw) ? "[]" : String(raw),
      });
    }

    filters[name] = raw;
  }

  return filters;
}

export class IssueService {
  #issueRepository;
  #communityRepository;
  #userRepository;

  constructor() {
    this.#issueRepository = new IssueRepository();
    this.#communityRepository = new CommunityRepository();
    this.#userRepository = new UserRepository();
  }

  /**
   * -----------------------------------------------------------------
   * Método: #parseId
   * Propósito: convertir el segmento de ruta `:communityId` o
   * `:issueId` en un identificador válido.
   * @param {unknown} value - Valor de `req.params`.
   * @param {"communityId" | "issueId"} field - Nombre del parámetro.
   * @returns {number} Identificador positivo.
   * @throws {AppError} 400 si no es numérico.
   * -----------------------------------------------------------------
   */
  #parseId(value, field) {
    const raw = typeof value === "string" ? value.trim() : "";
    const id = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isSafeInteger(id) || id < 1) {
      throw AppError.validation(`El identificador de ${ID_LABELS[field]} no es válido.`, {
        field,
        received: String(value),
      });
    }

    return id;
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertCommunityExists
   * Propósito: distinguir el 404 (comunidad inexistente) del 403
   * (vecino de otra comunidad).
   * @param {number} communityId - `communities.id_community`.
   * @throws {AppError} 404 si la comunidad no existe.
   * -----------------------------------------------------------------
   */
  async #assertCommunityExists(communityId) {
    const exists = await this.#communityRepository.existsById(communityId);
    if (!exists) {
      throw AppError.notFound("La comunidad solicitada no existe.");
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertMember
   * Propósito: exigir pertenencia activa a la comunidad (vecinos y
   * presidentes acceden solo a la suya).
   * @param {number} userId - `users.id_user` del token.
   * @param {number} communityId - Comunidad recurso.
   * @throws {AppError} 403 si no es miembro activo.
   * -----------------------------------------------------------------
   */
  async #assertMember(userId, communityId) {
    const isMember = await this.#userRepository.isCommunityMember(userId, communityId);
    if (!isMember) {
      throw AppError.forbidden("No pertenece a esta comunidad.");
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: #loadIssue
   * Propósito: cargar una incidencia o fallar con 404.
   * @param {number} issueId - `issues.id`.
   * @returns {Promise<object>} Fila de la incidencia.
   * @throws {AppError} 404 si no existe.
   * -----------------------------------------------------------------
   */
  async #loadIssue(issueId) {
    const row = await this.#issueRepository.findById(issueId);
    if (!row) {
      throw AppError.notFound("La incidencia solicitada no existe.");
    }
    return row;
  }

  /**
   * -----------------------------------------------------------------
   * Método: list
   * Propósito: listado de incidencias de una comunidad con filtros
   * (`GET /communities/:communityId/issues`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} query - `req.query`.
   * @param {number} userId - Usuario autenticado.
   * @returns {Promise<{ issues: object[], pagination: object }>}
   *   Incidencias y bloque `page`, `limit`, `total`, `total_pages`.
   * @throws {AppError} 400 (datos), 403 (no miembro), 404 (comunidad).
   * -----------------------------------------------------------------
   */
  async list(communityId, query = {}, userId) {
    const id = this.#parseId(communityId, "communityId");

    const params = parseListParams(query, {
      allowed: ISSUE_SORT_FIELDS,
      defaultField: "created_at",
      defaultOrder: "desc",
    });
    const filters = parseIssueFilters(query);

    await this.#assertCommunityExists(id);
    await this.#assertMember(userId, id);

    const [total, rows] = await Promise.all([
      this.#issueRepository.countByCommunity(id, { search: params.search, ...filters }),
      this.#issueRepository.findAllByCommunity(id, {
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
        order: params.order,
        search: params.search,
        ...filters,
      }),
    ]);

    return {
      issues: rows.map((row) => IssueModel.toSafeIssue(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: create
   * Propósito: alta de incidencia
   * (`POST /communities/:communityId/issues`). El autor es siempre
   * el usuario autenticado y el estado inicial `PENDING`.
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} data - `req.body`.
   * @param {number} userId - Autor (`req.user.id`).
   * @returns {Promise<{ issue: object }>} Incidencia creada.
   * @throws {AppError} 400 (validación), 403, 404.
   * -----------------------------------------------------------------
   */
  async create(communityId, data = {}, userId) {
    const id = this.#parseId(communityId, "communityId");

    const errors = IssueModel.validateCreate(data);
    if (errors.length > 0) {
      throw AppError.validation(errors.join(" "), { errors });
    }

    await this.#assertCommunityExists(id);
    await this.#assertMember(userId, id);

    // Tras la validación, `title` y `description` son cadenas no
    // vacías: se guardan recortados.
    const insertId = await this.#issueRepository.create({
      communityId: id,
      reporterId: userId,
      title: data.title.trim(),
      description: data.description.trim(),
      category: data.category ?? null,
      priority: data.priority ?? DEFAULT_PRIORITY,
    });

    const row = await this.#issueRepository.findById(insertId);
    return { issue: IssueModel.toSafeIssue(row) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getById
   * Propósito: detalle de una incidencia (`GET /issues/:issueId`).
   * @param {unknown} issueId - `req.params.issueId`.
   * @param {number} userId - Usuario autenticado.
   * @returns {Promise<{ issue: object }>} Incidencia.
   * @throws {AppError} 400, 403 (no miembro), 404.
   * -----------------------------------------------------------------
   */
  async getById(issueId, userId) {
    const id = this.#parseId(issueId, "issueId");
    const row = await this.#loadIssue(id);
    await this.#assertMember(userId, row.id_community);
    return { issue: IssueModel.toSafeIssue(row) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: update
   * Propósito: edición de campos (`PATCH /issues/:issueId`).
   *   · El autor edita solo mientras está `PENDING`.
   *   · El presidente edita en cualquier estado.
   *   · `status` no es editable por aquí.
   * @param {unknown} issueId - `req.params.issueId`.
   * @param {object} data - `req.body`.
   * @param {number} userId - Usuario autenticado.
   * @param {string} requesterRole - Rol del token (`req.user.role`).
   * @returns {Promise<{ issue: object }>} Incidencia actualizada.
   * @throws {AppError} 400, 403 (ownership), 404.
   * -----------------------------------------------------------------
   */
  async update(issueId, data = {}, userId, requesterRole) {
    const id = this.#parseId(issueId, "issueId");

    const errors = IssueModel.validateUpdate(data);
    if (errors.length > 0) {
      throw AppError.validation(errors.join(" "), { errors });
    }

    const row = await this.#loadIssue(id);
    await this.#assertMember(userId, row.id_community);

    const isAuthor = row.id_user === userId;
    const isPresident = requesterRole === Role.PRESIDENT;

    if (!isPresident) {
      if (!isAuthor) {
        throw AppError.forbidden("Solo el autor o el presidente pueden editar esta incidencia.");
      }
      if (row.status !== IssueStatus.PENDING) {
        throw AppError.forbidden(
          "Solo se puede editar una incidencia mientras está pendiente.",
        );
      }
    }

    const fields = {};
    for (const key of ISSUE_WRITABLE_FIELDS) {
      if (data[key] !== undefined) fields[key] = data[key];
    }
    if (typeof fields.title === "string") fields.title = fields.title.trim();
    if (typeof fields.description === "string") fields.description = fields.description.trim();

    await this.#issueRepository.update(id, fields);

    const updated = await this.#issueRepository.findById(id);
    return { issue: IssueModel.toSafeIssue(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeStatus
   * Propósito: transición de estado
   * (`PATCH /issues/:issueId/status`, solo presidente en la ruta).
   * @param {unknown} issueId - `req.params.issueId`.
   * @param {object} data - `req.body` con `status`.
   * @param {number} userId - Usuario autenticado (membresía).
   * @returns {Promise<{ issue: object }>} Incidencia actualizada.
   * @throws {AppError} 400, 403, 404, 409 (transición inválida).
   * -----------------------------------------------------------------
   */
  async changeStatus(issueId, data = {}, userId) {
    const id = this.#parseId(issueId, "issueId");

    const errors = IssueModel.validateStatusChange(data);
    if (errors.length > 0) {
      throw AppError.validation(errors.join(" "), { errors });
    }

    const row = await this.#loadIssue(id);
    await this.#assertMember(userId, row.id_community);

    const nextStatus = data.status;
    const allowed = ISSUE_TRANSITIONS[row.status] ?? [];

    if (!allowed.includes(nextStatus)) {
      // `errorHandler` solo emite `details` en `VALIDATION_ERROR`,
      // así que la información útil va en el mensaje: estado actual
      // y transición intentada.
      throw AppError.conflict(
        `Transición de estado no permitida: ${row.status} → ${nextStatus}.`,
      );
    }

    // `resolved_at` solo se rellena al resolver; en el resto de
    // transiciones el repositorio conserva el valor anterior.
    const resolvedAt = nextStatus === IssueStatus.RESOLVED ? new Date() : null;
    await this.#issueRepository.updateStatus(id, nextStatus, resolvedAt);

    const updated = await this.#issueRepository.findById(id);
    return { issue: IssueModel.toSafeIssue(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: remove
   * Propósito: borrado de una incidencia (`DELETE /issues/:issueId`,
   * solo presidente en la ruta).
   * @param {unknown} issueId - `req.params.issueId`.
   * @param {number} userId - Usuario autenticado (membresía).
   * @returns {Promise<{ deleted: boolean }>} Confirmación.
   * @throws {AppError} 400, 403, 404.
   * -----------------------------------------------------------------
   */
  async remove(issueId, userId) {
    const id = this.#parseId(issueId, "issueId");
    const row = await this.#loadIssue(id);
    await this.#assertMember(userId, row.id_community);
    await this.#issueRepository.delete(id);
    return { deleted: true };
  }
}

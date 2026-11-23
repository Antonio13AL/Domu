// =============================================================
// Servicio de gestión de usuarios.
// =============================================================
//
// El presidente lista, crea, edita, activa y desactiva usuarios.
//
// Sin objetos `req`/`res` y sin SQL: todo se delega en el repositorio.
// =============================================================

import { isRole, Role } from "../enums/Role.js";
import { AppError } from "../utils/AppError.js";
import { UserModel, USER_SORT_FIELDS, USER_UPDATABLE_FIELDS } from "../models/User.js";
import { buildPagination, parseListParams } from "../utils/pagination.js";
import { UserRepository } from "../repositories/userRepository.js";
import { hashPassword } from "../security/encryption.js";

/** Mensaje único de conflicto de correo. */
const EMAIL_CONFLICT = "No se pudo completar la operación con los datos proporcionados.";

export class UserService {
  #userRepository;

  constructor() {
    this.#userRepository = new UserRepository();
  }

  /**
   * -----------------------------------------------------------------
   * El método es: #parseId
   * El propósito es convertir el segmento de ruta `:userId` en un
   * identificador válido.
   * @param {unknown} value - `req.params.userId`.
   * @returns {number} `id_user` positivo.
   * @throws {AppError} 400 si el identificador no es numérico.
   * -----------------------------------------------------------------
   */
  #parseId(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    const id = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isSafeInteger(id) || id < 1) {
      throw AppError.validation("El identificador de usuario no es válido.", {
        field: "userId",
        received: String(value),
      });
    }

    return id;
  }

  /**
   * -----------------------------------------------------------------
   * El método: list
   * El propósito es listar el listado paginado con filtros (`GET /users`).
   * @param {object} query - `req.query`.
   * @returns {Promise<{ users: object[], pagination: object }>} y
   *   `page`, `limit`, `total`, `total_pages`.
   * @throws {AppError} 400 si un filtro o la paginación no valen.
   * -----------------------------------------------------------------
   */
  async list(query = {}) {
    const params = parseListParams(query, {
      allowed: USER_SORT_FIELDS,
      defaultField: "created_at",
      defaultOrder: "desc",
    });

    const filters = {};

    if (query.role !== undefined && query.role !== "") {
      if (typeof query.role !== "string" || !isRole(query.role)) {
        throw AppError.validation("El filtro de rol no es válido.", {
          field: "role",
          received: Array.isArray(query.role) ? "[]" : String(query.role),
        });
      }
      filters.role = query.role;
    }

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

    if (query.id_community !== undefined && query.id_community !== "") {
      const raw = String(query.id_community).trim();
      if (!/^\d{1,16}$/.test(raw) || Number(raw) < 1) {
        throw AppError.validation("El filtro id_community debe ser un número positivo.", {
          field: "id_community",
          received: raw,
        });
      }
      filters.idCommunity = Number(raw);
    }

    const [total, rows] = await Promise.all([
      this.#userRepository.countAll(filters),
      this.#userRepository.findAll({ ...params, ...filters }),
    ]);

    return {
      users: rows.map((row) => UserModel.toSafeUser(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * El método: getById
   * El propósito es ver el detalle de un usuario (`GET /users/:userId`).
   * @param {unknown} userId - `req.params.userId`.
   * @returns {Promise<{ user: object }>} Usuario seguro.
   * @throws {AppError} 400 si el id no vale, 404 si no existe.
   * -----------------------------------------------------------------
   */
  async getById(userId) {
    const id = this.#parseId(userId);
    const row = await this.#userRepository.findById(id);

    if (!row) {
      throw AppError.notFound("El usuario solicitado no existe.");
    }

    return { user: UserModel.toSafeUser(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: create
   * El propósito es el alta de usuario (`POST /users`).
   * @param {object} input - Cuerpo de la petición.
   * @returns {Promise<{ user: object }>} Usuario creado.
   * @throws {AppError} 400 con `details.errors` si los datos no
   *   valen; 409 si el correo ya está en uso.
   * -----------------------------------------------------------------
   */
  async create(input) {
    const errors = UserModel.validateAdminCreate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos del usuario no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const email = body.email.trim().toLowerCase();

    const existing = await this.#userRepository.findByEmail(email);
    if (existing) {
      throw AppError.conflict(EMAIL_CONFLICT);
    }

    const passwordHash = await hashPassword(body.password);

    let idUser;
    try {
      idUser = await this.#userRepository.create({
        name: body.name.trim(),
        surname: body.surname.trim(),
        email,
        password: passwordHash,
        phone: typeof body.phone === "string" && body.phone.trim() !== ""
          ? body.phone.trim()
          : null,
        // El rol solo se acepta si es un valor del enum. En caso contrario, si no
        // llega, la cuenta nace como vecina.
        role: typeof body.role === "string" && body.role !== "" ? body.role : Role.NEIGHBOR,
        idCommunity: Number.isSafeInteger(body.id_community) ? body.id_community : null,
        housing: typeof body.housing === "string" && body.housing !== "" ? body.housing : null,
      });
    } catch (error) {
      if (error?.errno === 1062 || error?.code === "ER_DUP_ENTRY") {
        throw AppError.conflict(EMAIL_CONFLICT);
      }
      if (error?.errno === 1452) {
        throw AppError.validation("La comunidad indicada no existe.", { field: "id_community" });
      }
      throw error;
    }

    const row = await this.#userRepository.findById(idUser);
    return { user: UserModel.toSafeUser(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método es: update
   * El propósito es edición parcial de datos y rol.
   * (`PATCH /users/:userId`).
   * @param {unknown} userId - `req.params.userId`.
   * @param {object} input - Cuerpo de la petición.
   * @returns {Promise<{ user: object }>} Usuario actualizado.
   * @throws {AppError} 400 si los datos o los campos no valen,
   *   404 si no existe, 409 si el correo pertenece a otro usuario.
   * -----------------------------------------------------------------
   */
  async update(userId, input) {
    const id = this.#parseId(userId);

    const errors = UserModel.validateUserUpdate(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos del usuario no son válidos.", { errors });
    }

    const existing = await this.#userRepository.findById(id);
    if (!existing) {
      throw AppError.notFound("El usuario solicitado no existe.");
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const fields = {};

    for (const key of USER_UPDATABLE_FIELDS) {
      if (Object.hasOwn(body, key)) {
        fields[key] = body[key];
      }
    }

    // Normalización de los valores admitidos.
    if (Object.hasOwn(fields, "name")) fields.name = fields.name.trim();
    if (Object.hasOwn(fields, "surname")) fields.surname = fields.surname.trim();
    if (Object.hasOwn(fields, "email")) fields.email = fields.email.trim().toLowerCase();
    if (Object.hasOwn(fields, "phone") && fields.phone !== null) {
      fields.phone = fields.phone.trim() === "" ? null : fields.phone.trim();
    }
    if (Object.hasOwn(fields, "housing") && fields.housing !== null && fields.housing.trim() === "") {
      fields.housing = null;
    }

    if (fields.email) {
      const duplicate = await this.#userRepository.findByEmail(fields.email, id);
      if (duplicate) {
        throw AppError.conflict(EMAIL_CONFLICT);
      }
    }

    try {
      await this.#userRepository.update(id, fields);
    } catch (error) {
      if (error?.errno === 1062 || error?.code === "ER_DUP_ENTRY") {
        throw AppError.conflict(EMAIL_CONFLICT);
      }
      if (error?.errno === 1452) {
        throw AppError.validation("La comunidad indicada no existe.", { field: "id_community" });
      }
      throw error;
    }

    const row = await this.#userRepository.findById(id);
    return { user: UserModel.toSafeUser(row) };
  }

  /**
   * -----------------------------------------------------------------
   * El método: changeStatus
   * El propósito es activar o desactivar una cuenta.
   * (`PATCH /users/:userId/status`).
   * @param {unknown} userId - `req.params.userId`.
   * @param {object} input - Cuerpo con `is_active`.
   * @param {number} requesterId - `req.user.id` (quien llama).
   * @returns {Promise<{ user: object }>} Usuario con el nuevo estado.
   * @throws {AppError} 400 si el cuerpo no vale, 404 si no existe,
   *   409 si se intenta desactivar la propia cuenta.
   * -----------------------------------------------------------------
   */
  async changeStatus(userId, input, requesterId) {
    const id = this.#parseId(userId);

    const errors = UserModel.validateStatusChange(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de estado no son válidos.", { errors });
    }

    const isActive = input.is_active;

    // Nadie se desactiva a sí mismo. Sin ella, un presidente podría quedarse sin poder volver a entrar.
    if (id === requesterId && isActive === false) {
      throw AppError.conflict("No puedes desactivar tu propia cuenta.");
    }

    const existing = await this.#userRepository.findById(id);
    if (!existing) {
      throw AppError.notFound("El usuario solicitado no existe.");
    }

    await this.#userRepository.updateStatus(id, isActive);

    const row = await this.#userRepository.findById(id);
    return { user: UserModel.toSafeUser(row) };
  }
}

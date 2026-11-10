// =============================================================
// Servicio de autenticación.
// =============================================================
//
// Reglas de seguridad aplicadas aquí:
//   · Un solo mensaje de credenciales para «correo inexistente»,
//     «contraseña incorrecta» y «cuenta desactivada»: no se revela
//     si un correo existe.
//   · Ante un correo desconocido se ejecuta un hash de relleno para
//     igualar el tiempo de respuesta (ataque de temporización).
//   · El rol se toma de la base de datos, no del token.
//   · Ninguna respuesta incluye `password` (`UserModel.toSafeUser`).
//   · `login`/`register` van limitados por `rateLimit.js`.
// =============================================================

import { AppError } from "../utils/AppError.js";
import { UserModel } from "../models/User.js";
import { AuthRepository } from "../repositories/authRepository.js";
import { Role } from "../enums/Role.js";
import { hashPassword, verifyPassword } from "../security/encryption.js";
import { signToken } from "../security/token.js";

/** Mensaje único de fallo de credenciales. */
const INVALID_CREDENTIALS = "Las credenciales no son válidas.";

export class AuthService {
  #authRepository;

  constructor() {
    this.#authRepository = new AuthRepository();
  }

  /**
   * -----------------------------------------------------------------
   * Método: getAuthenticatedUser
   * Propósito: validar el `sub` del token y devolver los datos
   * seguros del usuario activo asociado.
   * @param {string} subject - `sub` del payload (string numérico).
   * @returns {Promise<{ id: number, role: string, email: string }>}>
   * Usuario para `req.user`.
   * @throws {AppError} 401 si el `sub` es inválido, la cuenta no
   * existe o está desactivada.
   * -----------------------------------------------------------------
   */
  async getAuthenticatedUser(subject) {
    const id = typeof subject === "string" && /^\d{1,16}$/.test(subject)
      ? Number(subject)
      : NaN;

    if (!Number.isSafeInteger(id) || id < 1) {
      throw AppError.unauthorized("El token de autenticación no es válido.");
    }

    const user = await this.#authRepository.findActiveUserById(id);

    if (!user) {
      // Mismo mensaje para «no existe» y «desactivada»: no se
      // revela información sobre cuentas.
      throw AppError.unauthorized("La cuenta asociada al token no existe o no está activa.");
    }

    return {
      id: user.id_user,
      role: user.role,
      email: user.email,
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: register
   * Propósito: crear una cuenta de vecino y devolver su JWT.
   * @param {object} input - Cuerpo de `POST /auth/register`.
   * @returns {Promise<{ token: string, user: object }>}.
   * @throws {AppError} 400 si los datos o el `invite_code` no son
   * válidos; 409 si el correo ya está registrado.
   * -----------------------------------------------------------------
   */
  async register(input) {
    const errors = UserModel.validateRegister(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de registro no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const email = body.email.trim().toLowerCase();
    const inviteCode = typeof body.invite_code === "string" && body.invite_code.trim() !== ""
      ? body.invite_code.trim().toUpperCase()
      : null;

    const existing = await this.#authRepository.findByEmail(email);
    if (existing) {
      throw AppError.conflict("No se pudo completar el registro con los datos proporcionados.");
    }

    let idCommunity = null;
    if (inviteCode) {
      const community = await this.#authRepository.findCommunityByInviteCode(inviteCode);
      if (!community) {
        throw AppError.validation("El código de invitación no es válido.", {
          errors: ["El código de invitación no corresponde a una comunidad activa."],
          field: "invite_code",
        });
      }
      idCommunity = community.id_community;
    }

    const passwordHash = await hashPassword(body.password);

    let idUser;
    try {
      idUser = await this.#authRepository.create({
        name: body.name.trim(),
        surname: body.surname.trim(),
        email,
        password: passwordHash,
        phone: typeof body.phone === "string" && body.phone.trim() !== ""
          ? body.phone.trim()
          : null,
        // El registro público nunca otorga `PRESIDENT`.
        role: Role.NEIGHBOR,
        idCommunity,
      });
    } catch (error) {
      // Carrera entre la comprobación y el INSERT: la restricción
      // `uq_users_email` es la fuente de verdad.
      if (error?.errno === 1062 || error?.code === "ER_DUP_ENTRY") {
        throw AppError.conflict("No se pudo completar el registro con los datos proporcionados.");
      }
      throw error;
    }

    const profile = await this.#authRepository.findProfile(idUser);

    return {
      token: signToken({ userId: idUser, role: Role.NEIGHBOR }),
      user: UserModel.toSafeUser(profile),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: login
   * Propósito: validar credenciales y firmar el JWT.
   * @param {object} input - Cuerpo de `POST /auth/login`.
   * @returns {Promise<{ token: string, user: object }>}.
   * @throws {AppError} 400 si la entrada está mal formada; 401 con
   * mensaje genérico si las credenciales no valen.
   * -----------------------------------------------------------------
   */
  async login(input) {
    const errors = UserModel.validateLogin(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de acceso no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};
    const email = body.email.trim().toLowerCase();

    const user = await this.#authRepository.findByEmail(email);

    if (!user) {
      // Hash de relleno: iguala el tiempo de respuesta con el de un
      // usuario existente y evita el ataque de temporización.
      await hashPassword(body.password);
      throw AppError.unauthorized(INVALID_CREDENTIALS);
    }

    const matches = await verifyPassword(body.password, user.password);
    if (!matches) {
      throw AppError.unauthorized(INVALID_CREDENTIALS);
    }

    // Se comprueba después de la contraseña para no distinguir una
    // cuenta desactivada de una contraseña incorrecta.
    if (user.is_active !== 1) {
      throw AppError.unauthorized(INVALID_CREDENTIALS);
    }

    return {
      token: signToken({ userId: user.id_user, role: user.role }),
      user: UserModel.toSafeUser(user),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getProfile
   * Propósito: perfil y comunidades para `GET /auth/me`.
   * @param {number} userId - `req.user.id`.
   * @returns {Promise<{ user: object, communities: object[] }>}.
   * @throws {AppError} 401 si la cuenta dejó de existir.
   * -----------------------------------------------------------------
   */
  async getProfile(userId) {
    const row = await this.#authRepository.findProfile(userId);
    if (!row || row.is_active !== 1) {
      throw AppError.unauthorized("La cuenta asociada al token no existe o no está activa.");
    }

    const communities = row.id_community
      ? [{
        id_community: row.id_community,
        name: row.community_name,
        address: row.community_address,
        city: row.community_city,
        housing: row.housing ?? null,
      }]
      : [];

    // `community_*` no pertenece al usuario: se proyecta aparte.
    const { community_name, community_address, community_city, community_invite_code, ...safeUser } = row; // eslint-disable-line no-unused-vars

    return {
      user: UserModel.toSafeUser(safeUser),
      communities,
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: changePassword
   * Propósito: cambiar la contraseña del usuario autenticado.
   * @param {number} userId - `req.user.id`.
   * @param {object} input - Cuerpo de `PATCH /auth/me/password`.
   * @returns {Promise<{ message: string }>}.
   * @throws {AppError} 400 si los datos o la contraseña actual no
   * son válidos.
   * -----------------------------------------------------------------
   */
  async changePassword(userId, input) {
    const errors = UserModel.validatePasswordChange(input);
    if (errors.length > 0) {
      throw AppError.validation("Los datos de la contraseña no son válidos.", { errors });
    }

    const body = typeof input === "object" && input !== null ? input : {};

    if (body.new_password === body.current_password) {
      throw AppError.validation("La nueva contraseña debe ser distinta de la actual.", {
        errors: ["La nueva contraseña no puede coincidir con la actual."],
        field: "new_password",
      });
    }

    const user = await this.#authRepository.findProfile(userId);
    if (!user) {
      throw AppError.unauthorized("La cuenta asociada al token no existe o no está activa.");
    }

    // `findProfile` no proyecta `password`: se pide para comparar.
    const credentials = await this.#authRepository.findByEmail(user.email);
    const matches = credentials ? await verifyPassword(body.current_password, credentials.password) : false;

    if (!matches) {
      // Mismo patrón que el login: la contraseña actual no es un
      // fallo de autenticación, sino un dato inválido (400).
      throw AppError.validation("La contraseña actual no es correcta.", {
        errors: ["La contraseña actual no es correcta."],
        field: "current_password",
      });
    }

    const passwordHash = await hashPassword(body.new_password);
    const updated = await this.#authRepository.updatePassword(userId, passwordHash);

    if (!updated) {
      throw AppError.unauthorized("La cuenta asociada al token no existe o no está activa.");
    }

    return { message: "La contraseña se ha actualizado correctamente." };
  }
}

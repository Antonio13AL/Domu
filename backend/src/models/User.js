// =============================================================
// Modelo de usuario — validación de entrada.
// =============================================================
//
// Sin dependencias de Express ni de MySQL: solo define la forma de
// los datos y las reglas de validación aplicadas a los endpoints de
// autenticación.
//
// Reglas de negocio que aquí se fijan:
//   · Correo electrónico con formato válido y máximo 255 caracteres.
//   · Contraseña: mínimo 8 caracteres, al menos una letra y un
//     número, y máximo 72 bytes (límite práctico de bcrypt).
//   · Teléfono opcional: dígitos, espacios, guiones o `+`.
//   · `invite_code` opcional: 4-12 caracteres alfanuméricos
//     (columna `communities.invite_code VARCHAR(12)`).
//   · Nombres y apellidos: 1-100 caracteres (columnas de `users`).
//
// Los identificadores en el cuerpo de la petición van en
// `snake_case`: `invite_code`, `current_password`,
// `new_password`.
// =============================================================

import { isRole } from "../enums/Role.js";

/** Formato mínimo de correo aceptado (sin espacios internos). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Teléfono: 7-20 caracteres con dígitos, espacios, guiones o `+`. */
const PHONE_PATTERN = /^\+?[\d\s-]{7,20}$/;

/** Código de invitación: 4-12 caracteres alfanuméricos. */
const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{4,12}$/;

/** Longitudes máximas de las columnas de `users`. */
const MAX_LENGTHS = Object.freeze({
  name: 100,
  surname: 100,
  email: 255,
  password: 72,
  phone: 20,
  housing: 50,
  inviteCode: 12,
});

/**
 * -----------------------------------------------------------------
 * Constante: USER_SORT_FIELDS
 * Propósito: lista blanca de ordenación del listado de usuarios.
 * Son nombres de columna reales, por lo que el servicio los pasa tal
 * cual al repositorio.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const USER_SORT_FIELDS = Object.freeze([
  "name",
  "surname",
  "email",
  "role",
  "created_at",
]);

/**
 * -----------------------------------------------------------------
 * Constante: USER_UPDATABLE_FIELDS
 * Propósito: campos que `PATCH /users/:userId` acepta modificar.
 * `is_active` no está aquí: se cambia solo por
 * `PATCH /users/:userId/status`, y `password` solo por el flujo de
 * cambio de contraseña.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const USER_UPDATABLE_FIELDS = Object.freeze([
  "name",
  "surname",
  "email",
  "phone",
  "role",
  "id_community",
  "housing",
]);

/**
 * -----------------------------------------------------------------
 * Constante: USER_CREATE_FIELDS
 * Propósito: campos que `POST /users` acepta recibir.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const USER_CREATE_FIELDS = Object.freeze([
  "name",
  "surname",
  "email",
  "password",
  "phone",
  "role",
  "id_community",
  "housing",
]);

/**
 * -----------------------------------------------------------------
 * Función: isPlainObject
 * Propósito: comprobar que el cuerpo es un objeto JSON simple.
 * @param {unknown} value - Valor a comprobar.
 * @returns {boolean} `true` si es un objeto no nulo no-array.
 * -----------------------------------------------------------------
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * -----------------------------------------------------------------
 * Función: pushUnknownFields
 * Propósito: acumular en `errors` los campos no permitidos.
 * @param {object} body - Cuerpo ya comprobado.
 * @param {readonly string[]} allowed - Campos permitidos.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function pushUnknownFields(body, allowed, errors) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.push(`El campo "${key}" no está permitido.`);
    }
  }
}

export class UserModel {
  /**
   * -----------------------------------------------------------------
   * Función: isValidPassword
   * Propósito: política de contraseñas (mínimo 8, letra y
   * número; máximo 72 bytes para que bcrypt no trunque el valor).
   * @param {unknown} value - Contraseña candidata.
   * @returns {boolean} `true` si cumple la política.
   * -----------------------------------------------------------------
   */
  static isValidPassword(value) {
    return (
      typeof value === "string" &&
      value.length >= 8 &&
      Buffer.byteLength(value, "utf8") <= MAX_LENGTHS.password &&
      /[A-Za-z]/.test(value) &&
      /\d/.test(value)
    );
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateRegister
   * Propósito: validar `POST /auth/register`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateRegister(data) {
    const errors = [];
    const body = typeof data === "object" && data !== null ? data : {};

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      errors.push("El nombre es obligatorio.");
    } else if (body.name.trim().length > MAX_LENGTHS.name) {
      errors.push(`El nombre no puede superar los ${MAX_LENGTHS.name} caracteres.`);
    }

    if (typeof body.surname !== "string" || body.surname.trim().length === 0) {
      errors.push("Los apellidos son obligatorios.");
    } else if (body.surname.trim().length > MAX_LENGTHS.surname) {
      errors.push(`Los apellidos no pueden superar los ${MAX_LENGTHS.surname} caracteres.`);
    }

    if (typeof body.email !== "string" || body.email.trim().length === 0) {
      errors.push("El correo electrónico es obligatorio.");
    } else if (
      body.email.trim().length > MAX_LENGTHS.email ||
      !EMAIL_PATTERN.test(body.email.trim())
    ) {
      errors.push("El correo electrónico no tiene un formato válido.");
    }

    if (!UserModel.isValidPassword(body.password)) {
      errors.push(
        "La contraseña debe tener al menos 8 caracteres e incluir una letra y un número.",
      );
    }

    if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
      if (typeof body.phone !== "string" || !PHONE_PATTERN.test(body.phone.trim())) {
        errors.push("El teléfono no tiene un formato válido.");
      } else if (body.phone.trim().length > MAX_LENGTHS.phone) {
        errors.push(`El teléfono no puede superar los ${MAX_LENGTHS.phone} caracteres.`);
      }
    }

    if (
      body.invite_code !== undefined &&
      body.invite_code !== null &&
      body.invite_code !== ""
    ) {
      if (
        typeof body.invite_code !== "string" ||
        !INVITE_CODE_PATTERN.test(body.invite_code.trim())
      ) {
        errors.push(
          `El código de invitación debe tener entre 4 y ${MAX_LENGTHS.inviteCode} caracteres alfanuméricos.`,
        );
      }
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateLogin
   * Propósito: validar `POST /auth/login`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateLogin(data) {
    const errors = [];
    const body = typeof data === "object" && data !== null ? data : {};

    if (typeof body.email !== "string" || body.email.trim().length === 0) {
      errors.push("El correo electrónico es obligatorio.");
    } else if (!EMAIL_PATTERN.test(body.email.trim())) {
      errors.push("El correo electrónico no tiene un formato válido.");
    }

    if (typeof body.password !== "string" || body.password.length === 0) {
      errors.push("La contraseña es obligatoria.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validatePasswordChange
   * Propósito: validar `PATCH /auth/me/password`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validatePasswordChange(data) {
    const errors = [];
    const body = typeof data === "object" && data !== null ? data : {};

    if (typeof body.current_password !== "string" || body.current_password.length === 0) {
      errors.push("La contraseña actual es obligatoria.");
    }

    if (!UserModel.isValidPassword(body.new_password)) {
      errors.push(
        "La nueva contraseña debe tener al menos 8 caracteres e incluir una letra y un número.",
      );
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateAdminCreate
   * Propósito: validar `POST /users`.
   * Reutiliza las reglas del registro público para nombre, apellidos,
   * correo, contraseña y teléfono, y añade `role`, `id_community` y
   * `housing`. Rechaza cualquier campo fuera de la lista blanca.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateAdminCreate(data) {
    const body = isPlainObject(data) ? data : {};

    // Nombre, apellidos, correo, contraseña y teléfono: mismas reglas
    // que el registro público (sin `invite_code`, que no aplica aquí).
    const errors = UserModel.validateRegister({
      name: body.name,
      surname: body.surname,
      email: body.email,
      password: body.password,
      phone: body.phone,
    });

    pushUnknownFields(body, USER_CREATE_FIELDS, errors);

    if (body.role !== undefined && body.role !== null && body.role !== "") {
      if (typeof body.role !== "string" || !isRole(body.role)) {
        errors.push("El rol debe ser NEIGHBOR o PRESIDENT.");
      }
    }

    if (body.id_community !== undefined && body.id_community !== null && body.id_community !== "") {
      if (!Number.isSafeInteger(body.id_community) || body.id_community < 1) {
        errors.push("El identificador de comunidad debe ser un número positivo.");
      }
    }

    if (body.housing !== undefined && body.housing !== null && body.housing !== "") {
      if (typeof body.housing !== "string" || body.housing.length > MAX_LENGTHS.housing) {
        errors.push(`La vivienda no puede superar los ${MAX_LENGTHS.housing} caracteres.`);
      }
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateUserUpdate
   * Propósito: validar `PATCH /users/:userId`. Actualización parcial:
   * exige al menos un campo, admite solo los de la lista blanca y
   * valida el valor de cada campo presente. `null` vacía los campos
   * opcionales (`phone`, `housing`, `id_community`), pero no los
   * obligatorios.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateUserUpdate(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    if (Object.keys(body).length === 0) {
      errors.push("Debe indicar al menos un campo para actualizar.");
      return errors;
    }

    pushUnknownFields(body, USER_UPDATABLE_FIELDS, errors);

    const hasText = (field, label) => {
      if (!(field in body)) {
        return;
      }
      const value = body[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`El ${label} es obligatorio.`);
      } else if (value.trim().length > MAX_LENGTHS[field]) {
        errors.push(`El ${label} no puede superar los ${MAX_LENGTHS[field]} caracteres.`);
      }
    };

    hasText("name", "nombre");
    hasText("surname", "apellidos");

    if ("email" in body) {
      const value = body.email;
      if (typeof value !== "string" || value.trim().length === 0) {
        errors.push("El correo electrónico es obligatorio.");
      } else if (value.trim().length > MAX_LENGTHS.email || !EMAIL_PATTERN.test(value.trim())) {
        errors.push("El correo electrónico no tiene un formato válido.");
      }
    }

    if ("phone" in body && body.phone !== null && body.phone !== "") {
      if (typeof body.phone !== "string" || !PHONE_PATTERN.test(body.phone.trim())) {
        errors.push("El teléfono no tiene un formato válido.");
      } else if (body.phone.trim().length > MAX_LENGTHS.phone) {
        errors.push(`El teléfono no puede superar los ${MAX_LENGTHS.phone} caracteres.`);
      }
    }

    if ("role" in body) {
      if (typeof body.role !== "string" || !isRole(body.role)) {
        errors.push("El rol debe ser NEIGHBOR o PRESIDENT.");
      }
    }

    if ("id_community" in body && body.id_community !== null) {
      if (!Number.isSafeInteger(body.id_community) || body.id_community < 1) {
        errors.push("El identificador de comunidad debe ser un número positivo.");
      }
    }

    if ("housing" in body && body.housing !== null && body.housing !== "") {
      if (typeof body.housing !== "string" || body.housing.length > MAX_LENGTHS.housing) {
        errors.push(`La vivienda no puede superar los ${MAX_LENGTHS.housing} caracteres.`);
      }
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateStatusChange
   * Propósito: validar `PATCH /users/:userId/status`. Solo admite
   * `is_active` y este debe ser un booleano JSON de verdad
   * (rechaza `"true"`, `1`, etc., para evitar ambigüedades).
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateStatusChange(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    pushUnknownFields(body, ["is_active"], errors);

    if (typeof body.is_active !== "boolean") {
      errors.push("El campo is_active debe ser true o false.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: toSafeUser
   * Propósito: proyectar una fila de `users` a la forma que se
   * devuelve al cliente. Nunca incluye `password`.
   * `is_active` y `created_at` se añaden solo si vienen en la fila:
   * los flujos de autenticación no los necesitan, el listado de
   * administración sí.
   * @param {object} row - Fila con las columnas de usuario.
   * @returns {object | null} Usuario seguro o `null`.
   * -----------------------------------------------------------------
   */
  static toSafeUser(row) {
    if (!row) {
      return null;
    }

    const safeUser = {
      id_user: row.id_user,
      name: row.name,
      surname: row.surname,
      email: row.email,
      phone: row.phone ?? null,
      role: row.role,
      id_community: row.id_community ?? null,
      housing: row.housing ?? null,
    };

    if ("is_active" in row) {
      safeUser.is_active = row.is_active === 1 || row.is_active === true;
    }
    if ("created_at" in row) {
      safeUser.created_at = row.created_at;
    }

    return safeUser;
  }
}

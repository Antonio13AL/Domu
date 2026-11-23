// =============================================================
// Modelo de comunidad — validación de entrada.
// =============================================================
//
// Define la forma de los datos de `communities` y de los miembros que se gestionan a
// través de ella (`users.id_community`, la pertenencia vive
// en `users`, no existe tabla `community_members`).
// Los identificadores del cuerpo de la petición van en `snake_case`.
// =============================================================

/** Formato mínimo de código postal admitido (4-10 dígitos). */
const POSTAL_CODE_PATTERN = /^\d{4,10}$/;

/** Código de invitación: 4-12 caracteres alfanuméricos. */
const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{4,12}$/;

/** Longitudes máximas de las columnas de `communities`. */
const MAX_LENGTHS = Object.freeze({
  name: 150,
  address: 255,
  city: 100,
  postal_code: 10,
  invite_code: 12,
  housing: 50,
});

/**
 * -----------------------------------------------------------------
 * La constante es: COMMUNITY_SORT_FIELDS
 * Su propósito es: lista blanca de ordenación del listado de comunidades.
 * El servicio los pasa al repositorio, que vuelve a comprobarlos antes de interpolarlos.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const COMMUNITY_SORT_FIELDS = Object.freeze([
  "name",
  "city",
  "created_at",
]);

/**
 * -----------------------------------------------------------------
 * La constante es: MEMBER_SORT_FIELDS
 * Su propósito es: lista blanca de ordenación del listado de miembros.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const MEMBER_SORT_FIELDS = Object.freeze([
  "name",
  "surname",
  "role",
  "created_at",
]);

/**
 * -----------------------------------------------------------------
 * La constante es: COMMUNITY_CREATE_FIELDS
 * Su propósito es: campos que `POST /communities` acepta recibir.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const COMMUNITY_CREATE_FIELDS = Object.freeze([
  "name",
  "address",
  "city",
  "postal_code",
  "invite_code",
]);

/**
 * -----------------------------------------------------------------
 * La constante es: COMMUNITY_UPDATABLE_FIELDS
 * Su propósito son los campos que `PATCH /communities/:communityId` acepta
 * modificar. Se basa en que: `invite_code` se rota solo por
 * `POST /communities/:communityId/invite-code` y `is_active` solo
 * por `PATCH /communities/:communityId/status`.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const COMMUNITY_UPDATABLE_FIELDS = Object.freeze([
  "name",
  "address",
  "city",
  "postal_code",
]);

/**
 * -----------------------------------------------------------------
 * La función es: isPlainObject
 * Tiene el propósito de comprobar que el cuerpo es un objeto JSON simple.
 * @param {unknown} value - Valor a comprobar.
 * @returns {boolean} `true` si es un objeto no nulo no-array.
 * -----------------------------------------------------------------
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * -----------------------------------------------------------------
 * La función es: pushUnknownFields
 * Tiene el propósito de acumular en `errors` los campos no permitidos.
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

/**
 * -----------------------------------------------------------------
 * La función es: checkText
 * Tiene el propósito de validar un campo de texto obligatorio con su longitud
 * máxima de columna.
 * @param {object} body - Cuerpo de la petición.
 * @param {string} field - Nombre del campo (`snake_case`).
 * @param {string} label - Etiqueta para el mensaje.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function checkText(body, field, label, errors) {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`El ${label} es obligatorio.`);
  } else if (value.trim().length > MAX_LENGTHS[field]) {
    errors.push(`El ${label} no puede superar los ${MAX_LENGTHS[field]} caracteres.`);
  }
}

export class CommunityModel {
  /**
   * -----------------------------------------------------------------
   * La función es: validateCreate
   * Tiene el propósito de validar `POST /communities`. Rechaza cualquier campo
   * fuera de la lista.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} - vacío si es válido.
   * -----------------------------------------------------------------
   */
  static validateCreate(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    checkText(body, "name", "nombre", errors);
    checkText(body, "address", "dirección", errors);
    checkText(body, "city", "ciudad", errors);
    checkText(body, "postal_code", "código postal", errors);

    if (
      typeof body.postal_code === "string" &&
      body.postal_code.trim().length > 0 &&
      !POSTAL_CODE_PATTERN.test(body.postal_code.trim())
    ) {
      errors.push("El código postal debe contener entre 4 y 10 dígitos.");
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
          `El código de invitación debe tener entre 4 y ${MAX_LENGTHS.invite_code} caracteres alfanuméricos.`,
        );
      }
    }

    pushUnknownFields(body, COMMUNITY_CREATE_FIELDS, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * La función es: validateUpdate
   * Tiene el propósito de validar `PATCH /communities/:communityId`.
   * Exige al menos un campo, admite solo los de la lista blanca y valida el valor de cada campo presente.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} - vacío si es válido.
   * -----------------------------------------------------------------
   */
  static validateUpdate(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    if (Object.keys(body).length === 0) {
      errors.push("Debe indicar al menos un campo para actualizar.");
      return errors;
    }

    pushUnknownFields(body, COMMUNITY_UPDATABLE_FIELDS, errors);

    if ("name" in body) checkText(body, "name", "nombre", errors);
    if ("address" in body) checkText(body, "address", "dirección", errors);
    if ("city" in body) checkText(body, "city", "ciudad", errors);

    if ("postal_code" in body) {
      checkText(body, "postal_code", "código postal", errors);
      if (
        typeof body.postal_code === "string" &&
        body.postal_code.trim().length > 0 &&
        !POSTAL_CODE_PATTERN.test(body.postal_code.trim())
      ) {
        errors.push("El código postal debe contener entre 4 y 10 dígitos.");
      }
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * La función es: validateStatusChange
   * Tiene el propósito de validar `PATCH /communities/:communityId/status`.
   * Solo admite `is_active`, que debe ser un boolean JSON de
   * verdad ('true').
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} - vacío si es válido.
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
   * La función es: validateInviteRotation
   * Tiene el propósito de validar `POST /communities/:communityId/invite-code`.
   * Con `invite_code` se usa el indicado si tiene formato válido.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} - vacío si es válido.
   * -----------------------------------------------------------------
   */
  static validateInviteRotation(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    if (Object.keys(body).length === 0) {
      return errors;
    }

    pushUnknownFields(body, ["invite_code"], errors);

    if ("invite_code" in body) {
      if (
        typeof body.invite_code !== "string" ||
        !INVITE_CODE_PATTERN.test(body.invite_code.trim())
      ) {
        errors.push(
          `El código de invitación debe tener entre 4 y ${MAX_LENGTHS.invite_code} caracteres alfanuméricos.`,
        );
      }
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * La función es: validateMemberLink
   * Tiene el propósito de validar `POST /communities/:communityId/members`.
   * Importante: `id_user` es obligatorio; `housing` es opcional y se asigna al
   * vincular.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} - vacío si es válido.
   * -----------------------------------------------------------------
   */
  static validateMemberLink(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    pushUnknownFields(body, ["id_user", "housing"], errors);

    if (!Number.isSafeInteger(body.id_user) || body.id_user < 1) {
      errors.push("El identificador de usuario es obligatorio y debe ser un número positivo.");
    }

    if (body.housing !== undefined && body.housing !== null && body.housing !== "") {
      if (typeof body.housing !== "string") {
        errors.push("La vivienda debe ser texto o null.");
      } else if (body.housing.length > MAX_LENGTHS.housing) {
        errors.push(`La vivienda no puede superar los ${MAX_LENGTHS.housing} caracteres.`);
      }
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * La función es: validateMemberUpdate
   * Tiene el propósito de validar `PATCH
   * /communities/:communityId/members/:userId`. Solo admite
   * `housing`; `null` o `""` que vacían la vivienda.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} - vacío si es válido.
   * -----------------------------------------------------------------
   */
  static validateMemberUpdate(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    if (Object.keys(body).length === 0) {
      errors.push("Debe indicar al menos un campo para actualizar.");
      return errors;
    }

    pushUnknownFields(body, ["housing"], errors);

    if (
      "housing" in body &&
      body.housing !== null &&
      body.housing !== "" &&
      typeof body.housing === "string" &&
      body.housing.length > MAX_LENGTHS.housing
    ) {
      errors.push(`La vivienda no puede superar los ${MAX_LENGTHS.housing} caracteres.`);
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * La función es: toSafeCommunity
   * Tiene el propósito de proyectar una fila de `communities` a la forma que
   * se devuelve al cliente. Solo incluimos `invite_code` si viene
   * en la fila.
   * @param {object} row - Fila con las columnas de comunidad.
   * @returns {object | null} Comunidad segura o `null`.
   * -----------------------------------------------------------------
   */
  static toSafeCommunity(row) {
    if (!row) {
      return null;
    }

    const community = {
      id_community: row.id_community,
      name: row.name,
      address: row.address,
      city: row.city,
      postal_code: row.postal_code,
    };

    if ("invite_code" in row) {
      community.invite_code = row.invite_code;
    }
    if ("is_active" in row) {
      community.is_active = row.is_active === 1 || row.is_active === true;
    }
    if ("created_at" in row) {
      community.created_at = row.created_at;
    }
    if ("updated_at" in row) {
      community.updated_at = row.updated_at;
    }

    return community;
  }
}

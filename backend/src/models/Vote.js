// =============================================================
// Modelo de votaciones — validación de entrada.
// =============================================================
//
// Dominio propio: `votes` y `vote_responses`. Las reuniones
// se validan en `Meeting.js`; aquí solo vive lo que pertenece a una
// votación.
//
// Sin dependencias de Express ni de MySQL: solo define la forma de
// los datos y las reglas de validación de los endpoints de votación.
//
// Reglas de negocio que aquí se fijan:
//   · `opens_at`/`closes_at` aceptan `YYYY-MM-DD HH:mm:ss`, la
//     variante con `T` y marcas de zona; se normalizan a UTC
//     (`YYYY-MM-DD HH:mm:ss`) porque la API trabaja en UTC.
//   · El par `opens_at`/`closes_at` llega junto o no llega: la
//     ventana no se puede dejar a medias (el CHECK
//     `chk_votes_window` de la base de datos lo exige).
//   · `title` 1-200 caracteres (columna `VARCHAR(200)`).
//   · `description` es `TEXT`: máximo 65535 caracteres declarados,
//     con el límite de bytes de MySQL como red final.
//   · `status` no se acepta en el cuerpo de creación/edición: cambia
//     solo por `PATCH /votes/:voteId/status` (anti mass-assignment).
//   · Un cuerpo sin campos no admitido devuelve 400 en el servicio.
//
// Los identificadores en el cuerpo de la petición van en
// `snake_case`: `opens_at`, `vote_option`.
// =============================================================

import { isVoteOption, isVoteStatus } from "../enums/State.js";
import { normalizeDateTime } from "../utils/datetime.js";

/** Longitudes máximas de las columnas del bloque votaciones. */
const MAX_LENGTHS = Object.freeze({
  title: 200,
  text: 65535,
});

/**
 * -----------------------------------------------------------------
 * Constante: VOTE_SORT_FIELDS
 * Propósito: lista blanca de ordenación del listado de votaciones.
 * Son nombres de columna reales, por lo que el servicio los pasa
 * tal cual al repositorio.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const VOTE_SORT_FIELDS = Object.freeze(["created_at", "title", "status"]);

/**
 * -----------------------------------------------------------------
 * Constante: VOTE_CREATE_FIELDS
 * Propósito: campos de `POST /meetings/:meetingId/votes`. `status`
 * no está: toda votación nace en `DRAFT`.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const VOTE_CREATE_FIELDS = Object.freeze([
  "title",
  "description",
  "opens_at",
  "closes_at",
]);

/**
 * -----------------------------------------------------------------
 * Constante: VOTE_UPDATABLE_FIELDS
 * Propósito: campos de `PATCH /votes/:voteId` (solo en `DRAFT`).
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const VOTE_UPDATABLE_FIELDS = Object.freeze([
  "title",
  "description",
  "opens_at",
  "closes_at",
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

/**
 * -----------------------------------------------------------------
 * Función: validateOptionalText
 * Propósito: validar un campo de texto opcional de tipo `TEXT`.
 * @param {unknown} value - Valor recibido.
 * @param {string} label - Nombre visible para el mensaje.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateOptionalText(value, label, errors) {
  if (value === undefined || value === null || value === "") return;

  if (typeof value !== "string") {
    errors.push(`El campo "${label}" debe ser texto.`);
  } else if (value.length > MAX_LENGTHS.text) {
    errors.push(`El campo "${label}" no puede superar los ${MAX_LENGTHS.text} caracteres.`);
  }
}

/**
 * -----------------------------------------------------------------
 * Función: validateTitle
 * Propósito: validar el título de la votación.
 * @param {unknown} value - Título recibido.
 * @param {string} label - Nombre visible para el mensaje.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateTitle(value, label, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`El ${label} es obligatorio.`);
  } else if (value.trim().length > MAX_LENGTHS.title) {
    errors.push(`El ${label} no puede superar los ${MAX_LENGTHS.title} caracteres.`);
  }
}

/**
 * -----------------------------------------------------------------
 * Función: validateDateTimePair
 * Propósito: validar que `opens_at` y `closes_at` lleguen juntos y
 * en orden. Se usa en la creación: si ninguno llega no se queja,
 * porque el par puede quedar pendiente hasta abrir la votación.
 * @param {object} body - Cuerpo ya comprobado.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateDateTimePair(body, errors) {
  const hasOpens = body.opens_at !== undefined;
  const hasCloses = body.closes_at !== undefined;

  if (hasOpens !== hasCloses) {
    errors.push("opens_at y closes_at deben indicarse juntos.");
    return;
  }
  if (!hasOpens && !hasCloses) return;

  if (body.opens_at !== null && body.opens_at !== "" && normalizeDateTime(body.opens_at) === null) {
    errors.push("opens_at no tiene un formato válido (YYYY-MM-DD HH:mm:ss).");
  }
  if (body.closes_at !== null && body.closes_at !== "" && normalizeDateTime(body.closes_at) === null) {
    errors.push("closes_at no tiene un formato válido (YYYY-MM-DD HH:mm:ss).");
  }

  const opensAt = normalizeDateTime(body.opens_at);
  const closesAt = normalizeDateTime(body.closes_at);
  if (opensAt !== null && closesAt !== null && !(opensAt < closesAt)) {
    errors.push("opens_at debe ser anterior a closes_at.");
  }
}

/**
 * -----------------------------------------------------------------
 * Función: validateDateTimeFields
 * Propósito: validar solo los campos de ventana presentes en un
 * `PATCH`. El orden definitivo se comprueba en el servicio contra la
 * fila guardada (CHECK `chk_votes_window` de la base de datos).
 * @param {object} body - Cuerpo ya comprobado.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateDateTimeFields(body, errors) {
  for (const field of ["opens_at", "closes_at"]) {
    const value = body[field];
    if (value === undefined || value === null || value === "") continue;
    if (normalizeDateTime(value) === null) {
      errors.push(`${field} no tiene un formato válido (YYYY-MM-DD HH:mm:ss).`);
    }
  }
}

export class VoteModel {
  /**
   * -----------------------------------------------------------------
   * Función: validateVoteCreate
   * Propósito: validar `POST /meetings/:meetingId/votes`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateVoteCreate(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, VOTE_CREATE_FIELDS, errors);

    validateTitle(body.title, "título", errors);
    validateOptionalText(body.description, "descripción", errors);
    validateDateTimePair(body, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateVoteUpdate
   * Propósito: validar `PATCH /votes/:voteId` (solo en `DRAFT`).
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateVoteUpdate(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, VOTE_UPDATABLE_FIELDS, errors);

    const present = VOTE_UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (present.length === 0) {
      errors.push("Debe indicar al menos un campo a actualizar.");
      return errors;
    }

    if (body.title !== undefined) {
      validateTitle(body.title, "título", errors);
    }

    validateOptionalText(body.description, "descripción", errors);
    validateDateTimeFields(body, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateVoteStatusChange
   * Propósito: validar `PATCH /votes/:voteId/status`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateVoteStatusChange(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, ["status"], errors);

    if (!isVoteStatus(body.status)) {
      errors.push("El estado de la votación debe ser DRAFT, OPEN o CLOSED.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateVoteResponse
   * Propósito: validar `POST /votes/:voteId/responses`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateVoteResponse(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, ["vote_option"], errors);

    if (!isVoteOption(body.vote_option)) {
      errors.push("La opción de voto debe ser AGREE, DISAGREE o NULL.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: toSafeVote
   * Propósito: forma de respuesta de una votación.
   * @param {object} row - Fila de `votes`.
   * @returns {object} Votación segura.
   * -----------------------------------------------------------------
   */
  static toSafeVote(row) {
    if (!row) return null;

    return {
      id_vote: Number(row.id_vote),
      id_meeting: Number(row.id_meeting),
      created_by: Number(row.created_by),
      title: row.title,
      description: row.description ?? null,
      status: row.status,
      opens_at: row.opens_at ?? null,
      closes_at: row.closes_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * -----------------------------------------------------------------
   * Función: toSafeResponse
   * Propósito: forma de respuesta de un voto emitido.
   * @param {object} row - Fila de `vote_responses`.
   * @returns {object} Respuesta segura.
   * -----------------------------------------------------------------
   */
  static toSafeResponse(row) {
    if (!row) return null;

    return {
      id_vote: Number(row.id_vote),
      id_user: Number(row.id_user),
      vote_option: row.vote_option,
      created_at: row.created_at,
    };
  }
}

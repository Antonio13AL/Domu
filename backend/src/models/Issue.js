// =============================================================
// Modelo de incidencia
// =============================================================
//
// Sin dependencias de Express ni de MySQL: solo define la forma de
// los datos y las reglas de validación de los endpoints de
// incidencias.
//
// Reglas de negocio que aquí se fijan:
//   · `title` obligatorio, 1-200 caracteres (columna
//     `issues.title VARCHAR(200)`).
//   · `description` obligatoria, 1-5000 caracteres (columna
//     `issues.description TEXT`).
//   · `category` opcional y anulable, contra `IssueCategory`.
//   · `priority` opcional (por defecto `MEDIUM`), contra
//     `IssuePriority`.
//   · `status` solo en `PATCH /issues/:issueId/status`, contra
//     `IssueStatus` y la máquina de transiciones
//     `ISSUE_TRANSITIONS`.
//   · Ninguna operación admite campos fuera de la lista blanca
//     (anti mass-assignment): `id_user`, `id_community`,
//     `resolved_at` y el propio `status` los decide el servidor.
// =============================================================

import {
  isIssueCategory,
  isIssuePriority,
  isIssueStatus,
  ISSUE_CATEGORY_VALUES,
  ISSUE_PRIORITY_VALUES,
  ISSUE_STATUS_VALUES,
} from "../enums/State.js";

/** Longitudes máximas de las columnas de texto de `issues`. */
const MAX_LENGTHS = Object.freeze({
  title: 200,
  description: 5000,
});

/**
 * -----------------------------------------------------------------
 * Constante: ISSUE_SORT_FIELDS
 * Propósito: lista blanca de ordenación del listado de incidencias
 * (`parseSort` la exige como array).
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const ISSUE_SORT_FIELDS = Object.freeze([
  "created_at",
  "updated_at",
  "title",
  "priority",
  "status",
]);

/**
 * -----------------------------------------------------------------
 * Constante: ISSUE_WRITABLE_FIELDS
 * Propósito: campos que el alta y la edición admiten. Todo lo
 * demás (`status`, `id_user`, `resolved_at`…) se rechaza con
 * 400 para evitar mass-assignment.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const ISSUE_WRITABLE_FIELDS = Object.freeze([
  "title",
  "description",
  "category",
  "priority",
]);

/**
 * -----------------------------------------------------------------
 * Constante: ISSUE_TRANSITIONS
 * Propósito: máquina de transiciones de estado.
 *   PENDING     → IN_PROGRESS | REJECTED
 *   IN_PROGRESS → RESOLVED | REJECTED
 *   RESOLVED y REJECTED son estados finales.
 * @type {Readonly<Record<string, readonly string[]>>}
 * -----------------------------------------------------------------
 */
export const ISSUE_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(["IN_PROGRESS", "REJECTED"]),
  IN_PROGRESS: Object.freeze(["RESOLVED", "REJECTED"]),
  RESOLVED: Object.freeze([]),
  REJECTED: Object.freeze([]),
});

/** ¿Es un objeto plano (no un array, no `null`)? */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valida `title` (obligatorio y con longitud máxima).
 * @param {unknown} raw - Valor recibido.
 * @param {string[]} errors - Acumulador de errores.
 */
function validateTitle(raw, errors) {
  if (typeof raw !== "string" || raw.trim() === "") {
    errors.push("El título es obligatorio.");
    return;
  }
  if (raw.trim().length > MAX_LENGTHS.title) {
    errors.push(`El título no puede superar los ${MAX_LENGTHS.title} caracteres.`);
  }
}

/**
 * Valida `description` (obligatoria y con longitud máxima).
 * @param {unknown} raw - Valor recibido.
 * @param {string[]} errors - Acumulador de errores.
 */
function validateDescription(raw, errors) {
  if (typeof raw !== "string" || raw.trim() === "") {
    errors.push("La descripción es obligatoria.");
    return;
  }
  if (raw.trim().length > MAX_LENGTHS.description) {
    errors.push(`La descripción no puede superar los ${MAX_LENGTHS.description} caracteres.`);
  }
}

/**
 * Valida `category` (opcional y anulable).
 * @param {unknown} raw - Valor recibido.
 * @param {string[]} errors - Acumulador de errores.
 */
function validateCategory(raw, errors) {
  if (raw === undefined || raw === null) return;
  if (!isIssueCategory(raw)) {
    errors.push(`La categoría debe ser una de: ${ISSUE_CATEGORY_VALUES.join(", ")}.`);
  }
}

/**
 * Valida `priority` (opcional; el alta aplica `MEDIUM`).
 * @param {unknown} raw - Valor recibido.
 * @param {string[]} errors - Acumulador de errores.
 */
function validatePriority(raw, errors) {
  if (raw === undefined) return;
  if (!isIssuePriority(raw)) {
    errors.push(`La prioridad debe ser una de: ${ISSUE_PRIORITY_VALUES.join(", ")}.`);
  }
}

export class IssueModel {
  /**
   * -----------------------------------------------------------------
   * Método: validateCreate
   * Propósito: validar el cuerpo de
   * `POST /communities/:communityId/issues`.
   * @param {unknown} data - `req.body`.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateCreate(data) {
    const body = isPlainObject(data) ? data : {};
    const errors = [];

    for (const key of Object.keys(body)) {
      if (body[key] === undefined) continue;
      if (!ISSUE_WRITABLE_FIELDS.includes(key)) {
        errors.push(`El campo "${key}" no está permitido.`);
      }
    }

    validateTitle(body.title, errors);
    validateDescription(body.description, errors);
    validateCategory(body.category, errors);
    validatePriority(body.priority, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Método: validateUpdate
   * Propósito: validar el cuerpo de `PATCH /issues/:issueId`.
   *   · Al menos un campo de la lista blanca.
   *   · `status` no es editable por este endpoint (va en
   *     `PATCH /issues/:issueId/status`).
   * @param {unknown} data - `req.body`.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateUpdate(data) {
    const body = isPlainObject(data) ? data : {};
    const present = Object.keys(body).filter((key) => body[key] !== undefined);

    if (present.length === 0) {
      return ["Debe indicar al menos un campo para actualizar."];
    }

    const errors = [];

    for (const key of present) {
      if (!ISSUE_WRITABLE_FIELDS.includes(key)) {
        errors.push(`El campo "${key}" no está permitido.`);
      }
    }

    if (present.includes("title")) validateTitle(body.title, errors);
    if (present.includes("description")) validateDescription(body.description, errors);
    if (present.includes("category")) validateCategory(body.category, errors);
    if (present.includes("priority")) validatePriority(body.priority, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Método: validateStatusChange
   * Propósito: validar el cuerpo de
   * `PATCH /issues/:issueId/status`. Solo admite `status`; la
   * transición en sí se comprueba en el servicio con el estado
   * actual de la incidencia.
   * @param {unknown} data - `req.body`.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateStatusChange(data) {
    const body = isPlainObject(data) ? data : {};
    const present = Object.keys(body).filter((key) => body[key] !== undefined);
    const errors = [];

    if (present.length === 0) {
      errors.push("Debe indicar el estado nuevo.");
    }

    for (const key of present) {
      if (key !== "status") {
        errors.push(`El campo "${key}" no está permitido.`);
      }
    }

    if (body.status !== undefined && !isIssueStatus(body.status)) {
      errors.push(`El estado debe ser uno de: ${ISSUE_STATUS_VALUES.join(", ")}.`);
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Método: toSafeIssue
   * Propósito: proyectar la fila de `issues` a la forma que sale
   * por la API. No hay secretos en este dominio, pero la proyección
   * explícita evita que una columna nueva se filtre sin querer.
   * @param {null | object} row - Fila de la base de datos.
   * @returns {null | object} Incidencia en `snake_case`.
   * -----------------------------------------------------------------
   */
  static toSafeIssue(row) {
    if (!row) return null;

    return {
      id_issue: row.id_issue,
      id_community: row.id_community,
      id_user: row.id_user,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      status: row.status,
      resolved_at: row.resolved_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

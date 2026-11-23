// =============================================================
// Modelo de reuniones y asistencia — validación de entrada.
// =============================================================
//
// Dominio propio: `meetings` y `meeting_attendees`. Las
// votaciones se validan en `Vote.js`; aquí solo vive lo que
// pertenece a una reunión.
//
// Sin dependencias de Express ni de MySQL: solo define la forma de
// los datos y las reglas de validación de los endpoints de BE-10
// que no son de votación.
//
// Reglas de negocio que aquí se fijan:
//   · `date` con formato `YYYY-MM-DD` y fecha de calendario real.
//   · `start_time`/`end_time` aceptan `HH:mm` o `HH:mm:ss` y se
//     normalizan a `HH:mm:ss` (columnas `TIME`).
//   · `title` 1-200 caracteres (columna `VARCHAR(200)`).
//   · `agenda` y `minutes` son `TEXT`: máximo 65535 caracteres
//     declarados, con el límite de bytes de MySQL como red final.
//   · `state` de la reunión no se acepta en el cuerpo de
//     creación/edición: cambia solo por `PATCH
//     /meetings/:meetingId/status` (anti mass-assignment).
//   · Un cuerpo sin campos no admitido devuelve 400 en el servicio.
//
// La normalización de fechas y horas vive en `utils/datetime.js`,
// que comparten los modelos de reuniones y de votaciones.
// =============================================================

import { AttendanceStatus, isMeetingStatus } from "../enums/State.js";
import { formatDate, formatTime, normalizeDate, normalizeTime } from "../utils/datetime.js";

/** Longitudes máximas de las columnas del bloque reuniones. */
const MAX_LENGTHS = Object.freeze({
  title: 200,
  text: 65535,
});

/**
 * -----------------------------------------------------------------
 * Constante: MEETING_SORT_FIELDS
 * Propósito: lista blanca de ordenación del listado de reuniones.
 * Son nombres de columna reales, por lo que el servicio los pasa
 * tal cual al repositorio.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const MEETING_SORT_FIELDS = Object.freeze(["date", "created_at", "title", "state"]);

/**
 * -----------------------------------------------------------------
 * Constante: MEETING_CREATE_FIELDS
 * Propósito: campos que `POST /communities/:communityId/meetings`
 * acepta recibir. `minutes` no está: el acta se redacta después,
 * con `PATCH /meetings/:meetingId`.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const MEETING_CREATE_FIELDS = Object.freeze([
  "date",
  "start_time",
  "end_time",
  "title",
  "agenda",
]);

/**
 * -----------------------------------------------------------------
 * Constante: MEETING_UPDATABLE_FIELDS
 * Propósito: campos que `PATCH /meetings/:meetingId` admite.
 * `state` no está: se cambia por `PATCH /meetings/:meetingId/status`
 * y `id_community` es inmutable.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const MEETING_UPDATABLE_FIELDS = Object.freeze([
  "date",
  "start_time",
  "end_time",
  "title",
  "agenda",
  "minutes",
]);

/**
 * -----------------------------------------------------------------
 * Constante: ATTENDANCE_CONFIRMATION_VALUES
 * Propósito: estados que `PUT /meetings/:meetingId/attendance`
 * admite. `PENDING` queda fuera: es el estado por defecto de una
 * asistencia sin confirmar, no una confirmación.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const ATTENDANCE_CONFIRMATION_VALUES = Object.freeze([
  AttendanceStatus.ATTENDED,
  AttendanceStatus.ABSENT,
  AttendanceStatus.EXCUSED,
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
 * Propósito: validar el título de la reunión.
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

export class MeetingModel {
  /**
   * -----------------------------------------------------------------
   * Función: validateMeetingCreate
   * Propósito: validar `POST /communities/:communityId/meetings`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateMeetingCreate(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, MEETING_CREATE_FIELDS, errors);

    if (normalizeDate(body.date) === null) {
      errors.push("La fecha debe ser una fecha válida con formato YYYY-MM-DD.");
    }

    const startTime = normalizeTime(body.start_time);
    const endTime = normalizeTime(body.end_time);

    if (startTime === null) {
      errors.push("La hora de inicio debe tener formato HH:mm o HH:mm:ss.");
    }
    if (endTime === null) {
      errors.push("La hora de finalización debe tener formato HH:mm o HH:mm:ss.");
    }
    if (startTime !== null && endTime !== null && !(startTime < endTime)) {
      errors.push("La hora de finalización debe ser posterior a la de inicio.");
    }

    validateTitle(body.title, "título", errors);
    validateOptionalText(body.agenda, "agenda", errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateMeetingUpdate
   * Propósito: validar `PATCH /meetings/:meetingId`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateMeetingUpdate(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, MEETING_UPDATABLE_FIELDS, errors);

    const present = MEETING_UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (present.length === 0) {
      errors.push("Debe indicar al menos un campo a actualizar.");
      return errors;
    }

    if (body.date !== undefined && normalizeDate(body.date) === null) {
      errors.push("La fecha debe ser una fecha válida con formato YYYY-MM-DD.");
    }

    if (body.start_time !== undefined) {
      if (normalizeTime(body.start_time) === null) {
        errors.push("La hora de inicio debe tener formato HH:mm o HH:mm:ss.");
      }
    }
    if (body.end_time !== undefined) {
      if (normalizeTime(body.end_time) === null) {
        errors.push("La hora de finalización debe tener formato HH:mm o HH:mm:ss.");
      }
    }

    // El par de horas se valida aquí solo si llega completo; si no,
    // el servicio lo comprueba contra la fila guardada (CHECK
    // `chk_meetings_time` de la base de datos).
    if (body.start_time !== undefined && body.end_time !== undefined) {
      const startTime = normalizeTime(body.start_time);
      const endTime = normalizeTime(body.end_time);
      if (startTime !== null && endTime !== null && !(startTime < endTime)) {
        errors.push("La hora de finalización debe ser posterior a la de inicio.");
      }
    }

    if (body.title !== undefined) {
      validateTitle(body.title, "título", errors);
    }

    validateOptionalText(body.agenda, "agenda", errors);
    validateOptionalText(body.minutes, "acta", errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateMeetingStatusChange
   * Propósito: validar `PATCH /meetings/:meetingId/status`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateMeetingStatusChange(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, ["state"], errors);

    if (!isMeetingStatus(body.state)) {
      errors.push("El estado debe ser SCHEDULED, IN_PROGRESS, CLOSED o CANCELLED.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateAttendanceConfirmation
   * Propósito: validar `PUT /meetings/:meetingId/attendance`.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateAttendanceConfirmation(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, ["attendance_status"], errors);

    if (!ATTENDANCE_CONFIRMATION_VALUES.includes(body.attendance_status)) {
      errors.push("El estado de asistencia debe ser ATTENDED, ABSENT o EXCUSED.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: toSafeMeeting
   * Propósito: forma de respuesta de una reunión. No expone nada
   * que no esté en la tabla; `minutes` (acta) sí se devuelve porque
   * el detalle es para miembros y presidentes de la comunidad.
   * @param {object} row - Fila de `meetings`.
   * @returns {object} Reunión segura.
   * -----------------------------------------------------------------
   */
  static toSafeMeeting(row) {
    if (!row) return null;

    return {
      id_meeting: Number(row.id_meeting),
      id_community: Number(row.id_community),
      date: formatDate(row.date),
      start_time: formatTime(row.start_time),
      end_time: formatTime(row.end_time),
      title: row.title,
      agenda: row.agenda ?? null,
      minutes: row.minutes ?? null,
      state: row.state,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * -----------------------------------------------------------------
   * Función: toSafeAttendance
   * Propósito: forma de respuesta de una asistencia.
   * @param {object} row - Fila de `meeting_attendees`.
   * @returns {object} Asistencia segura.
   * -----------------------------------------------------------------
   */
  static toSafeAttendance(row) {
    if (!row) return null;

    return {
      id_meeting: Number(row.id_meeting),
      id_user: Number(row.id_user),
      attendance_status: row.attendance_status,
      confirmed_at: row.confirmed_at ?? null,
      name: row.name ?? null,
      surname: row.surname ?? null,
      housing: row.housing ?? null,
    };
  }
}

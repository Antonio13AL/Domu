// =============================================================
// Modelo de reservas de espacios comunes — validación de entrada.
// =============================================================
//
// Dominio propio: `bookings`. Vive solo la forma de los datos y
// las reglas de validación de los endpoints de reserva; sin
// dependencias de Express ni de MySQL (el bloqueo de solapamiento
// con `SELECT ... FOR UPDATE` es responsabilidad del repositorio
// y del servicio).
//
// Reglas de negocio que aquí se fijan:
//   · `space_name` 1-100 caracteres (columna `VARCHAR(100)`):
//     identifica el espacio y es la clave de solapamiento junto
//     con `booking_date`.
//   · `booking_date` con formato `YYYY-MM-DD` y fecha de
//     calendario real; sin fechas pasadas y sin más de 30 días
//     de antelación.
//   · `start_time`/`end_time` aceptan `HH:mm` o `HH:mm:ss` y se
//     normalizan a `HH:mm:ss` (columnas `TIME`).
//   · `start_time < end_time` y duración entre 30 minutos y
//     4 horas (el CHECK `chk_bookings_time` de la base de datos
//     solo garantiza el primer punto, la duración la fija aquí).
//   · `status` no se acepta en el cuerpo de creación ni en el de
//     edición: nace en `PENDING` y solo cambia por `PATCH
//     /bookings/:bookingId/status` (anti mass-assignment).
//   · `id_community`, `id_user`, `reviewed_by` y `reviewed_at`
//     son de servidor: nunca forman parte del cuerpo.
//
// La normalización de fechas y horas vive en `utils/datetime.js`,
// compartida con reuniones y votaciones.
// =============================================================

import { isBookingStatus } from "../enums/State.js";
import { formatDate, formatTime, normalizeDate, normalizeTime } from "../utils/datetime.js";

/** Longitudes máximas de las columnas del bloque reservas. */
const MAX_LENGTHS = Object.freeze({
  space_name: 100,
  text: 65535,
});

/**
 * -----------------------------------------------------------------
 * Constantes: límites temporales de una reserva
 * Propósito: fijar en el modelo los umbrales de negocio (duración
 * mínima y máxima, antelación máxima) para que servicio y tests
 * los compartan sin duplicar literales.
 * -----------------------------------------------------------------
 */
export const BOOKING_MIN_DURATION_MINUTES = Object.freeze({ value: 30 });
export const BOOKING_MAX_DURATION_MINUTES = Object.freeze({ value: 240 });
export const BOOKING_MAX_ADVANCE_DAYS = Object.freeze({ value: 30 });

/**
 * -----------------------------------------------------------------
 * Constante: BOOKING_CREATE_FIELDS
 * Propósito: campos que `POST /communities/:communityId/bookings`
 * acepta recibir. Los identificadores y el estado son de servidor.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const BOOKING_CREATE_FIELDS = Object.freeze([
  "space_name",
  "booking_date",
  "start_time",
  "end_time",
  "notes",
]);

/**
 * -----------------------------------------------------------------
 * Constante: BOOKING_UPDATABLE_FIELDS
 * Propósito: campos que `PATCH /bookings/:bookingId` admite mientras
 * la reserva sigue en `PENDING`.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const BOOKING_UPDATABLE_FIELDS = Object.freeze([
  "space_name",
  "booking_date",
  "start_time",
  "end_time",
  "notes",
]);

/**
 * -----------------------------------------------------------------
 * Constante: BOOKING_STATUS_CHANGE_VALUES
 * Propósito: estados que `PATCH /bookings/:bookingId/status` admite.
 * `PENDING` queda fuera: es el estado inicial, no una resolución.
 * @type {Readonly<string[]>}
 * -----------------------------------------------------------------
 */
export const BOOKING_STATUS_CHANGE_VALUES = Object.freeze([
  "CONFIRMED",
  "CANCELLED",
  "REJECTED",
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
 * Propósito: acumular en `errors` los campos no permitidos
 * (defensa de mass assignment en el origen de los datos).
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
 * Función: toUtcDateString
 * Propósito: convertir un `Date` a `YYYY-MM-DD` en UTC, que es la
 * referencia con la que la API compara `booking_date`.
 * @param {Date} date - Fecha a convertir.
 * @returns {string} Fecha en texto.
 * -----------------------------------------------------------------
 */
function toUtcDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * -----------------------------------------------------------------
 * Función: addUtcDays
 * Propósito: desplazar una fecha `YYYY-MM-DD` en días, para el
 * límite de antelación de 30 días.
 * @param {string} dateString - Fecha base.
 * @param {number} days - Días a sumar (puede ser negativo).
 * @returns {string} Fecha desplazada en `YYYY-MM-DD`.
 * -----------------------------------------------------------------
 */
function addUtcDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toUtcDateString(shifted);
}

/**
 * -----------------------------------------------------------------
 * Función: todayUtc
 * Propósito: fecha actual de referencia (`YYYY-MM-DD`, UTC). Es
 * parámetro opcional de los validadores para que los tests puedan
 * fijarla sin manipular el reloj del sistema.
 * @param {unknown} referenceDate - Fecha de referencia opcional.
 * @returns {string} Fecha de hoy.
 * -----------------------------------------------------------------
 */
function todayUtc(referenceDate) {
  if (referenceDate instanceof Date) return toUtcDateString(referenceDate);
  if (typeof referenceDate === "string") {
    const normalized = normalizeDate(referenceDate);
    if (normalized !== null) return normalized;
  }
  return toUtcDateString(new Date());
}

/**
 * -----------------------------------------------------------------
 * Función: durationInMinutes
 * Propósito: duración en minutos entre dos horas normalizadas
 * `HH:mm:ss`. Devuelve `null` si alguna no es válida.
 * @param {string} startTime - Hora de inicio normalizada.
 * @param {string} endTime - Hora de fin normalizada.
 * @returns {null | number} Duración en minutos o `null`.
 * -----------------------------------------------------------------
 */
function durationInMinutes(startTime, endTime) {
  const toMinutes = (time) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return toMinutes(endTime) - toMinutes(startTime);
}

/**
 * -----------------------------------------------------------------
 * Función: validateSpaceName
 * Propósito: validar el espacio reservado (`VARCHAR(100)`).
 * @param {unknown} value - Valor recibido.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateSpaceName(value, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push("El espacio a reservar es obligatorio.");
  } else if (value.trim().length > MAX_LENGTHS.space_name) {
    errors.push(`El espacio a reservar no puede superar los ${MAX_LENGTHS.space_name} caracteres.`);
  }
}

/**
 * -----------------------------------------------------------------
 * Función: validateOptionalNotes
 * Propósito: validar las notas opcionales de tipo `TEXT`.
 * @param {unknown} value - Valor recibido.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateOptionalNotes(value, errors) {
  if (value === undefined || value === null || value === "") return;

  if (typeof value !== "string") {
    errors.push("Las notas deben ser texto.");
  } else if (value.length > MAX_LENGTHS.text) {
    errors.push(`Las notas no pueden superar los ${MAX_LENGTHS.text} caracteres.`);
  }
}

/**
 * -----------------------------------------------------------------
 * Función: validateDateWindow
 * Propósito: aplicar las reglas de ventana de la reserva: sin
 * fechas pasadas y con un máximo de 30 días de antelación.
 * @param {string} bookingDate - Fecha ya normalizada.
 * @param {string} today - Fecha de referencia `YYYY-MM-DD`.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateDateWindow(bookingDate, today, errors) {
  if (bookingDate < today) {
    errors.push("La fecha de reserva no puede ser anterior a hoy.");
  }
  const limit = addUtcDays(today, BOOKING_MAX_ADVANCE_DAYS.value);
  if (bookingDate > limit) {
    errors.push(`La fecha de reserva no puede superar los ${BOOKING_MAX_ADVANCE_DAYS.value} días de antelación.`);
  }
}

/**
 * -----------------------------------------------------------------
 * Función: validateTimeRange
 * Propósito: validar el par de horas, el orden `start < end` y la
 * duración admitida (30 minutos a 4 horas).
 * @param {unknown} startValue - Hora de inicio recibida.
 * @param {unknown} endValue - Hora de fin recibida.
 * @param {string[]} errors - Acumulador de errores.
 * @returns {void}
 * -----------------------------------------------------------------
 */
function validateTimeRange(startValue, endValue, errors) {
  const startTime = normalizeTime(startValue);
  const endTime = normalizeTime(endValue);

  if (startTime === null) {
    errors.push("La hora de inicio debe tener formato HH:mm o HH:mm:ss.");
  }
  if (endTime === null) {
    errors.push("La hora de finalización debe tener formato HH:mm o HH:mm:ss.");
  }
  if (startTime === null || endTime === null) return;

  if (!(startTime < endTime)) {
    errors.push("La hora de finalización debe ser posterior a la de inicio.");
    return;
  }

  const minutes = durationInMinutes(startTime, endTime);
  if (minutes < BOOKING_MIN_DURATION_MINUTES.value) {
    errors.push(`La reserva debe durar al menos ${BOOKING_MIN_DURATION_MINUTES.value} minutos.`);
  } else if (minutes > BOOKING_MAX_DURATION_MINUTES.value) {
    errors.push(`La reserva no puede superar las ${BOOKING_MAX_DURATION_MINUTES.value} minutos (4 horas).`);
  }
}

export class BookingModel {
  /**
   * -----------------------------------------------------------------
   * Función: validateBookingCreate
   * Propósito: validar `POST /communities/:communityId/bookings`.
   * @param {object} data - Cuerpo de la petición.
   * @param {string | Date} [referenceDate] - Fecha de referencia
   * (por defecto, hoy en UTC); existe para los tests.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateBookingCreate(data, referenceDate) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, BOOKING_CREATE_FIELDS, errors);

    validateSpaceName(body.space_name, errors);

    const bookingDate = normalizeDate(body.booking_date);
    if (bookingDate === null) {
      errors.push("La fecha de reserva debe ser una fecha válida con formato YYYY-MM-DD.");
    } else {
      validateDateWindow(bookingDate, todayUtc(referenceDate), errors);
    }

    validateTimeRange(body.start_time, body.end_time, errors);
    validateOptionalNotes(body.notes, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateBookingUpdate
   * Propósito: validar `PATCH /bookings/:bookingId` (edición mientras
   * la reserva está en `PENDING`).
   * @param {object} data - Cuerpo de la petición.
   * @param {string | Date} [referenceDate] - Fecha de referencia
   * opcional, igual que en la creación.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateBookingUpdate(data, referenceDate) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, BOOKING_UPDATABLE_FIELDS, errors);

    const present = BOOKING_UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (present.length === 0) {
      errors.push("Debe indicar al menos un campo a actualizar.");
      return errors;
    }

    if (body.space_name !== undefined) {
      validateSpaceName(body.space_name, errors);
    }

    if (body.booking_date !== undefined) {
      const bookingDate = normalizeDate(body.booking_date);
      if (bookingDate === null) {
        errors.push("La fecha de reserva debe ser una fecha válida con formato YYYY-MM-DD.");
      } else {
        validateDateWindow(bookingDate, todayUtc(referenceDate), errors);
      }
    }

    // El par de horas se valida aquí solo si llega completo; si no,
    // el servicio lo comprueba contra la fila guardada (CHECK
    // `chk_bookings_time` de la base de datos).
    if (body.start_time !== undefined && body.end_time !== undefined) {
      validateTimeRange(body.start_time, body.end_time, errors);
    } else if (body.start_time !== undefined && normalizeTime(body.start_time) === null) {
      errors.push("La hora de inicio debe tener formato HH:mm o HH:mm:ss.");
    } else if (body.end_time !== undefined && normalizeTime(body.end_time) === null) {
      errors.push("La hora de finalización debe tener formato HH:mm o HH:mm:ss.");
    }

    validateOptionalNotes(body.notes, errors);

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: validateBookingStatusChange
   * Propósito: validar `PATCH /bookings/:bookingId/status`. Solo
   * resoluciones (`CONFIRMED`, `CANCELLED`, `REJECTED`): el estado
   * `PENDING` no se impone desde el cuerpo.
   * @param {object} data - Cuerpo de la petición.
   * @returns {string[]} Errores en español (vacío si es válido).
   * -----------------------------------------------------------------
   */
  static validateBookingStatusChange(data) {
    const errors = [];
    const body = isPlainObject(data) ? data : {};

    pushUnknownFields(body, ["status"], errors);

    if (!isBookingStatus(body.status) || !BOOKING_STATUS_CHANGE_VALUES.includes(body.status)) {
      errors.push("El estado debe ser CONFIRMED, CANCELLED o REJECTED.");
    }

    return errors;
  }

  /**
   * -----------------------------------------------------------------
   * Función: toSafeBooking
   * Propósito: forma de respuesta de una reserva. No expone nada que
   * no esté en la tabla `bookings`; `reviewed_by` se devuelve como
   * identificador numérico o `null`.
   * @param {object} row - Fila de `bookings`.
   * @returns {object} Reserva segura.
   * -----------------------------------------------------------------
   */
  static toSafeBooking(row) {
    if (!row) return null;

    return {
      id_booking: Number(row.id_booking),
      id_community: Number(row.id_community),
      id_user: Number(row.id_user),
      space_name: row.space_name,
      booking_date: formatDate(row.booking_date),
      start_time: formatTime(row.start_time),
      end_time: formatTime(row.end_time),
      status: row.status,
      notes: row.notes ?? null,
      reviewed_by: row.reviewed_by === null || row.reviewed_by === undefined ? null : Number(row.reviewed_by),
      reviewed_at: row.reviewed_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

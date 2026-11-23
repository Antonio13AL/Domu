// =============================================================
// Normalización de fechas y horas — utilidad compartida.
// =============================================================
//
// Centraliza la validación y la normalización temporal que usan los
// modelos de reuniones (`models/Meeting.js`) y de votaciones
// (`models/Vote.js`). Son dos dominios con reglas distintas —el
// día y la hora de una junta frente a la ventana `opens_at`/
// `closes_at` de una votación— pero con el mismo formato de entrada
// y de salida, así que no se duplica el código de conversión.
//
// La API trabaja en UTC y MySQL guarda `DATE`, `TIME` y `DATETIME`
// en ese mismo huso:
//
//   · `date`     → `YYYY-MM-DD` (fecha de calendario real).
//   · `time`     → `HH:mm:ss`   (acepta `HH:mm`, que es lo que
//     suelen enviar los formularios).
//   · `datetime` → `YYYY-MM-DD HH:mm:ss`; acepta el separador `T`,
//     fracciones de segundo y marca de zona horaria.
//
// Sin dependencias de Express, MySQL ni de ninguna entidad: es
// lógica pura de la capa de modelos.
// =============================================================

/** Fecha de calendario `YYYY-MM-DD`. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Hora `HH:mm` o `HH:mm:ss`. */
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Fecha y hora con separador ` ` o `T`, segundos y zona opcionales. */
const DATETIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * -----------------------------------------------------------------
 * Función: toUtcString
 * Propósito: convertir un `Date` a `YYYY-MM-DD HH:mm:ss` en UTC, el
 * formato que se guarda en `DATETIME` y el que se compara en la
 * ventana de votación.
 * @param {Date} date - Fecha a convertir.
 * @returns {string} Marca de tiempo normalizada.
 * -----------------------------------------------------------------
 */
export function toUtcString(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * -----------------------------------------------------------------
 * Función: currentTimestamp
 * Propósito: marca de tiempo UTC actual, para `confirmed_at` y para
 * comprobar la ventana `opens_at`–`closes_at`.
 * @returns {string} `YYYY-MM-DD HH:mm:ss` en UTC.
 * -----------------------------------------------------------------
 */
export function currentTimestamp() {
  return toUtcString(new Date());
}

/**
 * -----------------------------------------------------------------
 * Función: isValidCalendarDate
 * Propósito: comprobar que `YYYY-MM-DD` es una fecha real (rechaza
 * `2026-02-30`) mediante ida y vuelta por `Date.UTC`.
 * @param {string} text - Fecha candidata.
 * @returns {boolean} `true` si es una fecha válida.
 * -----------------------------------------------------------------
 */
export function isValidCalendarDate(text) {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;

  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * -----------------------------------------------------------------
 * Función: normalizeDate
 * Propósito: validar y devolver la fecha en `YYYY-MM-DD`.
 * @param {unknown} value - Valor recibido.
 * @returns {null | string} Fecha normalizada o `null` si no vale.
 * -----------------------------------------------------------------
 */
export function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return isValidCalendarDate(text) ? text : null;
}

/**
 * -----------------------------------------------------------------
 * Función: normalizeTime
 * Propósito: validar y devolver la hora en `HH:mm:ss` (acepta
 * `HH:mm` porque los formularios suelen no llevar segundos).
 * @param {unknown} value - Valor recibido.
 * @returns {null | string} Hora normalizada o `null` si no vale.
 * -----------------------------------------------------------------
 */
export function normalizeTime(value) {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return `${match[1]}:${match[2]}:${String(seconds).padStart(2, "0")}`;
}

/**
 * -----------------------------------------------------------------
 * Función: normalizeDateTime
 * Propósito: validar y normalizar una fecha y hora a UTC en
 * `YYYY-MM-DD HH:mm:ss`. Si el valor trae zona horaria se convierte;
 * si viene «desnudo» se interpreta como hora UTC (la API trabaja en
 * UTC), de modo que el resultado es determinista.
 * @param {unknown} value - Valor recibido.
 * @returns {null | string} Fecha y hora normalizada o `null`.
 * -----------------------------------------------------------------
 */
export function normalizeDateTime(value) {
  if (typeof value !== "string") return null;
  const match = DATETIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, datePart, hours, minutes, secondsRaw, zone] = match;

  if (!isValidCalendarDate(datePart)) return null;

  const seconds = secondsRaw ?? "00";
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;

  // Con zona horaria: se convierte al instante real y se guarda en
  // UTC. Sin zona: los componentes ya son UTC (la API trabaja en
  // UTC), por lo que no se hacen conversiones.
  if (zone !== undefined) {
    const parsed = new Date(value.trim().replace(" ", "T"));
    if (Number.isNaN(parsed.getTime())) return null;
    return toUtcString(parsed);
  }

  return `${datePart} ${hours}:${minutes}:${seconds}`;
}

/**
 * -----------------------------------------------------------------
 * Función: toComparableDateTime
 * Propósito: normalizar un valor leído de la base de datos (Date de
 * mysql2 o cadena) al formato comparable `YYYY-MM-DD HH:mm:ss`.
 * @param {unknown} value - Valor de `opens_at`/`closes_at`.
 * @returns {null | string} Marca normalizada o `null`.
 * -----------------------------------------------------------------
 */
export function toComparableDateTime(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return toUtcString(value);
  return normalizeDateTime(value);
}

/**
 * -----------------------------------------------------------------
 * Función: isValidWindow
 * Propósito: comprobar `opens_at < closes_at` sobre los valores
 * definitivos (cuerpo + fila guardada) antes de escribir.
 * @param {unknown} opensAt - Apertura candidata.
 * @param {unknown} closesAt - Cierre candidato.
 * @returns {boolean} `true` si el par es válido o está incompleto.
 * -----------------------------------------------------------------
 */
export function isValidWindow(opensAt, closesAt) {
  const opens = toComparableDateTime(opensAt);
  const closes = toComparableDateTime(closesAt);
  if (opens === null || closes === null) return true;
  return opens < closes;
}

/**
 * -----------------------------------------------------------------
 * Función: formatDate
 * Propósito: devolver una columna `DATE` como `YYYY-MM-DD` en la
 * respuesta JSON (mysql2 la entrega como objeto `Date`).
 * @param {unknown} value - Valor de la fila.
 * @returns {null | string} Fecha en texto o `null`.
 * -----------------------------------------------------------------
 */
export function formatDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
}

/**
 * -----------------------------------------------------------------
 * Función: formatTime
 * Propósito: devolver una columna `TIME` como `HH:mm:ss`.
 * @param {unknown} value - Valor de la fila.
 * @returns {null | string} Hora en texto o `null`.
 * -----------------------------------------------------------------
 */
export function formatTime(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  if (typeof value === "string") {
    const match = TIME_PATTERN.exec(value.trim());
    if (match) return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
    return value;
  }
  return null;
}

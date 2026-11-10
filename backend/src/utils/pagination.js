// =============================================================
// Paginación, ordenación y búsqueda centralizadas.
// =============================================================
//
// Toda lista de la API valida sus parámetros aquí, en un único
// sitio, para que los controladores solo reciban valores ya
// convertidos y dentro de rango:
//
//   page   ≥ 1 (entero)
//   limit  1–100 (entero)
//   sort   solo campos de la lista blanca del recurso
//   order  asc | desc
//   search máximo 100 caracteres
//
// Los parámetros inválidos lanzan `AppError.validation` (400), en
// lugar de ajustarlos fuera de los rangos permitidos.
// =============================================================

import { AppError } from "./AppError.js";

/**
 * -----------------------------------------------------------------
 * Constante: PAGINATION_LIMITS
 * Propósito: límites por defecto y máximos de la paginación.
 * @type {Readonly<{ defaultLimit: number, maxLimit: number, maxSearchLength: number }>}
 * -----------------------------------------------------------------
 */
export const PAGINATION_LIMITS = Object.freeze({
  defaultLimit: 20,
  maxLimit: 100,
  maxSearchLength: 100,
});

/**
 * -----------------------------------------------------------------
 * Función: parseIntegerParam
 * Propósito: convertir un parámetro de query a entero y validar su
 * rango. Devuelve `fallback` si el parámetro no llega (opcional
 * ausente); lanza `AppError.validation` si llega pero es inválido.
 * @param {unknown} raw - Valor crudo de `req.query`.
 * @param {object} options - Opciones.
 * @param {string} options.name - Nombre del parámetro (para el mensaje).
 * @param {number} options.minimum - Mínimo admitido.
 * @param {number} options.maximum - Máximo admitido (opcional).
 * @param {number | null} options.fallback - Valor si `raw` es `undefined`.
 * @returns {number} Entero válido.
 * -----------------------------------------------------------------
 */
function parseIntegerParam(raw, { name, minimum, maximum = null, fallback }) {
  if (raw === undefined || raw === "") {
    if (fallback === null) {
      throw AppError.validation(`El parámetro "${name}" es obligatorio.`, { field: name });
    }
    return fallback;
  }

  // `String(raw)` permite aceptar números ya convertidos por Express
  // y rechaza "1.5", "1e3", " 1 ", arrays y objetos.
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string") {
    // `qs` convierte `page[]=` o los parámetros repetidos en arrays:
    // se rechazan en lugar de coercerlos silenciosamente.
    throw AppError.validation(`El parámetro "${name}" debe ser un valor único.`, {
      field: name,
      received: Array.isArray(raw) ? "array" : typeof raw,
    });
  }
  if (!/^-?\d+$/.test(text)) {
    throw AppError.validation(`El parámetro "${name}" debe ser un número entero.`, {
      field: name,
      received: text.slice(0, 50),
    });
  }

  const value = Number(text);
  if (value < minimum || (maximum !== null && value > maximum)) {
    const range = maximum === null ? `≥ ${minimum}` : `entre ${minimum} y ${maximum}`;
    throw AppError.validation(`El parámetro "${name}" debe estar ${range}.`, {
      field: name,
      received: value,
    });
  }

  return value;
}

/**
 * -----------------------------------------------------------------
 * Función: parsePagination
 * Propósito: extraer `page` y `limit` ya validados, junto con el
 * `offset` que necesitan las consultas SQL.
 * @param {object} [query] - `req.query`.
 * @param {object} [options] - Opciones.
 * @param {number} [options.defaultLimit] - Límite por defecto.
 * @returns {{ page: number, limit: number, offset: number }}
 * -----------------------------------------------------------------
 */
export function parsePagination(query = {}, { defaultLimit = PAGINATION_LIMITS.defaultLimit } = {}) {
  const page = parseIntegerParam(query.page, {
    name: "page",
    minimum: 1,
    fallback: 1,
  });

  const limit = parseIntegerParam(query.limit, {
    name: "limit",
    minimum: 1,
    maximum: PAGINATION_LIMITS.maxLimit,
    fallback: defaultLimit,
  });

  return { page, limit, offset: (page - 1) * limit };
}

/**
 * -----------------------------------------------------------------
 * Función: parseSort
 * Propósito: extraer `sort` (solo campos de la lista blanca) y
 * `order` (`asc`/`desc`), con valores por defecto.
 * @param {object} [query] - `req.query`.
 * @param {object} options - Opciones.
 * @param {readonly string[]} options.allowed - Campos permitidos.
 * @param {string} [options.defaultField] - Campo por defecto; si no
 * se indica y no llega `sort`, no se ordena (`sort: null`).
 * @param {"asc" | "desc"} [options.defaultOrder] - Orden por defecto.
 * @returns {{ sort: string | null, order: "asc" | "desc" }}
 * -----------------------------------------------------------------
 */
export function parseSort(query = {}, { allowed, defaultField = null, defaultOrder = "asc" } = {}) {
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new TypeError("parseSort requiere una lista blanca de campos.");
  }

  const rawSort = query.sort;
  let sort = defaultField;

  if (rawSort !== undefined && rawSort !== "") {
    if (typeof rawSort !== "string") {
      throw AppError.validation('El parámetro "sort" debe ser un valor único.', {
        field: "sort",
        received: Array.isArray(rawSort) ? "array" : typeof rawSort,
      });
    }
    const field = String(rawSort);
    if (!allowed.includes(field)) {
      throw AppError.validation(`El parámetro "sort" admite únicamente: ${allowed.join(", ")}.`, {
        field: "sort",
        received: field.slice(0, 50),
      });
    }
    sort = field;
  } else if (defaultField === null) {
    sort = null;
  }

  const rawOrder = query.order;
  let order = defaultOrder;

  if (rawOrder !== undefined && rawOrder !== "") {
    if (typeof rawOrder !== "string") {
      throw AppError.validation('El parámetro "order" debe ser un valor único.', {
        field: "order",
        received: Array.isArray(rawOrder) ? "array" : typeof rawOrder,
      });
    }
    const value = String(rawOrder).toLowerCase();
    if (value !== "asc" && value !== "desc") {
      throw AppError.validation('El parámetro "order" solo admite "asc" o "desc".', {
        field: "order",
        received: String(rawOrder).slice(0, 50),
      });
    }
    order = value;
  }

  if (sort === null && rawOrder !== undefined && rawOrder !== "") {
    // Ordenar sin campo definido no tiene sentido: se acepta si el
    // recurso trae `defaultField`, y si no se rechaza.
    throw AppError.validation('El parámetro "order" requiere un campo "sort" válido.', {
      field: "order",
    });
  }

  return { sort, order };
}

/**
 * -----------------------------------------------------------------
 * Función: parseSearch
 * Propósito: extraer y normalizar el texto de búsqueda. Devuelve
 * `null` si no llega o está vacío; recorta espacios y rechaza
 * cadenas de más de 100 caracteres.
 * @param {object} [query] - `req.query`.
 * @param {object} [options] - Opciones.
 * @param {number} [options.maxLength] - Longitud máxima.
 * @returns {string | null} Término normalizado.
 * -----------------------------------------------------------------
 */
export function parseSearch(query = {}, { maxLength = PAGINATION_LIMITS.maxSearchLength } = {}) {
  if (query.search === undefined || query.search === "") {
    return null;
  }

  if (typeof query.search !== "string") {
    throw AppError.validation('El parámetro "search" debe ser un valor único.', {
      field: "search",
      received: Array.isArray(query.search) ? "array" : typeof query.search,
    });
  }

  const term = String(query.search).trim();
  if (term === "") {
    return null;
  }
  if (term.length > maxLength) {
    throw AppError.validation(`El parámetro "search" no puede superar los ${maxLength} caracteres.`, {
      field: "search",
      length: term.length,
    });
  }

  return term;
}

/**
 * -----------------------------------------------------------------
 * Función: parseListParams
 * Propósito: punto de entrada único para los controladores de
 * listado: pagina, ordena y busca en una sola llamada.
 * @param {object} [query] - `req.query`.
 * @param {object} [options] - Opciones de `parsePagination`,
 * `parseSort` y `parseSearch`.
 * @returns {{ page: number, limit: number, offset: number,
 *   sort: string | null, order: "asc" | "desc", search: string | null }}
 * -----------------------------------------------------------------
 */
export function parseListParams(query = {}, options = {}) {
  const { allowed, defaultField, defaultOrder } = options;

  const pagination = parsePagination(query, options);
  const sort = allowed
    ? parseSort(query, { allowed, defaultField, defaultOrder })
    : { sort: null, order: "asc" };
  const search = parseSearch(query, options);

  return { ...pagination, ...sort, search };
}

/**
 * -----------------------------------------------------------------
 * Función: buildPagination
 * Propósito: construir el bloque `page`, `limit`, `total` y
 * `total_pages` que acompaña a cada listado.
 * @param {object} input - Datos de la consulta.
 * @param {number} input.page - Página actual (1-based).
 * @param {number} input.limit - Tamaño de página.
 * @param {number} input.total - Total de filas del listado.
 * @returns {{ page: number, limit: number, total: number, total_pages: number }}
 * -----------------------------------------------------------------
 */
export function buildPagination({ page, limit, total }) {
  if (!Number.isInteger(page) || page < 1) {
    throw new TypeError(`buildPagination: page inválida (${page}).`);
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError(`buildPagination: limit inválido (${limit}).`);
  }
  if (!Number.isInteger(total) || total < 0) {
    throw new TypeError(`buildPagination: total inválido (${total}).`);
  }

  return {
    page,
    limit,
    total,
    // 0 cuando no hay filas: no hay páginas que recorrer.
    total_pages: Math.ceil(total / limit),
  };
}

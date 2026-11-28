// =============================================================
// Servicio de reservas de espacios comunes
// =============================================================
//
// Reglas de negocio (§Bookings de `backend-rules.md`):
//   · Cualquier miembro activo de la comunidad consulta la lista y
//     la disponibilidad, y crea reservas. La pertenencia vive en
//     `users.id_community` y se comprueba con `MembershipService`,
//     la fuente única de las reglas 401/403: quien no pertenece
//     recibe 403 también cuando la comunidad no existe, para no
//     revelar su existencia.
//   · Las fechas pasadas y las más de 30 días de antelación, el
//     orden `start_time < end_time` y la duración entre 30 minutos
//     y 4 horas los fija el modelo (`BookingModel`); el servicio
//     los vuelve a aplicar sobre los valores fusionados de la
//     edición, donde el modelo solo ve la parte del cuerpo.
//   · Una franja ocupada es aquella en la que hay reservas
//     `PENDING` o `CONFIRMED` del mismo espacio y fecha; `CANCELLED`
//     y `REJECTED` liberan el hueco.
//   · El alta comprueba el solapamiento dentro de la transacción
//     con `SELECT ... FOR UPDATE` (`BookingRepository.
//     createWithOverlapCheck`): dos peticiones simultáneas no
//     pueden crear la misma franja. La edición reutiliza la misma
//     regla sobre la lectura de disponibilidad, excluyéndose a sí
//     misma.
//   · El vecino solo cancela sus propias reservas `PENDING`; el
//     presidente confirma, rechaza y cancela las de su comunidad.
//     `DELETE` no borra filas: cancela (las reservas son
//     histórico), por lo que reutiliza la misma máquina de estados.
//
// Sin objetos `req`/`res` y sin SQL: todo se delega en los
// repositorios y en `MembershipService`.
// =============================================================

import { Role } from "../enums/Role.js";
import { BookingStatus } from "../enums/State.js";
import { AppError } from "../utils/AppError.js";
import {
  BookingModel,
  BOOKING_MAX_DURATION_MINUTES,
  BOOKING_MIN_DURATION_MINUTES,
  BOOKING_UPDATABLE_FIELDS,
} from "../models/Booking.js";
import { formatTime, normalizeDate, normalizeTime } from "../utils/datetime.js";
import { buildPagination, parseListParams } from "../utils/pagination.js";
import {
  BookingRepository,
  BOOKING_SORT_FIELDS,
} from "../repositories/bookingRepository.js";
import { MembershipService } from "./membershipService.js";

/** Etiqueta española de cada identificador de ruta (para el 400). */
const ID_LABELS = Object.freeze({
  communityId: "comunidad",
  bookingId: "reserva",
});

/** Longitud máxima de `bookings.space_name` (`VARCHAR(100)`). */
const MAX_SPACE_NAME_LENGTH = 100;

/**
 * -----------------------------------------------------------------
 * Constante: BOOKING_TRANSITIONS
 * Propósito: máquina de transiciones de estado.
 *   PENDING   → CONFIRMED | CANCELLED | REJECTED
 *   CONFIRMED → CANCELLED
 *   CANCELLED y REJECTED son estados finales.
 *   Quién puede dar cada paso (vecino vs. presidente) se comprueba
 *   además en cada método.
 * @type {Readonly<Record<string, readonly string[]>>}
 * -----------------------------------------------------------------
 */
export const BOOKING_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze([
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
    BookingStatus.REJECTED,
  ]),
  CONFIRMED: Object.freeze([BookingStatus.CANCELLED]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
});

/**
 * -----------------------------------------------------------------
 * Función: toMinutes
 * Propósito: convertir una hora `HH:mm[:ss]` (o una columna `TIME`
 * que mysql2 entregue como `Date`) a minutos desde medianoche, para
 * comparar franjas.
 * @param {unknown} value - Hora a convertir.
 * @returns {null | number} Minutos o `null` si no es válida.
 * -----------------------------------------------------------------
 */
function toMinutes(value) {
  const text = formatTime(value);
  if (typeof text !== "string") return null;

  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * -----------------------------------------------------------------
 * Función: overlaps
 * Propósito: comprobar solapamiento entre dos pares de minutos
 * `[inicio, fin)` (medio abierto: una reserva que termina cuando
 * otra empieza no se solapa).
 * @param {number} startA - Inicio de la franja A.
 * @param {number} endA - Fin de la franja A.
 * @param {number} startB - Inicio de la franja B.
 * @param {number} endB - Fin de la franja B.
 * @returns {boolean} `true` si las franjas se cruzan.
 * -----------------------------------------------------------------
 */
function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

/**
 * -----------------------------------------------------------------
 * Función: normalizeNotes
 * Propósito: llevar `notes` a `string` recortado o `null` (columna
 * `TEXT` anulable). El formato ya lo validó el modelo.
 * @param {unknown} value - Notas recibidas.
 * @returns {null | string} Notas listas para guardar.
 * -----------------------------------------------------------------
 */
function normalizeNotes(value) {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * -----------------------------------------------------------------
 * Función: parseBookingFilters
 * Propósito: convertir los filtros de `req.query` del listado
 * (`status`, `id_user`, `space_name`, `booking_date`, `date_from`,
 * `date_to`) en valores ya validados.
 * @param {object} [query] - `req.query`.
 * @returns {object} Filtros presentes (objeto vacío si no hay).
 * @throws {AppError} 400 si un filtro no es válido.
 * -----------------------------------------------------------------
 */
function parseBookingFilters(query = {}) {
  const filters = {};

  const status = query.status;
  if (status !== undefined && status !== "") {
    if (typeof status !== "string" || !Object.values(BookingStatus).includes(status)) {
      throw AppError.validation("El filtro status no es válido.", {
        field: "status",
        received: Array.isArray(status) ? "[]" : String(status),
      });
    }
    filters.status = status;
  }

  const dateFields = ["booking_date", "date_from", "date_to"];
  for (const field of dateFields) {
    const raw = query[field];
    if (raw === undefined || raw === "") continue;

    const normalized = normalizeDate(raw);
    if (normalized === null) {
      throw AppError.validation(
        `El filtro ${field} debe ser una fecha válida con formato YYYY-MM-DD.`,
        { field, received: Array.isArray(raw) ? "[]" : String(raw) },
      );
    }
    filters[field] = normalized;
  }

  const spaceName = query.space_name;
  if (spaceName !== undefined && spaceName !== "") {
    if (typeof spaceName !== "string" || spaceName.trim().length === 0) {
      throw AppError.validation("El filtro space_name no es válido.", {
        field: "space_name",
        received: Array.isArray(spaceName) ? "[]" : String(spaceName),
      });
    }
    if (spaceName.trim().length > MAX_SPACE_NAME_LENGTH) {
      throw AppError.validation(
        `El filtro space_name no puede superar los ${MAX_SPACE_NAME_LENGTH} caracteres.`,
        { field: "space_name" },
      );
    }
    filters.space_name = spaceName.trim();
  }

  const idUser = query.id_user;
  if (idUser !== undefined && idUser !== "") {
    const raw = typeof idUser === "string" ? idUser.trim() : "";
    if (!/^\d{1,16}$/.test(raw) || Number(raw) < 1) {
      throw AppError.validation("El filtro id_user no es válido.", {
        field: "id_user",
        received: Array.isArray(idUser) ? "[]" : String(idUser),
      });
    }
    filters.id_user = Number(raw);
  }

  return filters;
}

/**
 * -----------------------------------------------------------------
 * Función: parseAvailabilityQuery
 * Propósito: validar los parámetros de
 * `GET /communities/:communityId/bookings/availability`.
 *   · `space_name` y `booking_date` son obligatorios.
 *   · `exclude_booking_id` es opcional (al editar la propia).
 * @param {object} [query] - `req.query`.
 * @returns {{ spaceName: string, bookingDate: string,
 *   excludeBookingId: null | number }} Parámetros normalizados.
 * @throws {AppError} 400 si falta o no vale alguno.
 * -----------------------------------------------------------------
 */
function parseAvailabilityQuery(query = {}) {
  const errors = [];

  const rawSpace = query.space_name;
  const spaceName = typeof rawSpace === "string" ? rawSpace.trim() : "";
  if (spaceName.length === 0) {
    errors.push("El parámetro space_name es obligatorio.");
  } else if (spaceName.length > MAX_SPACE_NAME_LENGTH) {
    errors.push(
      `El parámetro space_name no puede superar los ${MAX_SPACE_NAME_LENGTH} caracteres.`,
    );
  }

  const bookingDate = normalizeDate(query.booking_date);
  if (bookingDate === null) {
    errors.push(
      "El parámetro booking_date debe ser una fecha válida con formato YYYY-MM-DD.",
    );
  }

  let excludeBookingId = null;
  const rawExclude = query.exclude_booking_id;
  if (rawExclude !== undefined && rawExclude !== "") {
    const raw = typeof rawExclude === "string" ? rawExclude.trim() : "";
    if (!/^\d{1,16}$/.test(raw) || Number(raw) < 1) {
      errors.push("El parámetro exclude_booking_id no es válido.");
    } else {
      excludeBookingId = Number(raw);
    }
  }

  if (errors.length > 0) {
    throw AppError.validation(errors.join(" "), { errors });
  }

  return { spaceName, bookingDate, excludeBookingId };
}

export class BookingService {
  #bookingRepository;
  #membershipService;

  constructor() {
    this.#bookingRepository = new BookingRepository();
    this.#membershipService = new MembershipService();
  }

  /**
   * -----------------------------------------------------------------
   * Método: #parseId
   * Propósito: convertir el segmento de ruta `:communityId` o
   * `:bookingId` en un identificador válido.
   * @param {unknown} value - Valor de `req.params`.
   * @param {"bookingId" | "communityId"} field - Nombre del parámetro.
   * @returns {number} Identificador positivo.
   * @throws {AppError} 400 si no es numérico.
   * -----------------------------------------------------------------
   */
  #parseId(value, field) {
    const raw = typeof value === "string" ? value.trim() : "";
    const id = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isSafeInteger(id) || id < 1) {
      throw AppError.validation(`El identificador de ${ID_LABELS[field]} no es válido.`, {
        field,
        received: String(value),
      });
    }

    return id;
  }

  /**
   * -----------------------------------------------------------------
   * Método: #loadBooking
   * Propósito: cargar una reserva o fallar con 404.
   * @param {number} bookingId - `bookings.id_booking`.
   * @returns {Promise<object>} Fila de la reserva.
   * @throws {AppError} 404 si no existe.
   * -----------------------------------------------------------------
   */
  async #loadBooking(bookingId) {
    const row = await this.#bookingRepository.findById(bookingId);
    if (!row) {
      throw AppError.notFound("La reserva solicitada no existe.");
    }
    return row;
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertOwnerOrPresident
   * Propósito: aplicar el alcance «Owner/Admin» de las reservas
   * (`GET`, `PATCH` y `DELETE /bookings/:bookingId`).
   * @param {object} row - Fila de `bookings`.
   * @param {number} userId - Usuario autenticado.
   * @param {string} requesterRole - Rol del token.
   * @throws {AppError} 403 si no es autor ni presidente.
   * -----------------------------------------------------------------
   */
  #assertOwnerOrPresident(row, userId, requesterRole) {
    const isOwner = Number(row.id_user) === userId;
    const isPresident = requesterRole === Role.PRESIDENT;

    if (!isOwner && !isPresident) {
      throw AppError.forbidden("Solo el autor o el presidente pueden gestionar esta reserva.");
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertTimeRange
   * Propósito: validar y normalizar el par de horas definitivo. En
   * la creación ya lo hizo el modelo; en la edición hace falta
   * porque el cuerpo puede traer solo una de las dos horas y el par
   * completo solo se conoce al fusionar con la fila guardada.
   * @param {unknown} startValue - Hora de inicio.
   * @param {unknown} endValue - Hora de finalización.
   * @returns {{ startTime: string, endTime: string }} Horas en
   * `HH:mm:ss`.
   * @throws {AppError} 400 si el par no es válido.
   * -----------------------------------------------------------------
   */
  #assertTimeRange(startValue, endValue) {
    const startTime = normalizeTime(startValue);
    const endTime = normalizeTime(endValue);

    if (startTime === null) {
      throw AppError.validation("La hora de inicio debe tener formato HH:mm o HH:mm:ss.", {
        field: "start_time",
      });
    }
    if (endTime === null) {
      throw AppError.validation("La hora de finalización debe tener formato HH:mm o HH:mm:ss.", {
        field: "end_time",
      });
    }

    if (!(startTime < endTime)) {
      throw AppError.validation("La hora de finalización debe ser posterior a la de inicio.", {
        errors: ["La hora de finalización debe ser posterior a la de inicio."],
      });
    }

    const minutes = toMinutes(endTime) - toMinutes(startTime);
    if (minutes < BOOKING_MIN_DURATION_MINUTES.value) {
      throw AppError.validation(
        `La reserva debe durar al menos ${BOOKING_MIN_DURATION_MINUTES.value} minutos.`,
        { errors: [`La reserva debe durar al menos ${BOOKING_MIN_DURATION_MINUTES.value} minutos.`] },
      );
    }
    if (minutes > BOOKING_MAX_DURATION_MINUTES.value) {
      throw AppError.validation(
        `La reserva no puede superar las ${BOOKING_MAX_DURATION_MINUTES.value} minutos (4 horas).`,
        {
          errors: [
            `La reserva no puede superar las ${BOOKING_MAX_DURATION_MINUTES.value} minutos (4 horas).`,
          ],
        },
      );
    }

    return { startTime, endTime };
  }

  /**
   * -----------------------------------------------------------------
   * Método: #assertNoOverlap
   * Propósito: comprobar que la franja final no se cruza con otra
   * reserva `PENDING`/`CONFIRMED` del mismo espacio y fecha. Es la
   * vía de la edición, que excluye su propia reserva; el alta usa la
   * comprobación transaccional con bloqueo del repositorio.
   * @param {object} input - Franja definitiva.
   * @param {number} input.communityId - Comunidad.
   * @param {string} input.spaceName - Espacio.
   * @param {string} input.bookingDate - Fecha (`YYYY-MM-DD`).
   * @param {string} input.startTime - Inicio (`HH:mm:ss`).
   * @param {string} input.endTime - Fin (`HH:mm:ss`).
   * @param {null | number} [excludeBookingId] - Reserva excluida.
   * @returns {Promise<void>}
   * @throws {AppError} 409 si la franja ya está ocupada.
   * -----------------------------------------------------------------
   */
  async #assertNoOverlap(
    { communityId, spaceName, bookingDate, startTime, endTime },
    excludeBookingId = null,
  ) {
    const rows = await this.#bookingRepository.findAvailability({
      communityId,
      spaceName,
      bookingDate,
      excludeBookingId,
    });

    const start = toMinutes(startTime);
    const end = toMinutes(endTime);

    const conflict = rows.find((row) => {
      const otherStart = toMinutes(row.start_time);
      const otherEnd = toMinutes(row.end_time);
      return otherStart !== null && otherEnd !== null && overlaps(start, end, otherStart, otherEnd);
    });

    if (conflict) {
      throw AppError.conflict(
        `La franja solicitada ya está ocupada por otra reserva (de ${formatTime(conflict.start_time)} a ${formatTime(conflict.end_time)}).`,
      );
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: list
   * Propósito: listado paginado de reservas de una comunidad
   * (`GET /communities/:communityId/bookings`).
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} query - `req.query`.
   * @param {number} userId - Usuario autenticado.
   * @returns {Promise<{ bookings: object[], pagination: object }>}
   * @throws {AppError} 400 (datos), 403 (no miembro).
   * -----------------------------------------------------------------
   */
  async list(communityId, query = {}, userId) {
    const id = this.#parseId(communityId, "communityId");

    const params = parseListParams(query, {
      allowed: BOOKING_SORT_FIELDS,
      defaultField: "booking_date",
      defaultOrder: "asc",
    });
    const filters = parseBookingFilters(query);

    await this.#membershipService.assertCommunityMember(userId, id);

    const [total, rows] = await Promise.all([
      this.#bookingRepository.countByCommunity(id, { search: params.search, ...filters }),
      this.#bookingRepository.findByCommunityId(id, {
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
        order: params.order,
        search: params.search,
        ...filters,
      }),
    ]);

    return {
      bookings: rows.map((row) => BookingModel.toSafeBooking(row)),
      pagination: buildPagination({ page: params.page, limit: params.limit, total }),
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getAvailability
   * Propósito: franjas ocupadas de un espacio en una fecha
   * (`GET /communities/:communityId/bookings/availability`).
   *   · Lectura sin bloqueo: responde con las reservas que ocupan
   *     el hueco (`PENDING`/`CONFIRMED`), no con la disponibilidad
   *     calculada, para que la rejilla del frontend pinte las franjas
   *     libres.
   *   · No se expone `id_user` ni `notes`: la rejilla solo necesita
   *     horario y estado, y así no se filtra quién reservó.
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} query - `req.query`.
   * @param {number} userId - Usuario autenticado.
   * @returns {Promise<{ availability: object }>}
   * @throws {AppError} 400 (datos), 403 (no miembro).
   * -----------------------------------------------------------------
   */
  async getAvailability(communityId, query = {}, userId) {
    const id = this.#parseId(communityId, "communityId");
    const { spaceName, bookingDate, excludeBookingId } = parseAvailabilityQuery(query);

    await this.#membershipService.assertCommunityMember(userId, id);

    const rows = await this.#bookingRepository.findAvailability({
      communityId: id,
      spaceName,
      bookingDate,
      excludeBookingId,
    });

    return {
      availability: {
        space_name: spaceName,
        booking_date: bookingDate,
        occupied: rows.map((row) => ({
          id_booking: Number(row.id_booking),
          start_time: formatTime(row.start_time),
          end_time: formatTime(row.end_time),
          status: row.status,
        })),
      },
    };
  }

  /**
   * -----------------------------------------------------------------
   * Método: create
   * Propósito: alta de reserva
   * (`POST /communities/:communityId/bookings`). Nace en `PENDING`
   * y el solapamiento se decide dentro de una transacción con
   * `SELECT ... FOR UPDATE`.
   * @param {unknown} communityId - `req.params.communityId`.
   * @param {object} data - `req.body`.
   * @param {number} userId - Autor (`req.user.id`).
   * @returns {Promise<{ booking: object }>} Reserva creada.
   * @throws {AppError} 400 (validación), 403 (no miembro),
   *   409 (franja ocupada).
   * -----------------------------------------------------------------
   */
  async create(communityId, data = {}, userId) {
    const id = this.#parseId(communityId, "communityId");

    const errors = BookingModel.validateBookingCreate(data);
    if (errors.length > 0) {
      throw AppError.validation(errors.join(" "), { errors });
    }

    await this.#membershipService.assertCommunityMember(userId, id);

    // Tras la validación las horas y la fecha ya son válidas: solo
    // se normalizan a su forma definitiva antes de escribir.
    const { startTime, endTime } = this.#assertTimeRange(data.start_time, data.end_time);

    const { idBooking, conflicts } = await this.#bookingRepository.createWithOverlapCheck({
      idCommunity: id,
      idUser: userId,
      spaceName: data.space_name.trim(),
      bookingDate: normalizeDate(data.booking_date),
      startTime,
      endTime,
      notes: normalizeNotes(data.notes),
    });

    if (idBooking === null) {
      const [first] = conflicts;
      throw AppError.conflict(
        first
          ? `La franja solicitada ya está ocupada por otra reserva (de ${formatTime(first.start_time)} a ${formatTime(first.end_time)}).`
          : "La franja solicitada ya está ocupada por otra reserva.",
      );
    }

    const row = await this.#bookingRepository.findById(idBooking);
    return { booking: BookingModel.toSafeBooking(row) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: getById
   * Propósito: detalle de una reserva (`GET /bookings/:bookingId`),
   * para el autor o para el presidente de su comunidad.
   * @param {unknown} bookingId - `req.params.bookingId`.
   * @param {number} userId - Usuario autenticado.
   * @param {string} requesterRole - Rol del token.
   * @returns {Promise<{ booking: object }>}
   * @throws {AppError} 400, 403, 404.
   * -----------------------------------------------------------------
   */
  async getById(bookingId, userId, requesterRole) {
    const id = this.#parseId(bookingId, "bookingId");
    const row = await this.#loadBooking(id);

    await this.#membershipService.assertCommunityMember(userId, Number(row.id_community));
    this.#assertOwnerOrPresident(row, userId, requesterRole);

    return { booking: BookingModel.toSafeBooking(row) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: update
   * Propósito: edición de una reserva mientras está `PENDING`
   * (`PATCH /bookings/:bookingId`), para el autor o el presidente.
   *   · El cuerpo puede traer solo una de las dos horas: el par
   *     definitivo se valida contra la fila guardada.
   *   · La franja resultante vuelve a comprobar el solapamiento
   *     excluyendo la propia reserva.
   * @param {unknown} bookingId - `req.params.bookingId`.
   * @param {object} data - `req.body`.
   * @param {number} userId - Usuario autenticado.
   * @param {string} requesterRole - Rol del token.
   * @returns {Promise<{ booking: object }>}
   * @throws {AppError} 400, 403, 404, 409.
   * -----------------------------------------------------------------
   */
  async update(bookingId, data = {}, userId, requesterRole) {
    const id = this.#parseId(bookingId, "bookingId");

    const errors = BookingModel.validateBookingUpdate(data);
    if (errors.length > 0) {
      throw AppError.validation(errors.join(" "), { errors });
    }

    const row = await this.#loadBooking(id);

    await this.#membershipService.assertCommunityMember(userId, Number(row.id_community));
    this.#assertOwnerOrPresident(row, userId, requesterRole);

    if (row.status !== BookingStatus.PENDING) {
      throw AppError.forbidden("Solo se puede editar una reserva mientras está pendiente.");
    }

    // Valores definitivos: cuerpo + fila guardada.
    const spaceName =
      data.space_name !== undefined ? data.space_name.trim() : String(row.space_name);
    const bookingDate =
      data.booking_date !== undefined
        ? normalizeDate(data.booking_date)
        : normalizeDate(row.booking_date);
    const { startTime, endTime } = this.#assertTimeRange(
      data.start_time !== undefined ? data.start_time : row.start_time,
      data.end_time !== undefined ? data.end_time : row.end_time,
    );

    await this.#assertNoOverlap(
      {
        communityId: Number(row.id_community),
        spaceName,
        bookingDate,
        startTime,
        endTime,
      },
      id,
    );

    // Solo se escriben los campos que trae el cuerpo (lista blanca).
    const fields = {};
    for (const key of BOOKING_UPDATABLE_FIELDS) {
      if (data[key] === undefined) continue;
      if (key === "space_name") fields.space_name = spaceName;
      else if (key === "booking_date") fields.booking_date = bookingDate;
      else if (key === "start_time") fields.start_time = startTime;
      else if (key === "end_time") fields.end_time = endTime;
      else if (key === "notes") fields.notes = normalizeNotes(data.notes);
    }

    await this.#bookingRepository.updateBooking(id, fields);

    const updated = await this.#bookingRepository.findById(id);
    return { booking: BookingModel.toSafeBooking(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeStatus
   * Propósito: resolver una reserva
   * (`PATCH /bookings/:bookingId/status`).
   *   · El vecino solo cancela sus propias reservas `PENDING`.
   *   · El presidente confirma, rechaza y cancela las de su
   *     comunidad; `CONFIRMED` solo admite cancelación.
   * @param {unknown} bookingId - `req.params.bookingId`.
   * @param {object} data - `req.body` con `status`.
   * @param {number} userId - Usuario autenticado.
   * @param {string} requesterRole - Rol del token.
   * @returns {Promise<{ booking: object }>}
   * @throws {AppError} 400, 403, 404, 409 (transición inválida).
   * -----------------------------------------------------------------
   */
  async changeStatus(bookingId, data = {}, userId, requesterRole) {
    const id = this.#parseId(bookingId, "bookingId");

    const errors = BookingModel.validateBookingStatusChange(data);
    if (errors.length > 0) {
      throw AppError.validation(errors.join(" "), { errors });
    }

    const row = await this.#loadBooking(id);
    await this.#membershipService.assertCommunityMember(userId, Number(row.id_community));

    const nextStatus = data.status;
    const isPresident = requesterRole === Role.PRESIDENT;

    if (!isPresident) {
      if (Number(row.id_user) !== userId) {
        throw AppError.forbidden("Solo el autor o el presidente pueden gestionar esta reserva.");
      }
      if (nextStatus !== BookingStatus.CANCELLED) {
        throw AppError.forbidden("Solo el presidente puede confirmar o rechazar reservas.");
      }
      if (row.status !== BookingStatus.PENDING) {
        throw AppError.forbidden("Solo se puede cancelar una reserva mientras está pendiente.");
      }
    }

    const allowed = BOOKING_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      // `errorHandler` solo emite `details` en `VALIDATION_ERROR`,
      // así que la información útil va en el mensaje.
      throw AppError.conflict(
        `Transición de estado no permitida: ${row.status} → ${nextStatus}.`,
      );
    }

    // El presidente deja constancia de quién resolvió; cuando el
    // propio vecino cancela, `reviewed_by` queda en `NULL`.
    await this.#bookingRepository.changeStatus(id, {
      status: nextStatus,
      reviewedBy: isPresident ? userId : null,
    });

    const updated = await this.#bookingRepository.findById(id);
    return { booking: BookingModel.toSafeBooking(updated) };
  }

  /**
   * -----------------------------------------------------------------
   * Método: remove
   * Propósito: `DELETE /bookings/:bookingId`. No borra filas: las
   * reservas son histórico, así que cancela y reutiliza la misma
   * máquina de estados y los mismos permisos que `changeStatus`.
   * @param {unknown} bookingId - `req.params.bookingId`.
   * @param {number} userId - Usuario autenticado.
   * @param {string} requesterRole - Rol del token.
   * @returns {Promise<{ booking: object }>} Reserva cancelada.
   * @throws {AppError} 400, 403, 404, 409.
   * -----------------------------------------------------------------
   */
  async remove(bookingId, userId, requesterRole) {
    return this.changeStatus(
      bookingId,
      { status: BookingStatus.CANCELLED },
      userId,
      requesterRole,
    );
  }
}

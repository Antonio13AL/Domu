  // =============================================================
// Repositorio de reservas de espacios comunes — SQL parametrizado.
// =============================================================
//
// Dominio propio: `bookings`. Implementa:
//   · Listado paginado por comunidad y detalle por identificador.
//   · Consulta de disponibilidad (lectura, sin bloqueo).
//   · Comprobación de solapamiento con `SELECT ... FOR UPDATE`
//     dentro de una transacción propia, para que dos peticiones
//     simultáneas sobre la misma franja no creen dos reservas.
//
// Reglas aplicadas aquí:
//   · Nunca se selecciona `*`: las columnas están explícitas.
//   · Todas las consultas usan placeholders `?` con `pool.query()`
//     o `connection.query()`.
//   · `sort`/`order` no admiten parámetros en MySQL: se interpolan
//     únicamente tras comprobarlos contra la lista blanca
//     `BOOKING_SORT_FIELDS` y con la PK `id_booking` como desempate,
//     para que la paginación sea estable.
//   · Los comodines `%`/`_` de `search` se escapan para que la
//     búsqueda literal no se convierta en un patrón accidental.
//   · Solo bloquean la franja las reservas `PENDING` y `CONFIRMED`;
//     `CANCELLED` y `REJECTED` son histórico y no cuentan.
//   · El repositorio no decide reglas de negocio: devuelve filas y
//     deja al servicio la traducción a `AppError`.
// =============================================================

import { pool } from "../config/database.js";
import { BookingStatus } from "../enums/State.js";

/** Columnas devueltas por el listado y el detalle de reservas. */
const BOOKING_COLUMNS = `
  id_booking, id_community, id_user, space_name, booking_date,
  start_time, end_time, status, notes, reviewed_by, reviewed_at,
  created_at, updated_at
`;

/**
 * Estados que ocupan una franja horaria. `CANCELLED` y `REJECTED`
 * liberan el espacio y no se tienen en cuenta en el solapamiento.
 * @type {ReadonlyArray<string>}
 */
export const BOOKING_BLOCKING_STATUS_VALUES = Object.freeze([
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
]);

/**
 * Campos que puede ordenar el listado de reservas. Son nombres de
 * columna reales, por lo que el servicio los pasa tal cual al
 * repositorio.
 * @type {ReadonlyArray<string>}
 */
export const BOOKING_SORT_FIELDS = Object.freeze([
  "booking_date",
  "start_time",
  "created_at",
  "space_name",
  "status",
]);

/** Mapa campo público → columna SQL del `ORDER BY`. */
const SORTABLE_FIELDS = Object.freeze({
  booking_date: "booking_date",
  start_time: "start_time",
  created_at: "created_at",
  space_name: "space_name",
  status: "status",
});

/** Columnas que `updateBooking` admite modificar (lista blanca). */
const UPDATABLE_COLUMNS = Object.freeze(
  new Set(["space_name", "booking_date", "start_time", "end_time", "notes"]),
);

/**
 * -----------------------------------------------------------------
 * Función: escapeLike
 * Propósito: escapar los comodines de `LIKE` para que el texto se
 * busque literalmente (MySQL usa `\` como escape por defecto).
 * @param {string} value - Texto del usuario.
 * @returns {string} Patrón apto para `LIKE ?`.
 * -----------------------------------------------------------------
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * -----------------------------------------------------------------
 * Función: buildBookingWhere
 * Propósito: montar el `WHERE` del listado de reservas de una
 * comunidad. La comunidad es obligatoria: el listado nunca cruza
 * comunidades.
 * @param {number} communityId - `bookings.id_community`.
 * @param {object} [filters] - Filtros ya validados por el servicio.
 * @param {string} [filters.status] - `BookingStatus`.
 * @param {number} [filters.id_user] - Autor de la reserva.
 * @param {string} [filters.space_name] - Nombre del espacio.
 * @param {string} [filters.booking_date] - Fecha exacta (`YYYY-MM-DD`).
 * @param {string} [filters.date_from] - Fecha mínima (`YYYY-MM-DD`).
 * @param {string} [filters.date_to] - Fecha máxima (`YYYY-MM-DD`).
 * @param {string} [filters.search] - Texto (≤ 100) en espacio o notas.
 * @returns {{ clause: string, values: unknown[] }} SQL y valores.
 * -----------------------------------------------------------------
 */
function buildBookingWhere(communityId, filters = {}) {
  const clauses = ["id_community = ?"];
  const values = [communityId];

  if (filters.status) {
    clauses.push("status = ?");
    values.push(filters.status);
  }

  if (filters.id_user) {
    clauses.push("id_user = ?");
    values.push(filters.id_user);
  }

  if (filters.space_name) {
    clauses.push("space_name LIKE ?");
    values.push(`%${escapeLike(filters.space_name)}%`);
  }

  if (filters.booking_date) {
    clauses.push("booking_date = ?");
    values.push(filters.booking_date);
  }

  if (filters.date_from) {
    clauses.push("booking_date >= ?");
    values.push(filters.date_from);
  }

  if (filters.date_to) {
    clauses.push("booking_date <= ?");
    values.push(filters.date_to);
  }

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push("(space_name LIKE ? OR notes LIKE ?)");
    values.push(pattern, pattern);
  }

  return { clause: `WHERE ${clauses.join(" AND ")}`, values };
}

/**
 * -----------------------------------------------------------------
 * Función: buildUpdateSet
 * Propósito: convertir campos ya normalizados en la cláusula `SET`
 * con sus placeholders, ignorando cualquier clave fuera de la lista
 * blanca de columnas editables.
 * @param {object} fields - Campos normalizados por el servicio.
 * @returns {{ clause: string, values: unknown[], keys: string[] }}
 *   SQL, valores y claves efectivamente escritas.
 * -----------------------------------------------------------------
 */
function buildUpdateSet(fields) {
  const keys = Object.keys(fields).filter((key) => UPDATABLE_COLUMNS.has(key));
  const clause = keys.map((key) => `${key} = ?`).join(", ");
  return { clause, values: keys.map((key) => fields[key]), keys };
}

export class BookingRepository {
  /**
   * -----------------------------------------------------------------
   * Método: countByCommunity
   * Propósito: total de reservas de una comunidad para paginar.
   * @param {number} communityId - `bookings.id_community`.
   * @param {object} [filters] - Filtros validados.
   * @returns {Promise<number>} Cantidad de reservas.
   * -----------------------------------------------------------------
   */
  async countByCommunity(communityId, filters = {}) {
    const { clause, values } = buildBookingWhere(communityId, filters);
    const query = `SELECT COUNT(*) AS total FROM bookings ${clause};`;
    const [rows] = await pool.query(query, values);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * -----------------------------------------------------------------
   * Método: findByCommunityId
   * Propósito: página de reservas de una comunidad.
   * @param {number} communityId - `bookings.id_community`.
   * @param {object} params - Paginación, orden y filtros.
   * @param {number} params.limit - Tamaño de página.
   * @param {number} params.offset - Desplazamiento.
   * @param {string} [params.sort] - Campo de la lista blanca.
   * @param {"asc" | "desc"} [params.order] - Sentido del orden.
   * @returns {Promise<object[]>} Filas de `bookings`.
   * -----------------------------------------------------------------
   */
  async findByCommunityId(communityId, { limit, offset, sort, order, ...filters }) {
    const { clause, values } = buildBookingWhere(communityId, filters);
    const sortColumn = SORTABLE_FIELDS[sort] ?? SORTABLE_FIELDS.booking_date;
    const direction = order === "desc" ? "DESC" : "ASC";

    const query = `
      SELECT ${BOOKING_COLUMNS}
      FROM bookings
      ${clause}
      ORDER BY ${sortColumn} ${direction}, id_booking ${direction}
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await pool.query(query, [...values, limit, offset]);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findById
   * Propósito: detalle de una reserva.
   * @param {number} bookingId - `bookings.id_booking`.
   * @returns {Promise<null | object>} Fila o `null`.
   * -----------------------------------------------------------------
   */
  async findById(bookingId) {
    const query = `
      SELECT ${BOOKING_COLUMNS}
      FROM bookings
      WHERE id_booking = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(query, [bookingId]);
    return rows[0] ?? null;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findAvailability
   * Propósito: franjas ocupadas de un espacio en una fecha (lectura
   * sin bloqueo) para que el servicio calcule la disponibilidad.
   * Solo devuelve reservas que ocupan la franja
   * (`PENDING`/`CONFIRMED`).
   * @param {object} input - Datos de la consulta.
   * @param {number} input.communityId - `bookings.id_community`.
   * @param {string} input.spaceName - Espacio exacto.
   * @param {string} input.bookingDate - Fecha (`YYYY-MM-DD`).
   * @param {number} [input.excludeBookingId] - Reserva que no debe
   * contarse (al editar la propia reserva).
   * @returns {Promise<object[]>} Reservas ocupadas, por hora de inicio.
   * -----------------------------------------------------------------
   */
  async findAvailability({ communityId, spaceName, bookingDate, excludeBookingId = null }) {
    const values = [communityId, spaceName, bookingDate, ...BOOKING_BLOCKING_STATUS_VALUES];
    let exclusion = "";

    if (excludeBookingId !== null && excludeBookingId !== undefined) {
      exclusion = "AND id_booking <> ?";
      values.push(excludeBookingId);
    }

    const query = `
      SELECT ${BOOKING_COLUMNS}
      FROM bookings
      WHERE id_community = ?
        AND space_name = ?
        AND booking_date = ?
        AND status IN (?, ?)
        ${exclusion}
      ORDER BY start_time ASC, id_booking ASC;
    `;
    const [rows] = await pool.query(query, values);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: findOverlapsForUpdate
   * Propósito: localizar reservas que se solapan con una franja y
   * bloquearlas (`SELECT ... FOR UPDATE`). Debe invocarse con una
   * conexión dentro de una transacción abierta; el bloqueo por rango
   * sobre `idx_bookings_community_date_space_status` impide que otra
   * petición inserte la misma franja mientras se decide.
   * @param {import("mysql2/promise").PoolConnection} connection -
   * Conexión con transacción iniciada.
   * @param {object} input - Franja a comprobar.
   * @param {number} input.communityId - `bookings.id_community`.
   * @param {string} input.spaceName - Espacio exacto.
   * @param {string} input.bookingDate - Fecha (`YYYY-MM-DD`).
   * @param {string} input.startTime - Inicio (`HH:mm:ss`).
   * @param {string} input.endTime - Fin (`HH:mm:ss`).
   * @param {number} [input.excludeBookingId] - Reserva excluida
   * (edición de la propia reserva).
   * @returns {Promise<object[]>} Reservas solapadas y bloqueadas.
   * -----------------------------------------------------------------
   */
  async findOverlapsForUpdate(
    connection,
    { communityId, spaceName, bookingDate, startTime, endTime, excludeBookingId = null },
  ) {
    if (!connection) {
      throw new TypeError(
        "findOverlapsForUpdate requiere una conexión con transacción abierta.",
      );
    }

    // Solapamiento de franjas semiabiertas [inicio, fin): la
    // reservada existente empieza ANTES de que termine la nueva y
    // termina DESPUÉS de que la nueva empiece. El primer `?` de esa
    // pareja es, por tanto, `endTime` y el segundo `startTime`.
    const values = [
      communityId,
      spaceName,
      bookingDate,
      endTime,
      startTime,
      ...BOOKING_BLOCKING_STATUS_VALUES,
    ];
    let exclusion = "";

    if (excludeBookingId !== null && excludeBookingId !== undefined) {
      exclusion = "AND id_booking <> ?";
      values.push(excludeBookingId);
    }

    const query = `
      SELECT ${BOOKING_COLUMNS}
      FROM bookings
      WHERE id_community = ?
        AND space_name = ?
        AND booking_date = ?
        AND start_time < ?   -- empieza antes de que acabe la nueva
        AND end_time > ?     -- acaba después de que empiece la nueva
        AND status IN (?, ?)
        ${exclusion}
      ORDER BY start_time ASC, id_booking ASC
      FOR UPDATE;
    `;
    const [rows] = await connection.query(query, values);
    return rows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: createBooking
   * Propósito: insertar una reserva nueva en estado inicial
   * `PENDING`. Acepta una conexión para participar en la transacción
   * de `createWithOverlapCheck`.
   * @param {import("mysql2/promise").PoolConnection} connection -
   * Conexión con transacción iniciada.
   * @param {object} fields - Datos ya normalizados.
   * @param {number} fields.idCommunity - `bookings.id_community`.
   * @param {number} fields.idUser - `bookings.id_user`.
   * @param {string} fields.spaceName - Espacio exacto.
   * @param {string} fields.bookingDate - Fecha (`YYYY-MM-DD`).
   * @param {string} fields.startTime - Inicio (`HH:mm:ss`).
   * @param {string} fields.endTime - Fin (`HH:mm:ss`).
   * @param {null | string} [fields.notes] - Notas opcionales.
   * @returns {Promise<number>} `bookings.id_booking` generado.
   * -----------------------------------------------------------------
   */
  async createBooking(
    connection,
    { idCommunity, idUser, spaceName, bookingDate, startTime, endTime, notes = null },
  ) {
    if (!connection) {
      throw new TypeError("createBooking requiere una conexión con transacción abierta.");
    }

    const query = `
      INSERT INTO bookings (
        id_community, id_user, space_name, booking_date,
        start_time, end_time, status, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const [result] = await connection.query(query, [
      idCommunity,
      idUser,
      spaceName,
      bookingDate,
      startTime,
      endTime,
      BookingStatus.PENDING,
      notes ?? null,
    ]);
    return Number(result.insertId);
  }

  /**
   * -----------------------------------------------------------------
   * Método: createWithOverlapCheck
   * Propósito: crear una reserva comprobando el solapamiento dentro
   * de una única transacción. Primero bloquea las reservas que
   * ocupan la franja; si hay alguna, hace `rollback` y devuelve los
   * conflictos para que el servicio decida el error (409). Si no,
   * inserta y confirma.
   * @param {object} fields - Datos ya normalizados.
   * @returns {Promise<{ idBooking: null | number, conflicts: object[] }>}
   *   Identificador creado y conflictos detectados (vacío si se creó).
   * -----------------------------------------------------------------
   */
  async createWithOverlapCheck(fields) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Serializa las altas de una misma comunidad: ver
      // `#lockCommunity` para el motivo (gap lock → interbloqueo).
      await this.#lockCommunity(connection, fields.idCommunity);

      // `findOverlapsForUpdate` nombra la comunidad `communityId`,
      // mientras que `createBooking` trabaja con `idCommunity`: aquí
      // se traduce la forma, porque pasar `fields` tal cual deja la
      // condición `id_community = NULL` y el solapamiento no se
      // detecta nunca.
      const conflicts = await this.findOverlapsForUpdate(connection, {
        communityId: fields.idCommunity,
        spaceName: fields.spaceName,
        bookingDate: fields.bookingDate,
        startTime: fields.startTime,
        endTime: fields.endTime,
      });

      if (conflicts.length > 0) {
        await connection.rollback();
        return { idBooking: null, conflicts };
      }

      const idBooking = await this.createBooking(connection, fields);
      await connection.commit();

      return { idBooking, conflicts: [] };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateBooking
   * Propósito: actualizar los campos editables de una reserva en una
   * sola sentencia (la lista blanca vive en `buildUpdateSet`; el
   * servicio valida el estado). Cuando además hay que aplicar la
   * regla de solapamiento se usa `updateWithOverlapCheck`, que corre
   * este mismo `SET` dentro de su transacción.
   * @param {number} bookingId - `bookings.id_booking`.
   * @param {object} fields - Campos normalizados.
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async updateBooking(bookingId, fields) {
    return this.#applyUpdate(pool, bookingId, fields);
  }

  /**
   * -----------------------------------------------------------------
   * Método: updateWithOverlapCheck
   * Propósito: editar una reserva comprobando el solapamiento dentro
   * de la misma transacción que la escritura. Es la vía que usa el
   * servicio para `PATCH /bookings/:bookingId`: primero candada la
   * comunidad, después bloquea las franjas que se crucen con la nueva
   * (excluyendo la propia reserva) y solo entonces escribe. Si hay
   * alguna, hace `rollback` y devuelve los conflictos para que el
   * servicio responda 409.
   *
   * Sin el candado de comunidad, dos **ediciones** simultáneas de
   * reservas distintas hacia la misma franja leerían ambas antes de
   * escribir, no se verían y las dos se aplicarían.
   * @param {object} input - Edición completa.
   * @param {number} input.bookingId - Reserva que se edita.
   * @param {number} input.communityId - `bookings.id_community`.
   * @param {string} input.spaceName - Espacio definitivo.
   * @param {string} input.bookingDate - Fecha definitiva (`YYYY-MM-DD`).
   * @param {string} input.startTime - Inicio definitivo (`HH:mm:ss`).
   * @param {string} input.endTime - Fin definitivo (`HH:mm:ss`).
   * @param {object} input.fields - Columnas a escribir (lista blanca).
   * @returns {Promise<{ updated: number, conflicts: object[] }>}
   *   Filas afectadas y conflictos detectados (vacío si se escribió).
   * -----------------------------------------------------------------
   */
  async updateWithOverlapCheck({
    bookingId,
    communityId,
    spaceName,
    bookingDate,
    startTime,
    endTime,
    fields,
  }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await this.#lockCommunity(connection, communityId);

      const conflicts = await this.findOverlapsForUpdate(connection, {
        communityId,
        spaceName,
        bookingDate,
        startTime,
        endTime,
        excludeBookingId: bookingId,
      });

      if (conflicts.length > 0) {
        await connection.rollback();
        return { updated: 0, conflicts };
      }

      const updated = await this.#applyUpdate(connection, bookingId, fields);
      await connection.commit();

      return { updated, conflicts: [] };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * -----------------------------------------------------------------
   * Método: #lockCommunity
   * Propósito: serializar las escrituras que luego comprueban el
   * solapamiento de una comunidad sobre su fila.
   *
   * Sin este candado, dos transacciones simultáneas que llegan con la
   * franja libre toman ambas el *gap lock* del índice (los *gap locks*
   * son compatibles entre sí) y, al insertar o al actualizar, cada una
   * espera el lock de la otra: InnoDB mata a una con
   * `ER_LOCK_DEADLOCK` y la API devolvería 500 en lugar del 409. Con
   * el candado, la segunda transacción espera a que la primera
   * confirme, relee la franja, encuentra el cambio recién hecho y
   * responde 409 sin interbloqueo.
   * @param {import("mysql2/promise").PoolConnection} connection -
   * Conexión con transacción iniciada.
   * @param {number} communityId - `communities.id_community`.
   * @returns {Promise<void>}
   * -----------------------------------------------------------------
   */
  async #lockCommunity(connection, communityId) {
    await connection.query(
      "SELECT id_community FROM communities WHERE id_community = ? FOR UPDATE;",
      [communityId],
    );
  }

  /**
   * -----------------------------------------------------------------
   * Método: #applyUpdate
   * Propósito: ejecutar el `UPDATE` de una reserva sobre el executor
   * indicado (la conexión de una transacción o el pool compartido),
   * con la lista blanca de columnas de `buildUpdateSet`.
   * @param {{ query: Function }} executor - Conexión o pool.
   * @param {number} bookingId - `bookings.id_booking`.
   * @param {object} fields - Campos normalizados.
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async #applyUpdate(executor, bookingId, fields) {
    const { clause, values, keys } = buildUpdateSet(fields);
    if (keys.length === 0) return 0;

    const query = `UPDATE bookings SET ${clause} WHERE id_booking = ? LIMIT 1;`;
    const [result] = await executor.query(query, [...values, bookingId]);
    return result.affectedRows;
  }

  /**
   * -----------------------------------------------------------------
   * Método: changeStatus
   * Propósito: resolver una reserva (`CONFIRMED`, `CANCELLED` o
   * `REJECTED`) y dejar rastro de quién y cuándo la revisó. La
   * transición válida la decide el servicio.
   * @param {number} bookingId - `bookings.id_booking`.
   * @param {object} input - Resolución.
   * @param {string} input.status - `BookingStatus`.
   * @param {null | number} [input.reviewedBy] - Presidente que
   * resuelve; `null` cuando el propio vecino cancela.
   * @returns {Promise<number>} Filas afectadas.
   * -----------------------------------------------------------------
   */
  async changeStatus(bookingId, { status, reviewedBy = null }) {
    const query = `
      UPDATE bookings
      SET status = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id_booking = ?
      LIMIT 1;
    `;
    const [result] = await pool.query(query, [status, reviewedBy, bookingId]);
    return result.affectedRows;
  }
}

// =============================================================
// Seed de datos de demostración
// Uso:
//   npm run db:seed
//
// Qué hace:
//   1. Comprueba que el esquema ya está migrado (`npm run db:migrate`).
//   2. Hashea las dos contraseñas de demo con bcrypt (coste 12).
//   3. Inserta dentro de una transacción los datos:
//      2 comunidades, 1 presidente y 6 vecinos, 8 incidencias,
//      2 reuniones con asistencia, 3 votaciones con respuestas y
//      6 reservas.
//   4. Cada fila se localiza por su clave natural antes de insertar,
//      por lo que una segunda ejecución no duplica nada y un seed
//      interrumpido a mitad se completa en la siguiente pasada.
// =============================================================

// Importación de la librería bcrypt para el hashing seguro de contraseñas
import bcrypt from "bcryptjs";

// Importación del pool compartido y utilidades de la configuración de base de datos.
// El pool se usa de forma exclusiva con `getConnection()` (y no con `pool.query`)
// para que toda la carga corra sobre UNA sola conexión y la transacción sea efectiva.
import { closePool, dbDestination, pool } from "../src/config/database.js";

// Lee el coste de hashing desde las variables de entorno (.env) o usa 12 por defecto
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

// Credenciales de prueba predefinidas para los roles (SOLO para entorno de desarrollo)
const DEMO_PASSWORDS = {
  president: "Admin1234!",
  neighbor: "Vecino1234!",
};

// -------------------------------------------------------------
// Datos de demo. Fechas estáticas para asegurar que el seed sea
// determinista (siempre genere los mismos datos sin duplicar).
// -------------------------------------------------------------
const COMMUNITIES = [
  {
    id: "acacias",
    name: "Residencial Las Acacias",
    address: "Calle Almendros 12",
    city: "Madrid",
    postalCode: "28010",
    inviteCode: "ACACIAS2026",
  },
  {
    id: "norte",
    name: "Edificio Parque Norte",
    address: "Avenida del Parque 45",
    city: "Madrid",
    postalCode: "28025",
    inviteCode: "NORTE2026",
  },
];

// Listado de usuarios iniciales (1 presidente en Acacias y 6 vecinos repartidos)
const USERS = [
  {
    id: "admin",
    name: "Ana",
    surname: "García",
    email: "admin@domu.es",
    password: "president",
    phone: "600111222",
    role: "PRESIDENT",
    community: "acacias",
    housing: "Ático A",
  },
  {
    id: "vecino1",
    name: "Luis",
    surname: "Martínez",
    email: "vecino1@domu.es",
    password: "neighbor",
    phone: "600222333",
    role: "NEIGHBOR",
    community: "acacias",
    housing: "1º B",
  },
  {
    id: "vecino2",
    name: "Carmen",
    surname: "López",
    email: "vecino2@domu.es",
    password: "neighbor",
    phone: "600333444",
    role: "NEIGHBOR",
    community: "acacias",
    housing: "2º A",
  },
  {
    id: "vecino3",
    name: "Javier",
    surname: "Sánchez",
    email: "vecino3@domu.es",
    password: "neighbor",
    phone: "600444555",
    role: "NEIGHBOR",
    community: "acacias",
    housing: "3º C",
  },
  {
    id: "vecino4",
    name: "Marta",
    surname: "Romero",
    email: "vecino4@domu.es",
    password: "neighbor",
    phone: "600555666",
    role: "NEIGHBOR",
    community: "acacias",
    housing: "Ático B",
  },
  {
    id: "vecino5",
    name: "Diego",
    surname: "Navarro",
    email: "vecino5@domu.es",
    password: "neighbor",
    phone: "600666777",
    role: "NEIGHBOR",
    community: "norte",
    housing: "Bajo A",
  },
  {
    id: "vecino6",
    name: "Lucía",
    surname: "Ortega",
    email: "vecino6@domu.es",
    password: "neighbor",
    phone: "600777888",
    role: "NEIGHBOR",
    community: "norte",
    housing: "1º A",
  },
];

// Incidencias de prueba que cubren los diferentes estados del sistema
const ISSUES = [
  {
    community: "acacias",
    author: "vecino1",
    title: "Fuga de agua en el portal B",
    description: "Hay una fuga en el cuarto de contadores del portal B que moja el suelo del rellano.",
    category: "PLUMBING",
    priority: "HIGH",
    state: "IN_PROGRESS",
    resolvedAt: null,
  },
  {
    community: "acacias",
    author: "vecino2",
    title: "Luz del garaje parpadea",
    description: "La iluminación del garaje parpadea desde hace dos días.",
    category: "ELECTRICAL",
    priority: "MEDIUM",
    state: "PENDING",
    resolvedAt: null,
  },
  {
    community: "acacias",
    author: "vecino3",
    title: "Ascensor detenido en el 3º",
    description: "El ascensor principal se detiene en la tercera planta y no abre.",
    category: "ELEVATOR",
    priority: "URGENT",
    state: "IN_PROGRESS",
    resolvedAt: null,
  },
  {
    community: "acacias",
    author: "vecino4",
    title: "Portal sin cerradura",
    description: "La cerradura del portal principal está rota desde el lunes.",
    category: "SECURITY",
    priority: "HIGH",
    state: "RESOLVED",
    resolvedAt: "2026-10-30 12:00:00",
  },
  {
    community: "acacias",
    author: "vecino1",
    title: "Pintura de la escalera descascarillada",
    description: "La pintura del rellano de la escalera se está descascarillando.",
    category: "OTHER",
    priority: "LOW",
    state: "PENDING",
    resolvedAt: null,
  },
  {
    community: "norte",
    author: "vecino5",
    title: "Gotera en el trastero",
    description: "Se acumula agua en el techo del trastero de la planta baja.",
    category: "PLUMBING",
    priority: "MEDIUM",
    state: "RESOLVED",
    resolvedAt: "2026-10-18 09:30:00",
  },
  {
    community: "norte",
    author: "vecino6",
    title: "Cámara de seguridad inoperativa",
    description: "La cámara de la entrada principal no graba desde el corte de luz.",
    category: "SECURITY",
    priority: "HIGH",
    state: "REJECTED",
    resolvedAt: null,
  },
  {
    community: "norte",
    author: "vecino5",
    title: "Limpieza del patio pendiente",
    description: "El patio comunitario acumula hojas desde la semana pasada.",
    category: "CLEANING",
    priority: "LOW",
    state: "PENDING",
    resolvedAt: null,
  },
];

// Reuniones de vecinos (una pasada con acta y otra futura programada)
const MEETINGS = [
  {
    id: "acacias_assembly",
    community: "acacias",
    date: "2026-10-22",
    startTime: "18:00:00",
    endTime: "19:30:00",
    title: "Asamblea ordinaria de octubre",
    agenda: "Aprobación del presupuesto de limpieza y revisión del contrato de mantenimiento.",
    minutes: "Se aprueba el presupuesto de limpieza por mayoría. Se revisará el contrato en la próxima asamblea.",
    state: "CLOSED",
  },
  {
    id: "norte_meeting",
    community: "norte",
    date: "2026-12-12",
    startTime: "17:00:00",
    endTime: "18:00:00",
    title: "Reunión de vecinos de diciembre",
    agenda: "Presupuesto de limpieza y pintura del portal.",
    minutes: null,
    state: "SCHEDULED",
  },
];

// Estado de asistencia de los usuarios a las reuniones
const ATTENDEES = [
  { meeting: "acacias_assembly", user: "admin", status: "ATTENDED", confirmedAt: "2026-10-20 10:00:00" },
  { meeting: "acacias_assembly", user: "vecino1", status: "ATTENDED", confirmedAt: "2026-10-20 10:05:00" },
  { meeting: "acacias_assembly", user: "vecino2", status: "ATTENDED", confirmedAt: "2026-10-21 09:00:00" },
  { meeting: "acacias_assembly", user: "vecino3", status: "ABSENT", confirmedAt: null },
  { meeting: "acacias_assembly", user: "vecino4", status: "EXCUSED", confirmedAt: "2026-10-21 18:00:00" },
  { meeting: "norte_meeting", user: "vecino5", status: "PENDING", confirmedAt: null },
  { meeting: "norte_meeting", user: "vecino6", status: "PENDING", confirmedAt: null },
];

// Votaciones creadas dentro de las asambleas
const VOTES = [
  {
    id: "cleaning_contract",
    meeting: "acacias_assembly",
    createdBy: "admin",
    title: "¿Aprobamos el contrato de limpieza?",
    description: "Renovación anual del contrato de limpieza por 18.400 €.",
    status: "CLOSED",
    opensAt: "2026-10-20 10:00:00",
    closesAt: "2026-10-22 19:00:00",
  },
  {
    id: "night_guard",
    meeting: "acacias_assembly",
    createdBy: "admin",
    title: "¿Contratamos vigilante nocturno?",
    description: "Incorporar vigilancia nocturna tres noches por semana.",
    status: "OPEN",
    opensAt: "2026-11-01 00:00:00",
    closesAt: "2026-11-30 23:59:00",
  },
  {
    id: "portal_reform",
    meeting: "acacias_assembly",
    createdBy: "admin",
    title: "Obras del portal — anteproyecto",
    description: "Anteproyecto de reforma del portal principal para su debate.",
    status: "DRAFT",
    opensAt: null,
    closesAt: null,
  },
];

// Respuestas emitidas por los vecinos en las votaciones
const VOTE_RESPONSES = [
  { vote: "cleaning_contract", user: "vecino1", option: "AGREE" },
  { vote: "cleaning_contract", user: "vecino2", option: "AGREE" },
  { vote: "cleaning_contract", user: "vecino3", option: "DISAGREE" },
  { vote: "cleaning_contract", user: "vecino4", option: "AGREE" },
  { vote: "night_guard", user: "vecino1", option: "AGREE" },
  { vote: "night_guard", user: "vecino2", option: "AGREE" },
  { vote: "night_guard", user: "vecino3", option: "AGREE" },
  { vote: "night_guard", user: "vecino4", option: "DISAGREE" },
];

// Reservas de espacios comunes realizadas por los usuarios
const BOOKINGS = [
  {
    community: "acacias",
    user: "vecino1",
    spaceName: "Salón de actos",
    bookingDate: "2026-11-14",
    startTime: "10:00:00",
    endTime: "13:00:00",
    status: "CONFIRMED",
    notes: "Cumpleaños familiar.",
    reviewedBy: "admin",
    reviewedAt: "2026-11-02 09:00:00",
  },
  {
    community: "acacias",
    user: "vecino2",
    spaceName: "Parrilla",
    bookingDate: "2026-11-15",
    startTime: "12:00:00",
    endTime: "15:00:00",
    status: "PENDING",
    notes: null,
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    community: "acacias",
    user: "vecino3",
    spaceName: "Piscina",
    bookingDate: "2026-11-21",
    startTime: "16:00:00",
    endTime: "18:00:00",
    status: "CONFIRMED",
    notes: "Clase de natación.",
    reviewedBy: "admin",
    reviewedAt: "2026-11-03 17:30:00",
  },
  {
    community: "acacias",
    user: "vecino4",
    spaceName: "Sala de juegos",
    bookingDate: "2026-11-22",
    startTime: "11:00:00",
    endTime: "13:00:00",
    status: "REJECTED",
    notes: "Supera las 4 horas permitidas.",
    reviewedBy: "admin",
    reviewedAt: "2026-11-04 10:15:00",
  },
  {
    community: "norte",
    user: "vecino5",
    spaceName: "Salón de actos",
    bookingDate: "2026-11-28",
    startTime: "09:00:00",
    endTime: "12:00:00",
    status: "PENDING",
    notes: null,
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    community: "norte",
    user: "vecino6",
    spaceName: "Parrilla",
    bookingDate: "2026-12-05",
    startTime: "13:00:00",
    endTime: "16:00:00",
    status: "CANCELLED",
    notes: "Cancelada por el vecino.",
    reviewedBy: null,
    reviewedAt: null,
  },
];

// -------------------------------------------------------------
// Utilidades y contadores globales
// -------------------------------------------------------------
let createdCount = 0;  // Cuenta registros insertados en esta ejecución
let existingCount = 0; // Cuenta registros que ya existían previamente

/**
 * Función ensureRow:
 * Busca si el registro ya existe usando sus columnas naturales (`lookupColumns`).
 * Si existe, retorna su ID existente. Si no, lo inserta y retorna el nuevo ID.
 */
async function ensureRow(connection, table, primaryKey, lookupColumns, data) {
  // Construye la cláusula WHERE dinámicamente según las columnas de búsqueda natural
  const where = lookupColumns.map((column) => `\`${column}\` = ?`).join(" AND ");
  const lookupValues = lookupColumns.map((column) => data[column]);

  // Ejecuta la consulta para verificar existencia
  const [existing] = await connection.query(
    `SELECT \`${primaryKey}\` AS id FROM \`${table}\` WHERE ${where} LIMIT 1`,
    lookupValues,
  );

  // Si ya se encuentra en la BD, se incrementa el contador de existentes y se retorna su ID
  if (existing.length > 0) {
    existingCount += 1;
    return existing[0].id;
  }

  // Si no existe, prepara las columnas y marcadores para la inserción segura
  const columns = Object.keys(data);
  const placeholders = columns.map(() => "?").join(", ");

  // Inserta el registro utilizando parámetros para evitar inyecciones SQL
  const [result] = await connection.query(
    `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
    columns.map((column) => data[column]),
  );

  // Incrementa el contador de creados y retorna la nueva clave primaria generada
  createdCount += 1;
  return result.insertId;
}

/** 
 * Ejecuta una tarea o fase específica y muestra por consola un resumen 
 * de las filas nuevas añadidas y las ya existentes.
 */
async function runPhase(label, task) {
  const beforeCreated = createdCount;
  const beforeExisting = existingCount;
  const result = await task();
  console.log(
    `  [OK] ${label}: ${createdCount - beforeCreated} creada(s), ` +
      `${existingCount - beforeExisting} ya existente(s)`,
  );
  return result;
}

/** 
 * Comprueba que la base de datos contenga las tablas del esquema principal 
 * antes de intentar insertar datos de prueba.
 */
async function assertSchemaReady(connection) {
  const [rows] = await connection.query(
    "SELECT COUNT(*) AS tableCount FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name = 'users'",
  );

  // Si la tabla 'users' no existe, detiene la ejecución informando la causa
  if (rows[0].tableCount === 0) {
    const error = new Error(
      "La base de datos no tiene el esquema cargado. Ejecuta `npm run db:migrate` antes de `npm run db:seed`.",
    );
    error.code = "SCHEMA_NOT_READY";
    throw error;
  }
}

// -------------------------------------------------------------
// Fases de carga de datos específicos
// -------------------------------------------------------------

// Inserta las comunidades de propietarios
async function seedCommunities(connection) {
  const communityIds = {};

  for (const community of COMMUNITIES) {
    communityIds[community.id] = await ensureRow(
      connection,
      "communities",
      "id_community",
      ["invite_code"], // Clave natural para evitar duplicados
      {
        name: community.name,
        address: community.address,
        city: community.city,
        postal_code: community.postalCode,
        invite_code: community.inviteCode,
        is_active: 1,
      },
    );
  }

  return communityIds; // Retorna un mapa con los IDs reales generados
}

// Inserta a los usuarios (presidente y vecinos) vinculándolos con sus comunidades
async function seedUsers(connection, communityIds, passwordHashes) {
  const userIds = {};

  for (const user of USERS) {
    userIds[user.id] = await ensureRow(connection, "users", "id_user", ["email"], {
      name: user.name,
      surname: user.surname,
      email: user.email,
      password: passwordHashes[user.password], // Contraseña ya hasheada con bcrypt
      phone: user.phone,
      role: user.role,
      id_community: communityIds[user.community],
      housing: user.housing,
      is_active: 1,
    });
  }

  return userIds;
}

// Inserta las incidencias o averías reportadas
async function seedIssues(connection, communityIds, userIds) {
  for (const issue of ISSUES) {
    await ensureRow(connection, "issues", "id_issue", ["id_community", "title"], {
      id_community: communityIds[issue.community],
      id_user: userIds[issue.author],
      title: issue.title,
      description: issue.description,
      category: issue.category,
      priority: issue.priority,
      state: issue.state,
      resolved_at: issue.resolvedAt,
    });
  }
}

// Inserta las asambleas o reuniones de vecinos programadas
async function seedMeetings(connection, communityIds) {
  const meetingIds = {};

  for (const meeting of MEETINGS) {
    meetingIds[meeting.id] = await ensureRow(
      connection,
      "meetings",
      "id_meeting",
      ["id_community", "date", "start_time"],
      {
        id_community: communityIds[meeting.community],
        date: meeting.date,
        start_time: meeting.startTime,
        end_time: meeting.endTime,
        title: meeting.title,
        agenda: meeting.agenda,
        minutes: meeting.minutes,
        state: meeting.state,
      },
    );
  }

  return meetingIds;
}

// Registra la asistencia de los usuarios a las reuniones.
async function seedAttendees(connection, meetingIds, userIds) {
  for (const attendee of ATTENDEES) {
    await ensureRow(connection, "meeting_attendees", "id_meet_atte", ["id_meeting", "id_user"], {
      id_meeting: meetingIds[attendee.meeting],
      id_user: userIds[attendee.user],
      attendance_status: attendee.status,
      confirmed_at: attendee.confirmedAt,
    });
  }
}

// Inserta las votaciones creadas dentro de las reuniones.
async function seedVotes(connection, meetingIds, userIds) {
  const voteIds = {};

  for (const vote of VOTES) {
    voteIds[vote.id] = await ensureRow(connection, "votes", "id_vote", ["id_meeting", "title"], {
      id_meeting: meetingIds[vote.meeting],
      created_by: userIds[vote.createdBy],
      title: vote.title,
      description: vote.description,
      status: vote.status,
      opens_at: vote.opensAt,
      closes_at: vote.closesAt,
    });
  }

  return voteIds;
}

// Inserta los votos individuales emitidos por los vecinos
async function seedVoteResponses(connection, voteIds, userIds) {
  for (const response of VOTE_RESPONSES) {
    await ensureRow(connection, "vote_responses", "id_vot_res", ["id_vote", "id_user"], {
      id_vote: voteIds[response.vote],
      id_user: userIds[response.user],
      vote_option: response.option,
    });
  }
}

// Inserta las reservas de espacios comunes solicitadas
async function seedBookings(connection, communityIds, userIds) {
  for (const booking of BOOKINGS) {
    await ensureRow(
      connection,
      "bookings",
      "id_booking",
      ["id_community", "id_user", "booking_date", "start_time"],
      {
        id_community: communityIds[booking.community],
        id_user: userIds[booking.user],
        space_name: booking.spaceName,
        booking_date: booking.bookingDate,
        start_time: booking.startTime,
        end_time: booking.endTime,
        status: booking.status,
        notes: booking.notes,
        reviewed_by: booking.reviewedBy ? userIds[booking.reviewedBy] : null,
        reviewed_at: booking.reviewedAt,
      },
    );
  }
}

// -------------------------------------------------------------
// Punto de entrada principal
// -------------------------------------------------------------
async function main() {
  console.log("==> Seed de datos de demostración iniciado...");
  console.log(`==> Destino: ${dbDestination}`);

  // Genera los hashes de las contraseñas antes de abrir la transacción 
  // para evitar mantener bloqueos en la base de datos mientras bcrypt procesa el coste 12.
  const passwordHashes = {
    president: await bcrypt.hash(DEMO_PASSWORDS.president, BCRYPT_ROUNDS),
    neighbor: await bcrypt.hash(DEMO_PASSWORDS.neighbor, BCRYPT_ROUNDS),
  };

  // Obtiene una conexión exclusiva del pool compartido (`pool.getConnection`)
  // en lugar de abrir una conexión suelta con `createConnection`: así no se
  // duplica el pool que `database.js` ya instancia al importarlo y el cierre
  // queda en manos de `closePool()`.
  const connection = await pool.getConnection();

  try {
    // 1. Verifica que el esquema esté listo
    await assertSchemaReady(connection);
    
    // 2. Inicia una transacción SQL para garantizar atomicidad
    await connection.beginTransaction();

    try {
      // 3. Ejecuta ordenadamente cada fase de carga de datos mediante el helper runPhase
      const communityIds = await runPhase("comunidades", () => seedCommunities(connection));
      const userIds = await runPhase("usuarios", () =>
        seedUsers(connection, communityIds, passwordHashes),
      );
      await runPhase("incidencias", () => seedIssues(connection, communityIds, userIds));
      const meetingIds = await runPhase("reuniones", () =>
        seedMeetings(connection, communityIds),
      );
      await runPhase("asistencia", () => seedAttendees(connection, meetingIds, userIds));
      const voteIds = await runPhase("votaciones", () => seedVotes(connection, meetingIds, userIds));
      await runPhase("respuestas de voto", () => seedVoteResponses(connection, voteIds, userIds));
      await runPhase("reservas", () => seedBookings(connection, communityIds, userIds));

      // 4. Si todo va bien, confirma los cambios definitivamente en la base de datos
      await connection.commit();
    } catch (error) {
      // Si ocurre cualquier error a mitad, revierte todos los cambios de la transacción
      await connection.rollback();
      throw error;
    }

    // Muestra los resultados finales por consola
    console.log(
      `==> Seed completado: ${createdCount} fila(s) creada(s), ` +
        `${existingCount} ya existente(s).`,
    );

    if (createdCount === 0) {
      console.log("==> Sin cambios: los datos de demo ya estaban cargados.");
    } else {
      console.log("==> Acceso de demo: admin@domu.es / Admin1234! · vecinoN@domu.es / Vecino1234!");
    }
  } finally {
    // Bloque que se ejecuta siempre al terminar: devuelve la conexión al pool
    // compartido y cierra el pool de forma ordenada (nunca queda un socket abierto).
    connection.release();
    await closePool();
  }
}

// Ejecución del script principal manejando errores globales de forma limpia
main().catch((error) => {
  console.error(`✗ Error en el seed [${error.code ?? "UNKNOWN"}]: ${error.message}`);
  if (error.cause) {
    console.error(`  Causa: ${error.cause.message}`);
  }
  process.exitCode = 1;
});
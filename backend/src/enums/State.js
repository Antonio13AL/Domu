// =============================================================
// Enums de dominio
// =============================================================
//
// Fuente única de verdad de los estados y categorías que la
// aplicación acepta. Los valores coinciden literalmente con los
// `CHECK` de `database/migrations/001_init.sql`:

// Se añade `VoteOption` aunque no lo liste: existe en el
// esquema y exige validar que la opción pertenece a la
// votación. Todo se exporta congelado.
// =============================================================

/** Estado de una incidencia (`issues.state`). */
export const IssueStatus = Object.freeze({
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  REJECTED: "REJECTED",
});

/** Prioridad de una incidencia (`issues.priority`). */
export const IssuePriority = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
});

/** Categoría de una incidencia (`issues.category`, anulable). */
export const IssueCategory = Object.freeze({
  PLUMBING: "PLUMBING",
  ELECTRICAL: "ELECTRICAL",
  ELEVATOR: "ELEVATOR",
  CLEANING: "CLEANING",
  SECURITY: "SECURITY",
  OTHER: "OTHER",
});

/** Estado de una reserva (`bookings.status`). */
export const BookingStatus = Object.freeze({
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
});

/** Estado de una reunión (`meetings.state`). */
export const MeetingStatus = Object.freeze({
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
});

/** Asistencia a una reunión (`meeting_attendees.attendance_status`). */
export const AttendanceStatus = Object.freeze({
  PENDING: "PENDING",
  ATTENDED: "ATTENDED",
  ABSENT: "ABSENT",
  EXCUSED: "EXCUSED",
});

/** Estado de una votación (`votes.status`). */
export const VoteStatus = Object.freeze({
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
});

/** Opción de voto (`vote_responses.vote_option`). */
export const VoteOption = Object.freeze({
  AGREE: "AGREE",
  DISAGREE: "DISAGREE",
  NULL: "NULL",
});

/**
 * Constantes: *_VALUES
 * Propósito: listas blancas congeladas, una por enum, para
 * validaciones en servicios y modelos.
 * @type {ReadonlyArray<string>}
 */
export const ISSUE_STATUS_VALUES = Object.freeze(Object.values(IssueStatus));
export const ISSUE_PRIORITY_VALUES = Object.freeze(Object.values(IssuePriority));
export const ISSUE_CATEGORY_VALUES = Object.freeze(Object.values(IssueCategory));
export const BOOKING_STATUS_VALUES = Object.freeze(Object.values(BookingStatus));
export const MEETING_STATUS_VALUES = Object.freeze(Object.values(MeetingStatus));
export const ATTENDANCE_STATUS_VALUES = Object.freeze(Object.values(AttendanceStatus));
export const VOTE_STATUS_VALUES = Object.freeze(Object.values(VoteStatus));
export const VOTE_OPTION_VALUES = Object.freeze(Object.values(VoteOption));

/**
 * Función: createValidator
 * Propósito: fabrica una función validadora de enum. Es una ayuda
 * interna del módulo: cada enum expone su propio validador con
 * nombre (`isIssueStatus`, `isBookingStatus`, …) para que los
 * servicios no tengan que importar listas y comparar a mano.
 * @param {ReadonlyArray<string>} values - Lista blanca congelada.
 * @returns {(value: unknown) => boolean} Validador de tipo.
 */
function createValidator(values) {
  return function isEnumValue(value) {
    return typeof value === "string" && values.includes(value);
  };
}

export const isIssueStatus = createValidator(ISSUE_STATUS_VALUES);
export const isIssuePriority = createValidator(ISSUE_PRIORITY_VALUES);
export const isIssueCategory = createValidator(ISSUE_CATEGORY_VALUES);
export const isBookingStatus = createValidator(BOOKING_STATUS_VALUES);
export const isMeetingStatus = createValidator(MEETING_STATUS_VALUES);
export const isAttendanceStatus = createValidator(ATTENDANCE_STATUS_VALUES);
export const isVoteStatus = createValidator(VOTE_STATUS_VALUES);
export const isVoteOption = createValidator(VOTE_OPTION_VALUES);

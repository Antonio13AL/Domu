// =============================================================
// Rutas de reuniones y asistencia.
// =============================================================
//
// Dominio propio: las rutas de reunión y su asistencia. Las de
// votación están en `voteRoutes.js`.
//
// Este router declara rutas completas porque el contrato las reparte
// entre dos prefijos:
//
// | Método | Ruta                                       | Rol             | Descripción               |
// | ------ | ------------------------------------------ | --------------- | ------------------------- |
// | GET    | /communities/:communityId/meetings         | Miembro/Admin   | Listado con filtros/pag.  |
// | POST   | /communities/:communityId/meetings         | Admin           | Crear reunión             |
// | GET    | /meetings/:meetingId                       | Miembro/Admin   | Detalle y acta            |
// | PATCH  | /meetings/:meetingId                       | Admin           | Editar reunión            |
// | PATCH  | /meetings/:meetingId/status                | Admin           | Cambiar estado            |
// | GET    | /meetings/:meetingId/attendance            | Admin           | Listar asistencia         |
// | PUT    | /meetings/:meetingId/attendance            | Miembro         | Confirmar asistencia      |
//
// Las etiquetas de rol son:
// «Miembro» = NEIGHBOR y «Admin» = PRESIDENT. Las rutas «Miembro/
// Admin» solo exigen token: la pertenencia a la comunidad se
// comprueba en el servicio, que es donde está la fila `users`.
//
// Sin lógica de negocio: solo middlewares y controlador. El rol se
// comprueba aquí (defensa en profundidad) y otra vez en el servicio.
// =============================================================

import { Router } from "express";

import { MeetingController } from "../controllers/meetingController.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.js";

const router = Router();
const controller = new MeetingController();

// `authorizeRoles` valida su configuración en construcción y solo
// admite roles existentes del enum `Role`.
const presidentOnly = authorizeRoles(["PRESIDENT"]);
const neighborOnly = authorizeRoles(["NEIGHBOR"]);

// -------------------------------------------------------------
// Reuniones por comunidad
// -------------------------------------------------------------
router.get(
  "/communities/:communityId/meetings",
  authenticateToken,
  controller.listMeetings,
);
router.post(
  "/communities/:communityId/meetings",
  authenticateToken,
  presidentOnly,
  controller.createMeeting,
);

// -------------------------------------------------------------
// Reunión
// -------------------------------------------------------------
router.get("/:meetingId", authenticateToken, controller.getMeeting);

// Se declara la ruta con sufijo antes que la genérica por claridad.
router.patch(
  "/:meetingId/status",
  authenticateToken,
  presidentOnly,
  controller.changeMeetingStatus,
);
router.patch(
  "/:meetingId",
  authenticateToken,
  presidentOnly,
  controller.updateMeeting,
);

// -------------------------------------------------------------
// Asistencia
// -------------------------------------------------------------
router.get(
  "/:meetingId/attendance",
  authenticateToken,
  presidentOnly,
  controller.listAttendance,
);
router.put(
  "/:meetingId/attendance",
  authenticateToken,
  neighborOnly,
  controller.confirmAttendance,
);

export default router;

// =============================================================
// Rutas de votaciones.
// =============================================================
//
// Dominio propio: las siete rutas cuyo recurso es una votación,
// incluidas el listado y la creación como subrecurso de una reunión.
// Las de reunión y asistencia están en `meetingRoutes.js`.
//
// | Método | Ruta                                       | Rol             | Descripción                |
// | ------ | ------------------------------------------ | --------------- | -------------------------- |
// | GET    | /meetings/:meetingId/votes                 | Miembro/Admin   | Listar votaciones          |
// | POST   | /meetings/:meetingId/votes                 | Admin           | Crear votación             |
// | GET    | /votes/:voteId                             | Miembro/Admin   | Detalle                    |
// | PATCH  | /votes/:voteId                             | Admin           | Editar en DRAFT            |
// | PATCH  | /votes/:voteId/status                      | Admin           | Abrir/cerrar               |
// | POST   | /votes/:voteId/responses                   | Miembro         | Votar                      |
// | GET    | /votes/:voteId/results                     | Admin/Miembro   | Resultados (vecino: CLOSED)|
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

import { VoteController } from "../controllers/voteController.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.js";

const router = Router();
const controller = new VoteController();

// `authorizeRoles` valida su configuración en construcción y solo
// admite roles existentes del enum `Role`.
const presidentOnly = authorizeRoles(["PRESIDENT"]);
const neighborOnly = authorizeRoles(["NEIGHBOR"]);

// -------------------------------------------------------------
// Votaciones de una reunión
// -------------------------------------------------------------
router.get(
  "/meetings/:meetingId/votes",
  authenticateToken,
  controller.listVotes,
);
router.post(
  "/meetings/:meetingId/votes",
  authenticateToken,
  presidentOnly,
  controller.createVote,
);

// -------------------------------------------------------------
// Votación
// -------------------------------------------------------------
router.get("/:voteId", authenticateToken, controller.getVote);
// La ruta con sufijo se declara antes que la genérica por claridad.
router.get("/:voteId/results", authenticateToken, controller.getResults);
router.patch(
  "/:voteId/status",
  authenticateToken,
  presidentOnly,
  controller.changeVoteStatus,
);
router.patch(
  "/:voteId",
  authenticateToken,
  presidentOnly,
  controller.updateVote,
);
router.post(
  "/:voteId/responses",
  authenticateToken,
  neighborOnly,
  controller.castVote,
);

export default router;

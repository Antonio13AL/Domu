// =============================================================
// Rutas de comunidades y miembros — prefijo `/api/v1/communities`.
// =============================================================
//
// | Método | Ruta                                      | Rol         | Descripción             |
// | ------ | ----------------------------------------- | ----------- | ----------------------- |
// | GET    | /communities                              | Autenticado | Admin: todas; vecino: la suya |
// | POST   | /communities                              | President   | Crear comunidad         |
// | GET    | /communities/:communityId                 | Miembro/Admin | Detalle              |
// | PATCH  | /communities/:communityId                 | President   | Editar nombre/dirección |
// | PATCH  | /communities/:communityId/status          | President   | Archivar/activar        |
// | POST   | /communities/:communityId/invite-code     | President   | Rotar código            |
// | GET    | /communities/:communityId/members         | Miembro/Admin | Listar miembros       |
// | POST   | /communities/:communityId/members         | President   | Vincular usuario        |
// | PATCH  | /communities/:communityId/members/:userId | President   | Editar vivienda         |
// | DELETE | /communities/:communityId/members/:userId | President   | Desvincular             |
//
// Las rutas de lectura compartidas (detalle y miembros) solo exigen
// token. Las de escritura exigen rol `PRESIDENT`. La validación de datos y las reglas de negocio viven
// en el servicio, nunca aquí.
// =============================================================

import { Router } from "express";

import { CommunityController } from "../controllers/communityController.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.js";

const router = Router();
const controller = new CommunityController();

// `authorizeRoles` valida su configuración en construcción y solo admite roles existentes del enum `Role`.
const presidentOnly = authorizeRoles(["PRESIDENT"]);

// Se declaran primero las rutas con sufijo fijo para que no las capture una genérica posterior.
router.get("/", authenticateToken, controller.list);
router.post("/", authenticateToken, presidentOnly, controller.create);
router.get("/:communityId/members", authenticateToken, controller.listMembers);
router.post("/:communityId/members", authenticateToken, presidentOnly, controller.addMember);
router.patch(
  "/:communityId/members/:userId",
  authenticateToken,
  presidentOnly,
  controller.updateMember,
);
router.delete(
  "/:communityId/members/:userId",
  authenticateToken,
  presidentOnly,
  controller.removeMember,
);
router.patch(
  "/:communityId/status",
  authenticateToken,
  presidentOnly,
  controller.changeStatus,
);
router.post(
  "/:communityId/invite-code",
  authenticateToken,
  presidentOnly,
  controller.rotateInviteCode,
);
router.get("/:communityId", authenticateToken, controller.getById);
router.patch("/:communityId", authenticateToken, presidentOnly, controller.update);

export default router;

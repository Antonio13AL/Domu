// =============================================================
// Rutas de incidencias
// =============================================================
//
// Se monta en la raíz del prefijo `/api/v1`
//
// | Método | Ruta                                | Rol           | Descripción                |
// | ------ | ----------------------------------- | ------------- | -------------------------- |
// | GET    | /communities/:communityId/issues    | Miembro/Admin | Listado con filtros y pag. |
// | POST   | /communities/:communityId/issues    | Miembro/Admin | Crear                      |
// | GET    | /issues/:issueId                    | Miembro/Admin | Detalle                    |
// | PATCH  | /issues/:issueId                    | Autor/Admin   | Editar si está `PENDING`   |
// | PATCH  | /issues/:issueId/status             | Admin         | Cambiar estado             |
// | DELETE | /issues/:issueId                    | Admin         | Eliminar                   |
//
// «Admin» = `PRESIDENT`. La membresía de la comunidad y el
// ownership (autor/`PENDING`) se comprueban en el servicio; aquí
// solo se autentican y se autorizan roles. La validación de datos y
// las reglas de negocio viven en el servicio, nunca aquí.
// =============================================================

import { Router } from "express";

import { IssueController } from "../controllers/issueController.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.js";

const router = Router();
const controller = new IssueController();

const presidentOnly = authorizeRoles(["PRESIDENT"]);

router.get("/communities/:communityId/issues", authenticateToken, controller.list);
router.post("/communities/:communityId/issues", authenticateToken, controller.create);

router.get("/issues/:issueId", authenticateToken, controller.getById);
router.patch(
  "/issues/:issueId/status",
  authenticateToken,
  presidentOnly,
  controller.changeStatus,
);
router.delete("/issues/:issueId", authenticateToken, presidentOnly, controller.remove);
router.patch("/issues/:issueId", authenticateToken, controller.update);

export default router;

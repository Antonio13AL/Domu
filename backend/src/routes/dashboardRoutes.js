// =============================================================
// Rutas del panel (dashboard)
// =============================================================
//
// Se monta en la raíz del prefijo `/api/v1`
//
// | Método | Ruta                                        | Rol    | Descripción       |
// | ------ | ------------------------------------------- | ------ | ----------------- |
// | GET    | /communities/:communityId/dashboard/summary | Miembro | KPIs según el rol |
//
// La ruta se declara absoluta, igual que reservas, incidencias,
// reuniones y votaciones, porque este router cuelga de la raíz de
// `/api/v1`.
//
// «Miembro» = pertenencia activa a la comunidad, resuelta dentro del
// servicio con `MembershipService` (403 genérico también cuando la
// comunidad no existe, para no revelarla); `backend-rules.md` marca
// el endpoint como *Authenticated*, así que aquí solo se
// autentican el token y no se exige rol: son los dos roles
// existentes y cada uno recibe su propio bloque de KPIs. Sin lógica
// de negocio en la capa de ruta.
// =============================================================

import { Router } from "express";

import { DashboardController } from "../controllers/dashboardController.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();
const controller = new DashboardController();

router.get(
  "/communities/:communityId/dashboard/summary",
  authenticateToken,
  controller.getSummary,
);

export default router;

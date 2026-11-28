// =============================================================
// Controlador del panel (dashboard)
// =============================================================
//
// Extrae `req.params.communityId` y el usuario del token, llama al
// servicio y responde con:
//
//   { "status": "success", "data": { "summary": { ... } } }
//
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global. La capa no contiene SQL ni reglas de
// negocio: el bloque `kpis` (y su filtrado por rol) lo calcula
// íntegramente `DashboardService`.
//
// Nota: el servicio admite un reloj inyectable para los tests, pero
// el controlador no lo toma de la petición: la hora de los KPIs
// la fija el servidor, nunca el cliente.
//
// | Método | Ruta                                           | Código |
// | ------ | ---------------------------------------------- | ------ |
// | GET    | /communities/:communityId/dashboard/summary    | 200    |
// =============================================================

import { DashboardService } from "../services/dashboardService.js";

export class DashboardController {
  #dashboardService;

  constructor() {
    this.#dashboardService = new DashboardService();
  }

  /**
   * GET /api/v1/communities/:communityId/dashboard/summary — 200 con
   * el resumen de KPIs del rol autenticado (`NEIGHBOR` o
   * `PRESIDENT`).
   */
  getSummary = async (req, res, next) => {
    try {
      const summary = await this.#dashboardService.getSummary(
        req.params.communityId,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { summary },
      });
    } catch (error) {
      next(error);
    }
  };
}

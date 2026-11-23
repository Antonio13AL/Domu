// =============================================================
// Controlador de incidencias
// =============================================================
//
// Extrae `req.params`, `req.query` y `req.body`, llama al servicio y
// responde con:
//
//   { "status": "success", "data": { ... } }
//
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global.
// =============================================================

import { IssueService } from "../services/issueService.js";

export class IssueController {
  #issueService;

  constructor() {
    this.#issueService = new IssueService();
  }

  /**
   * GET /api/v1/communities/:communityId/issues — 200 con listado
   * y paginación.
   */
  list = async (req, res, next) => {
    try {
      const { issues, pagination } = await this.#issueService.list(
        req.params.communityId,
        req.query,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { issues, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/communities/:communityId/issues — 201 con la
   * incidencia creada.
   */
  create = async (req, res, next) => {
    try {
      const { issue } = await this.#issueService.create(
        req.params.communityId,
        req.body,
        req.user.id,
      );

      return res.status(201).json({
        status: "success",
        data: { issue },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/issues/:issueId — 200 con el detalle.
   */
  getById = async (req, res, next) => {
    try {
      const { issue } = await this.#issueService.getById(req.params.issueId, req.user.id);

      return res.status(200).json({
        status: "success",
        data: { issue },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/issues/:issueId — 200 con la incidencia editada.
   */
  update = async (req, res, next) => {
    try {
      const { issue } = await this.#issueService.update(
        req.params.issueId,
        req.body,
        req.user.id,
        req.user.role,
      );

      return res.status(200).json({
        status: "success",
        data: { issue },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/issues/:issueId/status — 200 con la incidencia
   * en su nuevo estado.
   */
  changeStatus = async (req, res, next) => {
    try {
      const { issue } = await this.#issueService.changeStatus(
        req.params.issueId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { issue },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/issues/:issueId — 200 con la confirmación.
   */
  remove = async (req, res, next) => {
    try {
      const { deleted } = await this.#issueService.remove(req.params.issueId, req.user.id);

      return res.status(200).json({
        status: "success",
        data: { deleted },
      });
    } catch (error) {
      next(error);
    }
  };
}

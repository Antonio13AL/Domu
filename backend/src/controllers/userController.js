// =============================================================
// Controlador de gestión de usuarios (capa 2 — sin SQL ni reglas).
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

import { UserService } from "../services/userService.js";

export class UserController {
  #userService;

  constructor() {
    this.#userService = new UserService();
  }

  /**
   * GET /api/v1/users — 200 con listado y paginación.
   */
  list = async (req, res, next) => {
    try {
      const { users, pagination } = await this.#userService.list(req.query);

      return res.status(200).json({
        status: "success",
        data: { users, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/users — 201 con el usuario creado.
   */
  create = async (req, res, next) => {
    try {
      const { user } = await this.#userService.create(req.body);

      return res.status(201).json({
        status: "success",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/users/:userId — 200 con el detalle.
   */
  getById = async (req, res, next) => {
    try {
      const { user } = await this.#userService.getById(req.params.userId);

      return res.status(200).json({
        status: "success",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/users/:userId — 200 con el usuario actualizado.
   */
  update = async (req, res, next) => {
    try {
      const { user } = await this.#userService.update(req.params.userId, req.body);

      return res.status(200).json({
        status: "success",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/users/:userId/status — 200 con el nuevo estado.
   */
  changeStatus = async (req, res, next) => {
    try {
      const { user } = await this.#userService.changeStatus(
        req.params.userId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  };
}

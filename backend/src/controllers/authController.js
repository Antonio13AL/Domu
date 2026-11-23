// =============================================================
// Controlador de autenticación.
// =============================================================
//
// Extrae los datos de `req.body`/`req.user`. { "status": "success", "data": { ... } }
// Los errores se delegan en `next(error)` para que los traduzca el `errorHandler` global.
// =============================================================

import { AuthService } from "../services/authService.js";

export class AuthController {
  #authService;

  constructor() {
    this.#authService = new AuthService();
  }

  register = async (req, res, next) => {
    try {
      const { token, user } = await this.#authService.register(req.body);

      return res.status(201).json({
        status: "success",
        data: { token, user },
      });
    } catch (error) {
      next(error);
    }
  };

  login = async (req, res, next) => {
    try {
      const { token, user } = await this.#authService.login(req.body);

      return res.status(200).json({
        status: "success",
        data: { token, user },
      });
    } catch (error) {
      next(error);
    }
  };

  me = async (req, res, next) => {
    try {
      const profile = await this.#authService.getProfile(req.user.id);

      return res.status(200).json({
        status: "success",
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (req, res, next) => {
    try {
      const result = await this.#authService.changePassword(req.user.id, req.body);

      return res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

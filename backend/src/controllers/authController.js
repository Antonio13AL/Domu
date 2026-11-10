// =============================================================
// Controlador de autenticación (capa 2 — sin SQL ni reglas).
// =============================================================
//
// Extrae los datos de `req.body`/`req.user`.
//
//   { "status": "success", "data": { ... } }
//
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global.
// =============================================================

import { AuthService } from "../services/authService.js";

export class AuthController {
  #authService;

  constructor() {
    this.#authService = new AuthService();
  }

  /**
   * POST /api/v1/auth/register — 201 con token y usuario.
   */
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

  /**
   * POST /api/v1/auth/login — 200 con token y usuario.
   */
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

  /**
   * GET /api/v1/auth/me — 200 con perfil y comunidades.
   */
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

  /**
   * PATCH /api/v1/auth/me/password — 200 con confirmación.
   */
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

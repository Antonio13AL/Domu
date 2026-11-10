// =============================================================
// Rutas de autenticación — prefijo `/api/v1/auth`.
// =============================================================
//
// | Método | Ruta                | Rol         | Descripción                  |
// | ------ | ------------------- | ----------- | ---------------------------- |
// | POST   | /auth/register      | Público     | Registro; `invite_code` opc. |
// | POST   | /auth/login         | Público     | Login; devuelve JWT y usuario|
// | GET    | /auth/me            | Autenticado | Perfil y comunidades         |
// | PATCH  | /auth/me/password   | Autenticado | Cambio de contraseña         |
//
// Sin lógica de negocio: solo middlewares (rate limit y
// autenticación) y controlador. El rate limit va antes del
// controlador para que ni siquiera se evalúe la petición.
// =============================================================

import { Router } from "express";

import { AuthController } from "../controllers/authController.js";
import { authenticateToken } from "../middlewares/auth.js";
import { loginRateLimit, registerRateLimit } from "../middlewares/rateLimit.js";

const router = Router();
const controller = new AuthController();

// Públicos, con límite de intentos.
router.post("/register", registerRateLimit, controller.register);
router.post("/login", loginRateLimit, controller.login);

// Autenticados.
router.get("/me", authenticateToken, controller.me);
router.patch("/me/password", authenticateToken, controller.changePassword);

export default router;

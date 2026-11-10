// =============================================================
// Rutas de gestión de usuarios — prefijo `/api/v1/users`.
// =============================================================
//
// | Método | Ruta                   | Rol             | Descripción                |
// | ------ | ---------------------- | --------------- | -------------------------- |
// | GET    | /users                 | President       | Listado con filtros y pag. |
// | POST   | /users                 | President       | Crear usuario              |
// | GET    | /users/:userId         | President       | Detalle                    |
// | PATCH  | /users/:userId         | President       | Editar datos/role          |
// | PATCH  | /users/:userId/status  | President       | Activar/desactivar         |
//
// Todas las rutas exigen token y rol; la validación de datos y las
// reglas de negocio viven en el servicio, nunca aquí.
// =============================================================

import { Router } from "express";

import { UserController } from "../controllers/userController.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.js";

const router = Router();
const controller = new UserController();

// `authorizeRoles` valida su configuración en construcción y solo
// admite roles existentes del enum `Role`.
const presidentOnly = authorizeRoles(["PRESIDENT"]);

// Se declara la ruta con sufijo antes que la genérica por claridad.
router.get("/", authenticateToken, presidentOnly, controller.list);
router.post("/", authenticateToken, presidentOnly, controller.create);
router.patch("/:userId/status", authenticateToken, presidentOnly, controller.changeStatus);
router.get("/:userId", authenticateToken, presidentOnly, controller.getById);
router.patch("/:userId", authenticateToken, presidentOnly, controller.update);

export default router;

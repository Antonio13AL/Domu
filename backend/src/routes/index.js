// =============================================================
// Router raíz de la API — prefijo `/api/v1`.
// =============================================================
//
// Es el único punto de montaje de la API: cada dominio se añade
// aquí como sub-router cuando se implemente.
//
// Las rutas que no existen caen en el middleware `notFound` y
// responden `404 NOT_FOUND` con el formato estándar.
// =============================================================

import { Router } from "express";

import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import communityRoutes from "./communityRoutes.js";

const router = Router();

// Autenticación: registro, login, perfil y contraseña.
router.use("/auth", authRoutes);

// Usuarios.
router.use("/users", userRoutes);

// Comunidades, miembros e invitaciones.
router.use("/communities", communityRoutes);

export default router;

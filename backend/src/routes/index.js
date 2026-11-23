// =============================================================
// Router raíz de la API — prefijo `/api/v1`.
// =============================================================
//
// Es el único punto de montaje de la API: cada dominio se añade
// aquí como sub-router cuando se implemente. Las incidencias ya
// están montadas en la raíz, porque su dominio ocupa dos familias
// de caminos (`/communities/:id/issues` y `/issues/:id`).
//
// Las rutas que no existen caen en el middleware `notFound` y
// responden `404 NOT_FOUND` con el formato estándar.
// =============================================================

import { Router } from "express";

import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import communityRoutes from "./communityRoutes.js";
import issueRoutes from "./issueRoutes.js";

const router = Router();

// Autenticación: registro, login, perfil y contraseña.
router.use("/auth", authRoutes);

// Usuarios.
router.use("/users", userRoutes);

// Comunidades, miembros e invitaciones.
router.use("/communities", communityRoutes);

// Usuarios: listado, alta, edición y estado (solo `PRESIDENT`).
router.use("/users", userRoutes);

// Incidencias.
router.use("/issues", issueRoutes);

export default router;

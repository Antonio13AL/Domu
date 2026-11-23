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
import meetingRoutes from "./meetingRoutes.js";
import voteRoutes from "./voteRoutes.js";

const router = Router();

// Autenticación: registro, login, perfil y contraseña.
router.use("/auth", authRoutes);

// Reuniones y asistencia (BE-10). Este router declara rutas
// completas (`/communities/:id/meetings` y `/meetings/...`), por lo
// que se monta en la raíz de la API.
router.use(meetingRoutes);

// Votaciones (BE-10): dominio separado, mismo montaje en la raíz.
// Los caminos no se solapan con los de `meetingRoutes`, que solo
// casan rutas de longitud exacta.
router.use(voteRoutes);

export default router;

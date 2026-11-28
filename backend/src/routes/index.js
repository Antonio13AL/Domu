// =============================================================
// Router raíz de la API — prefijo `/api/v1`.
// =============================================================
//
// Es el único punto de montaje de la API: cada dominio se añade
// aquí como sub-router cuando se implemente. Los dominios cuyos
// routers declaran rutas absolutas (panel, reservas, incidencias,
// reuniones y votaciones) se montan en la raíz; los que declaran
// rutas relativas (`/auth`, `/users` y `/communities`) consumen su
// propio prefijo.
//
// Las rutas que no existen caen en el middleware `notFound` y
// responden `404 NOT_FOUND` con el formato estándar.
// =============================================================

import { Router } from "express";

import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import communityRoutes from "./communityRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import bookingRoutes from "./bookingRoutes.js";
import issueRoutes from "./issueRoutes.js";
import meetingRoutes from "./meetingRoutes.js";
import voteRoutes from "./voteRoutes.js";

const router = Router();

// ---------------------------------------------------------------
// 1. Familias con prefijo fijo (`/auth`, `/users`, `/communities`):
//    el prefijo se consume aquí y cada router resuelve sus rutas
//    relativas (`/me`, `/:userId`, `/:communityId`, …).
// ---------------------------------------------------------------

// Autenticación: registro, login, perfil y contraseña.
router.use("/auth", authRoutes);

// Usuarios.
router.use("/users", userRoutes);

// Comunidades, miembros e invitaciones.
router.use("/communities", communityRoutes);

// Reservas: rutas absolutas (`/communities/:id/bookings`,
// `/communities/:id/bookings/availability` y `/bookings/:id`), por lo
// que se monta en la raíz, antes que el resto de familias absolutas
// para que su orden de declaración sea el primero de la sección 2.
router.use("/", bookingRoutes);

// Incidencias: rutas absolutas (`/communities/:id/issues` e
// `/issues/:id`), montadas en la raíz del prefijo.
router.use("/", issueRoutes);

// Reuniones, asistencia y votaciones: también rutas absolutas
// (`/communities/:id/meetings`, `/meetings/:id`, `/meetings/:id/votes`
// y `/votes/:id`), por lo que se montan en la raíz.
router.use("/", meetingRoutes);
router.use("/", voteRoutes);

// Panel: rutas absolutas (`/communities/:id/dashboard/summary`).
router.use("/", dashboardRoutes);

export default router;

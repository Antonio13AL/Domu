// =============================================================
// Rutas de reservas de espacios comunes
// =============================================================
//
// Se monta en la raíz del prefijo `/api/v1`
//
// | Método | Ruta                                            | Rol           | Descripción                 |
// | ------ | ----------------------------------------------- | ------------- | --------------------------- |
// | GET    | /communities/:communityId/bookings              | Miembro/Admin | Listado con filtros y pag.  |
// | GET    | /communities/:communityId/bookings/availability | Miembro/Admin | Franjas ocupadas del espacio|
// | POST   | /communities/:communityId/bookings              | Miembro/Admin | Crear (nace `PENDING`)      |
// | GET    | /bookings/:bookingId                            | Autor/Admin   | Detalle                     |
// | PATCH  | /bookings/:bookingId                            | Autor/Admin   | Editar mientras `PENDING`   |
// | PATCH  | /bookings/:bookingId/status                     | Admin         | Confirmar/rechazar/cancelar |
// | DELETE | /bookings/:bookingId                           | Autor/Admin   | Cancelar (no borra la fila) |
//
// Todas las rutas se declaran **absolutas** (sin prefijo del
// montaje), igual que incidencias, reuniones y votaciones, porque
// este router cuelga de la raíz de `/api/v1`.
//
// «Admin» = `PRESIDENT`, «Miembro» = `NEIGHBOR` y «Autor» es la
// propiedad de la reserva. En la capa de ruta solo se
// autentica con `authenticateToken` y se exige el rol `PRESIDENT`
// en el cambio de estado, que es el único punto que la tabla del
// Bookings reserva a «Admin»: el vecino cancela sus propias
// reservas con `DELETE /bookings/:bookingId`. La pertenencia a la
// comunidad, el ownership y el resto de reglas (franja, duración,
// solapamiento, transiciones) viven en el servicio, nunca aquí.
// =============================================================

import { Router } from "express";

import { BookingController } from "../controllers/bookingController.js";
import { authenticateToken, authorizeRoles } from "../middlewares/auth.js";

const router = Router();
const controller = new BookingController();

const presidentOnly = authorizeRoles(["PRESIDENT"]);

// -------------------------------------------------------------
// Reservas de la comunidad (`/communities/:communityId/bookings`)
// -------------------------------------------------------------
router.get(
  "/communities/:communityId/bookings",
  authenticateToken,
  controller.list,
);
router.get(
  "/communities/:communityId/bookings/availability",
  authenticateToken,
  controller.getAvailability,
);
router.post(
  "/communities/:communityId/bookings",
  authenticateToken,
  controller.create,
);

// -------------------------------------------------------------
// Reserva concreta (`/bookings/:bookingId`)
// -------------------------------------------------------------
router.get("/bookings/:bookingId", authenticateToken, controller.getById);
router.patch("/bookings/:bookingId", authenticateToken, controller.update);

// Resolución de la reserva: solo el presidente confirma, rechaza o
// cancela; el vecino cancela la suya con DELETE.
router.patch(
  "/bookings/:bookingId/status",
  authenticateToken,
  presidentOnly,
  controller.changeStatus,
);
router.delete("/bookings/:bookingId", authenticateToken, controller.remove);

export default router;

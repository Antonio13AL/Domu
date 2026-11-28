// =============================================================
// Controlador de reservas de espacios comunes
// =============================================================
//
// Extrae `req.params`, `req.query` y `req.body`, llama al servicio y
// responde con:
//
//   { "status": "success", "data": { ... } }
//
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global. La capa no contiene SQL ni reglas de
// negocio: el rol (`req.user.role`) y el usuario (`req.user.id`)
// solo se pasan al servicio.
//
// | Método | Ruta                                            | Código |
// | ------ | ----------------------------------------------- | ------ |
// | GET    | /communities/:communityId/bookings              | 200    |
// | GET    | /communities/:communityId/bookings/availability | 200    |
// | POST   | /communities/:communityId/bookings              | 201    |
// | GET    | /bookings/:bookingId                            | 200    |
// | PATCH  | /bookings/:bookingId                            | 200    |
// | PATCH  | /bookings/:bookingId/status                     | 200    |
// | DELETE | /bookings/:bookingId                           | 200    |
// =============================================================

import { BookingService } from "../services/bookingService.js";

export class BookingController {
  #bookingService;

  constructor() {
    this.#bookingService = new BookingService();
  }

  /**
   * GET /api/v1/communities/:communityId/bookings — 200 con listado
   * y paginación.
   */
  list = async (req, res, next) => {
    try {
      const { bookings, pagination } = await this.#bookingService.list(
        req.params.communityId,
        req.query,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { bookings, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/communities/:communityId/bookings/availability — 200
   * con las franjas ocupadas de un espacio en una fecha.
   */
  getAvailability = async (req, res, next) => {
    try {
      const { availability } = await this.#bookingService.getAvailability(
        req.params.communityId,
        req.query,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { availability },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/communities/:communityId/bookings — 201 con la
   * reserva creada (nace en `PENDING`).
   */
  create = async (req, res, next) => {
    try {
      const { booking } = await this.#bookingService.create(
        req.params.communityId,
        req.body,
        req.user.id,
      );

      return res.status(201).json({
        status: "success",
        data: { booking },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/bookings/:bookingId — 200 con el detalle (autor o
   * presidente).
   */
  getById = async (req, res, next) => {
    try {
      const { booking } = await this.#bookingService.getById(
        req.params.bookingId,
        req.user.id,
        req.user.role,
      );

      return res.status(200).json({
        status: "success",
        data: { booking },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/bookings/:bookingId — 200 con la reserva editada
   * (solo mientras está `PENDING`).
   */
  update = async (req, res, next) => {
    try {
      const { booking } = await this.#bookingService.update(
        req.params.bookingId,
        req.body,
        req.user.id,
        req.user.role,
      );

      return res.status(200).json({
        status: "success",
        data: { booking },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/bookings/:bookingId/status — 200 con la reserva en
   * su nuevo estado (`CONFIRMED`, `CANCELLED` o `REJECTED`).
   */
  changeStatus = async (req, res, next) => {
    try {
      const { booking } = await this.#bookingService.changeStatus(
        req.params.bookingId,
        req.body,
        req.user.id,
        req.user.role,
      );

      return res.status(200).json({
        status: "success",
        data: { booking },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/bookings/:bookingId — 200 con la reserva
   * cancelada: no se borra la fila, es histórico.
   */
  remove = async (req, res, next) => {
    try {
      const { booking } = await this.#bookingService.remove(
        req.params.bookingId,
        req.user.id,
        req.user.role,
      );

      return res.status(200).json({
        status: "success",
        data: { booking },
      });
    } catch (error) {
      next(error);
    }
  };
}

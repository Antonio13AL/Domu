// =============================================================
// Controlador de reuniones y asistencia.
// =============================================================
//
// Dominio propio: las rutas de reunión y su asistencia. Las rutas
// de votación están en `voteController.js`.
//
// Extrae `req.params`, `req.query`, `req.body` y `req.user`, llama
// al servicio y responde con:
//
//   { "status": "success", "data": { ... } }
//
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global.
// =============================================================

import { MeetingService } from "../services/meetingService.js";

export class MeetingController {
  #meetingService;

  constructor() {
    this.#meetingService = new MeetingService();
  }

  /**
   * GET /api/v1/communities/:communityId/meetings — 200 con listado y paginación.
   */
  listMeetings = async (req, res, next) => {
    try {
      const { meetings, pagination } = await this.#meetingService.listMeetings(
        req.params.communityId,
        req.query,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { meetings, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/communities/:communityId/meetings — 201 con la reunión creada.
   */
  createMeeting = async (req, res, next) => {
    try {
      const { meeting } = await this.#meetingService.createMeeting(
        req.params.communityId,
        req.body,
        req.user.id,
      );

      return res.status(201).json({
        status: "success",
        data: { meeting },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/meetings/:meetingId — 200 con el detalle y el acta.
   */
  getMeeting = async (req, res, next) => {
    try {
      const { meeting } = await this.#meetingService.getMeeting(
        req.params.meetingId,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { meeting },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/meetings/:meetingId — 200 con la reunión actualizada.
   */
  updateMeeting = async (req, res, next) => {
    try {
      const { meeting } = await this.#meetingService.updateMeeting(
        req.params.meetingId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { meeting },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/meetings/:meetingId/status — 200 con la reunión actualizada.
   */
  changeMeetingStatus = async (req, res, next) => {
    try {
      const { meeting } = await this.#meetingService.changeMeetingStatus(
        req.params.meetingId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { meeting },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/meetings/:meetingId/attendance — 200 con la asistencia.
   */
  listAttendance = async (req, res, next) => {
    try {
      const { attendees } = await this.#meetingService.listAttendance(
        req.params.meetingId,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { attendees },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/v1/meetings/:meetingId/attendance — 200 con la asistencia confirmada.
   */
  confirmAttendance = async (req, res, next) => {
    try {
      const { attendance } = await this.#meetingService.confirmAttendance(
        req.params.meetingId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { attendance },
      });
    } catch (error) {
      next(error);
    }
  };
}

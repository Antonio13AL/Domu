// =============================================================
// Controlador de votaciones.
// =============================================================
//
// Dominio propio: todas las rutas cuyo recurso es una votación,
// incluido el listado y la creación como subrecurso de una reunión
// (`/meetings/:meetingId/votes`).
//
// Extrae `req.params`, `req.query`, `req.body` y `req.user`, llama
// al servicio y responde con:
//
//   { "status": "success", "data": { ... } }
//
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global.
// =============================================================

import { VoteService } from "../services/voteService.js";

export class VoteController {
  #voteService;

  constructor() {
    this.#voteService = new VoteService();
  }

  /**
   * GET /api/v1/meetings/:meetingId/votes — 200 con el listado y la paginación.
   */
  listVotes = async (req, res, next) => {
    try {
      const { votes, pagination } = await this.#voteService.listVotes(
        req.params.meetingId,
        req.query,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { votes, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/meetings/:meetingId/votes — 201 con la votación creada.
   */
  createVote = async (req, res, next) => {
    try {
      const { vote } = await this.#voteService.createVote(
        req.params.meetingId,
        req.body,
        req.user.id,
      );

      return res.status(201).json({
        status: "success",
        data: { vote },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/votes/:voteId — 200 con el detalle.
   */
  getVote = async (req, res, next) => {
    try {
      const { vote } = await this.#voteService.getVote(req.params.voteId, req.user.id);

      return res.status(200).json({
        status: "success",
        data: { vote },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/votes/:voteId — 200 con la votación actualizada.
   */
  updateVote = async (req, res, next) => {
    try {
      const { vote } = await this.#voteService.updateVote(
        req.params.voteId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { vote },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/votes/:voteId/status — 200 con la votación actualizada.
   */
  changeVoteStatus = async (req, res, next) => {
    try {
      const { vote } = await this.#voteService.changeVoteStatus(
        req.params.voteId,
        req.body,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { vote },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/votes/:voteId/responses — 201 con el voto registrado.
   */
  castVote = async (req, res, next) => {
    try {
      const { response } = await this.#voteService.castVote(
        req.params.voteId,
        req.body,
        req.user.id,
      );

      return res.status(201).json({
        status: "success",
        data: { response },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/votes/:voteId/results — 200 con los resultados.
   */
  getResults = async (req, res, next) => {
    try {
      const { vote, results, total_responses } = await this.#voteService.getResults(
        req.params.voteId,
        req.user.id,
      );

      return res.status(200).json({
        status: "success",
        data: { vote, results, total_responses },
      });
    } catch (error) {
      next(error);
    }
  };
}

// =============================================================
// Controlador de comunidades y miembros.
// =============================================================
// Extrae `req.params`, `req.query` y `req.body`, llama al servicio y
// responde con: { "status": "success", "data": { ... } }.
// Los errores se delegan en `next(error)` para que los traduzca el
// `errorHandler` global.
// =============================================================

import { CommunityService } from "../services/communityService.js";

export class CommunityController {
  #communityService;

  constructor() {
    this.#communityService = new CommunityService();
  }

  list = async (req, res, next) => {
    try {
      const { communities, pagination } = await this.#communityService.list(
        req.user,
        req.query,
      );

      return res.status(200).json({
        status: "success",
        data: { communities, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (req, res, next) => {
    try {
      const { community } = await this.#communityService.create(req.body);

      return res.status(201).json({
        status: "success",
        data: { community },
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req, res, next) => {
    try {
      const { community } = await this.#communityService.getById(
        req.user,
        req.params.communityId,
      );

      return res.status(200).json({
        status: "success",
        data: { community },
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const { community } = await this.#communityService.update(
        req.params.communityId,
        req.body,
      );

      return res.status(200).json({
        status: "success",
        data: { community },
      });
    } catch (error) {
      next(error);
    }
  };

  changeStatus = async (req, res, next) => {
    try {
      const { community } = await this.#communityService.changeStatus(
        req.params.communityId,
        req.body,
      );

      return res.status(200).json({
        status: "success",
        data: { community },
      });
    } catch (error) {
      next(error);
    }
  };

  rotateInviteCode = async (req, res, next) => {
    try {
      const { community } = await this.#communityService.rotateInviteCode(
        req.params.communityId,
        req.body,
      );

      return res.status(200).json({
        status: "success",
        data: { community },
      });
    } catch (error) {
      next(error);
    }
  };

  listMembers = async (req, res, next) => {
    try {
      const { members, pagination } = await this.#communityService.listMembers(
        req.user,
        req.params.communityId,
        req.query,
      );

      return res.status(200).json({
        status: "success",
        data: { members, ...pagination },
      });
    } catch (error) {
      next(error);
    }
  };

  addMember = async (req, res, next) => {
    try {
      const { member } = await this.#communityService.addMember(
        req.params.communityId,
        req.body,
      );

      return res.status(200).json({
        status: "success",
        data: { member },
      });
    } catch (error) {
      next(error);
    }
  };

  updateMember = async (req, res, next) => {
    try {
      const { member } = await this.#communityService.updateMember(
        req.params.communityId,
        req.params.userId,
        req.body,
      );

      return res.status(200).json({
        status: "success",
        data: { member },
      });
    } catch (error) {
      next(error);
    }
  };

  removeMember = async (req, res, next) => {
    try {
      const { member } = await this.#communityService.removeMember(
        req.params.communityId,
        req.params.userId,
      );

      return res.status(200).json({
        status: "success",
        data: { member },
      });
    } catch (error) {
      next(error);
    }
  };
}

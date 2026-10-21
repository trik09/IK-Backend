import express from "express";
import {
  createRace,
  getPuzzleCategories,
  getAdminRaces,
  deleteRace,
  getPublicRaces,
  getRaceById,
  joinRace,
  updateVehicle,
  getRaceResults,
} from "../controllers/race.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import isUser, { optionalUser } from "../middleware/user.middleware.js";

const router = express.Router();

// Admin routes
router.post("/create", isAdmin, createRace);
router.get("/admin/categories", isAdmin, getPuzzleCategories);
router.get("/admin/list", isAdmin, getAdminRaces);
router.delete("/admin/:id", isAdmin, deleteRace);

// Student / Public routes
router.get("/list", optionalUser, getPublicRaces);
router.get("/:id", optionalUser, getRaceById);
router.post("/:id/join", isUser, joinRace);
router.post("/:id/vehicle", isUser, updateVehicle);
router.get("/:id/results", optionalUser, getRaceResults);

export default router;

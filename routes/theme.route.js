import express from "express";
import {
  createTheme,
  getThemes,
  getThemeById,
  updateTheme,
  deleteTheme,
  setThemePuzzles
} from "../controllers/theme.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { checkPermission } from "../middleware/permission.middleware.js";

const router = express.Router();

// Theme CRUD routes
router.post("/create-theme", isAdmin, checkPermission("puzzles", "create"), createTheme);
router.get("/get-themes", getThemes);
router.get("/get-theme/:id", getThemeById);
router.put("/update-theme/:id", isAdmin, checkPermission("puzzles", "update"), updateTheme);
router.delete("/delete-theme/:id", isAdmin, checkPermission("puzzles", "delete"), deleteTheme);

// Theme puzzle association
router.post("/set-theme-puzzles/:id", isAdmin, checkPermission("puzzles", "update"), setThemePuzzles);

export default router;

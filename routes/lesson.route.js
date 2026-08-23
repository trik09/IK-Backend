import { Router } from "express";
import isUser, { optionalUser } from "../middleware/user.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";
import {
  getLessonById, createLesson, updateLesson,
  updateLessonBlocks, deleteLesson, updateProgress,
} from "../controllers/lesson.controller.js";

const router = Router();

// Student / Public
router.get("/:id", optionalUser, getLessonById);
router.post("/:id/progress", isUser, updateProgress);

// Admin
router.post("/", isAdmin, createLesson);
router.put("/:id", isAdmin, updateLesson);
router.put("/:id/blocks", isAdmin, updateLessonBlocks);
router.delete("/:id", isAdmin, deleteLesson);

export default router;

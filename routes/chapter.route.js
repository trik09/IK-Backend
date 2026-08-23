import { Router } from "express";
import isAdmin from "../middleware/admin.middleware.js";
import { createChapter, updateChapter, deleteChapter, reorderChapters } from "../controllers/chapter.controller.js";

const router = Router();

// All chapter management routes are Admin protected
router.post("/", isAdmin, createChapter);
router.put("/reorder", isAdmin, reorderChapters);
router.put("/:id", isAdmin, updateChapter);
router.delete("/:id", isAdmin, deleteChapter);

export default router;

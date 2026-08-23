import { Router } from "express";
import isAdmin from "../middleware/admin.middleware.js";
import { getCategories, getCategoryById, createCategory, updateCategory, deleteCategory } from "../controllers/courseCategory.controller.js";

const router = Router();

// Public
router.get("/", getCategories);
router.get("/:id", getCategoryById);

// Admin only
router.post("/", isAdmin, createCategory);
router.put("/:id", isAdmin, updateCategory);
router.delete("/:id", isAdmin, deleteCategory);

export default router;

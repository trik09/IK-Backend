import express from "express";
import {
  createQuizCategory,
  getQuizCategories,
  getQuizCategoryById,
  updateQuizCategory,
  deleteQuizCategory
} from "../controllers/quizCategory.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { checkPermission } from "../middleware/permission.middleware.js";

const router = express.Router();

router.post("/create-category", isAdmin, checkPermission("quizzes", "create"), createQuizCategory);
router.get("/get-categories", getQuizCategories);
router.get("/get-category/:id", getQuizCategoryById);
router.put("/update-category/:id", isAdmin, checkPermission("quizzes", "update"), updateQuizCategory);
router.delete("/delete-category/:id", isAdmin, checkPermission("quizzes", "delete"), deleteQuizCategory);

export default router;


import express from "express";
import {
  createQuiz,
  getQuizzes,
  getQuizById,
  updateQuiz,
  deleteQuiz,
  deleteMultipleQuizzes,
} from "../controllers/quiz.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { checkPermission } from "../middleware/permission.middleware.js";

const router = express.Router();

router.post("/create-quiz", isAdmin, checkPermission("quizzes", "create"), createQuiz);
router.get("/get-quizzes", getQuizzes);
router.get("/get-quiz/:id", getQuizById);
router.put("/update-quiz/:id", isAdmin, checkPermission("quizzes", "update"), updateQuiz);
router.delete("/delete-quiz/:id", isAdmin, checkPermission("quizzes", "delete"), deleteQuiz);
router.post("/delete-multiple-quizzes", isAdmin, checkPermission("quizzes", "delete"), deleteMultipleQuizzes);

export default router;


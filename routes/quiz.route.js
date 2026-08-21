import express from "express";
import {
  createQuiz,
  getQuizzes,
  getQuizById,
  updateQuiz,
  deleteQuiz,
  deleteMultipleQuizzes,
  bulkCreateQuizzes,
  exportQuizzes,
  batchGetQuizzes,
} from "../controllers/quiz.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { checkPermission } from "../middleware/permission.middleware.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

// ── Body-size override for bulk quiz import only ──────────────────────────────
// Mirrors the same pattern used in puzzle.route.js for /bulk-create-puzzle.
// All other routes inherit the global 1mb limit set in index.js.
const bulkImportBodyParser = express.json({ limit: "200mb" });

router.post("/create-quiz", isAdmin, checkPermission("quizzes", "create"), createQuiz);
router.post("/bulk-create-quiz", isAdmin, checkPermission("quizzes", "create"), bulkImportBodyParser, bulkCreateQuizzes);
router.post("/export-quizzes", isAdmin, checkPermission("quizzes", "read"), exportQuizzes);
router.get("/get-quizzes", getQuizzes);
router.get("/get-quiz/:id", getQuizById);
router.get("/batch-get-quizzes", isAuthenticated, batchGetQuizzes);
router.put("/update-quiz/:id", isAdmin, checkPermission("quizzes", "update"), updateQuiz);
router.delete("/delete-quiz/:id", isAdmin, checkPermission("quizzes", "delete"), deleteQuiz);
router.post("/delete-multiple-quizzes", isAdmin, checkPermission("quizzes", "delete"), deleteMultipleQuizzes);

export default router;



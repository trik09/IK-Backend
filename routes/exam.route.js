import express from "express";
import {
  createExam,
  getAdminExams,
  getExamById,
  updateExam,
  deleteExam,
  getAdminExamLeaderboard,
  getPublicExams,
  getExamDetailsForUser,
  joinExam,
  saveAnswer,
  submitExam,
  getExamResults,
  getExamLeaderboard
} from "../controllers/exam.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { checkPermission } from "../middleware/permission.middleware.js";

const router = express.Router();

// ── Admin Routes ──────────────────────────────────────────────────────────────
router.post  ("/create-exam",                isAdmin, checkPermission("exams", "create"), createExam);
router.get   ("/admin/get-exams",            isAdmin, checkPermission("exams", "read"),   getAdminExams);
router.get   ("/admin/get-exam/:id",         isAdmin, checkPermission("exams", "read"),   getExamById);
router.put   ("/update-exam/:id",            isAdmin, checkPermission("exams", "update"), updateExam);
router.delete("/delete-exam/:id",            isAdmin, checkPermission("exams", "delete"), deleteExam);
router.get   ("/admin/exam-leaderboard/:id", isAdmin, checkPermission("exams", "read"),   getAdminExamLeaderboard);

// ── User Routes ───────────────────────────────────────────────────────────────
router.get ("/public/get-exams",          getPublicExams);                            // no auth — browseable
router.get ("/public/get-exam/:id",       isAuthenticated, getExamDetailsForUser);
router.post("/public/join-exam/:id",      isAuthenticated, joinExam);
router.post("/public/save-answer/:id",   isAuthenticated, saveAnswer);
router.post("/public/submit-exam/:id",   isAuthenticated, submitExam);
router.get ("/public/exam-results/:id",   isAuthenticated, getExamResults);
router.get ("/public/exam-leaderboard/:id", isAuthenticated, getExamLeaderboard);

export default router;

import express from "express";
import isUser from "../../../middleware/user.middleware.js";
import {
  getLearningDashboard,
  getChapterBySlug,
  getExerciseById,
  submitExerciseAttempt,
  completeExercise,
  requestExerciseHint,
  getUserProgress,
  resetProgress,
} from "../controllers/user.controller.js";

const router = express.Router();

router.get("/", isUser, getLearningDashboard);
router.get("/progress", isUser, getUserProgress);
router.post("/progress/reset", isUser, resetProgress);
router.get("/chapters/:slug", isUser, getChapterBySlug);
router.get("/exercises/:id", isUser, getExerciseById);
router.post("/exercises/:id/attempt", isUser, submitExerciseAttempt);
router.post("/exercises/:id/complete", isUser, completeExercise);
router.post("/exercises/:id/hint", isUser, requestExerciseHint);

export default router;

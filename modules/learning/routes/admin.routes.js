import express from "express";
import isAdmin from "../../../middleware/admin.middleware.js";
import { checkPermission } from "../../../middleware/permission.middleware.js";
import {
  getAdminDashboard,
  listSections,
  createSection,
  updateSection,
  deleteSection,
  reorderSections,
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  getChapterExercisesAdmin,
  listExercises,
  getExerciseAdmin,
  createExercise,
  updateExercise,
  deleteExercise,
  duplicateExercise,
  reorderExercises,
  validateExerciseAdmin,
  publishExercise,
} from "../controllers/admin.controller.js";

const router = express.Router();
const perm = (action) => checkPermission("learning", action);

router.get("/dashboard", isAdmin, perm("read"), getAdminDashboard);

router.get("/sections", isAdmin, perm("read"), listSections);
router.post("/sections", isAdmin, perm("create"), createSection);
router.patch("/sections/:id", isAdmin, perm("update"), updateSection);
router.delete("/sections/:id", isAdmin, perm("delete"), deleteSection);
router.post("/sections/reorder", isAdmin, perm("update"), reorderSections);

router.get("/chapters", isAdmin, perm("read"), listChapters);
router.post("/chapters", isAdmin, perm("create"), createChapter);
router.patch("/chapters/:id", isAdmin, perm("update"), updateChapter);
router.delete("/chapters/:id", isAdmin, perm("delete"), deleteChapter);
router.post("/chapters/reorder", isAdmin, perm("update"), reorderChapters);
router.get("/chapters/:id/exercises", isAdmin, perm("read"), getChapterExercisesAdmin);

router.get("/exercises", isAdmin, perm("read"), listExercises);
router.post("/exercises", isAdmin, perm("create"), createExercise);
router.get("/exercises/:id", isAdmin, perm("read"), getExerciseAdmin);
router.patch("/exercises/:id", isAdmin, perm("update"), updateExercise);
router.delete("/exercises/:id", isAdmin, perm("delete"), deleteExercise);
router.post("/exercises/:id/duplicate", isAdmin, perm("create"), duplicateExercise);
router.post("/exercises/reorder", isAdmin, perm("update"), reorderExercises);
router.post("/exercises/:id/validate", isAdmin, perm("update"), validateExerciseAdmin);
router.post("/exercises/:id/publish", isAdmin, perm("update"), publishExercise);

export default router;

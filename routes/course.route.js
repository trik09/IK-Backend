import { Router } from "express";
import isUser, { optionalUser } from "../middleware/user.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";
import {
  getCourses, getCoursesAdmin, getCourseBySlug, getCourseById,
  createCourse, updateCourse, deleteCourse, duplicateCourse,
  enrollInCourse, getCourseProgress, getMyCourses,
} from "../controllers/course.controller.js";

const router = Router();

// ── Public ───────────────────────────────────────────────────────────────────
router.get("/", getCourses);
router.get("/detail/:slug", optionalUser, getCourseBySlug);

// ── Authenticated User ──────────────────────────────────────────────────────
router.get("/my-courses", isUser, getMyCourses);
router.post("/:id/enroll", isUser, enrollInCourse);
router.get("/:id/progress", isUser, getCourseProgress);

// ── Admin ────────────────────────────────────────────────────────────────────
router.get("/admin/all", isAdmin, getCoursesAdmin);
router.get("/id/:id", isAdmin, getCourseById);
router.post("/", isAdmin, createCourse);
router.put("/:id", isAdmin, updateCourse);
router.delete("/:id", isAdmin, deleteCourse);
router.post("/:id/duplicate", isAdmin, duplicateCourse);

export default router;

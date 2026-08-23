import express from "express";
import { createFeedback, getAdminFeedbacks } from "../controllers/feedback.controller.js";
import isUser from "../middleware/user.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

router.post("/", isUser, createFeedback);
router.get("/admin", isAdmin, getAdminFeedbacks);

export default router;

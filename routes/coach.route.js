import express from "express";
import {
  applyBecomeCoach,
  getMarketplaceCoaches,
  getCoachProfile,
  createCoachInquiry,
  getAdminCoaches,
  updateCoachStatus,
  deleteCoachRecord,
  getAdminInquiries,
  updateInquiryStatus,
} from "../controllers/coach.controller.js";
import isUser from "../middleware/user.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

// Visitor/Member endpoints
router.post("/apply", applyBecomeCoach);
router.get("/marketplace", getMarketplaceCoaches);
router.get("/profile/:id", getCoachProfile);
router.post("/inquire", createCoachInquiry);

// Admin endpoints
router.get("/admin/applications", isAdmin, getAdminCoaches);
router.put("/admin/application/:id/status", isAdmin, updateCoachStatus);
router.delete("/admin/application/:id", isAdmin, deleteCoachRecord);
router.get("/admin/inquiries", isAdmin, getAdminInquiries);
router.put("/admin/inquiry/:id", isAdmin, updateInquiryStatus);

export default router;

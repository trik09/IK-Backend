import express from "express";
import jwt from "jsonwebtoken";
import {
  createNotification,
  getAdminNotifications,
  deleteNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead
} from "../controllers/notification.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { getAuthUserById } from "../utils/userAuthCache.js";

const router = express.Router();

// Helper for optional authentication
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.id) {
        req.user = await getAuthUserById(decoded.id);
      }
    }
  } catch {
    // Pass through if unauthenticated or token expired
  }
  next();
};

// ── Public / User Endpoints ───────────────────────────────────────────────
router.get("/", optionalAuth, getUserNotifications);
router.post("/read/:id", isAuthenticated, markAsRead);
router.post("/read-all", isAuthenticated, markAllAsRead);

// ── Admin Management Endpoints ────────────────────────────────────────────
router.post("/admin/create", isAdmin, createNotification);
router.get("/admin/list", isAdmin, getAdminNotifications);
router.delete("/admin/:id", isAdmin, deleteNotification);

export default router;

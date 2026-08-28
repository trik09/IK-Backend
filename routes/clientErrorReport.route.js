import express from "express";
import {
  createClientErrorReport,
  getClientErrorReports,
  getClientErrorReportById,
  updateClientErrorReportStatus,
  deleteClientErrorReport,
} from "../controllers/clientErrorReport.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";

import jwt from "jsonwebtoken";
import AdminModel from "../models/AdminSchema.js";
import { getAuthUserById } from "../utils/userAuthCache.js";

const router = express.Router();

const isAuthenticatedOrAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded?.id) {
            const user = await getAuthUserById(decoded.id);
            if (user) req.user = user;
          } else if (decoded?.email) {
            if (decoded.email === process.env.ADMIN_EMAIL) {
              req.admin = { email: decoded.email, role: "superadmin" };
            } else {
              const subAdmin = await AdminModel.findOne({ email: decoded.email }).lean();
              if (subAdmin) {
                req.admin = { id: subAdmin._id, email: subAdmin.email, role: "subadmin" };
              }
            }
          }
        } catch (err) {
          // Ignore token error and proceed
        }
      }
    }
    next();
  } catch (err) {
    next();
  }
};

// Students, authenticated users, or admins submit reports
router.post("/", isAuthenticatedOrAdmin, createClientErrorReport);

// Admin list / detail / status / delete
router.get("/", isAdmin, getClientErrorReports);
router.get("/:id", isAdmin, getClientErrorReportById);
router.patch("/:id/status", isAdmin, updateClientErrorReportStatus);
router.delete("/:id", isAdmin, deleteClientErrorReport);

export default router;

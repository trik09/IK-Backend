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

const router = express.Router();

// Students / authenticated users submit reports during exam or competition
router.post("/", isAuthenticated, createClientErrorReport);

// Admin list / detail / status / delete
router.get("/", isAdmin, getClientErrorReports);
router.get("/:id", isAdmin, getClientErrorReportById);
router.patch("/:id/status", isAdmin, updateClientErrorReportStatus);
router.delete("/:id", isAdmin, deleteClientErrorReport);

export default router;

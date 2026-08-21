import express from "express";
import {
  getPlatformSettings,
  updatePlatformSettings,
} from "../controllers/platformSettings.controller.js";
import isAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

router.get("/", getPlatformSettings);
router.patch("/", isAdmin, updatePlatformSettings);

export default router;

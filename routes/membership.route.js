import { Router } from "express";
import isUser from "../middleware/user.middleware.js";
import { upgradeToPro, getMembershipStatus, cancelMembership } from "../controllers/membership.controller.js";

const router = Router();

// All membership routes require authentication
router.post("/upgrade", isUser, upgradeToPro);
router.get("/status", isUser, getMembershipStatus);
router.post("/cancel", isUser, cancelMembership);

export default router;

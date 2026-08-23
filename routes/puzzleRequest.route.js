import express from "express";
import {
  createPuzzleRequest,
  getAdminPuzzleRequests,
  approvePuzzleRequest,
  rejectPuzzleRequest,
} from "../controllers/puzzleRequest.controller.js";
import isUser from "../middleware/user.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

router.post("/", isUser, createPuzzleRequest);
router.get("/admin", isAdmin, getAdminPuzzleRequests);
router.put("/admin/:id/approve", isAdmin, approvePuzzleRequest);
router.put("/admin/:id/reject", isAdmin, rejectPuzzleRequest);

export default router;

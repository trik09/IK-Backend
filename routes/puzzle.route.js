import express from "express";
import {
  createPuzzle,
  getPuzzles,
  getPuzzleById,
  updatePuzzle,
  deletePuzzle,
  deleteAllPuzzles,
  getPuzzlesWithFilters,
  getPuzzleStats,
  getRandomPuzzle,
  bulkCreatePuzzles,
  exportPuzzles,
  deleteMultiplePuzzles,
  validatePuzzles,
  deleteInvalidPuzzles,
  toggleDailyTraining,
  getPuzzleIds,
  getAdaptivePuzzle,
  submitPuzzleAttempt
} from "../controllers/puzzle.controller.js";
import isAdmin from "../middleware/admin.middleware.js";
import { checkPermission } from "../middleware/permission.middleware.js";
import isUser, { optionalUser } from "../middleware/user.middleware.js";

const router = express.Router();

// ── Body-size override for bulk import only ───────────────────────────────────
// All other routes inherit the global 1mb limit set in index.js.
// This route needs a larger limit because it receives thousands of puzzles in
// a single JSON array. The override only applies to this one route — it does
// NOT change the limit for any other endpoint.
const bulkImportBodyParser = express.json({ limit: "200mb" });

// Glicko-2 Adaptive Matchmaking & Attempt Submission Routes
router.get("/adaptive", optionalUser, getAdaptivePuzzle);
router.get("/next", optionalUser, getAdaptivePuzzle);
router.post("/attempt", optionalUser, submitPuzzleAttempt);
router.post("/:id/attempt", optionalUser, (req, res, next) => {
  if (req.params.id) req.body.puzzleId = req.params.id;
  return submitPuzzleAttempt(req, res, next);
});

// Manual puzzle routes
router.post("/create-puzzle", isAdmin, checkPermission("puzzles", "create"), createPuzzle);
router.post("/bulk-create-puzzle", isAdmin, checkPermission("puzzles", "create"), bulkImportBodyParser, bulkCreatePuzzles);
router.post("/export-puzzles", isAdmin, checkPermission("puzzles", "read"), exportPuzzles); // Changed from GET to POST to accept body
router.get("/get-puzzles", getPuzzles);
router.get("/get-puzzle-ids", isAdmin, checkPermission("puzzles", "read"), getPuzzleIds);
router.get("/get-puzzle/:id", getPuzzleById);
router.put("/update-puzzle/:id", isAdmin, checkPermission("puzzles", "update"), updatePuzzle);
router.delete("/delete-all-puzzles", isAdmin, checkPermission("puzzles", "delete"), deleteAllPuzzles);
router.post("/delete-multiple-puzzles", isAdmin, checkPermission("puzzles", "delete"), deleteMultiplePuzzles);
router.delete("/delete-puzzle/:id", isAdmin, checkPermission("puzzles", "delete"), deletePuzzle);
router.patch("/toggle-daily/:id", isAdmin, checkPermission("puzzles", "update"), toggleDailyTraining);

// Validation routes
router.get("/validate-puzzles", isAdmin, checkPermission("puzzles", "read"), validatePuzzles);
router.post("/delete-invalid-puzzles", isAdmin, checkPermission("puzzles", "delete"), deleteInvalidPuzzles);

// Lichess import routes
// Lichess import routes
// router.post("/import-lichess", isAdmin, importFromLichess); // Removed

router.get("/puzzles-filtered", getPuzzlesWithFilters);
router.get("/puzzle-stats", getPuzzleStats);

// Casual puzzle route (no auth required)
router.get("/random-puzzle", getRandomPuzzle);

export default router;

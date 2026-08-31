import express from 'express';
import {
  createCompetition,
  getCompetitions,
  getCompetitionById,
  updateCompetition,
  deleteCompetition,
  joinCompetition,
  submitSolution,
  getLeaderboard,
  getPuzzlesForCompetition,
  getPuzzlesByIds,
  getVar4RotationHistory,
  previewVar4RotatingCategories,
  recordVar4RotationHistory,
} from '../controllers/competition.controller.js';
import isAdmin from '../middleware/admin.middleware.js';
import isUser, { optionalUser } from '../middleware/user.middleware.js';
import { checkPermission } from '../middleware/permission.middleware.js';
const router = express.Router();

// Admin routes — auth + permission only; batch Var3/Var4 creation must not be rate-limited.
router.post('/create-competition', isAdmin, checkPermission('competitions', 'create'), createCompetition);
router.get('/', optionalUser, getCompetitions);

router.get('/puzzles/for-competition', isAdmin, checkPermission('competitions', 'create'), getPuzzlesForCompetition);
router.get('/var4/rotation-history', isAdmin, checkPermission('competitions', 'create'), getVar4RotationHistory);
router.get('/var4/preview-rotating-categories', isAdmin, checkPermission('competitions', 'create'), previewVar4RotatingCategories);
router.post('/var4/rotation-history', isAdmin, checkPermission('competitions', 'create'), recordVar4RotationHistory);
router.get('/:id', getCompetitionById);
router.put('/update-competition/:id', isAdmin, checkPermission('competitions', 'update'), updateCompetition);
router.delete('/delete-competition/:id', isAdmin, checkPermission('competitions', 'delete'), deleteCompetition);
router.post('/puzzles/by-ids', isAdmin, checkPermission('competitions', 'read'), getPuzzlesByIds);


// User routes
router.post('/:id/join', isUser, joinCompetition);
router.post('/:id/submit/:puzzleId', isUser, submitSolution);
router.get('/:id/leaderboard', getLeaderboard);

export default router;

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
  getPuzzlesByIds
} from '../controllers/competition.controller.js';
import isAdmin from '../middleware/admin.middleware.js';
import isUser, { optionalUser } from '../middleware/user.middleware.js';
import { checkPermission } from '../middleware/permission.middleware.js';

const router = express.Router();

// Admin routes
router.post('/create-competition', isAdmin, checkPermission('competitions', 'create'), createCompetition);
router.get('/', optionalUser, getCompetitions);

router.get('/puzzles/for-competition', isAdmin, checkPermission('competitions', 'create'), getPuzzlesForCompetition);
router.get('/:id', getCompetitionById);
router.put('/update-competition/:id', isAdmin, checkPermission('competitions', 'update'), updateCompetition);
router.delete('/delete-competition/:id', isAdmin, checkPermission('competitions', 'delete'), deleteCompetition);
router.post('/puzzles/by-ids', isAdmin, checkPermission('competitions', 'read'), getPuzzlesByIds);


// User routes
router.post('/:id/join', isUser, joinCompetition);
router.post('/:id/submit/:puzzleId', isUser, submitSolution);
router.get('/:id/leaderboard', getLeaderboard);

export default router;

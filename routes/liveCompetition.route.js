import express from 'express';
import {
  participateInCompetition,
  submitCompetition,
  submitPuzzleSolution,
  getLiveLeaderboard,
  getCompetitionPuzzles,
  startCompetition,
  getLobbyState,
  getActiveParticipation,
  getPuzzlesForEvent,
  getPuzzlesByIds
} from '../controllers/liveCompetition.controller.js';
import isUser from '../middleware/user.middleware.js';
import isAdmin from '../middleware/admin.middleware.js';

const router = express.Router();

router.get('/admin/puzzles/for-event', isAdmin, getPuzzlesForEvent);
router.post('/admin/puzzles/by-ids', isAdmin, getPuzzlesByIds);
// User routes for live competitions
router.get('/user/active-participation', isUser, getActiveParticipation); // Check active participation
router.post('/:competitionId/participate', isUser, participateInCompetition);
router.post('/:competitionId/submit', isUser, submitCompetition);
router.post('/:competitionId/puzzles/:puzzleId/submit', isUser, submitPuzzleSolution);
router.get('/:competitionId/leaderboard', getLiveLeaderboard);
router.get('/:competitionId/puzzles', isUser, getCompetitionPuzzles);
router.get(
  "/:competitionId/lobby-state",
  isUser,
  getLobbyState
);


// Admin routes
router.post('/:competitionId/start', isAdmin, startCompetition);

// Debug routes (remove in production)




export default router;
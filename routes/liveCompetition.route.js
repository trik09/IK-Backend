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
import {
  liveLeaderboardRateLimiter,
  liveLobbyRateLimiter,
  liveParticipateRateLimiter,
} from '../middleware/rateLimit.middleware.js';
import { liveSlowLogMiddleware } from '../middleware/liveSlowLog.middleware.js';
import { liveConcurrencyGuard, liveGetTimeout } from '../middleware/liveLoadGuard.middleware.js';

const router = express.Router();
const liveLog = liveSlowLogMiddleware(500);

router.use(liveConcurrencyGuard);
router.use(liveGetTimeout());

router.get('/admin/puzzles/for-event', isAdmin, getPuzzlesForEvent);
router.post('/admin/puzzles/by-ids', isAdmin, getPuzzlesByIds);
router.get('/user/active-participation', isUser, liveLog, getActiveParticipation);
router.post('/:competitionId/participate', isUser, liveLog, liveParticipateRateLimiter, participateInCompetition);
router.post('/:competitionId/submit', isUser, liveLog, submitCompetition);
router.post('/:competitionId/puzzles/:puzzleId/submit', isUser, liveLog, submitPuzzleSolution);
router.get('/:competitionId/leaderboard', isUser, liveLog, liveLeaderboardRateLimiter, getLiveLeaderboard);
router.get('/:competitionId/puzzles', isUser, liveLog, getCompetitionPuzzles);
router.get('/:competitionId/lobby-state', isUser, liveLog, liveLobbyRateLimiter, getLobbyState);


// Admin routes
router.post('/:competitionId/start', isAdmin, startCompetition);

// Debug routes (remove in production)




export default router;
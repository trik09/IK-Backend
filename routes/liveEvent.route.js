import express from 'express';
import {
  participateInEvent,
  submitEvent,
  submitEventPuzzleSolution,
  getLiveEventLeaderboard,
  getEventPuzzles,
  getActiveEventParticipation
} from '../controllers/liveEvent.controller.js';
import isUser, { optionalUser } from '../middleware/user.middleware.js';
import {
  liveLeaderboardRateLimiter,
  liveParticipateRateLimiter,
} from '../middleware/rateLimit.middleware.js';
import { liveSlowLogMiddleware } from '../middleware/liveSlowLog.middleware.js';
import { liveConcurrencyGuard, liveGetTimeout } from '../middleware/liveLoadGuard.middleware.js';

const router = express.Router();
const liveLog = liveSlowLogMiddleware(500);

router.use(liveConcurrencyGuard);
router.use(liveGetTimeout());

router.get('/user/active-participation', isUser, liveLog, getActiveEventParticipation);
router.post('/:eventId/participate', isUser, liveLog, liveParticipateRateLimiter, participateInEvent);
router.post('/:eventId/submit', isUser, liveLog, submitEvent);
router.post('/:eventId/puzzles/:puzzleId/submit', isUser, liveLog, submitEventPuzzleSolution);
router.get('/:eventId/leaderboard', optionalUser, liveLog, liveLeaderboardRateLimiter, getLiveEventLeaderboard);
router.get('/:eventId/puzzles', isUser, liveLog, getEventPuzzles);

export default router;

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

const router = express.Router();

// User routes for live events
router.get('/user/active-participation', isUser, getActiveEventParticipation);
router.post('/:eventId/participate', isUser, participateInEvent);
router.post('/:eventId/submit', isUser, submitEvent);
router.post('/:eventId/puzzles/:puzzleId/submit', isUser, submitEventPuzzleSolution);
router.get('/:eventId/leaderboard', optionalUser, getLiveEventLeaderboard);
router.get('/:eventId/puzzles', isUser, getEventPuzzles);

export default router;

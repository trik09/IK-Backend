import express from 'express';
import {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  createRound,
  getRoundsForEvent,
  updateRound,
  deleteRound,
  registerForEvent,
  getEventParticipants,
  approveParticipant,
  getUserRegistrations,
  getEventLeaderboard,
  updateRoundSelection,
} from '../controllers/event.controller.js';
import isAdmin from '../middleware/admin.middleware.js';
import isUser from '../middleware/user.middleware.js';
import { checkPermission } from '../middleware/permission.middleware.js';

const router = express.Router();

// ─── Admin Event CRUD ────────────────────────────────────────────────────────
router.post('/create-event', isAdmin, checkPermission('events', 'create'), createEvent);
router.put('/update-event/:id', isAdmin, checkPermission('events', 'update'), updateEvent);
router.delete('/delete-event/:id', isAdmin, checkPermission('events', 'delete'), deleteEvent);

// ─── Admin Round Management ──────────────────────────────────────────────────
router.post('/:id/rounds', isAdmin, checkPermission('events', 'update'), createRound);
router.put('/:id/rounds/:roundId', isAdmin, checkPermission('events', 'update'), updateRound);
router.put('/:id/rounds/:roundId/selection', isAdmin, checkPermission('events', 'update'), updateRoundSelection);
router.delete('/:id/rounds/:roundId', isAdmin, checkPermission('events', 'update'), deleteRound);

// ─── Admin Participant Management ────────────────────────────────────────────
router.get('/:id/participants', isAdmin, checkPermission('events', 'read'), getEventParticipants);
router.put('/:id/approve/:participantId', isAdmin, checkPermission('events', 'update'), approveParticipant);

// ─── Public / User Routes ────────────────────────────────────────────────────
router.get('/', getEvents);
router.get('/user/registrations', isUser, getUserRegistrations);

// NOTE: specific string routes must come before /:id
router.get('/:id/rounds', getRoundsForEvent);
router.get('/:id/leaderboard', getEventLeaderboard);
router.get('/:id', getEventById);

router.post('/:id/register', isUser, registerForEvent);

export default router;

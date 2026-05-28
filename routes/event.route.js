import express from 'express';
import {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  registerForEvent,
  getEventParticipants,
  approveParticipant,
  getUserRegistrations
} from '../controllers/event.controller.js';
import { getPuzzlesForCompetition } from '../controllers/competition.controller.js'; // can reuse puzzle list endpoint
import isAdmin from '../middleware/admin.middleware.js';
import isUser from '../middleware/user.middleware.js';
import { checkPermission } from '../middleware/permission.middleware.js';

const router = express.Router();

// Admin routes
router.post('/create-event', isAdmin, checkPermission('events', 'create'), createEvent);
router.get('/admin/puzzles/for-event', isAdmin, checkPermission('events', 'create'), getPuzzlesForCompetition); // reuse
router.get('/:id/participants', isAdmin, checkPermission('events', 'read'), getEventParticipants);
router.put('/:id/approve/:participantId', isAdmin, checkPermission('events', 'update'), approveParticipant);
router.put('/update-event/:id', isAdmin, checkPermission('events', 'update'), updateEvent);
router.delete('/delete-event/:id', isAdmin, checkPermission('events', 'delete'), deleteEvent);


// Public/User routes
router.get('/', getEvents);
router.get('/user/registrations', isUser, getUserRegistrations);
router.get('/:id', getEventById);
router.post('/:id/register', isUser, registerForEvent);


export default router;

const express = require('express');
const router = express.Router();
const tournamentService = require('../services/tournamentService');
const Tournament = require('../models/Tournament');
const { authenticate, isAdmin } = require('../middleware/auth');

// Get all tournaments
router.get('/', async (req, res) => {
    try {
        const tournaments = await Tournament.find()
            .select('name totalRounds currentRound startTime status players')
            .sort({ startTime: -1 });
        
        // Transform to include player count
        const result = tournaments.map(t => ({
            ...t.toObject(),
            playerCount: t.players.length
        }));
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tournaments' });
    }
});

// Get specific tournament details
router.get('/:id', async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id)
            .populate('players.user', 'username rating');
        
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
        res.json(tournament);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tournament' });
    }
});

// Create tournament (Admin only)
router.post('/', authenticate, isAdmin, async (req, res) => {
    try {
        const tournament = await tournamentService.createTournament(req.user._id, req.body);
        res.status(201).json(tournament);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Join tournament
router.post('/:id/join', authenticate, async (req, res) => {
    try {
        const tournament = await tournamentService.joinTournament(req.params.id, req.user);
        res.json(tournament);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Start next round (Admin only)
router.post('/:id/start-round', authenticate, isAdmin, async (req, res) => {
    try {
        const io = req.app.get('io');
        const tournament = await tournamentService.startNextRound(req.params.id, io);
        res.json(tournament);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get active pairings for the 2D world
router.get('/:id/pairings', async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

        // Get matches for the current round
        const currentRoundMatches = tournament.matches
            .filter(m => m.round === tournament.currentRound && m.result === null)
            .map((m, index) => ({
                boardId: index + 1,
                gameId: m.gameId,
                white: m.white, // In a real app, populate these names
                black: m.black
            }));

        res.json({ pairings: currentRoundMatches });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch pairings' });
    }
});

// Delete tournament (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const tournament = await Tournament.findByIdAndDelete(req.params.id);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
        res.json({ message: 'Tournament deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete tournament' });
    }
});

module.exports = router;



const express = require('express');
const router = express.Router();
const OfflineTournament = require('../models/OfflineTournament');
const { authenticate, isAdmin } = require('../middleware/auth');

// @desc    Get all tournaments with filtering
// @route   GET /api/events
router.get('/', async (req, res) => {
    try {
        const { city, state, type, featured, search } = req.query;
        let query = { isPublished: true };

        if (city) query['location.city'] = { $regex: city, $options: 'i' };
        if (state) query['location.state'] = { $regex: state, $options: 'i' };
        if (type) query.tournamentType = type;
        if (featured === 'true') query.isFeatured = true;
        
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { 'location.city': { $regex: search, $options: 'i' } }
            ];
        }

        const tournaments = await OfflineTournament.find(query).sort({ startDate: 1 });
        res.json(tournaments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// @desc    Get tournament by slug
// @route   GET /api/events/:slug
router.get('/:slug', async (req, res) => {
    try {
        const tournament = await OfflineTournament.findOne({ slug: req.params.slug, isPublished: true });
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
        res.json(tournament);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// @desc    Create tournament (Admin Only)
// @route   POST /api/admin/events
router.post('/admin', authenticate, isAdmin, async (req, res) => {
    try {
        const tournament = await OfflineTournament.create(req.body);
        res.status(201).json(tournament);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// @desc    Update tournament (Admin Only)
// @route   PUT /api/admin/events/:id
router.put('/admin/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const tournament = await OfflineTournament.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(tournament);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// @desc    Delete tournament (Admin Only)
// @route   DELETE /api/admin/events/:id
router.delete('/admin/:id', authenticate, isAdmin, async (req, res) => {
    try {
        await OfflineTournament.findByIdAndDelete(req.params.id);
        res.json({ message: 'Tournament deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;

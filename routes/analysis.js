const express = require('express');
const router = express.Router();
const Analysis = require('../models/Analysis');
const Game = require('../models/Game');
const { authenticate } = require('../middleware/auth');

/**
 * Request analysis for a completed game.
 */
router.post('/request/:gameId', authenticate, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const game = await Game.findById(gameId);
        
        if (!game) return res.status(404).json({ error: 'Game not found.' });
        if (game.status !== 'finished' && game.status !== 'abandoned') {
            return res.status(400).json({ error: 'Only completed games can be analyzed.' });
        }

        let analysis = await Analysis.findOne({ gameId });
        
        if (analysis) {
            if (analysis.status === 'completed') {
                return res.json(analysis);
            }
            if (analysis.status === 'processing' || analysis.status === 'pending') {
                return res.json({ message: 'Analysis is already in progress.', status: analysis.status });
            }
        } else {
            analysis = new Analysis({ gameId });
            await analysis.save();
        }

        // In a real BullMQ setup:
        // const analysisQueue = req.app.get('analysisQueue');
        // await analysisQueue.add('analyze', { gameId });

        // For the sake of this demo, we'll trigger it manually or mock the queue
        // We'll call the processor directly but in a "background" way
        const processAnalysis = require('../workers/analysisWorker');
        processAnalysis({ data: { gameId } });

        res.json({ message: 'Analysis requested.', status: 'processing' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to request analysis.' });
    }
});

/**
 * Get analysis results for a game.
 */
router.get('/:gameId', async (req, res) => {
    try {
        const analysis = await Analysis.findOne({ gameId: req.params.gameId });
        if (!analysis) return res.status(404).json({ error: 'Analysis not found.' });
        res.json(analysis);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch analysis.' });
    }
});

module.exports = router;

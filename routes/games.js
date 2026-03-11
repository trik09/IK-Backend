const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const jwt = require('jsonwebtoken');
const { generatePGN } = require('../services/gameService');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';

// Middleware to verify JWT
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { userId, username }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// GET Active Game for Current User
router.get('/active', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        const activeGame = await Game.findOne({
            status: { $in: ['playing', 'waiting'] },
            $or: [{ whitePlayer: userId }, { blackPlayer: userId }]
        });

        if (!activeGame) {
            return res.status(200).json({ hasActiveGame: false });
        }

        // Determine user's color
        const isWhite = activeGame.whitePlayer === userId;
        const color = isWhite ? 'w' : 'b';
        const opponent = isWhite ? activeGame.blackUsername : activeGame.whiteUsername;

        res.status(200).json({
            hasActiveGame: true,
            game: {
                roomId: activeGame.roomId,
                status: activeGame.status,
                color,
                opponent,
                fen: activeGame.finalFen,
                moveHistory: activeGame.moveHistory,
                drawOfferedBy: activeGame.drawOfferedBy
            }
        });

    } catch (err) {
        console.error('Error fetching active game:', err);
        res.status(500).json({ error: 'Failed to fetch active game' });
    }
});

// GET Full Game State by Room ID
router.get('/:roomId', authMiddleware, async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId });
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        res.status(200).json(game);
    } catch (err) {
        console.error('Error fetching game:', err);
        res.status(500).json({ error: 'Failed to fetch game' });
    }
});

// GET PGN Export
router.get('/:roomId/pgn', authMiddleware, async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId });
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        // Generate PGN if not stored
        const pgn = game.pgn || generatePGN(game);

        res.setHeader('Content-Type', 'application/x-chess-pgn');
        res.setHeader('Content-Disposition', `attachment; filename="game_${game.roomId}.pgn"`);
        res.send(pgn);
    } catch (err) {
        console.error('Error exporting PGN:', err);
        res.status(500).json({ error: 'Failed to export PGN' });
    }
});

// POST Resign from a game (REST fallback)
router.post('/:roomId/resign', authMiddleware, async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId });
        if (!game || game.status !== 'playing') {
            return res.status(404).json({ error: 'Active game not found' });
        }

        const userId = req.user.userId;
        const isWhite = game.whitePlayer === userId;
        const isBlack = game.blackPlayer === userId;

        if (!isWhite && !isBlack) {
            return res.status(403).json({ error: 'You are not a player in this game' });
        }

        const winner = isWhite ? 'black' : 'white';
        game.status = 'finished';
        game.winner = winner;
        game.endReason = 'resignation';
        game.pgn = generatePGN(game);
        await game.save();

        res.status(200).json({ winner, reason: 'resignation' });
    } catch (err) {
        console.error('Error resigning:', err);
        res.status(500).json({ error: 'Failed to resign' });
    }
});

// GET Game History for Logged-In User
router.get('/history/list', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        const games = await Game.find({
            status: { $in: ['finished', 'abandoned'] },
            $or: [{ whitePlayer: userId }, { blackPlayer: userId }]
        }).sort({ createdAt: -1 }).limit(20);

        res.status(200).json(games);

    } catch (err) {
        console.error('Error fetching game history:', err);
        res.status(500).json({ error: 'Failed to fetch game history' });
    }
});

module.exports = router;

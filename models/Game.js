const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true,
    },
    tournamentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tournament',
        default: null
    },
    whitePlayer: {
        type: String,
        default: null
    },
    blackPlayer: {
        type: String,
        default: null
    },
    whiteUsername: {
        type: String,
        default: 'Anonymous'
    },
    blackUsername: {
        type: String,
        default: 'Anonymous'
    },
    status: {
        type: String,
        enum: ['waiting', 'playing', 'finished', 'abandoned'],
        default: 'waiting'
    },
    winner: {
        type: String,
        enum: ['white', 'black', 'draw', null],
        default: null
    },
    endReason: {
        type: String,
        default: null // checkmate, stalemate, insufficient, repetition, resignation, timeout, abandoned, draw_agreement
    },
    moveHistory: [{
        san: String,   // Standard Algebraic Notation e.g., 'e4'
        from: String,  // e.g., 'e2'
        to: String,    // e.g., 'e4'
        color: String, // 'w' or 'b'
        fen: String,   // FEN state after the move
        timestamp: { type: Date, default: Date.now }
    }],
    finalFen: {
        type: String,
        default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    },
    drawOfferedBy: {
        type: String,
        default: null // userId of player who offered draw
    },
    pgn: {
        type: String,
        default: null
    },
    rated: {
        type: Boolean,
        default: true
    },
    ratingChanges: {
        white: { type: Number, default: null },
        black: { type: Number, default: null }
    },
    ratingBefore: {
        white: { type: Number, default: null },
        black: { type: Number, default: null }
    },
    ratingAfter: {
        white: { type: Number, default: null },
        black: { type: Number, default: null }
    },
    // Time control: { minutes, increment } — null means untimed
    timeControl: {
        minutes: { type: Number, default: null },
        increment: { type: Number, default: 0 } // seconds added after each move
    },
    // Remaining time in milliseconds for each side (persisted for reconnection)
    whiteClock: { type: Number, default: null },
    blackClock: { type: Number, default: null },
    // Whether the game clock has been started (Black made first move)
    clockStarted: { type: Boolean, default: false },
    // Timestamp of the last move (used to calculate elapsed time on refresh)
    lastMoveAt: { type: Date, default: null },
    // authoritative current state
    currentFen: {
        type: String,
        default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    },
    turn: {
        type: String,
        enum: ['w', 'b'],
        default: 'w'
    }
}, { timestamps: true });

module.exports = mongoose.model('Game', GameSchema);

const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    totalRounds: {
        type: Number,
        required: true,
        default: 5
    },
    currentRound: {
        type: Number,
        default: 0
    },
    timeControl: {
        minutes: { type: Number, required: true },
        increment: { type: Number, default: 0 }
    },
    startTime: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['upcoming', 'ongoing', 'completed', 'canceled'],
        default: 'upcoming'
    },
    players: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: String,
        score: { type: Number, default: 0 },
        buchholz: { type: Number, default: 0 },
        opponents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        colorHistory: [String], // 'w' or 'b'
        withdrawn: { type: Boolean, default: false },
        hasBye: { type: Boolean, default: false }
    }],
    matches: [{
        round: Number,
        white: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        black: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        result: { type: String, enum: ['1-0', '0-1', '0.5-0.5', 'bye', null], default: null },
        gameId: { type: String }
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Tournament', tournamentSchema);

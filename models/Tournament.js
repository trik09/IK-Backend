const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
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
    startTime: {
        type: Date,
        required: true
    },
    timeControl: {
        minutes: { type: Number, required: true },
        increment: { type: Number, default: 0 }
    },
    status: {
        type: String,
        enum: ['waiting', 'ongoing', 'completed', 'canceled'],
        default: 'waiting'
    },
    players: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: String,
        score: { type: Number, default: 0 },
        buchholz: { type: Number, default: 0 },
        opponents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        colorHistory: [String],
        receivedByes: [Number],
        withdrawn: { type: Boolean, default: false },
        joinedRound: { type: Number, default: 0 },
        hasLateJoinBye: { type: Boolean, default: false }
    }],
    matches: [{
        round: Number,
        white: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        black: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null if bye
        result: { type: String, enum: ['1-0', '0-1', '0.5-0.5', 'bye', null], default: null },
        gameId: String
    }],
    nextRoundStartTime: {
        type: Date,
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Tournament', TournamentSchema);

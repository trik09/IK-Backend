const mongoose = require('mongoose');

const AnalysisSchema = new mongoose.Schema({
    gameId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Game',
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    engine: {
        name: { type: String, default: 'Stockfish 16.1' },
        depth: { type: Number, default: 18 }
    },
    summary: {
        accuracy: {
            white: { type: Number, default: 0 },
            black: { type: Number, default: 0 }
        },
        opening: {
            name: String,
            eco: String,
            theoryEndedAt: Number
        },
        performance: {
            white: { type: String }, // e.g. "Aggressive", "Tactical"
            black: { type: String }
        },
        coachCommentary: { type: String }
    },
    analysisMoves: [{
        moveIndex: Number,
        ply: Number,
        san: String,
        color: String,
        eval: {
            type: Number, // centipawns
            isMate: Boolean,
            mateIn: Number
        },
        bestMove: {
            san: String,
            eval: Number
        },
        classification: {
            type: String,
            enum: ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'missed_win', 'forced', 'only_move', null]
        },
        explanation: { type: String }
    }],
    criticalMoments: [{
        moveIndex: Number,
        description: String,
        bestLine: [String]
    }],
    graphs: {
        evaluation: [Number], // eval at each ply
        winProbability: [Number]
    }
}, { timestamps: true });

module.exports = mongoose.model('Analysis', AnalysisSchema);

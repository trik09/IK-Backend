const { Worker } = require('bullmq');
const { Chess } = require('chess.js');
const Game = require('../models/Game');
const Analysis = require('../models/Analysis');
const analysisService = require('../services/analysisService');

/**
 * Worker to process chess game analysis.
 * In a real production environment, this would run Stockfish (WASM or binary).
 */
const processAnalysis = async (job) => {
    const { gameId, depth = 18 } = job.data;
    console.log(`🧠 Starting analysis for game: ${gameId}`);

    try {
        const game = await Game.findById(gameId);
        if (!game) throw new Error('Game not found');

        // Update Analysis status to processing
        await Analysis.findOneAndUpdate({ gameId }, { status: 'processing' });

        const chess = new Chess();
        const analysisMoves = [];
        const evals = [];
        
        let prevEval = 30; // Starting eval ~+0.3 for white

        // Iterate through move history
        for (let i = 0; i < game.moveHistory.length; i++) {
            const move = game.moveHistory[i];
            const boardBefore = chess.fen();
            
            // 1. MOCK ENGINE ANALYSIS (In production, call Stockfish here)
            // For now, we simulate engine behavior based on move quality
            // We'll calculate "best move" as either the move played (if good) or a random legal move
            const bestMoveSan = move.san; // Mocking best move
            const currentEvalValue = prevEval + (Math.random() * 20 - 10); // Mocking tiny changes
            const bestEvalValue = currentEvalValue; // Mocking best eval matches played move
            
            const classification = analysisService.classifyMove(
                prevEval, 
                currentEvalValue, 
                bestEvalValue, 
                move, 
                null, 
                false
            );

            const explanation = analysisService.generateExplanation(
                move,
                classification,
                prevEval,
                currentEvalValue,
                { san: bestMoveSan },
                null
            );

            analysisMoves.push({
                moveIndex: i,
                ply: i + 1,
                san: move.san,
                color: move.color,
                eval: {
                    value: currentEvalValue,
                    isMate: false,
                    mateIn: 0
                },
                bestMove: {
                    san: bestMoveSan,
                    eval: bestEvalValue
                },
                classification,
                explanation
            });

            evals.push(currentEvalValue);
            prevEval = currentEvalValue;
            chess.move(move.san);
        }

        // 2. Finalize Analysis
        const accuracyWhite = analysisService.calculateAccuracy(analysisMoves.filter(m => m.color === 'w'));
        const accuracyBlack = analysisService.calculateAccuracy(analysisMoves.filter(m => m.color === 'b'));

        await Analysis.findOneAndUpdate({ gameId }, {
            status: 'completed',
            summary: {
                accuracy: { white: accuracyWhite, black: accuracyBlack },
                opening: { name: 'Ruy Lopez', eco: 'C60', theoryEndedAt: 12 },
                performance: { white: 'Aggressive', black: 'Solid' },
                coachCommentary: `White played a very strong game with ${accuracyWhite}% accuracy. The turning point was at move 22 when black allowed a knight fork.`
            },
            analysisMoves,
            graphs: {
                evaluation: evals,
                winProbability: evals.map(e => 50 + (e / 10)) // Simple mock win prob
            }
        });

        console.log(`✅ Analysis completed for game: ${gameId}`);
    } catch (err) {
        console.error(`❌ Analysis failed for game ${gameId}:`, err);
        await Analysis.findOneAndUpdate({ gameId }, { status: 'failed' });
    }
};

module.exports = processAnalysis;

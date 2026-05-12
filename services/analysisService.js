const { Chess } = require('chess.js');

/**
 * Service to handle move classification and human-friendly insights.
 */
class AnalysisService {
    
    /**
     * Classifies a move based on centipawn loss and position context.
     */
    classifyMove(prevEval, currentEval, bestEval, move, boardAfter, isSacrifice) {
        const loss = bestEval - currentEval;
        
        // 1. Check for Blunders / Missed Wins
        if (loss > 200) {
            if (prevEval > 200 && currentEval < 50) return 'missed_win';
            return 'blunder';
        }
        
        // 2. Mistake
        if (loss > 90) return 'mistake';
        
        // 3. Inaccuracy
        if (loss > 40) return 'inaccuracy';
        
        // 4. Brilliant (Sacrifice that is the best move)
        if (isSacrifice && loss < 10 && currentEval > prevEval + 50) {
            return 'brilliant';
        }

        // 5. Great / Best / Excellent
        if (loss < 5) return 'best';
        if (loss < 15) return 'excellent';
        if (loss < 30) return 'good';

        return 'good';
    }

    /**
     * Generates a coach-like explanation for a move.
     */
    generateExplanation(move, classification, prevEval, currentEval, bestMove, boardBefore) {
        if (classification === 'blunder') {
            return `This move drastically changed the game. You missed ${bestMove.san}, which would have kept the position equal.`;
        }
        if (classification === 'mistake') {
            return `This allows your opponent to gain a significant advantage. ${bestMove.san} was a much stronger choice.`;
        }
        if (classification === 'missed_win') {
            return "You had a winning advantage but let it slip. This was a critical moment.";
        }
        if (classification === 'brilliant') {
            return `A stunning move! You sacrificed material to create unstoppable threats. Incredible vision.`;
        }
        if (classification === 'inaccuracy') {
            return "A bit passive. It doesn't lose the game, but it gives your opponent more breathing room.";
        }
        if (classification === 'best') {
            return "The best move in the position. You found the exact path the engine recommends.";
        }
        
        return null;
    }

    /**
     * Detects if a move is a sacrifice.
     */
    isSacrifice(move, boardBefore, boardAfter) {
        // Simplified: check if piece was captured or if a high-value piece was moved to an attacked square
        // without immediate recapture of equal value.
        // For now, return false as placeholder.
        return false;
    }

    /**
     * Calculates accuracy percentage for a player.
     */
    calculateAccuracy(moves) {
        if (moves.length === 0) return 100;
        const total = moves.reduce((acc, move) => {
            // Simplified accuracy formula
            const loss = Math.max(0, move.bestMove.eval - move.eval.value);
            return acc + Math.max(0, 100 - (loss / 2));
        }, 0);
        return Math.round(total / moves.length);
    }
}

module.exports = new AnalysisService();

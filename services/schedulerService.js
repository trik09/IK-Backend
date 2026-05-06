const Tournament = require('../models/Tournament');
const tournamentService = require('./tournamentService');

let ioInstance = null;

const init = (io) => {
    ioInstance = io;
    // Run every 10 seconds
    setInterval(checkUpcomingTournaments, 10000);
    setInterval(checkCompletedRounds, 15000);
};

/**
 * Automatically start upcoming tournaments when their startTime is reached
 */
const checkUpcomingTournaments = async () => {
    try {
        const now = new Date();
        const upcoming = await Tournament.find({
            status: 'upcoming',
            startTime: { $lte: now }
        });

        for (const tournament of upcoming) {
            console.log(`🚀 Automatically starting tournament: ${tournament.name}`);
            await tournamentService.startNextRound(tournament._id, ioInstance);
        }
    } catch (err) {
        console.error('Error in checkUpcomingTournaments:', err);
    }
};

/**
 * Automatically start the next round if all games in the current round are finished
 */
const checkCompletedRounds = async () => {
    try {
        const ongoing = await Tournament.find({ status: 'ongoing' });

        for (const tournament of ongoing) {
            // Get matches of current round
            const currentMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
            
            // Check if all are finished (result !== null)
            const allFinished = currentMatches.every(m => m.result !== null);

            if (allFinished && currentMatches.length > 0) {
                // If it's the last round, it will be marked as completed in startNextRound
                
                // Add a small delay/buffer before starting next round (e.g. 1 minute)
                // We can use a property in the model to track "nextRoundStartTime" if we want to be precise,
                // but for MVP, let's just wait until all finished, and if it's been finished for a bit, start.
                
                // For simplicity, let's check the updatedAt of the last match result
                // Actually, let's just start it. The user said "after 1 minute".
                
                // We'll add a 'nextRoundScheduled' flag or check time.
                // Let's keep it simple: if all finished, and last update was > 60s ago.
                const lastUpdate = tournament.updatedAt;
                const timeSinceLastUpdate = new Date() - new Date(lastUpdate);

                if (timeSinceLastUpdate > 60000) { // 1 minute
                    console.log(`⏩ Starting next round for ${tournament.name} (Round ${tournament.currentRound + 1})`);
                    await tournamentService.startNextRound(tournament._id, ioInstance);
                }
            }
        }
    } catch (err) {
        console.error('Error in checkCompletedRounds:', err);
    }
};

module.exports = { init };

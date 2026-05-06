const Tournament = require('../models/Tournament');
const tournamentService = require('./tournamentService');

let ioInstance = null;

const init = (io) => {
    ioInstance = io;
    // Run every 5 seconds for more responsive transitions
    setInterval(checkUpcomingTournaments, 5000);
    setInterval(checkScheduledRounds, 5000);
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
 * Automatically start the next round if the nextRoundStartTime has passed
 */
const checkScheduledRounds = async () => {
    try {
        const now = new Date();
        const scheduled = await Tournament.find({
            status: 'ongoing',
            nextRoundStartTime: { $ne: null, $lte: now }
        });

        for (const tournament of scheduled) {
            console.log(`⏩ Executing scheduled round ${tournament.currentRound + 1} for ${tournament.name}`);
            await tournamentService.startNextRound(tournament._id, ioInstance);
        }
    } catch (err) {
        console.error('Error in checkScheduledRounds:', err);
    }
};

module.exports = { init };

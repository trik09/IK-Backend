const Tournament = require('../models/Tournament');
const Game = require('../models/Game');
const mongoose = require('mongoose');
const gameService = require('./gameService');

/**
 * Calculate maximum feasible Swiss rounds for a given player count
 */
const calculateMaxRounds = (playerCount) => {
    if (playerCount < 2) return 0;
    if (playerCount === 2) return 1;
    if (playerCount <= 4) return 2;
    if (playerCount <= 8) return 3;
    if (playerCount <= 16) return 4;
    if (playerCount <= 32) return 5;
    if (playerCount <= 64) return 6;
    return Math.floor(Math.log2(playerCount)) + 1;
};

/**
 * Proper Swiss Pairing Logic
 */
const generatePairings = (players, roundNumber) => {
    // 1. Filter out withdrawn players
    let activePlayers = players.filter(p => !p.withdrawn);

    // 2. Sort by score (desc), then buchholz (desc)
    activePlayers.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz);

    const pairings = [];
    const pairedIds = new Set();

    // Helper to check if two players have played before
    const havePlayed = (p1, p2) => {
        return p1.opponents.some(id => id.toString() === p2.user.toString());
    };

    // 3. Handle BYE if odd number of players (Standard Swiss)
    if (activePlayers.length % 2 !== 0) {
        // Find candidate for bye: lowest score who hasn't had a bye yet
        const byeCandidateIndex = activePlayers.slice().reverse().findIndex(p => p.receivedByes.length === 0);
        const actualIndex = byeCandidateIndex === -1 ? activePlayers.length - 1 : (activePlayers.length - 1 - byeCandidateIndex);
        
        const byePlayer = activePlayers.splice(actualIndex, 1)[0];
        pairings.push({
            round: roundNumber,
            white: byePlayer.user,
            black: null,
            result: 'bye'
        });
        pairedIds.add(byePlayer.user.toString());
    }

    // 4. Pairing loop with floating
    for (let i = 0; i < activePlayers.length; i++) {
        const p1 = activePlayers[i];
        if (pairedIds.has(p1.user.toString())) continue;

        let p2Index = -1;
        
        // Try to find an opponent p1 hasn't played, starting from closest score
        for (let j = i + 1; j < activePlayers.length; j++) {
            const potentialP2 = activePlayers[j];
            if (pairedIds.has(potentialP2.user.toString())) continue;

            if (!havePlayed(p1, potentialP2)) {
                p2Index = j;
                break;
            }
        }

        if (p2Index !== -1) {
            const p2 = activePlayers[p2Index];
            
            // Color assignment balancing
            const p1W = p1.colorHistory.filter(c => c === 'w').length;
            const p1B = p1.colorHistory.filter(c => c === 'b').length;
            const p2W = p2.colorHistory.filter(c => c === 'w').length;
            const p2B = p2.colorHistory.filter(c => c === 'b').length;

            let white, black;
            // Balance based on who has played more of a color
            if ((p1W - p1B) > (p2W - p2B)) {
                white = p2.user; black = p1.user;
            } else {
                white = p1.user; black = p2.user;
            }

            pairings.push({
                round: roundNumber,
                white,
                black,
                result: null
            });

            pairedIds.add(p1.user.toString());
            pairedIds.add(p2.user.toString());
        }
    }

    // 4. Handle BYE for remaining player (if odd count or impossible pairings)
    const unpaired = activePlayers.filter(p => !pairedIds.has(p.user.toString()));
    for (const p of unpaired) {
        // Only one bye allowed per tournament for a player (standard Swiss)
        // Except for late join byes which are separate
        pairings.push({
            round: roundNumber,
            white: p.user,
            black: null,
            result: 'bye'
        });
    }

    return pairings;
};

const createTournament = async (adminId, data) => {
    const tournament = new Tournament({
        ...data,
        createdBy: adminId
    });
    return await tournament.save();
};

const joinTournament = async (tournamentId, user) => {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');
    
    // Lichess Style Late Join Limit: fewer than half rounds completed
    if (tournament.status === 'ongoing') {
        const limit = Math.ceil(tournament.totalRounds / 2);
        if (tournament.currentRound >= limit) {
            throw new Error(`Late joining is only allowed until round ${limit}.`);
        }
    }

    if (tournament.status === 'completed' || tournament.status === 'canceled') {
        throw new Error('Tournament has ended.');
    }
    
    const isJoined = tournament.players.some(p => p.user.toString() === user._id.toString());
    if (isJoined) return tournament;

    // Award 0.5 bye if joining late (after round 1 has started)
    let initialScore = 0;
    let hasLateJoinBye = false;
    if (tournament.currentRound > 0) {
        initialScore = 0.5;
        hasLateJoinBye = true;
    }

    tournament.players.push({
        user: user._id,
        username: user.username,
        score: initialScore,
        buchholz: 0,
        opponents: [],
        colorHistory: [],
        joinedRound: tournament.currentRound,
        hasLateJoinBye
    });

    return await tournament.save();
};

const startNextRound = async (tournamentId, io) => {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');
    
    tournament.nextRoundStartTime = null;

    // FEASIBILITY CHECK: If we can't pair anyone or reached max rounds
    const maxFeasible = calculateMaxRounds(tournament.players.length);
    if (tournament.currentRound >= maxFeasible && tournament.players.length < 10) {
        // If very low players, we might reach impossible pairings earlier
        console.log(`⚠️ Pairing feasibility limit reached for ${tournament.name}. Ending early.`);
        tournament.status = 'completed';
        await tournament.save();
        if (io) io.to(`tournament_${tournamentId}`).emit('tournament-completed', tournament);
        return tournament;
    }

    if (tournament.currentRound >= tournament.totalRounds) {
        tournament.status = 'completed';
        await tournament.save();
        if (io) io.to(`tournament_${tournamentId}`).emit('tournament-completed', tournament);
        return tournament;
    }

    tournament.currentRound += 1;
    tournament.status = 'ongoing';

    const newPairings = generatePairings(tournament.players, tournament.currentRound);
    
    // Create real games for each pairing
    for (const match of newPairings) {
        if (match.result !== 'bye') {
            const whitePlayer = tournament.players.find(p => p.user.toString() === match.white.toString());
            const blackPlayer = tournament.players.find(p => p.user.toString() === match.black.toString());
            
            const roomCode = await gameService.createTournamentGame(
                match.white, whitePlayer.username,
                match.black, blackPlayer.username,
                tournament.timeControl,
                tournamentId
            );
            
            match.gameId = roomCode; 
        } else {
            // Handle BYE logic (Full Bye = 1.0)
            const p = tournament.players.find(p => p.user.toString() === match.white.toString());
            if (p) {
                p.score += 1;
                p.receivedByes.push(tournament.currentRound);
            }
        }
    }

    tournament.matches.push(...newPairings);
    const savedTournament = await tournament.save();

    if (io) {
        io.to(`tournament_${tournamentId}`).emit('tournament-round-started', {
            tournamentId,
            round: tournament.currentRound,
            pairings: newPairings
        });
    }

    return savedTournament;
};

const updateMatchResult = async (tournamentId, gameId, result, io = null) => {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return;

    const match = tournament.matches.find(m => m.gameId && m.gameId.toString() === gameId.toString());
    if (!match) return;
    if (match.result !== null) return;

    match.result = result;

    const whitePlayer = tournament.players.find(p => p.user.toString() === match.white.toString());
    const blackPlayer = tournament.players.find(p => p.user.toString() === match.black.toString());

    if (result === '1-0') {
        if (whitePlayer) whitePlayer.score += 1;
    } else if (result === '0-1') {
        if (blackPlayer) blackPlayer.score += 1;
    } else if (result === '0.5-0.5') {
        if (whitePlayer) whitePlayer.score += 0.5;
        if (blackPlayer) blackPlayer.score += 0.5;
    }

    if (whitePlayer && blackPlayer) {
        whitePlayer.opponents.push(blackPlayer.user);
        whitePlayer.colorHistory.push('w');
        blackPlayer.opponents.push(whitePlayer.user);
        blackPlayer.colorHistory.push('b');
    }

    // Recalculate Buchholz
    tournament.players.forEach(p => {
        let bScore = 0;
        p.opponents.forEach(oppId => {
            const opp = tournament.players.find(op => op.user.toString() === oppId.toString());
            if (opp) bScore += opp.score;
        });
        p.buchholz = bScore;
    });

    // Check if round finished
    const currentMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
    const allFinished = currentMatches.every(m => m.result !== null);

    if (allFinished) {
        tournament.nextRoundStartTime = new Date(Date.now() + 60000);
        if (io) {
            io.to(`tournament_${tournamentId}`).emit('tournament-round-finished', {
                tournamentId,
                currentRound: tournament.currentRound,
                nextRoundStartTime: tournament.nextRoundStartTime
            });
        }
    }

    const saved = await tournament.save();
    if (io) io.to(`tournament_${tournamentId}`).emit('tournament-updated', saved);

    return saved;
};

module.exports = {
    createTournament,
    joinTournament,
    startNextRound,
    updateMatchResult,
    generatePairings,
    calculateMaxRounds
};

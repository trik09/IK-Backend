const Tournament = require('../models/Tournament');
const Game = require('../models/Game');
const mongoose = require('mongoose');

/**
 * Generate Swiss pairings for a specific round
 */
const generatePairings = (players, roundNumber) => {
    // 1. Filter out withdrawn players
    let activePlayers = players.filter(p => !p.withdrawn);

    // 2. Sort by score (desc), then buchholz (desc)
    activePlayers.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz);

    const pairings = [];
    const pairedIds = new Set();

    // 3. Handle BYE if odd number of players
    if (activePlayers.length % 2 !== 0) {
        // Give BYE to lowest ranked player who hasn't had one
        const byeCandidateIndex = activePlayers.slice().reverse().findIndex(p => !p.hasBye);
        const actualIndex = byeCandidateIndex === -1 ? activePlayers.length - 1 : (activePlayers.length - 1 - byeCandidateIndex);
        
        const byePlayer = activePlayers.splice(actualIndex, 1)[0];
        pairings.push({
            round: roundNumber,
            white: byePlayer.user,
            black: null, // null means BYE
            result: 'bye'
        });
        pairedIds.add(byePlayer.user.toString());
    }

    // 4. Pairing loop
    for (let i = 0; i < activePlayers.length; i++) {
        const p1 = activePlayers[i];
        if (pairedIds.has(p1.user.toString())) continue;

        let p2Index = -1;
        // Try to find an opponent p1 hasn't played
        for (let j = i + 1; j < activePlayers.length; j++) {
            const potentialP2 = activePlayers[j];
            if (pairedIds.has(potentialP2.user.toString())) continue;

            if (!p1.opponents.includes(potentialP2.user)) {
                p2Index = j;
                break;
            }
        }

        // If all players already played p1 (rare in Swiss), just take the next available
        if (p2Index === -1) {
            for (let j = i + 1; j < activePlayers.length; j++) {
                if (!pairedIds.has(activePlayers[j].user.toString())) {
                    p2Index = j;
                    break;
                }
            }
        }

        if (p2Index !== -1) {
            const p2 = activePlayers[p2Index];
            
            // Color assignment
            const p1WhiteCount = p1.colorHistory.filter(c => c === 'w').length;
            const p1BlackCount = p1.colorHistory.filter(c => c === 'b').length;
            const p2WhiteCount = p2.colorHistory.filter(c => c === 'w').length;
            const p2BlackCount = p2.colorHistory.filter(c => c === 'b').length;

            let white, black;
            // Very basic color balancing
            if (p1WhiteCount > p1BlackCount && p2BlackCount > p2WhiteCount) {
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
    if (tournament.status !== 'upcoming') throw new Error('Tournament already started');
    
    const isJoined = tournament.players.some(p => p.user.toString() === user._id.toString());
    if (isJoined) return tournament;

    tournament.players.push({
        user: user._id,
        username: user.username,
        score: 0,
        buchholz: 0,
        opponents: [],
        colorHistory: []
    });

    return await tournament.save();
};

const startNextRound = async (tournamentId) => {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');
    
    if (tournament.currentRound >= tournament.totalRounds) {
        tournament.status = 'completed';
        return await tournament.save();
    }

    tournament.currentRound += 1;
    tournament.status = 'ongoing';

    const newPairings = generatePairings(tournament.players, tournament.currentRound);
    
    // Add pairings to tournament matches
    tournament.matches.push(...newPairings);

    // Update player histories for BYEs
    newPairings.forEach(match => {
        if (match.result === 'bye') {
            const p = tournament.players.find(p => p.user.toString() === match.white.toString());
            if (p) {
                p.score += 1;
                p.hasBye = true;
            }
        }
    });

    return await tournament.save();
};

const updateMatchResult = async (tournamentId, gameId, result) => {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return;

    const match = tournament.matches.find(m => m.gameId && m.gameId.toString() === gameId.toString());
    if (!match) return;

    match.result = result;

    // Update scores
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

    // Update opponent history
    if (whitePlayer && blackPlayer) {
        whitePlayer.opponents.push(blackPlayer.user);
        whitePlayer.colorHistory.push('w');
        blackPlayer.opponents.push(whitePlayer.user);
        blackPlayer.colorHistory.push('b');
    }

    // Recalculate Buchholz for all players (sum of scores of opponents)
    tournament.players.forEach(p => {
        let bScore = 0;
        p.opponents.forEach(oppId => {
            const opp = tournament.players.find(op => op.user.toString() === oppId.toString());
            if (opp) bScore += opp.score;
        });
        p.buchholz = bScore;
    });

    return await tournament.save();
};

module.exports = {
    createTournament,
    joinTournament,
    startNextRound,
    updateMatchResult,
    generatePairings
};

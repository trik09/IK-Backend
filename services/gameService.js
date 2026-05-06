const { Chess } = require('chess.js');
const Game = require('../models/Game');

/**
 * In-memory active rooms map.
 */
const activeRooms = {};

// Disconnect grace period (30 seconds)
const DISCONNECT_TIMEOUT_MS = 30000;

// Helper to generate a 6-character room code
const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

/**
 * Get or create an in-memory room.
 */
const getActiveRoom = (roomCode) => {
    return activeRooms[roomCode] || null;
};

/**
 * Restore a room from the database into memory.
 * This is CRITICAL for recovery after server restart or cleanup.
 */
const restoreRoomFromDB = async (roomCode, io = null) => {
    const game = await Game.findOne({ roomId: roomCode, status: { $in: ['playing', 'waiting', 'finished', 'abandoned'] } });
    if (!game) return null;

    const chess = new Chess(game.currentFen || undefined);

    const tc = game.timeControl?.minutes != null ? game.timeControl : null;

    const restoredClocks = {
        w: game.whiteClock != null ? game.whiteClock : (tc ? tc.minutes * 60 * 1000 : null),
        b: game.blackClock != null ? game.blackClock : (tc ? tc.minutes * 60 * 1000 : null)
    };

    activeRooms[roomCode] = {
        gameInstance: chess,
        players: {},
        spectators: new Set(),
        disconnectTimers: {},
        timeoutTimer: null,
        clocks: restoredClocks,
        lastMoveTime: game.lastMoveAt ? new Date(game.lastMoveAt).getTime() : null,
        timeControl: tc,
        clockStarted: game.clockStarted || false
    };

    // Populate player info
    if (game.whitePlayer) {
        activeRooms[roomCode].players[game.whitePlayer] = { socketId: null, username: game.whiteUsername, color: 'w' };
    }
    if (game.blackPlayer) {
        activeRooms[roomCode].players[game.blackPlayer] = { socketId: null, username: game.blackUsername, color: 'b' };
    }

    // If game is in progress and clock started, resume ticking with CORRECT elapsed time
    if (game.status === 'playing' && game.clockStarted && io) {
        scheduleTimeout(roomCode, io);
    }

    return activeRooms[roomCode];
};

/**
 * Start/Reset the server-side timeout timer for the current player.
 * Accounts for time already elapsed since the turn started.
 */
const scheduleTimeout = (roomCode, io) => {
    const room = activeRooms[roomCode];
    if (!room || !room.clockStarted || !room.timeControl) return;

    if (room.timeoutTimer) {
        clearTimeout(room.timeoutTimer);
        room.timeoutTimer = null;
    }

    const currentTurn = room.gameInstance.turn();
    const elapsedSinceTurnStart = room.lastMoveTime ? Date.now() - room.lastMoveTime : 0;
    const realRemainingTime = room.clocks[currentTurn] - elapsedSinceTurnStart;

    if (realRemainingTime <= 0) {
        handleTimeout(roomCode, io);
        return;
    }

    room.timeoutTimer = setTimeout(() => {
        handleTimeout(roomCode, io);
    }, realRemainingTime + 200); // 200ms buffer
};

/**
 * Handle a clock timeout.
 */
const handleTimeout = async (roomCode, io) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    const currentTurn = room.gameInstance.turn();
    room.clocks[currentTurn] = 0;
    const winner = currentTurn === 'w' ? 'black' : 'white';

    const game = await Game.findOne({ roomId: roomCode });
    if (game && game.status === 'playing') {
        game.status = 'finished';
        game.winner = winner;
        game.endReason = 'timeout';
        game.whiteClock = room.clocks.w;
        game.blackClock = room.clocks.b;
        game.clockStarted = true;
        game.lastMoveAt = new Date();
        game.currentFen = room.gameInstance.fen();
        game.pgn = generatePGN(game);
        await game.save();
        await handleTournamentGameEnd(game, io);

        io.to(roomCode).emit('game_ended', {
            winner,
            reason: 'timeout',
            clocks: { 
                w: room.clocks.w, 
                b: room.clocks.b, 
                lastMoveAt: new Date().toISOString() 
            }
        });
        
        cleanupRoom(roomCode);
    }
};

/**
 * Create a specialized room for a tournament match
 */
const createTournamentGame = async (whiteId, whiteUsername, blackId, blackUsername, timeControl, tournamentId) => {
    const roomCode = generateRoomCode();
    
    const game = new Game({
        roomId: roomCode,
        tournamentId: tournamentId,
        whitePlayer: whiteId,
        whiteUsername: whiteUsername,
        blackPlayer: blackId,
        blackUsername: blackUsername,
        status: 'playing', // Auto-start
        timeControl: timeControl,
        whiteClock: timeControl ? timeControl.minutes * 60 * 1000 : null,
        blackClock: timeControl ? timeControl.minutes * 60 * 1000 : null,
        lastMoveAt: new Date(),
        clockStarted: true,
        currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turn: 'w'
    });

    await game.save();

    // Initialize in-memory state
    activeRooms[roomCode] = {
        gameInstance: new Chess(),
        players: {
            [whiteId]: { socketId: null, username: whiteUsername, color: 'w' },
            [blackId]: { socketId: null, username: blackUsername, color: 'b' }
        },
        spectators: new Set(),
        disconnectTimers: {},
        timeoutTimer: null,
        clocks: {
            w: timeControl ? timeControl.minutes * 60 * 1000 : null,
            b: timeControl ? timeControl.minutes * 60 * 1000 : null
        },
        lastMoveTime: Date.now(),
        timeControl: timeControl,
        clockStarted: true 
    };

    return roomCode;
};

/**
 * Create a new room.
 */
const createRoom = async (userId, username, timeControl = null) => {
    const roomCode = generateRoomCode();
    const hostColor = Math.random() < 0.5 ? 'w' : 'b';
    const initialClock = timeControl ? timeControl.minutes * 60 * 1000 : null;

    const newGame = new Game({
        roomId: roomCode,
        status: 'waiting',
        whitePlayer: hostColor === 'w' ? userId : null,
        blackPlayer: hostColor === 'b' ? userId : null,
        whiteUsername: hostColor === 'w' ? username : 'Anonymous',
        blackUsername: hostColor === 'b' ? username : 'Anonymous',
        timeControl: timeControl ? { minutes: timeControl.minutes, increment: timeControl.increment || 0 } : { minutes: null, increment: 0 },
        whiteClock: initialClock,
        blackClock: initialClock,
        clockStarted: false,
        lastMoveAt: null,
        currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turn: 'w'
    });
    await newGame.save();

    activeRooms[roomCode] = {
        gameInstance: new Chess(),
        players: { [userId]: { socketId: null, username, color: hostColor } },
        spectators: new Set(),
        disconnectTimers: {},
        timeoutTimer: null,
        clocks: { w: initialClock, b: initialClock },
        lastMoveTime: null,
        clockStarted: false,
        timeControl: timeControl ? { minutes: timeControl.minutes, increment: timeControl.increment || 0 } : null
    };

    return { roomCode, hostColor };
};

/**
 * Join an existing room.
 */
const joinRoom = async (roomCode, userId, username) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game) return { error: 'Room not found.' };
    
    const room = activeRooms[roomCode];
    if (!room) return { error: 'Room not found in memory.' };

    // If game is already playing (like tournament games), check if user is a participant
    if (game.status === 'playing') {
        const player = room.players[userId];
        if (player) {
            // Already a player, just reconnecting
            const opponentId = Object.keys(room.players).find(id => id !== userId);
            const opponent = room.players[opponentId];
            return {
                joinerColor: player.color,
                hostUserId: opponentId,
                hostUsername: opponent?.username || 'Opponent',
                hostColor: opponent?.color,
                clocks: getClocks(roomCode),
                timeControl: room.timeControl,
                tournamentId: game.tournamentId
            };
        }
        return { error: 'Game is already in progress.' };
    }

    if (game.status !== 'waiting') return { error: 'Game is already in progress.' };

    const hostUserId = Object.keys(room.players)[0];
    const hostColor = room.players[hostUserId].color;
    const joinerColor = hostColor === 'w' ? 'b' : 'w';

    room.players[userId] = { socketId: null, username, color: joinerColor };

    game.status = 'playing';
    if (joinerColor === 'w') {
        game.whitePlayer = userId;
        game.whiteUsername = username;
    } else {
        game.blackPlayer = userId;
        game.blackUsername = username;
    }
    await game.save();

    return {
        joinerColor,
        hostUserId,
        hostUsername: room.players[hostUserId].username,
        hostColor,
        clocks: getClocks(roomCode),
        timeControl: room.timeControl,
        tournamentId: game.tournamentId
    };
};

/**
 * Process a move with server-side authority on clocks and state.
 */
const makeMove = async (roomCode, move, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room || !room.gameInstance) return { error: 'Room not found.' };

    const playerInfo = room.players[userId];
    if (!playerInfo) return { error: 'You are not a player.' };

    const currentTurn = room.gameInstance.turn();
    if (playerInfo.color !== currentTurn) return { error: 'Not your turn.' };

    const now = Date.now();
    let clockUpdate = null;
    const isTimedGame = room.timeControl && room.clocks.w !== null && room.clocks.b !== null;

    if (isTimedGame) {
        if (!room.clockStarted) {
            // Clock starts on Black's first move (if White started)
            // or White's first move if it's a tournament game where it starts instantly.
            // Currently, tournament games start with clockStarted = true.
            if (currentTurn === 'b' || room.clockStarted) {
                room.clockStarted = true;
                room.lastMoveTime = now;
                scheduleTimeout(roomCode, io);
            }
            clockUpdate = { ...room.clocks, lastMoveAt: new Date(now).toISOString() };
        } else {
            const elapsed = room.lastMoveTime ? now - room.lastMoveTime : 0;
            room.clocks[currentTurn] -= elapsed;

            if (room.clocks[currentTurn] <= 0) {
                room.clocks[currentTurn] = 0;
                const winner = currentTurn === 'w' ? 'black' : 'white';
                const game = await Game.findOne({ roomId: roomCode });
                if (game) {
                    game.status = 'finished';
                    game.winner = winner;
                    game.endReason = 'timeout';
                    game.whiteClock = room.clocks.w;
                    game.blackClock = room.clocks.b;
                    game.clockStarted = true;
                    game.lastMoveAt = new Date(now);
                    game.currentFen = room.gameInstance.fen();
                    game.pgn = generatePGN(game);
                    await game.save();
                    await handleTournamentGameEnd(game, io);
                }
                return {
                    result: null,
                    newFen: room.gameInstance.fen(),
                    gameOverResult: { winner, reason: 'timeout' },
                    clocks: { ...room.clocks, lastMoveAt: new Date(now).toISOString() }
                };
            }

            const incrementMs = (room.timeControl.increment || 0) * 1000;
            room.clocks[currentTurn] += incrementMs;
            room.lastMoveTime = now;
            clockUpdate = { ...room.clocks, lastMoveAt: new Date(now).toISOString() };
            
            scheduleTimeout(roomCode, io);
        }
    } else {
        // Untimed game still updates lastMoveAt for consistency
        room.lastMoveTime = now;
        clockUpdate = { w: null, b: null, lastMoveAt: new Date(now).toISOString() };
    }

    try {
        const result = room.gameInstance.move(move);
        if (!result) return { error: 'Invalid move.' };

        const newFen = room.gameInstance.fen();
        const nextTurn = room.gameInstance.turn();

        let gameOverResult = null;
        if (room.gameInstance.isGameOver()) {
            gameOverResult = getGameOverResult(room.gameInstance);
            if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        }

        // Fire-and-forget async DB save, pushed to the macro-task queue
        // This ensures Socket.io emits instantly before MongoDB driver does any synchronous BSON work
        setImmediate(() => {
            saveMoveToDBAsync(roomCode, result, newFen, nextTurn, clockUpdate, room.clockStarted, room.lastMoveTime, gameOverResult, io);
        });

        return { result, newFen, gameOverResult, clocks: clockUpdate };
    } catch (error) {
        return { error: 'Move error.' };
    }
};

const saveMoveToDBAsync = async (roomCode, result, newFen, nextTurn, clockUpdate, clockStarted, lastMoveTime, gameOverResult, io) => {
    try {
        const game = await Game.findOne({ roomId: roomCode });
        if (game) {
            game.moveHistory.push({ san: result.san, from: result.from, to: result.to, color: result.color, fen: newFen });
            game.finalFen = newFen;
            game.currentFen = newFen;
            game.turn = nextTurn;
            game.drawOfferedBy = null;
            game.clockStarted = clockStarted;
            game.lastMoveAt = lastMoveTime ? new Date(lastMoveTime) : null;
            
            if (clockUpdate) {
                game.whiteClock = clockUpdate.w;
                game.blackClock = clockUpdate.b;
            }

            if (gameOverResult) {
                game.status = 'finished';
                game.winner = gameOverResult.winner;
                game.endReason = gameOverResult.reason;
                game.pgn = generatePGN(game);
                await game.save();
                await handleTournamentGameEnd(game, io);
            } else {
                await game.save();
            }
        }
    } catch (err) {
        console.error('Async DB Save error:', err);
    }
};

const getGameOverResult = (gameInstance) => {
    let winner = null;
    let reason = 'draw';
    if (gameInstance.isCheckmate()) {
        winner = gameInstance.turn() === 'w' ? 'black' : 'white';
        reason = 'checkmate';
    } else if (gameInstance.isStalemate()) reason = 'stalemate';
    else if (gameInstance.isThreefoldRepetition()) reason = 'repetition';
    else if (gameInstance.isInsufficientMaterial()) reason = 'insufficient';
    return { winner, reason };
};

const handleTournamentGameEnd = async (game, io = null) => {
    if (!game.tournamentId) return;
    try {
        const tournamentService = require('./tournamentService');
        let result = '0-0';
        if (game.winner === 'white') result = '1-0';
        else if (game.winner === 'black') result = '0-1';
        else if (game.winner === 'draw') result = '0.5-0.5';

        await tournamentService.updateMatchResult(game.tournamentId, game.roomId, result, io);
        console.log(`🏆 Tournament match updated: ${game.roomId} -> ${result}`);
    } catch (err) {
        console.error('❌ Error updating tournament match:', err);
    }
};

const getActiveGameForUser = async (userId) => {
    let game = await Game.findOne({
        status: { $in: ['playing', 'waiting'] },
        $or: [{ whitePlayer: userId }, { blackPlayer: userId }]
    }).sort({ updatedAt: -1 });
    if (game) return game;

    const fiveSecondsAgo = new Date(Date.now() - 5 * 1000);
    return await Game.findOne({
        status: { $in: ['finished', 'abandoned'] },
        $or: [{ whitePlayer: userId }, { blackPlayer: userId }],
        updatedAt: { $gte: fiveSecondsAgo }
    }).sort({ updatedAt: -1 });
};

const resignGame = async (roomCode, userId, io) => {
    const room = activeRooms[roomCode];
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'No active game.' };
    const winner = game.whitePlayer === userId ? 'black' : 'white';
    game.status = 'finished';
    game.winner = winner;
    game.endReason = 'resignation';
    game.lastMoveAt = new Date();
    game.pgn = generatePGN(game);
    if (room) {
        game.whiteClock = room.clocks.w;
        game.blackClock = room.clocks.b;
        if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
    }
    await game.save();
    await handleTournamentGameEnd(game, io);
    return { winner, reason: 'resignation' };
};

const offerDraw = async (roomCode, userId) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'No active game.' };
    game.drawOfferedBy = userId;
    await game.save();
    return { success: true };
};

const respondToDraw = async (roomCode, userId, accept, io) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'No active game.' };
    if (accept) {
        game.status = 'finished';
        game.winner = 'draw';
        game.endReason = 'draw_agreement';
        game.lastMoveAt = new Date();
        game.pgn = generatePGN(game);
        const room = activeRooms[roomCode];
        if (room && room.timeoutTimer) clearTimeout(room.timeoutTimer);
    }
    game.drawOfferedBy = null;
    await game.save();
    if (accept) await handleTournamentGameEnd(game, io);
    return { accepted: accept, winner: accept ? 'draw' : null, reason: accept ? 'draw_agreement' : null };
};

const handleDisconnect = (roomCode, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room) return;
    room.disconnectTimers[userId] = setTimeout(async () => {
        const game = await Game.findOne({ roomId: roomCode });
        if (!game || game.status !== 'playing') return;
        const winner = game.whitePlayer === userId ? 'black' : 'white';
        game.status = 'abandoned';
        game.winner = winner;
        game.endReason = 'abandoned';
        game.lastMoveAt = new Date();
        game.pgn = generatePGN(game);
        if (room) {
            game.whiteClock = room.clocks.w;
            game.blackClock = room.clocks.b;
            if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        }
        await game.save();
        handleTournamentGameEnd(game);
        io.to(roomCode).emit('game_ended', { winner, reason: 'abandoned', message: 'Opponent abandoned.' });
        cleanupRoom(roomCode);
    }, DISCONNECT_TIMEOUT_MS);
};

const cancelDisconnectTimer = (roomCode, userId) => {
    const room = activeRooms[roomCode];
    if (room && room.disconnectTimers[userId]) {
        clearTimeout(room.disconnectTimers[userId]);
        delete room.disconnectTimers[userId];
    }
};

const updatePlayerSocket = (roomCode, userId, socketId) => {
    const room = activeRooms[roomCode];
    if (room && room.players[userId]) room.players[userId].socketId = socketId;
};

const findRoomForUser = (userId) => {
    for (const [code, data] of Object.entries(activeRooms)) {
        if (data.players[userId]) return code;
    }
    return null;
};

const cleanupRoom = (roomCode) => {
    const room = activeRooms[roomCode];
    if (room) {
        for (const t of Object.values(room.disconnectTimers)) clearTimeout(t);
        if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        delete activeRooms[roomCode];
    }
};

const generatePGN = (game) => {
    const tags = [
        `[Event "Indian Knights Online Game"]`,
        `[Site "Indian Knights"]`,
        `[Date "${new Date(game.createdAt).toISOString().split('T')[0].replace(/-/g, '.')}"]`,
        `[Round "-"]`,
        `[White "${game.whiteUsername || 'Anonymous'}"]`,
        `[Black "${game.blackUsername || 'Anonymous'}"]`
    ];
    if (game.timeControl?.minutes != null) tags.push(`[TimeControl "${game.timeControl.minutes * 60}+${game.timeControl.increment || 0}"]`);
    let res = '*';
    if (game.winner === 'white') res = '1-0';
    else if (game.winner === 'black') res = '0-1';
    else if (game.winner === 'draw') res = '1/2-1/2';
    tags.push(`[Result "${res}"]`);
    if (game.finalFen && game.finalFen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') tags.push(`[FEN "${game.finalFen}"]`);
    let moveText = '';
    for (let i = 0; i < game.moveHistory.length; i++) {
        const m = game.moveHistory[i];
        if (m.color === 'w') moveText += `${Math.floor(i / 2) + 1}. `;
        moveText += `${m.san} `;
    }
    moveText += res;
    return tags.join('\n') + '\n\n' + moveText.trim() + '\n';
};

const startClock = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return { error: 'No room.' };
    if (room.clockStarted) return { error: 'Started.' };
    room.clockStarted = true;
    room.lastMoveTime = Date.now();
    return { success: true, clocks: getClocks(roomCode) };
};

/**
 * Get current clocks for a room (snapshotted).
 * Includes lastMoveAt timestamp for real-time synchronization.
 */
const getClocks = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return null;
    return { 
        w: room.clocks.w, 
        b: room.clocks.b, 
        lastMoveAt: room.lastMoveTime ? new Date(room.lastMoveTime).toISOString() : null 
    };
};

module.exports = {
    activeRooms, getActiveRoom, restoreRoomFromDB, createRoom, joinRoom, makeMove, getClocks, startClock,
    getActiveGameForUser, resignGame, offerDraw, respondToDraw, handleDisconnect, cancelDisconnectTimer,
    updatePlayerSocket, findRoomForUser, cleanupRoom, generatePGN, DISCONNECT_TIMEOUT_MS,
    createTournamentGame
};

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
 */
const restoreRoomFromDB = async (roomCode, io = null) => {
    const game = await Game.findOne({ roomId: roomCode, status: { $in: ['playing', 'waiting', 'finished', 'abandoned'] } });
    if (!game) return null;

    const chess = new Chess();

    // Replay all moves
    for (const move of game.moveHistory) {
        chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    }

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
        timeoutTimer: null, // Timer for clock timeout
        clocks: restoredClocks,
        lastMoveTime: null,
        timeControl: tc,
        clockStarted: game.clockStarted || false
    };

    // If game is in progress and clock started, resume ticking
    if (game.status === 'playing' && game.clockStarted && io) {
        activeRooms[roomCode].lastMoveTime = Date.now();
        scheduleTimeout(roomCode, io);
    }

    // Populate player info
    if (game.whitePlayer) {
        activeRooms[roomCode].players[game.whitePlayer] = { socketId: null, username: game.whiteUsername, color: 'w' };
    }
    if (game.blackPlayer) {
        activeRooms[roomCode].players[game.blackPlayer] = { socketId: null, username: game.blackUsername, color: 'b' };
    }

    // If clock was already started, we need to handle the ticking for the current player
    // However, to keep it simple and robust across refreshes, we only start the server timer 
    // when a socket action occurs or on the first move after restoration.
    // For now, let's just make sure the next move starts it.

    return activeRooms[roomCode];
};

/**
 * Start/Reset the server-side timeout timer for the current player.
 */
const scheduleTimeout = (roomCode, io) => {
    const room = activeRooms[roomCode];
    if (!room || !room.clockStarted || !room.timeControl) return;

    // Clear existing timer
    if (room.timeoutTimer) {
        clearTimeout(room.timeoutTimer);
        room.timeoutTimer = null;
    }

    const currentTurn = room.gameInstance.turn();
    const remainingTime = room.clocks[currentTurn];

    if (remainingTime <= 0) {
        handleTimeout(roomCode, io);
        return;
    }

    // Schedule the timeout
    room.timeoutTimer = setTimeout(() => {
        handleTimeout(roomCode, io);
    }, remainingTime + 500); // Add a small buffer (500ms) for network/sync
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
        game.pgn = generatePGN(game);
        await game.save();

        io.to(roomCode).emit('game_ended', {
            winner,
            reason: 'timeout',
            clocks: { ...room.clocks }
        });
        
        console.log(`🏁 Game Over [${roomCode}]: ${winner} wins by timeout`);
        cleanupRoom(roomCode);
    }
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
        clockStarted: false
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
    if (game.status !== 'waiting') return { error: 'Game is already in progress or finished.' };

    const room = activeRooms[roomCode];
    if (!room) return { error: 'Room not found in server memory.' };

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
        clocks: room.clocks,
        timeControl: room.timeControl
    };
};

/**
 * Process a move.
 */
const makeMove = async (roomCode, move, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room || !room.gameInstance) return { error: 'Room not found.' };

    const playerInfo = room.players[userId];
    if (!playerInfo) return { error: 'You are not a player in this game.' };

    const currentTurn = room.gameInstance.turn();
    if (playerInfo.color !== currentTurn) return { error: 'Not your turn.' };

    const moveCount = room.gameInstance.history().length;
    let clockUpdate = null;
    const isTimedGame = room.timeControl && room.clocks.w !== null && room.clocks.b !== null;

    if (isTimedGame) {
        const now = Date.now();
        const isBlackFirstMove = currentTurn === 'b' && !room.clockStarted;

        if (!room.clockStarted) {
            if (isBlackFirstMove) {
                room.clockStarted = true;
                room.lastMoveTime = now;
                scheduleTimeout(roomCode, io);
            }
            clockUpdate = { w: room.clocks.w, b: room.clocks.b };
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
                    game.pgn = generatePGN(game);
                    await game.save();
                }
                return {
                    result: null,
                    newFen: room.gameInstance.fen(),
                    gameOverResult: { winner, reason: 'timeout' },
                    clocks: { ...room.clocks }
                };
            }

            const incrementMs = (room.timeControl.increment || 0) * 1000;
            room.clocks[currentTurn] += incrementMs;
            room.lastMoveTime = now;
            clockUpdate = { w: room.clocks.w, b: room.clocks.b };
            
            // Schedule next player's timeout
            scheduleTimeout(roomCode, io);
        }
    }

    try {
        const result = room.gameInstance.move(move);
        if (!result) return { error: 'Invalid move.' };

        const newFen = room.gameInstance.fen();
        const game = await Game.findOne({ roomId: roomCode });
        if (game) {
            game.moveHistory.push({ san: result.san, from: result.from, to: result.to, color: result.color, fen: newFen });
            game.finalFen = newFen;
            game.drawOfferedBy = null;
            game.clockStarted = room.clockStarted;
            if (clockUpdate) {
                game.whiteClock = clockUpdate.w;
                game.blackClock = clockUpdate.b;
            }
            await game.save();
        }

        let gameOverResult = null;
        if (room.gameInstance.isGameOver()) {
            gameOverResult = getGameOverResult(room.gameInstance);
            if (game) {
                game.status = 'finished';
                game.winner = gameOverResult.winner;
                game.endReason = gameOverResult.reason;
                game.pgn = generatePGN(game);
                await game.save();
            }
            if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        }

        return { result, newFen, gameOverResult, clocks: clockUpdate };
    } catch (error) {
        return { error: 'Move processing error.' };
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

/**
 * Find active game for a user.
 * MODIFIED: Also returns games that finished in the last 2 minutes.
 */
const getActiveGameForUser = async (userId) => {
    // 1. Check for truly active games
    let game = await Game.findOne({
        status: { $in: ['playing', 'waiting'] },
        $or: [{ whitePlayer: userId }, { blackPlayer: userId }]
    });

    if (game) return game;

    // 2. Check for recently finished games (last 2 minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    game = await Game.findOne({
        status: { $in: ['finished', 'abandoned'] },
        $or: [{ whitePlayer: userId }, { blackPlayer: userId }],
        updatedAt: { $gte: twoMinutesAgo }
    }).sort({ updatedAt: -1 });

    return game;
};

const resignGame = async (roomCode, userId) => {
    const room = activeRooms[roomCode];
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'Game not found.' };

    const isWhite = game.whitePlayer === userId;
    const winner = isWhite ? 'black' : 'white';
    game.status = 'finished';
    game.winner = winner;
    game.endReason = 'resignation';
    game.pgn = generatePGN(game);
    if (room) {
        game.whiteClock = room.clocks.w;
        game.blackClock = room.clocks.b;
        if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
    }
    await game.save();
    return { winner, reason: 'resignation' };
};

const offerDraw = async (roomCode, userId) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'Game not found.' };
    game.drawOfferedBy = userId;
    await game.save();
    return { success: true };
};

const respondToDraw = async (roomCode, userId, accept) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'Game not found.' };
    if (accept) {
        game.status = 'finished';
        game.winner = 'draw';
        game.endReason = 'draw_agreement';
        game.pgn = generatePGN(game);
        const room = activeRooms[roomCode];
        if (room && room.timeoutTimer) clearTimeout(room.timeoutTimer);
    }
    game.drawOfferedBy = null;
    await game.save();
    return { accepted: accept, winner: accept ? 'draw' : null, reason: accept ? 'draw_agreement' : null };
};

const handleDisconnect = (roomCode, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room) return;
    room.disconnectTimers[userId] = setTimeout(async () => {
        const game = await Game.findOne({ roomId: roomCode });
        if (!game || game.status !== 'playing') return;
        const isWhite = game.whitePlayer === userId;
        const winner = isWhite ? 'black' : 'white';
        game.status = 'abandoned';
        game.winner = winner;
        game.endReason = 'abandoned';
        game.pgn = generatePGN(game);
        if (room) {
            game.whiteClock = room.clocks.w;
            game.blackClock = room.clocks.b;
            if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        }
        await game.save();
        io.to(roomCode).emit('game_ended', { winner, reason: 'abandoned', message: 'Opponent abandoned the game.' });
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
    for (const [roomCode, roomData] of Object.entries(activeRooms)) {
        if (roomData.players[userId]) return roomCode;
    }
    return null;
};

const cleanupRoom = (roomCode) => {
    const room = activeRooms[roomCode];
    if (room) {
        for (const timerId of Object.values(room.disconnectTimers)) clearTimeout(timerId);
        if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        delete activeRooms[roomCode];
    }
};

const generatePGN = (game) => {
    const tags = [];
    tags.push(`[Event "Indian Knights Online Game"]`);
    tags.push(`[Site "Indian Knights"]`);
    tags.push(`[Date "${new Date(game.createdAt).toISOString().split('T')[0].replace(/-/g, '.')}"]`);
    tags.push(`[Round "-"]`);
    tags.push(`[White "${game.whiteUsername || 'Anonymous'}"]`);
    tags.push(`[Black "${game.blackUsername || 'Anonymous'}"]`);
    if (game.timeControl?.minutes != null) {
        const tc = game.timeControl;
        tags.push(`[TimeControl "${tc.minutes * 60}+${tc.increment || 0}"]`);
    }
    let result = '*';
    if (game.winner === 'white') result = '1-0';
    else if (game.winner === 'black') result = '0-1';
    else if (game.winner === 'draw') result = '1/2-1/2';
    tags.push(`[Result "${result}"]`);
    if (game.finalFen && game.finalFen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') tags.push(`[FEN "${game.finalFen}"]`);
    let moveText = '';
    for (let i = 0; i < game.moveHistory.length; i++) {
        const move = game.moveHistory[i];
        if (move.color === 'w') moveText += `${Math.floor(i / 2) + 1}. `;
        moveText += `${move.san} `;
    }
    moveText += result;
    return tags.join('\n') + '\n\n' + moveText.trim() + '\n';
};

/**
 * Get current clocks for a room (snapshotted).
 */
const getClocks = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return null;
    return { ...room.clocks };
};

const startClock = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return { error: 'Room not found.' };
    if (room.clockStarted) return { error: 'Clock already started.' };
    room.clockStarted = true;
    room.lastMoveTime = Date.now();
    return { success: true, clocks: { ...room.clocks } };
};

module.exports = {
    activeRooms, getActiveRoom, restoreRoomFromDB, createRoom, joinRoom, makeMove, getClocks, startClock,
    getActiveGameForUser, resignGame, offerDraw, respondToDraw, handleDisconnect, cancelDisconnectTimer,
    updatePlayerSocket, findRoomForUser, cleanupRoom, generatePGN, DISCONNECT_TIMEOUT_MS
};

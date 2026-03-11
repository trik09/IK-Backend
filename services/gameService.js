const { Chess } = require('chess.js');
const Game = require('../models/Game');

/**
 * In-memory active rooms map.
 * Structure:
 * {
 *   [roomCode]: {
 *     gameInstance: Chess,
 *     players: { [userId]: { socketId, username, color } },
 *     spectators: Set<socketId>,
 *     disconnectTimers: { [userId]: timeoutId },
 *     // Clock state (milliseconds remaining)
 *     clocks: { w: Number, b: Number },
 *     lastMoveTime: Number | null,   // Date.now() when last move was made
 *     timeControl: { minutes: Number, increment: Number } | null
 *   }
 * }
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
 * Rebuilds the chess.js instance by replaying all moves.
 */
const restoreRoomFromDB = async (roomCode) => {
    const game = await Game.findOne({ roomId: roomCode, status: { $in: ['playing', 'waiting'] } });
    if (!game) return null;

    const chess = new Chess();

    // Replay all moves to rebuild the game state
    for (const move of game.moveHistory) {
        chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    }

    // Determine time control from DB
    const tc = game.timeControl?.minutes != null ? game.timeControl : null;

    activeRooms[roomCode] = {
        gameInstance: chess,
        players: {},
        spectators: new Set(),
        disconnectTimers: {},
        clocks: {
            w: game.whiteClock != null ? game.whiteClock : (tc ? tc.minutes * 60 * 1000 : null),
            b: game.blackClock != null ? game.blackClock : (tc ? tc.minutes * 60 * 1000 : null)
        },
        lastMoveTime: null,  // Will resume ticking on next move
        timeControl: tc
    };

    // Populate player info from DB (socket IDs will be filled on reconnect)
    if (game.whitePlayer) {
        activeRooms[roomCode].players[game.whitePlayer] = {
            socketId: null,
            username: game.whiteUsername,
            color: 'w'
        };
    }
    if (game.blackPlayer) {
        activeRooms[roomCode].players[game.blackPlayer] = {
            socketId: null,
            username: game.blackUsername,
            color: 'b'
        };
    }

    return activeRooms[roomCode];
};

/**
 * Create a new room in memory and database.
 * timeControl: { minutes, increment } | null (null = untimed)
 */
const createRoom = async (userId, username, timeControl = null) => {
    const roomCode = generateRoomCode();
    const hostColor = Math.random() < 0.5 ? 'w' : 'b';

    // Initial clock values in milliseconds
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
        blackClock: initialClock
    });
    await newGame.save();

    activeRooms[roomCode] = {
        gameInstance: new Chess(),
        players: {
            [userId]: { socketId: null, username, color: hostColor }
        },
        spectators: new Set(),
        disconnectTimers: {},
        clocks: { w: initialClock, b: initialClock },
        lastMoveTime: null,
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

    // Determine joiner color (opposite of host)
    const hostUserId = Object.keys(room.players)[0];
    const hostColor = room.players[hostUserId].color;
    const joinerColor = hostColor === 'w' ? 'b' : 'w';

    // Add to in-memory room
    room.players[userId] = { socketId: null, username, color: joinerColor };

    // Update DB
    game.status = 'playing';
    if (joinerColor === 'w') {
        game.whitePlayer = userId;
        game.whiteUsername = username;
    } else {
        game.blackPlayer = userId;
        game.blackUsername = username;
    }
    await game.save();

    // Start the clock — white moves first
    room.lastMoveTime = Date.now();

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
 * Get current clocks for a room (snapshotted — does not subtract live elapsed).
 */
const getClocks = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return null;
    return { ...room.clocks };
};

/**
 * Process a move: validate with chess.js, manage clocks, save to DB, return result.
 */
const makeMove = async (roomCode, move, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room || !room.gameInstance) return { error: 'Room not found.' };

    // Check it's this player's turn
    const playerInfo = room.players[userId];
    if (!playerInfo) return { error: 'You are not a player in this game.' };

    const currentTurn = room.gameInstance.turn();
    if (playerInfo.color !== currentTurn) return { error: 'Not your turn.' };

    // ---- CLOCK MANAGEMENT ----
    let clockUpdate = null;
    if (room.timeControl && room.clocks.w !== null && room.clocks.b !== null) {
        const now = Date.now();
        const elapsed = room.lastMoveTime ? now - room.lastMoveTime : 0;

        // Deduct elapsed from the player who just moved
        room.clocks[currentTurn] -= elapsed;

        // Check for timeout BEFORE applying increment
        if (room.clocks[currentTurn] <= 0) {
            room.clocks[currentTurn] = 0;
            const winner = currentTurn === 'w' ? 'black' : 'white';

            // Save to DB
            const game = await Game.findOne({ roomId: roomCode });
            if (game) {
                game.status = 'finished';
                game.winner = winner;
                game.endReason = 'timeout';
                game.whiteClock = room.clocks.w;
                game.blackClock = room.clocks.b;
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

        // Apply increment to player who just moved
        const incrementMs = (room.timeControl.increment || 0) * 1000;
        room.clocks[currentTurn] += incrementMs;

        // Update lastMoveTime for the next player
        room.lastMoveTime = now;

        clockUpdate = { w: room.clocks.w, b: room.clocks.b };
    }
    // --------------------------

    try {
        const result = room.gameInstance.move(move);
        if (!result) return { error: 'Invalid move.' };

        const newFen = room.gameInstance.fen();

        // Save to DB asynchronously
        const game = await Game.findOne({ roomId: roomCode });
        if (game) {
            game.moveHistory.push({
                san: result.san,
                from: result.from,
                to: result.to,
                color: result.color,
                fen: newFen
            });
            game.finalFen = newFen;
            game.drawOfferedBy = null;

            // Persist current clock values
            if (clockUpdate) {
                game.whiteClock = clockUpdate.w;
                game.blackClock = clockUpdate.b;
            }

            await game.save();
        }

        // Check game over (checkmate, stalemate, etc.)
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
        }

        return { result, newFen, gameOverResult, clocks: clockUpdate };
    } catch (error) {
        return { error: 'Move processing error.' };
    }
};

/**
 * Determine game over result from chess.js instance.
 */
const getGameOverResult = (gameInstance) => {
    let winner = null;
    let reason = 'draw';

    if (gameInstance.isCheckmate()) {
        winner = gameInstance.turn() === 'w' ? 'black' : 'white';
        reason = 'checkmate';
    } else if (gameInstance.isStalemate()) {
        reason = 'stalemate';
    } else if (gameInstance.isThreefoldRepetition()) {
        reason = 'repetition';
    } else if (gameInstance.isInsufficientMaterial()) {
        reason = 'insufficient';
    }

    return { winner, reason };
};

/**
 * Find active game for a user (status: playing or waiting).
 */
const getActiveGameForUser = async (userId) => {
    return await Game.findOne({
        status: { $in: ['playing', 'waiting'] },
        $or: [{ whitePlayer: userId }, { blackPlayer: userId }]
    });
};

/**
 * Handle resignation.
 */
const resignGame = async (roomCode, userId) => {
    const room = activeRooms[roomCode];
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'Game not found or already ended.' };

    const isWhite = game.whitePlayer === userId;
    const winner = isWhite ? 'black' : 'white';

    game.status = 'finished';
    game.winner = winner;
    game.endReason = 'resignation';
    game.pgn = generatePGN(game);

    // Persist clocks at time of resignation
    if (room) {
        game.whiteClock = room.clocks.w;
        game.blackClock = room.clocks.b;
    }

    await game.save();

    return { winner, reason: 'resignation' };
};

/**
 * Handle draw offer.
 */
const offerDraw = async (roomCode, userId) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'Game not found.' };
    if (game.drawOfferedBy) return { error: 'A draw offer is already pending.' };

    game.drawOfferedBy = userId;
    await game.save();
    return { success: true };
};

/**
 * Handle draw response.
 */
const respondToDraw = async (roomCode, userId, accept) => {
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'Game not found.' };
    if (!game.drawOfferedBy) return { error: 'No pending draw offer.' };
    if (game.drawOfferedBy === userId) return { error: 'Cannot respond to your own draw offer.' };

    if (accept) {
        game.status = 'finished';
        game.winner = 'draw';
        game.endReason = 'draw_agreement';
        game.pgn = generatePGN(game);
    }
    game.drawOfferedBy = null;
    await game.save();

    return { accepted: accept, winner: accept ? 'draw' : null, reason: accept ? 'draw_agreement' : null };
};

/**
 * Handle disconnect with grace period.
 */
const handleDisconnect = (roomCode, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    // Pause the clock for the disconnected player
    // (lastMoveTime is left as-is; elapsed will be charged on next move attempt)

    // Set a 30s timer — if not reconnected, mark as abandoned
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
        }

        await game.save();

        io.to(roomCode).emit('game_ended', {
            winner,
            reason: 'abandoned',
            message: 'Opponent abandoned the game.'
        });

        cleanupRoom(roomCode);
    }, DISCONNECT_TIMEOUT_MS);
};

/**
 * Cancel disconnect timer when player reconnects.
 */
const cancelDisconnectTimer = (roomCode, userId) => {
    const room = activeRooms[roomCode];
    if (room && room.disconnectTimers[userId]) {
        clearTimeout(room.disconnectTimers[userId]);
        delete room.disconnectTimers[userId];
    }
};

/**
 * Update socket ID for a player (used on connect/reconnect).
 */
const updatePlayerSocket = (roomCode, userId, socketId) => {
    const room = activeRooms[roomCode];
    if (room && room.players[userId]) {
        room.players[userId].socketId = socketId;
    }
};

/**
 * Find which room a userId belongs to.
 */
const findRoomForUser = (userId) => {
    for (const [roomCode, roomData] of Object.entries(activeRooms)) {
        if (roomData.players[userId]) {
            return roomCode;
        }
    }
    return null;
};

/**
 * Clean up a room from memory.
 */
const cleanupRoom = (roomCode) => {
    const room = activeRooms[roomCode];
    if (room) {
        for (const timerId of Object.values(room.disconnectTimers)) {
            clearTimeout(timerId);
        }
        delete activeRooms[roomCode];
    }
};

/**
 * Generate PGN string from a game document.
 */
const generatePGN = (game) => {
    const tags = [];
    tags.push(`[Event "Indian Knights Online Game"]`);
    tags.push(`[Site "Indian Knights"]`);
    tags.push(`[Date "${new Date(game.createdAt).toISOString().split('T')[0].replace(/-/g, '.')}"]`);
    tags.push(`[Round "-"]`);
    tags.push(`[White "${game.whiteUsername || 'Anonymous'}"]`);
    tags.push(`[Black "${game.blackUsername || 'Anonymous'}"]`);

    // Add TimeControl PGN tag if applicable
    if (game.timeControl?.minutes != null) {
        const tc = game.timeControl;
        tags.push(`[TimeControl "${tc.minutes * 60}+${tc.increment || 0}"]`);
    }

    let result = '*';
    if (game.winner === 'white') result = '1-0';
    else if (game.winner === 'black') result = '0-1';
    else if (game.winner === 'draw') result = '1/2-1/2';
    tags.push(`[Result "${result}"]`);

    if (game.finalFen && game.finalFen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
        tags.push(`[FEN "${game.finalFen}"]`);
    }

    // Build move text
    let moveText = '';
    for (let i = 0; i < game.moveHistory.length; i++) {
        const move = game.moveHistory[i];
        if (move.color === 'w') {
            moveText += `${Math.floor(i / 2) + 1}. `;
        }
        moveText += `${move.san} `;
    }
    moveText += result;

    return tags.join('\n') + '\n\n' + moveText.trim() + '\n';
};

module.exports = {
    activeRooms,
    getActiveRoom,
    restoreRoomFromDB,
    createRoom,
    joinRoom,
    makeMove,
    getClocks,
    getActiveGameForUser,
    resignGame,
    offerDraw,
    respondToDraw,
    handleDisconnect,
    cancelDisconnectTimer,
    updatePlayerSocket,
    findRoomForUser,
    cleanupRoom,
    generatePGN,
    DISCONNECT_TIMEOUT_MS
};

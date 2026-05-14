const { Chess } = require('chess.js');
const Game = require('../models/Game');
const User = require('../models/User');

const calculateElo = (ratingA, ratingB, scoreA, k = 32) => {
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    return Math.round(ratingA + k * (scoreA - expectedA));
};

const finalizeGameAndRatings = async (game, winner, endReason, io) => {
    if (game.status === 'finished' || game.status === 'abandoned') return game;
    
    game.status = ['abandoned'].includes(endReason) ? 'abandoned' : 'finished';
    game.winner = winner;
    game.endReason = endReason;
    game.pgn = generatePGN(game);

    // Minimum moves validation (4 plies = 2 full moves)
    const isRated = game.rated !== false && game.moveHistory.length >= 4 && endReason !== 'aborted' && endReason !== 'canceled';

    if (isRated && game.whitePlayer && game.blackPlayer) {
        const whiteUser = await User.findById(game.whitePlayer);
        const blackUser = await User.findById(game.blackPlayer);

        if (whiteUser && blackUser) {
            const whiteRatingBefore = whiteUser.blitzRating || 1200;
            const blackRatingBefore = blackUser.blitzRating || 1200;

            let scoreWhite = 0.5;
            let scoreBlack = 0.5;
            if (winner === 'white') { scoreWhite = 1; scoreBlack = 0; }
            else if (winner === 'black') { scoreWhite = 0; scoreBlack = 1; }

            const whiteRatingAfter = calculateElo(whiteRatingBefore, blackRatingBefore, scoreWhite);
            const blackRatingAfter = calculateElo(blackRatingBefore, whiteRatingBefore, scoreBlack);

            game.ratingBefore = { white: whiteRatingBefore, black: blackRatingBefore };
            game.ratingAfter = { white: whiteRatingAfter, black: blackRatingAfter };
            game.ratingChanges = { 
                white: whiteRatingAfter - whiteRatingBefore, 
                black: blackRatingAfter - blackRatingBefore 
            };

            // Update user models
            whiteUser.blitzRating = whiteRatingAfter;
            whiteUser.gamesPlayed += 1;
            if (winner === 'white') whiteUser.wins += 1;
            else if (winner === 'draw') whiteUser.draws += 1;
            else if (winner === 'black') whiteUser.losses += 1;

            blackUser.blitzRating = blackRatingAfter;
            blackUser.gamesPlayed += 1;
            if (winner === 'black') blackUser.wins += 1;
            else if (winner === 'draw') blackUser.draws += 1;
            else if (winner === 'white') blackUser.losses += 1;

            await whiteUser.save();
            await blackUser.save();
        }
    } else {
        game.rated = false;
    }

    // Schedule cleanup after 10 minutes to allow for rematches/chat
    setTimeout(() => {
        cleanupRoom(game.roomId);
    }, 10 * 60 * 1000);

    // CRITICAL: Don't save games that haven't even started (0 moves)
    // This prevents "Anonymous" ghost games from cluttering the DB/Profile
    if (game.moveHistory.length === 0) {
        console.log(`🧹 Cleaning up empty game room: ${game.roomId}`);
        return game; // Skip save
    }

    await game.save();
    
    // Broadcast rating update
    if (io && game.rated && game.ratingChanges) {
        // Emit rating updates directly to players if they are still connected
        const wSocket = io.sockets.sockets.get(activeRooms[game.roomId]?.players[game.whitePlayer]?.socketId);
        if (wSocket) wSocket.emit('rating_updated', { newRating: game.ratingAfter.white, change: game.ratingChanges.white });
        
        const bSocket = io.sockets.sockets.get(activeRooms[game.roomId]?.players[game.blackPlayer]?.socketId);
        if (bSocket) bSocket.emit('rating_updated', { newRating: game.ratingAfter.black, change: game.ratingChanges.black });
    }

    await handleTournamentGameEnd(game, io);
    return game;
};

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
        activeRooms[roomCode].players[game.whitePlayer.toString()] = { socketId: null, username: game.whiteUsername, color: 'w' };
    }
    if (game.blackPlayer) {
        activeRooms[roomCode].players[game.blackPlayer.toString()] = { socketId: null, username: game.blackUsername, color: 'b' };
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
    
    const whiteUser = await User.findById(whiteId);
    const blackUser = await User.findById(blackId);

    const game = new Game({
        roomId: roomCode,
        tournamentId: tournamentId,
        whitePlayer: whiteId,
        whiteUsername: whiteUsername,
        whiteRating: whiteUser?.blitzRating || 1200,
        blackPlayer: blackId,
        blackUsername: blackUsername,
        blackRating: blackUser?.blitzRating || 1200,
        status: 'playing', // Auto-start
        timeControl: timeControl,
        whiteClock: timeControl ? timeControl.minutes * 60 * 1000 : null,
        blackClock: timeControl ? timeControl.minutes * 60 * 1000 : null,
        lastMoveAt: null,
        clockStarted: false,
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
        lastMoveTime: null,
        timeControl: timeControl,
        clockStarted: false 
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

    const hostUser = await User.findById(userId);
    const hostRating = hostUser?.blitzRating || 1200;

    const newGame = new Game({
        roomId: roomCode,
        status: 'waiting',
        whitePlayer: hostColor === 'w' ? userId : null,
        blackPlayer: hostColor === 'b' ? userId : null,
        whiteUsername: hostColor === 'w' ? username : 'Anonymous',
        blackUsername: hostColor === 'b' ? username : 'Anonymous',
        whiteRating: hostColor === 'w' ? hostRating : null,
        blackRating: hostColor === 'b' ? hostRating : null,
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
    
    let room = activeRooms[roomCode];
    if (!room) {
        room = await restoreRoomFromDB(roomCode);
    }
    
    if (!room) return { error: 'Room not found.' };

    const hostUserId = Object.keys(room.players)[0];
    const isHost = hostUserId === userId;

    // If game is already playing or finished
    if (game.status === 'playing' || game.status === 'finished' || game.status === 'abandoned') {
        const player = room.players[userId];
        if (player) {
            // Already a participant, return their state
            const opponentId = Object.keys(room.players).find(id => id !== userId);
            const opponent = room.players[opponentId];
            return {
                success: true,
                isHost: isHost,
                status: game.status,
                joinerColor: player.color,
                hostUserId: isHost ? userId : hostUserId,
                hostUsername: isHost ? player.username : (opponent?.username || 'Opponent'),
                hostColor: isHost ? player.color : opponent?.color,
                hostRating: isHost ? (player.color === 'w' ? game.whiteRating : game.blackRating) : (opponent?.color === 'w' ? game.whiteRating : game.blackRating),
                joinerRating: isHost ? (player.color === 'w' ? game.whiteRating : game.blackRating) : (player.color === 'w' ? game.whiteRating : game.blackRating),
                clocks: getClocks(roomCode),
                timeControl: room.timeControl,
                tournamentId: game.tournamentId
            };
        }
        
        if (game.status === 'finished' || game.status === 'abandoned') {
            return { error: 'GAME_FINISHED', status: game.status };
        }
        return { error: 'GAME_IN_PROGRESS' };
    }

    if (game.status !== 'waiting') return { error: 'Game is already in progress.' };

    // Handle host opening their own link while in 'waiting' status
    if (isHost) {
        const hostColor = room.players[hostUserId].color;
        return {
            success: true,
            isHost: true,
            status: 'waiting',
            roomCode,
            joinerColor: hostColor, // They are the host, but we use this to set their local color
            hostUsername: username,
            hostRating: hostColor === 'w' ? game.whiteRating : game.blackRating,
            clocks: getClocks(roomCode),
            timeControl: room.timeControl,
            tournamentId: game.tournamentId
        };
    }

    const hostColor = room.players[hostUserId].color;
    const joinerColor = hostColor === 'w' ? 'b' : 'w';

    const joinerUser = await User.findById(userId);
    const joinerRating = joinerUser?.blitzRating || 1200;

    room.players[userId] = { socketId: null, username, color: joinerColor };

    game.status = 'playing';
    if (joinerColor === 'w') {
        game.whitePlayer = userId;
        game.whiteUsername = username;
        game.whiteRating = joinerRating;
    } else {
        game.blackPlayer = userId;
        game.blackUsername = username;
        game.blackRating = joinerRating;
    }
    await game.save();

    return {
        joinerColor,
        hostUserId,
        hostUsername: room.players[hostUserId].username,
        hostColor,
        hostRating: hostColor === 'w' ? game.whiteRating : game.blackRating,
        joinerRating: joinerRating,
        clocks: getClocks(roomCode),
        timeControl: room.timeControl,
        tournamentId: game.tournamentId,
        status: 'playing'
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
            // Clock only starts after Black makes their first move.
            // This gives both players one "free" move.
            if (currentTurn === 'b') {
                room.clockStarted = true;
            }
            // Always update lastMoveTime so the next player's duration is measured from now
            room.lastMoveTime = now;
            clockUpdate = { ...room.clocks, lastMoveAt: new Date(now).toISOString() };
        } else {
            // Clock is already running, subtract time from the player who just moved
            const elapsed = room.lastMoveTime ? now - room.lastMoveTime : 0;
            room.clocks[currentTurn] -= elapsed;

            if (room.clocks[currentTurn] <= 0) {
                room.clocks[currentTurn] = 0;
                const winner = currentTurn === 'w' ? 'black' : 'white';
                const game = await Game.findOne({ roomId: roomCode });
                if (game) {
                    game.whiteClock = room.clocks.w;
                    game.blackClock = room.clocks.b;
                    game.clockStarted = true;
                    game.lastMoveAt = new Date(now);
                    game.currentFen = room.gameInstance.fen();
                    await finalizeGameAndRatings(game, winner, 'timeout', io);
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
        }
    } else {
        // Untimed game still updates lastMoveTime for consistency
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
        } else if (room.clockStarted) {
            // Only schedule a timeout if the game isn't over and the clock is started.
            // Since we've already updated lastMoveTime and moved to the next turn,
            // scheduleTimeout will correctly set the timer for the next player.
            scheduleTimeout(roomCode, io);
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
                await finalizeGameAndRatings(game, gameOverResult.winner, gameOverResult.reason, io);
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
    const game = await Game.findOne({
        status: { $in: ['playing', 'waiting'] },
        $or: [{ whitePlayer: userId }, { blackPlayer: userId }]
    }).sort({ updatedAt: -1 });

    // Filter out old/ghost games:
    // 1. 'playing' games with no moves older than 30s
    // 2. 'waiting' games older than 5 minutes (stale lobby)
    if (game) {
        const ageInMs = Date.now() - new Date(game.updatedAt).getTime();
        
        if (game.status === 'playing' && game.moveHistory.length === 0 && ageInMs > 30000) {
            return null;
        }
        
        if (game.status === 'waiting' && ageInMs > 300000) { // 5 minutes
            return null;
        }
    }

    return game;
};

const resignGame = async (roomCode, userId, io) => {
    const room = activeRooms[roomCode];
    const game = await Game.findOne({ roomId: roomCode });
    if (!game || game.status !== 'playing') return { error: 'No active game.' };
    const winner = game.whitePlayer === userId ? 'black' : 'white';
    if (room) {
        game.whiteClock = room.clocks.w;
        game.blackClock = room.clocks.b;
        if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
    }
    game.lastMoveAt = new Date();
    await finalizeGameAndRatings(game, winner, 'resignation', io);
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
        const room = activeRooms[roomCode];
        if (room) {
            game.whiteClock = room.clocks.w;
            game.blackClock = room.clocks.b;
            if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
        }
        game.drawOfferedBy = null;
        game.lastMoveAt = new Date();
        await finalizeGameAndRatings(game, 'draw', 'draw_agreement', io);
    } else {
        game.drawOfferedBy = null;
        await game.save();
    }
    return { accepted: accept, winner: accept ? 'draw' : null, reason: accept ? 'draw_agreement' : null };
};

const handleDisconnect = (roomCode, userId, io) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    // We no longer automatically abandon games on disconnect.
    // The player's clock will simply continue to run.
    // If they do not reconnect in time, they will lose by Timeout.
    console.log(`🔌 Player ${userId} disconnected from room ${roomCode}. Clock continues to tick.`);
};

const cancelDisconnectTimer = (roomCode, userId) => {
    // No-op since we removed the disconnect timer
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
 * Calculates the real-time remaining milliseconds on the server to prevent client clock drift.
 */
const getClocks = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return null;

    let w = room.clocks.w;
    let b = room.clocks.b;

    // Dynamically calculate the actual remaining time on the server
    if (room.clockStarted && room.lastMoveTime) {
        const elapsed = Date.now() - room.lastMoveTime;
        const currentTurn = room.gameInstance.turn();
        if (currentTurn === 'w') {
            w = Math.max(0, w - elapsed);
        } else {
            b = Math.max(0, b - elapsed);
        }
    }

    return { 
        w: w, 
        b: b, 
        clockStarted: room.clockStarted,
        lastMoveAt: null 
    };
};

const startRematch = async (oldRoomCode, userId1, userId2, io) => {
    const oldRoom = activeRooms[oldRoomCode];
    if (!oldRoom) return { error: 'Old room not found.' };

    const oldGame = await Game.findOne({ roomId: oldRoomCode });
    if (!oldGame) return { error: 'Old game not found.' };

    // Determine colors for rematch (swap them)
    const oldWhiteId = oldGame.whitePlayer;
    const oldBlackId = oldGame.blackPlayer;

    // Create a new room
    // The player who requested the rematch or just swap from the old game
    const newHostId = oldBlackId; // Black from old game becomes White in new game
    const newJoinerId = oldWhiteId;

    const hostUser = oldRoom.players[newHostId];
    const joinerUser = oldRoom.players[newJoinerId];

    if (!hostUser || !joinerUser) return { error: 'Players not found in room.' };

    // Create room with same settings
    const { roomCode: newRoomCode } = await createRoom(
        newHostId, 
        hostUser.username, 
        oldRoom.timeControl, 
        oldGame.tournamentId,
        'w' // We force host to be white in the new room
    );

    // Join the other player
    await joinRoom(newRoomCode, newJoinerId, joinerUser.username);

    // Update socket IDs if they are available
    updatePlayerSocket(newRoomCode, newHostId, hostUser.socketId);
    updatePlayerSocket(newRoomCode, newJoinerId, joinerUser.socketId);

    return { success: true, newRoomCode };
};

module.exports = {
    activeRooms, getActiveRoom, restoreRoomFromDB, createRoom, joinRoom, makeMove, getClocks, startClock,
    getActiveGameForUser, resignGame, offerDraw, respondToDraw, handleDisconnect, cancelDisconnectTimer,
    updatePlayerSocket, findRoomForUser, cleanupRoom, generatePGN, DISCONNECT_TIMEOUT_MS,
    createTournamentGame, startRematch
};

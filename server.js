const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const gameService = require('./services/gameService');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    // Socket.IO reconnection settings
    pingTimeout: 60000,
    pingInterval: 25000
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/indian_knights';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Database: indian_knights'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- API ROUTES ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/games', require('./routes/games'));

app.get('/', (req, res) => {
    res.send('Indian Knights Backend API is running.');
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';

// Socket Authentication Middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: Token required to play ranked matches.'));
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded; // { userId, username }
        next();
    } catch (err) {
        next(new Error('Authentication error: Invalid or expired token.'));
    }
});

// --- SOCKET.IO MULTIPLAYER LOGIC ---
io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.user.username} (${socket.id})`);

    // =============================================
    // 1. CREATE ROOM
    // =============================================
    socket.on('create_room', async (data, callback) => {
        try {
            // data may contain { timeControl: { minutes, increment } }
            const timeControl = data?.timeControl || null;

            const { roomCode, hostColor } = await gameService.createRoom(
                socket.user.userId,
                socket.user.username,
                timeControl
            );

            // Set socket ID for this player
            gameService.updatePlayerSocket(roomCode, socket.user.userId, socket.id);
            socket.join(roomCode);

            const tcLabel = timeControl
                ? `${timeControl.minutes}+${timeControl.increment || 0}`
                : 'Untimed';
            console.log(`🏠 Room Created: ${roomCode} by ${socket.user.username} as ${hostColor} [${tcLabel}]`);
            callback({ success: true, roomCode });
        } catch (error) {
            console.error('Error creating room:', error);
            callback({ success: false, error: 'Database error creating room.' });
        }
    });

    // =============================================
    // 2. JOIN ROOM
    // =============================================
    socket.on('join_room', async (data, callback) => {
        const { roomCode } = data;
        try {
            const result = await gameService.joinRoom(roomCode, socket.user.userId, socket.user.username);

            if (result.error) {
                return callback({ success: false, error: result.error });
            }

            // Set socket ID and join socket room
            gameService.updatePlayerSocket(roomCode, socket.user.userId, socket.id);
            socket.join(roomCode);

            console.log(`🤝 ${socket.user.username} joined room ${roomCode} as ${result.joinerColor}`);

            // Notify Joiner
            callback({
                success: true,
                roomCode,
                color: result.joinerColor,
                opponent: result.hostUsername,
                clocks: result.clocks,
                timeControl: result.timeControl
            });

            // Notify Host — include clocks and timeControl
            socket.to(roomCode).emit('game_started', {
                message: 'Opponent connected. Game on!',
                roomCode,
                color: result.hostColor,
                opponent: socket.user.username,
                clocks: result.clocks,
                timeControl: result.timeControl
            });

        } catch (error) {
            console.error('Error joining room:', error);
            callback({ success: false, error: 'Error joining room.' });
        }
    });

    // =============================================
    // 3. RECONNECT TO ACTIVE GAME
    // =============================================
    socket.on('reconnect_game', async (data, callback) => {
        try {
            const userId = socket.user.userId;

            // Check if user has an active game in DB
            const activeGame = await gameService.getActiveGameForUser(userId);
            if (!activeGame) {
                return callback({ success: false, hasActiveGame: false });
            }

            const roomCode = activeGame.roomId;

            // Ensure room is in memory (restore from DB if needed)
            let room = gameService.getActiveRoom(roomCode);
            if (!room) {
                room = await gameService.restoreRoomFromDB(roomCode);
                if (!room) {
                    return callback({ success: false, hasActiveGame: false });
                }
            }

            // Cancel any disconnect timer
            gameService.cancelDisconnectTimer(roomCode, userId);

            // Update socket ID and rejoin socket room
            gameService.updatePlayerSocket(roomCode, userId, socket.id);
            socket.join(roomCode);

            // Determine color and opponent
            const playerInfo = room.players[userId];
            const opponentUserId = Object.keys(room.players).find(id => id !== userId);
            const opponentInfo = opponentUserId ? room.players[opponentUserId] : null;

            console.log(`🔄 ${socket.user.username} reconnected to room ${roomCode}`);

            // Notify opponent that we reconnected
            socket.to(roomCode).emit('opponent_reconnected', {
                message: 'Opponent has reconnected!'
            });

            // Send full game state back including current clocks
            callback({
                success: true,
                hasActiveGame: true,
                roomCode,
                fen: room.gameInstance.fen(),
                moveHistory: activeGame.moveHistory,
                color: playerInfo.color,
                opponent: opponentInfo ? opponentInfo.username : null,
                status: activeGame.status,
                drawOfferedBy: activeGame.drawOfferedBy,
                clocks: room.clocks,
                timeControl: room.timeControl
            });

        } catch (error) {
            console.error('Error reconnecting:', error);
            callback({ success: false, error: 'Reconnection failed.' });
        }
    });

    // =============================================
    // 4. MAKE A MOVE
    // =============================================
    socket.on('make_move', async (data) => {
        const { roomCode, move } = data;

        const result = await gameService.makeMove(roomCode, move, socket.user.userId, io);

        if (result.error) {
            socket.emit('move_error', { error: result.error });
            return;
        }

        // Broadcast move to the room (opponent + spectators)
        // Include updated clocks
        socket.to(roomCode).emit('opponent_move', {
            move: data.move,
            fen: result.newFen,
            san: result.result?.san,
            clocks: result.clocks
        });

        // Confirm move to sender — include updated clocks
        socket.emit('move_confirmed', {
            fen: result.newFen,
            san: result.result?.san,
            clocks: result.clocks
        });

        // Handle game over (checkmate, stalemate, timeout, etc.)
        if (result.gameOverResult) {
            io.to(roomCode).emit('game_ended', {
                winner: result.gameOverResult.winner,
                reason: result.gameOverResult.reason,
                clocks: result.clocks
            });
            console.log(`🏁 Game Over [${roomCode}]: ${result.gameOverResult.winner} wins by ${result.gameOverResult.reason}`);
            gameService.cleanupRoom(roomCode);
        }
    });

    // =============================================
    // 5. SPECTATE A GAME
    // =============================================
    socket.on('spectate_game', async (data, callback) => {
        const { roomCode } = data;

        try {
            let room = gameService.getActiveRoom(roomCode);

            // Try to restore from DB if not in memory
            if (!room) {
                room = await gameService.restoreRoomFromDB(roomCode);
            }

            if (!room) {
                return callback({ success: false, error: 'Game not found.' });
            }

            // Add as spectator
            room.spectators.add(socket.id);
            socket.join(roomCode);

            // Get game from DB for move history
            const Game = require('./models/Game');
            const game = await Game.findOne({ roomId: roomCode });

            // Get player names
            const players = {};
            for (const [uid, pInfo] of Object.entries(room.players)) {
                players[pInfo.color] = pInfo.username;
            }

            callback({
                success: true,
                roomCode,
                fen: room.gameInstance.fen(),
                moveHistory: game ? game.moveHistory : [],
                players,
                status: game ? game.status : 'unknown',
                clocks: room.clocks,
                timeControl: room.timeControl
            });

            console.log(`👁️ Spectator ${socket.user.username} watching room ${roomCode}`);

        } catch (error) {
            console.error('Error spectating:', error);
            callback({ success: false, error: 'Failed to spectate.' });
        }
    });

    // =============================================
    // 6. DRAW OFFER
    // =============================================
    socket.on('offer_draw', async (data) => {
        const { roomCode } = data;
        const result = await gameService.offerDraw(roomCode, socket.user.userId);

        if (result.error) {
            socket.emit('draw_error', { error: result.error });
            return;
        }

        socket.to(roomCode).emit('draw_offered', {
            by: socket.user.username,
            byUserId: socket.user.userId
        });
    });

    socket.on('respond_draw', async (data) => {
        const { roomCode, accept } = data;
        const result = await gameService.respondToDraw(roomCode, socket.user.userId, accept);

        if (result.error) {
            socket.emit('draw_error', { error: result.error });
            return;
        }

        if (result.accepted) {
            io.to(roomCode).emit('game_ended', {
                winner: 'draw',
                reason: 'draw_agreement',
                message: 'Game drawn by mutual agreement.'
            });
            gameService.cleanupRoom(roomCode);
        } else {
            socket.to(roomCode).emit('draw_declined', {
                by: socket.user.username
            });
        }
    });

    // =============================================
    // 7. RESIGN
    // =============================================
    socket.on('resign', async (data) => {
        const { roomCode } = data;
        const result = await gameService.resignGame(roomCode, socket.user.userId);

        if (result.error) {
            socket.emit('resign_error', { error: result.error });
            return;
        }

        io.to(roomCode).emit('game_ended', {
            winner: result.winner,
            reason: 'resignation',
            message: `${socket.user.username} resigned.`
        });

        console.log(`🏳️ ${socket.user.username} resigned in room ${roomCode}`);
        gameService.cleanupRoom(roomCode);
    });

    // =============================================
    // 8. CHAT
    // =============================================
    socket.on('send_chat', (data) => {
        const { roomCode, message } = data;
        socket.to(roomCode).emit('receive_chat', {
            text: message,
            sender: socket.user.username,
            timestamp: Date.now()
        });
    });

    // =============================================
    // 9. DISCONNECT HANDLING
    // =============================================
    socket.on('disconnect', async () => {
        console.log(`❌ Disconnected: ${socket.user.username} (${socket.id})`);

        const userId = socket.user.userId;

        // Find which room this user belongs to
        const roomCode = gameService.findRoomForUser(userId);
        if (!roomCode) return;

        const room = gameService.getActiveRoom(roomCode);
        if (!room) return;

        // Remove spectator if they are one
        if (room.spectators.has(socket.id)) {
            room.spectators.delete(socket.id);
            return;
        }

        // For players: mark socket as null (disconnected)
        if (room.players[userId]) {
            room.players[userId].socketId = null;
        }

        // Check game status — only do grace period for active games
        const Game = require('./models/Game');
        const game = await Game.findOne({ roomId: roomCode });
        if (!game || game.status !== 'playing') {
            // Game is waiting or finished, just clean up if needed
            if (game && game.status === 'waiting') {
                // Host disconnected while waiting, clean up
                game.status = 'abandoned';
                await game.save();
                gameService.cleanupRoom(roomCode);
            }
            return;
        }

        // Notify opponent of disconnect
        socket.to(roomCode).emit('opponent_disconnected', {
            message: 'Opponent disconnected. Waiting for reconnection...',
            timeout: gameService.DISCONNECT_TIMEOUT_MS
        });

        // Start grace period
        gameService.handleDisconnect(roomCode, userId, io);
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`🚀 Indian Knights Chess Server running on port ${PORT}`);
});

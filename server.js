require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use('/api/admin', adminRoutes);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// Game State
const rooms = new Map();

const PLAYER_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6'];

async function startRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  try {
    const Category = require('./models/Category');
    const categories = await Category.find();
    if (categories.length === 0) {
      return io.to(roomCode).emit('game-error', 'No categories found. Admin must add words first.');
    }

    const category = categories[Math.floor(Math.random() * categories.length)];
    const words = category.words;
    if (words.length < 2) {
      return io.to(roomCode).emit('game-error', 'Category must have at least 2 words.');
    }

    let wordIndex1 = Math.floor(Math.random() * words.length);
    let wordIndex2;
    do { wordIndex2 = Math.floor(Math.random() * words.length); }
    while (wordIndex1 === wordIndex2);

    const trueWord = words[wordIndex1];
    const liarWord = words[wordIndex2];

    const liarIndex = Math.floor(Math.random() * room.players.length);
    room.players.forEach((p, idx) => {
      p.role = idx === liarIndex ? 'Liar' : 'Innocent';
      p.word = idx === liarIndex ? liarWord : trueWord;
      p.votes = 0;
      p.hasVoted = false;
    });

    room.status = 'playing';
    room.category = category.name;
    room.voteCount = 0;

    // Send game-started first so clients can navigate
    io.to(roomCode).emit('game-started', {
      category: category.name,
      players: room.players.map(p => ({ id: p.id, name: p.name, colorIndex: p.colorIndex, isHost: p.isHost }))
    });

    // Delay role reveal so Game page has time to mount and register socket listeners
    setTimeout(() => {
      room.players.forEach(p => {
        io.to(p.id).emit('role-reveal', { role: p.role, word: p.word });
      });
    }, 1000);

  } catch (err) {
    console.error('Start round error:', err);
    io.to(roomCode).emit('game-error', 'Failed to start game. Please try again.');
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomCode, playerName, sessionId }) => {
    socket.join(roomCode);

    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, { players: [], status: 'lobby', voteCount: 0 });
    }

    const room = rooms.get(roomCode);

    // Try to reconnect existing session
    if (sessionId) {
      const existing = room.players.find(p => p.sessionId === sessionId);
      if (existing) {
        existing.id = socket.id;
        io.to(roomCode).emit('room-update', { players: room.players, status: room.status });
        // If game already started, resend role-reveal to this player
        if (room.status === 'playing' && existing.role) {
          setTimeout(() => {
            io.to(socket.id).emit('role-reveal', { role: existing.role, word: existing.word });
            io.to(socket.id).emit('game-started', {
              category: room.category,
              players: room.players.map(p => ({ id: p.id, name: p.name, colorIndex: p.colorIndex, isHost: p.isHost }))
            });
          }, 300);
        }
        return;
      }
    }

    // Check for same name (reconnect without sessionId)
    const sameNamePlayer = room.players.find(p => p.name === playerName);
    if (sameNamePlayer) {
      sameNamePlayer.id = socket.id;
      if (sessionId) sameNamePlayer.sessionId = sessionId;
      io.to(roomCode).emit('room-update', { players: room.players, status: room.status });
      return;
    }

    // New player
    const colorIndex = room.players.length % PLAYER_COLORS.length;
    const player = {
      id: socket.id,
      sessionId: sessionId || socket.id,
      name: playerName,
      isHost: room.players.length === 0,
      ready: false,
      votes: 0,
      hasVoted: false,
      colorIndex
    };

    room.players.push(player);
    io.to(roomCode).emit('room-update', { players: room.players, status: room.status });
    console.log(`${playerName} joined ${roomCode} (${room.players.length} players)`);
  });

  socket.on('start-game', async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) {
      socket.emit('game-error', 'Only the host can start the game.');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('game-error', 'Need at least 2 players to start.');
      return;
    }
    await startRound(roomCode);
  });

  socket.on('next-round', async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me || !me.isHost) return;
    await startRound(roomCode);
  });

  socket.on('send-message', ({ roomCode, message }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const sender = room.players.find(p => p.id === socket.id);
    if (sender) {
      io.to(roomCode).emit('new-message', {
        senderId: sender.id,
        sender: sender.name,
        colorIndex: sender.colorIndex,
        text: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  socket.on('cast-vote', ({ roomCode, targetId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const voter = room.players.find(p => p.id === socket.id);
    if (!voter) return;

    if (voter.hasVoted) {
      socket.emit('vote-error', 'You have already cast your vote!');
      return;
    }

    if (targetId === socket.id) {
      socket.emit('vote-error', 'You cannot vote for yourself!');
      return;
    }

    const target = room.players.find(p => p.id === targetId);
    if (!target) {
      socket.emit('vote-error', 'Player not found.');
      return;
    }

    voter.hasVoted = true;
    target.votes = (target.votes || 0) + 1;
    room.voteCount = (room.voteCount || 0) + 1;

    io.to(roomCode).emit('vote-update', {
      votes: room.players.map(p => ({ id: p.id, name: p.name, votes: p.votes })),
      voteCount: room.voteCount,
      totalPlayers: room.players.length
    });

    if (room.voteCount >= room.players.length) {
      const sortedByVotes = [...room.players].sort((a, b) => b.votes - a.votes);
      const loser = sortedByVotes[0];
      const innocentWon = loser.role === 'Liar';
      const liar = room.players.find(p => p.role === 'Liar');
      const innocent = room.players.find(p => p.role === 'Innocent');
      room.status = 'finished';

      io.to(roomCode).emit('game-over', {
        winner: innocentWon ? 'Innocents' : 'Liar',
        liarName: liar ? liar.name : 'Unknown',
        liarId: liar ? liar.id : null,
        trueWord: innocent ? innocent.word : '?',
        liarWord: liar ? liar.word : '?',
        allVotes: room.players.map(p => ({ id: p.id, name: p.name, votes: p.votes }))
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    rooms.forEach((room, roomCode) => {
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        const player = room.players[index];
        room.players.splice(index, 1);
        if (room.players.length === 0) {
          rooms.delete(roomCode);
        } else {
          if (player.isHost) {
            room.players[0].isHost = true;
          }
          io.to(roomCode).emit('room-update', { players: room.players, status: room.status });
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

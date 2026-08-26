/* ====================================================
   QCFY CASUAL 2-PLAYER ONLINE CHESS SOCKET HANDLERS
   ==================================================== */

// In-memory active casual rooms map
const casualPlayRooms = new Map();

// Helper: Generate random 6-character room code (e.g. 7X9K2B)
const generateRoomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const initializePlaySocketHandlers = (io) => {
  io.on("connection", (socket) => {
    // 1. Create Casual Game Room
    socket.on("create_casual_room", ({ roomCode: requestedCode, timeConfig, side, playerName }) => {
      try {
        let roomCode = (requestedCode || "").trim().toUpperCase();
        if (!roomCode || casualPlayRooms.has(roomCode)) {
          roomCode = generateRoomCode();
          while (casualPlayRooms.has(roomCode)) {
            roomCode = generateRoomCode();
          }
        }

        let assignedSide = side || "random";
        if (assignedSide === "random") {
          assignedSide = Math.random() < 0.5 ? "white" : "black";
        }

        const playerObj = {
          socketId: socket.id,
          name: playerName || "Player 1",
          side: assignedSide,
        };

        const room = {
          roomCode,
          timeConfig: timeConfig || { time: 5, inc: 0, mode: "Blitz" },
          playerWhite: assignedSide === "white" ? playerObj : null,
          playerBlack: assignedSide === "black" ? playerObj : null,
          creatorSide: assignedSide,
          status: "waiting", // "waiting" | "playing" | "finished"
          fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          moves: [],
          createdAt: Date.now(),
        };

        casualPlayRooms.set(roomCode, room);

        const roomName = `play_room_${roomCode}`;
        socket.join(roomName);
        socket.casualRoomCode = roomCode;

        console.log(`[CasualPlay] Room created: ${roomCode} by ${playerObj.name} (${assignedSide})`);

        socket.emit("casual_room_created", {
          success: true,
          roomCode,
          timeConfig: room.timeConfig,
          assignedSide,
          status: "waiting",
        });
      } catch (err) {
        console.error("[CasualPlay] Error creating room:", err);
        socket.emit("casual_room_error", { message: "Failed to create room" });
      }
    });

    // 2. Join Casual Game Room
    socket.on("join_casual_room", ({ roomCode, playerName }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const room = casualPlayRooms.get(cleanCode);

        if (!room) {
          return socket.emit("casual_room_error", { message: "Room not found or code expired." });
        }

        if (room.status === "finished") {
          return socket.emit("casual_room_error", { message: "This game has already ended." });
        }

        let assignedSide = "black";
        if (!room.playerWhite) {
          assignedSide = "white";
          room.playerWhite = {
            socketId: socket.id,
            name: playerName || "Player 2",
            side: "white",
          };
        } else if (!room.playerBlack) {
          assignedSide = "black";
          room.playerBlack = {
            socketId: socket.id,
            name: playerName || "Player 2",
            side: "black",
          };
        } else {
          // Check if reconnecting existing player
          if (room.playerWhite.name === playerName || room.playerWhite.socketId === socket.id) {
            room.playerWhite.socketId = socket.id;
            assignedSide = "white";
          } else if (room.playerBlack.name === playerName || room.playerBlack.socketId === socket.id) {
            room.playerBlack.socketId = socket.id;
            assignedSide = "black";
          } else {
            return socket.emit("casual_room_error", { message: "Room is already full." });
          }
        }

        room.status = "playing";
        const roomName = `play_room_${cleanCode}`;
        socket.join(roomName);
        socket.casualRoomCode = cleanCode;

        console.log(`[CasualPlay] Player ${playerName} joined room: ${cleanCode} as ${assignedSide}`);

        // Broadcast game start / resume to all players in the room
        io.to(roomName).emit("casual_game_start", {
          success: true,
          roomCode: cleanCode,
          timeConfig: room.timeConfig,
          playerWhite: room.playerWhite,
          playerBlack: room.playerBlack,
          fen: room.fen,
          moves: room.moves,
          status: "playing",
        });
      } catch (err) {
        console.error("[CasualPlay] Error joining room:", err);
        socket.emit("casual_room_error", { message: "Failed to join room" });
      }
    });

    // 3. Reconnect to Active Casual Room on Refresh / Navigation
    socket.on("reconnect_casual_room", ({ roomCode, playerName, side }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const room = casualPlayRooms.get(cleanCode);

        if (!room || room.status === "finished") {
          return socket.emit("casual_room_error", { message: "Active game session ended." });
        }

        const roomName = `play_room_${cleanCode}`;
        socket.join(roomName);
        socket.casualRoomCode = cleanCode;

        if (side === "white" && room.playerWhite) {
          room.playerWhite.socketId = socket.id;
          if (playerName) room.playerWhite.name = playerName;
        } else if (side === "black" && room.playerBlack) {
          room.playerBlack.socketId = socket.id;
          if (playerName) room.playerBlack.name = playerName;
        }

        console.log(`[CasualPlay] Player reconnected to room: ${cleanCode} (${side})`);

        socket.emit("casual_game_sync", {
          success: true,
          roomCode: cleanCode,
          timeConfig: room.timeConfig,
          playerWhite: room.playerWhite,
          playerBlack: room.playerBlack,
          fen: room.fen,
          moves: room.moves,
          nextTurn: (room.fen.split(" ")[1]) || "w",
          status: room.status,
        });
      } catch (err) {
        console.error("[CasualPlay] Error reconnecting room:", err);
      }
    });

    // 4. Make Move in Room
    socket.on("make_casual_move", ({ roomCode, from, to, promotion, fen, moveNotation }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const room = casualPlayRooms.get(cleanCode);

        if (!room) return;

        room.fen = fen;
        if (moveNotation) {
          room.moves.push(moveNotation);
        }

        const roomName = `play_room_${cleanCode}`;
        // Broadcast move to opponent
        socket.to(roomName).emit("casual_move_made", {
          roomCode: cleanCode,
          from,
          to,
          promotion,
          fen,
          moveNotation,
          nextTurn: fen.split(" ")[1] || "w",
        });
      } catch (err) {
        console.error("[CasualPlay] Error making move:", err);
      }
    });

    // 5. Game Over (Checkmate, Timeout, Stalemate)
    socket.on("casual_game_over", ({ roomCode, reason, winner }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const room = casualPlayRooms.get(cleanCode);
        if (room) {
          room.status = "finished";
          const roomName = `play_room_${cleanCode}`;
          io.to(roomName).emit("casual_game_over", { reason, winner });
        }
      } catch (err) {
        console.error("[CasualPlay] Error handling game over:", err);
      }
    });

    // 6. Resign Game
    socket.on("casual_resign", ({ roomCode, playerSide }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const room = casualPlayRooms.get(cleanCode);
        if (room) {
          room.status = "finished";
          const winner = playerSide === "white" ? "black" : "white";
          const roomName = `play_room_${cleanCode}`;
          io.to(roomName).emit("casual_game_over", {
            reason: "resigned",
            resignedBy: playerSide,
            winner,
          });
        }
      } catch (err) {
        console.error("[CasualPlay] Error resigning:", err);
      }
    });

    // 7. Draw Offer & Response
    socket.on("casual_offer_draw", ({ roomCode, playerSide }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const roomName = `play_room_${cleanCode}`;
        socket.to(roomName).emit("casual_draw_offered", { fromSide: playerSide });
      } catch (err) {}
    });

    socket.on("casual_respond_draw", ({ roomCode, accepted }) => {
      try {
        const cleanCode = (roomCode || "").trim().toUpperCase();
        const roomName = `play_room_${cleanCode}`;
        if (accepted) {
          const room = casualPlayRooms.get(cleanCode);
          if (room) room.status = "finished";
          io.to(roomName).emit("casual_game_over", { reason: "draw_accepted", winner: "draw" });
        } else {
          socket.to(roomName).emit("casual_draw_declined");
        }
      } catch (err) {}
    });

    // 8. Disconnect Handler
    socket.on("disconnect", () => {
      if (socket.casualRoomCode) {
        const room = casualPlayRooms.get(socket.casualRoomCode);
        if (room) {
          const roomName = `play_room_${socket.casualRoomCode}`;
          socket.to(roomName).emit("casual_opponent_disconnected");
          // Clean up room only if inactive for 20 minutes
          setTimeout(() => {
            const socketsInRoom = io.sockets.adapter.rooms?.get(roomName);
            if (!socketsInRoom || socketsInRoom.size === 0) {
              casualPlayRooms.delete(socket.casualRoomCode);
            }
          }, 20 * 60 * 1000);
        }
      }
    });
  });
};

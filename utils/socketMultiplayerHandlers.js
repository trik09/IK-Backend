import { Chess } from "chess.js";
import User from "../models/UserSchema.js";

// In-memory state for low-latency active games and challenges
const activeChallenges = new Map(); // roomCode -> challengeData
const activeGames = new Map();      // gameId -> gameData
const userSocketMap = new Map();    // userId -> socketId
const socketUserMap = new Map();    // socketId -> userId

/**
 * Calculates ELO Rating Delta for Multiplayer Matches
 */
function calculateMatchElo(whiteRating, blackRating, result, whiteGames = 0, blackGames = 0) {
  // result: 1 (White win), 0 (Black win), 0.5 (Draw)
  const Rw = whiteRating || 1000;
  const Rb = blackRating || 1000;

  const Ew = 1 / (1 + Math.pow(10, (Rb - Rw) / 400));
  const Eb = 1 / (1 + Math.pow(10, (Rw - Rb) / 400));

  const Kw = whiteGames < 15 ? 40 : whiteGames < 30 ? 32 : 16;
  const Kb = blackGames < 15 ? 40 : blackGames < 30 ? 32 : 16;

  const Sw = result;
  const Sb = 1 - result;

  const deltaW = Math.round(Kw * (Sw - Ew));
  const deltaB = Math.round(Kb * (Sb - Eb));

  return {
    whiteDelta: deltaW,
    blackDelta: deltaB,
    newWhiteRating: Math.max(100, Rw + deltaW),
    newBlackRating: Math.max(100, Rb + deltaB),
  };
}

/**
 * Generates a clean 6-character room code
 */
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function initializeMultiplayerSocketHandlers(io) {
  const mpNamespace = io.of("/multiplayer");

  mpNamespace.on("connection", (socket) => {
    // ── 1. Register User Socket ──────────────────────────────────────────────
    socket.on("mp_identify", async ({ userId }) => {
      if (!userId) return;
      userSocketMap.set(userId, socket.id);
      socketUserMap.set(socket.id, userId);
      socket.userId = userId;

      // Check if user is already in an active game (reconnection)
      for (const [gameId, game] of activeGames.entries()) {
        if (
          (game.white.userId === userId || game.black.userId === userId) &&
          !game.isGameOver
        ) {
          socket.join(gameId);
          if (game.disconnectTimer) {
            clearTimeout(game.disconnectTimer);
            game.disconnectTimer = null;
          }

          // Notify room of reconnection
          mpNamespace.to(gameId).emit("mp_player_reconnected", {
            userId,
            color: game.white.userId === userId ? "white" : "black",
          });

          // Send current game snapshot to reconnecting player
          socket.emit("mp_game_reconnected", getPublicGameState(game));
          break;
        }
      }
    });

    // ── 2. Create Challenge ──────────────────────────────────────────────────
    socket.on("mp_create_challenge", async (payload, callback) => {
      try {
        const {
          timeControl = { minutes: 5, increment: 3 },
          color = "random", // 'white' | 'black' | 'random'
          isRated = true,
          user,
        } = payload;

        if (!user || !user._id) {
          if (typeof callback === "function") callback({ success: false, message: "Authentication required" });
          return;
        }

        // Fetch fresh user rating
        const dbUser = await User.findById(user._id).select("name username avatar playingRating").lean();
        const playingRating = dbUser?.playingRating || 1000;

        let roomCode = generateRoomCode();
        while (activeChallenges.has(roomCode)) {
          roomCode = generateRoomCode();
        }

        const challengeData = {
          roomCode,
          host: {
            userId: user._id,
            name: dbUser?.name || user.name || "Player",
            username: dbUser?.username || user.username || "Player",
            avatar: dbUser?.avatar || user.avatar || "",
            rating: playingRating,
            socketId: socket.id,
          },
          timeControl: {
            minutes: Math.max(1, parseInt(timeControl.minutes) || 5),
            increment: Math.max(0, parseInt(timeControl.increment) || 0),
          },
          colorPreference: color,
          isRated: Boolean(isRated),
          createdAt: Date.now(),
        };

        activeChallenges.set(roomCode, challengeData);
        socket.join(roomCode);
        socket.currentRoomCode = roomCode;

        if (typeof callback === "function") {
          callback({
            success: true,
            roomCode,
            challenge: challengeData,
          });
        }
      } catch (err) {
        console.error("[MP] Error creating challenge:", err);
        if (typeof callback === "function") callback({ success: false, message: err.message });
      }
    });

    // ── 3. Get Challenge Info ────────────────────────────────────────────────
    socket.on("mp_get_challenge", ({ roomCode }, callback) => {
      const challenge = activeChallenges.get(roomCode?.toUpperCase());
      if (!challenge) {
        if (typeof callback === "function") callback({ success: false, message: "Challenge not found or expired" });
        return;
      }
      if (typeof callback === "function") callback({ success: true, challenge });
    });

    // ── 4. Cancel Challenge ──────────────────────────────────────────────────
    socket.on("mp_cancel_challenge", ({ roomCode }) => {
      const code = roomCode?.toUpperCase();
      if (activeChallenges.has(code)) {
        activeChallenges.delete(code);
        socket.leave(code);
      }
    });

    // ── 5. Join Challenge & Start Game ───────────────────────────────────────
    socket.on("mp_join_challenge", async ({ roomCode, user }, callback) => {
      try {
        const code = roomCode?.toUpperCase();
        const challenge = activeChallenges.get(code);

        if (!challenge) {
          if (typeof callback === "function") callback({ success: false, message: "Game room does not exist or has expired." });
          return;
        }

        if (challenge.host.userId === user._id) {
          if (typeof callback === "function") callback({ success: false, message: "You cannot join your own challenge." });
          return;
        }

        const dbUser = await User.findById(user._id).select("name username avatar playingRating").lean();
        const opponentRating = dbUser?.playingRating || 1000;

        const challenger = {
          userId: user._id,
          name: dbUser?.name || user.name || "Opponent",
          username: dbUser?.username || user.username || "Opponent",
          avatar: dbUser?.avatar || user.avatar || "",
          rating: opponentRating,
          socketId: socket.id,
        };

        // Determine colors
        let whitePlayer, blackPlayer;
        if (challenge.colorPreference === "white") {
          whitePlayer = challenge.host;
          blackPlayer = challenger;
        } else if (challenge.colorPreference === "black") {
          whitePlayer = challenger;
          blackPlayer = challenge.host;
        } else {
          // Random
          if (Math.random() > 0.5) {
            whitePlayer = challenge.host;
            blackPlayer = challenger;
          } else {
            whitePlayer = challenger;
            blackPlayer = challenge.host;
          }
        }

        const initialTimeMs = challenge.timeControl.minutes * 60 * 1000;
        const chessInstance = new Chess();

        const gameData = {
          gameId: code,
          chess: chessInstance,
          fen: chessInstance.fen(),
          white: whitePlayer,
          black: blackPlayer,
          timeControl: challenge.timeControl,
          isRated: challenge.isRated,
          whiteTime: initialTimeMs,
          blackTime: initialTimeMs,
          lastMoveTime: null,
          turn: "w",
          moveHistory: [],
          isGameOver: false,
          result: null,
          drawOfferedBy: null,
          disconnectTimer: null,
          timerInterval: null,
        };

        activeGames.set(code, gameData);
        activeChallenges.delete(code); // Clean up challenge

        socket.join(code);

        // Notify both players that game has started
        const publicState = getPublicGameState(gameData);
        mpNamespace.to(code).emit("mp_game_started", publicState);

        if (typeof callback === "function") callback({ success: true, gameState: publicState });
      } catch (err) {
        console.error("[MP] Error joining challenge:", err);
        if (typeof callback === "function") callback({ success: false, message: err.message });
      }
    });

    // ── 6. Make Move ─────────────────────────────────────────────────────────
    socket.on("mp_make_move", async ({ gameId, from, to, promotion = "q" }, callback) => {
      try {
        const game = activeGames.get(gameId);
        if (!game || game.isGameOver) {
          if (typeof callback === "function") callback({ success: false, message: "Game is not active." });
          return;
        }

        const currentTurn = game.chess.turn(); // 'w' or 'b'
        const expectedUserId = currentTurn === "w" ? game.white.userId : game.black.userId;

        if (socket.userId && socket.userId !== expectedUserId) {
          if (typeof callback === "function") callback({ success: false, message: "It is not your turn." });
          return;
        }

        const now = Date.now();

        // Calculate time elapsed for the player who just moved
        if (game.lastMoveTime) {
          const elapsed = now - game.lastMoveTime;
          if (currentTurn === "w") {
            game.whiteTime = Math.max(0, game.whiteTime - elapsed + (game.timeControl.increment * 1000));
          } else {
            game.blackTime = Math.max(0, game.blackTime - elapsed + (game.timeControl.increment * 1000));
          }
        }
        game.lastMoveTime = now;

        // Execute move on server instance
        const moveResult = game.chess.move({ from, to, promotion });
        if (!moveResult) {
          if (typeof callback === "function") callback({ success: false, message: "Illegal move." });
          return;
        }

        game.fen = game.chess.fen();
        game.turn = game.chess.turn();
        game.drawOfferedBy = null; // Clear draw offers on any move

        const moveRecord = {
          from: moveResult.from,
          to: moveResult.to,
          san: moveResult.san,
          piece: moveResult.piece,
          captured: moveResult.captured || null,
          promotion: moveResult.promotion || null,
          fen: game.fen,
          whiteTime: game.whiteTime,
          blackTime: game.blackTime,
        };
        game.moveHistory.push(moveRecord);

        // Start clock ticker if not already running
        startClockTicker(mpNamespace, game);

        // Check game-ending conditions
        if (game.chess.isGameOver()) {
          let winner = null;
          let reason = "Game Over";

          if (game.chess.isCheckmate()) {
            winner = currentTurn === "w" ? "white" : "black";
            reason = `Checkmate! ${winner === "white" ? game.white.name : game.black.name} won.`;
          } else if (game.chess.isDraw()) {
            if (game.chess.isStalemate()) reason = "Draw by Stalemate";
            else if (game.chess.isThreefoldRepetition()) reason = "Draw by 3-Fold Repetition";
            else if (game.chess.isInsufficientMaterial()) reason = "Draw by Insufficient Material";
            else reason = "Draw by 50-Move Rule";
          }

          await handleGameOver(mpNamespace, game, winner, reason);
          return;
        }

        // Broadcast valid move to room
        mpNamespace.to(gameId).emit("mp_move_made", {
          move: moveRecord,
          fen: game.fen,
          turn: game.turn,
          whiteTime: game.whiteTime,
          blackTime: game.blackTime,
          isCheck: game.chess.inCheck(),
        });

        if (typeof callback === "function") callback({ success: true });
      } catch (err) {
        console.error("[MP] Move error:", err);
        if (typeof callback === "function") callback({ success: false, message: err.message });
      }
    });

    // ── 7. Resign ────────────────────────────────────────────────────────────
    socket.on("mp_resign", async ({ gameId }) => {
      const game = activeGames.get(gameId);
      if (!game || game.isGameOver) return;

      const isWhite = game.white.userId === socket.userId;
      const winner = isWhite ? "black" : "white";
      const resignerName = isWhite ? game.white.name : game.black.name;

      await handleGameOver(
        mpNamespace,
        game,
        winner,
        `${resignerName} resigned. ${winner === "white" ? game.white.name : game.black.name} won.`
      );
    });

    // ── 8. Draw Offer & Response ─────────────────────────────────────────────
    socket.on("mp_offer_draw", ({ gameId }) => {
      const game = activeGames.get(gameId);
      if (!game || game.isGameOver) return;

      const isWhite = game.white.userId === socket.userId;
      game.drawOfferedBy = isWhite ? "white" : "black";

      mpNamespace.to(gameId).emit("mp_draw_offered", {
        byColor: game.drawOfferedBy,
      });
    });

    socket.on("mp_respond_draw", async ({ gameId, accept }) => {
      const game = activeGames.get(gameId);
      if (!game || game.isGameOver) return;

      if (accept) {
        await handleGameOver(mpNamespace, game, null, "Draw agreed by both players.");
      } else {
        game.drawOfferedBy = null;
        mpNamespace.to(gameId).emit("mp_draw_declined");
      }
    });

    // ── 9. Abort (Move 1 only) ────────────────────────────────────────────────
    socket.on("mp_abort", ({ gameId }) => {
      const game = activeGames.get(gameId);
      if (!game || game.isGameOver) return;

      if (game.moveHistory.length < 2) {
        clearInterval(game.timerInterval);
        game.isGameOver = true;
        game.result = {
          winner: null,
          reason: "Game aborted.",
          isAborted: true,
          whiteDelta: 0,
          blackDelta: 0,
        };
        mpNamespace.to(gameId).emit("mp_game_over", game.result);
      }
    });

    // ── 10. Rematch ──────────────────────────────────────────────────────────
    socket.on("mp_request_rematch", ({ gameId }) => {
      const game = activeGames.get(gameId);
      if (!game) return;

      mpNamespace.to(gameId).emit("mp_rematch_offered", {
        byUserId: socket.userId,
      });
    });

    socket.on("mp_accept_rematch", async ({ gameId }) => {
      const oldGame = activeGames.get(gameId);
      if (!oldGame) return;

      // Swap colors for rematch
      const newWhite = oldGame.black;
      const newBlack = oldGame.white;
      const initialTimeMs = oldGame.timeControl.minutes * 60 * 1000;
      const newChess = new Chess();

      // Refresh ratings
      const [uWhite, uBlack] = await Promise.all([
        User.findById(newWhite.userId).select("playingRating").lean(),
        User.findById(newBlack.userId).select("playingRating").lean(),
      ]);

      newWhite.rating = uWhite?.playingRating || 1000;
      newBlack.rating = uBlack?.playingRating || 1000;

      const newGameData = {
        gameId,
        chess: newChess,
        fen: newChess.fen(),
        white: newWhite,
        black: newBlack,
        timeControl: oldGame.timeControl,
        isRated: oldGame.isRated,
        whiteTime: initialTimeMs,
        blackTime: initialTimeMs,
        lastMoveTime: null,
        turn: "w",
        moveHistory: [],
        isGameOver: false,
        result: null,
        drawOfferedBy: null,
        disconnectTimer: null,
        timerInterval: null,
      };

      activeGames.set(gameId, newGameData);
      mpNamespace.to(gameId).emit("mp_game_started", getPublicGameState(newGameData));
    });

    // ── 11. In-Game Chat ─────────────────────────────────────────────────────
    socket.on("mp_send_chat", ({ gameId, text }) => {
      if (!text || !text.trim()) return;
      const game = activeGames.get(gameId);
      if (!game) return;

      const isWhite = game.white.userId === socket.userId;
      const sender = isWhite ? game.white.name : game.black.name;

      mpNamespace.to(gameId).emit("mp_chat_message", {
        sender,
        isWhite,
        text: text.trim().slice(0, 200),
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    });

    // ── 12. Disconnection Handling ───────────────────────────────────────────
    socket.on("disconnect", () => {
      const userId = socketUserMap.get(socket.id);
      socketUserMap.delete(socket.id);
      if (userId && userSocketMap.get(userId) === socket.id) {
        userSocketMap.delete(userId);
      }

      // Check if user was in a challenge
      if (socket.currentRoomCode && activeChallenges.has(socket.currentRoomCode)) {
        activeChallenges.delete(socket.currentRoomCode);
      }

      // Check active games for abandonment timer
      for (const [gameId, game] of activeGames.entries()) {
        if (
          !game.isGameOver &&
          (game.white.userId === userId || game.black.userId === userId)
        ) {
          const isWhite = game.white.userId === userId;
          mpNamespace.to(gameId).emit("mp_player_disconnected", {
            color: isWhite ? "white" : "black",
            graceSeconds: 45,
          });

          // 45s grace period before auto-forfeit
          game.disconnectTimer = setTimeout(async () => {
            if (!game.isGameOver) {
              const winner = isWhite ? "black" : "white";
              const loserName = isWhite ? game.white.name : game.black.name;
              await handleGameOver(
                mpNamespace,
                game,
                winner,
                `${loserName} disconnected and abandoned the match.`
              );
            }
          }, 45000);
          break;
        }
      }
    });
  });
}

/**
 * Clock ticker timer running authoritatively on server
 */
function startClockTicker(mpNamespace, game) {
  if (game.timerInterval) return;

  game.timerInterval = setInterval(async () => {
    if (game.isGameOver) {
      clearInterval(game.timerInterval);
      return;
    }

    const now = Date.now();
    if (!game.lastMoveTime) game.lastMoveTime = now;
    const elapsed = now - game.lastMoveTime;
    game.lastMoveTime = now;

    if (game.turn === "w") {
      game.whiteTime = Math.max(0, game.whiteTime - elapsed);
      if (game.whiteTime <= 0) {
        clearInterval(game.timerInterval);
        await handleGameOver(mpNamespace, game, "black", `Time out! ${game.black.name} won on time.`);
        return;
      }
    } else {
      game.blackTime = Math.max(0, game.blackTime - elapsed);
      if (game.blackTime <= 0) {
        clearInterval(game.timerInterval);
        await handleGameOver(mpNamespace, game, "white", `Time out! ${game.white.name} won on time.`);
        return;
      }
    }

    // Broadcast time sync every 1 second
    mpNamespace.to(game.gameId).emit("mp_time_sync", {
      whiteTime: game.whiteTime,
      blackTime: game.blackTime,
    });
  }, 1000);
}

/**
 * Handle game over, update Elo ratings, and notify players
 */
async function handleGameOver(mpNamespace, game, winner, reason) {
  if (game.isGameOver) return;
  game.isGameOver = true;
  if (game.timerInterval) clearInterval(game.timerInterval);
  if (game.disconnectTimer) clearTimeout(game.disconnectTimer);

  let whiteDelta = 0;
  let blackDelta = 0;
  let newWhiteRating = game.white.rating;
  let newBlackRating = game.black.rating;

  if (game.isRated) {
    try {
      const [uWhite, uBlack] = await Promise.all([
        User.findById(game.white.userId),
        User.findById(game.black.userId),
      ]);

      if (uWhite && uBlack) {
        const score = winner === "white" ? 1 : winner === "black" ? 0 : 0.5;
        const eloResult = calculateMatchElo(
          uWhite.playingRating || 1000,
          uBlack.playingRating || 1000,
          score,
          uWhite.playingGamesCount || 0,
          uBlack.playingGamesCount || 0
        );

        whiteDelta = eloResult.whiteDelta;
        blackDelta = eloResult.blackDelta;
        newWhiteRating = eloResult.newWhiteRating;
        newBlackRating = eloResult.newBlackRating;

        // Update White stats
        uWhite.playingRating = newWhiteRating;
        uWhite.playingGamesCount = (uWhite.playingGamesCount || 0) + 1;
        if (winner === "white") uWhite.playingWinsCount = (uWhite.playingWinsCount || 0) + 1;
        else if (winner === "black") uWhite.playingLossesCount = (uWhite.playingLossesCount || 0) + 1;
        else uWhite.playingDrawsCount = (uWhite.playingDrawsCount || 0) + 1;
        await uWhite.save();

        // Update Black stats
        uBlack.playingRating = newBlackRating;
        uBlack.playingGamesCount = (uBlack.playingGamesCount || 0) + 1;
        if (winner === "black") uBlack.playingWinsCount = (uBlack.playingWinsCount || 0) + 1;
        else if (winner === "white") uBlack.playingLossesCount = (uBlack.playingLossesCount || 0) + 1;
        else uBlack.playingDrawsCount = (uBlack.playingDrawsCount || 0) + 1;
        await uBlack.save();
      }
    } catch (err) {
      console.error("[MP] Error updating ratings on game over:", err);
    }
  }

  // Generate PGN for download
  const pgn = game.chess.pgn();

  game.result = {
    winner,
    reason,
    whiteDelta,
    blackDelta,
    newWhiteRating,
    newBlackRating,
    pgn,
    finalFen: game.fen,
  };

  mpNamespace.to(game.gameId).emit("mp_game_over", game.result);
}

/**
 * Strips internal server state for safe client consumption
 */
function getPublicGameState(game) {
  return {
    gameId: game.gameId,
    fen: game.fen,
    turn: game.turn,
    white: game.white,
    black: game.black,
    timeControl: game.timeControl,
    isRated: game.isRated,
    whiteTime: game.whiteTime,
    blackTime: game.blackTime,
    moveHistory: game.moveHistory,
    isGameOver: game.isGameOver,
    result: game.result,
  };
}

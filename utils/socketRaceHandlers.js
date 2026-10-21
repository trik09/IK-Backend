import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Chess } from "chess.js";
import RaceModel from "../models/RaceSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import { getAuthUserById } from "./userAuthCache.js";

let _io = null;

// Memory cache for active races
// raceId -> {
//   race,
//   puzzles: Map<puzzleId, puzzleDoc>,
//   participants: Map<userId, participantData>,
//   countdownTimer,
//   raceDurationTimer,
//   tickInterval
// }
const activeRaces = new Map();

export const getRaceIO = () => _io;

/**
 * Get or load active race state in memory
 */
export async function getOrLoadRace(raceId) {
  const id = String(raceId);
  if (activeRaces.has(id)) {
    return activeRaces.get(id);
  }

  const race = await RaceModel.findById(id).populate("puzzles").lean();
  if (!race) return null;

  const puzzleMap = new Map();
  const formattedPuzzles = [];
  if (Array.isArray(race.puzzles)) {
    race.puzzles.forEach((p) => {
      if (p?._id) {
        const item = {
          _id: p._id,
          id: p._id,
          title: p.title || "Puzzle",
          fen: p.fen,
          solutionMoves: p.solutionMoves || [],
          solution: p.solutionMoves || [],
          alternativeSolutions: p.alternativeSolutions || [],
          type: p.type || "normal",
          puzzleType: p.type || "normal",
          firstMoveBy: p.firstMoveBy || "w",
          difficulty: p.difficulty || "medium",
          category: p.category || "Tactics",
          rating: p.rating || 400,
        };
        puzzleMap.set(String(p._id), item);
        formattedPuzzles.push(item);
      }
    });
  }

  const participantMap = new Map();
  if (Array.isArray(race.participants)) {
    race.participants.forEach((p) => {
      const uId = String(p.user);
      participantMap.set(uId, {
        userId: uId,
        username: p.username || "Racer",
        name: p.name || "",
        avatar: p.avatar || null,
        vehicle: p.vehicle || { id: "supercar", name: "Supercar", color: "#ef4444" },
        meters: p.meters || 0,
        speed: p.speed || 0,
        combo: p.combo || 0,
        maxCombo: p.maxCombo || 0,
        puzzlesSolved: p.puzzlesSolved || 0,
        mistakes: p.mistakes || 0,
        skipsUsed: p.skipsUsed || 0,
        currentPuzzleIndex: p.currentPuzzleIndex || 0,
      });
    });
  }

  const raceState = {
    raceId: id,
    name: race.name,
    status: race.status,
    startTime: new Date(race.startTime).getTime(),
    endTime: new Date(race.endTime).getTime(),
    duration: race.duration,
    countdownDuration: race.countdownDuration || 10,
    puzzles: formattedPuzzles,
    puzzleMap,
    participants: participantMap,
    countdownRemaining: null,
    timeRemaining: race.duration,
    countdownTimer: null,
    raceTimer: null,
  };

  activeRaces.set(id, raceState);

  // If already scheduled or past, trigger lifecycle check
  checkAndTriggerRaceLifecycle(raceState);

  return raceState;
}

/**
 * Trigger countdown and race timers
 */
export function checkAndTriggerRaceLifecycle(raceState) {
  if (!_io || !raceState) return;
  const now = Date.now();
  const roomName = `race_${raceState.raceId}`;

  // If already ended
  if (raceState.status === "ENDED" || now >= raceState.endTime) {
    if (raceState.status !== "ENDED") {
      finishRace(raceState.raceId);
    }
    return;
  }

  // If already LIVE
  if (raceState.status === "LIVE") {
    startDurationTimer(raceState);
    return;
  }

  // If UPCOMING: check if within countdown window or starting immediately
  const countdownDurationMs = (raceState.countdownDuration || 10) * 1000;
  const timeUntilStart = raceState.startTime - now;

  if (timeUntilStart <= 0) {
    // If start time is already reached or in past, run a 5-second quick traffic countdown
    startCountdown(raceState, 5);
  } else if (timeUntilStart <= countdownDurationMs) {
    // Start or resume countdown
    const secondsLeft = Math.max(3, Math.ceil(timeUntilStart / 1000));
    startCountdown(raceState, secondsLeft);
  } else {
    // Schedule countdown start
    const delay = timeUntilStart - countdownDurationMs;
    setTimeout(() => {
      startCountdown(raceState, raceState.countdownDuration || 10);
    }, delay);
  }
}

function startCountdown(raceState, initialSeconds) {
  if (raceState.countdownTimer) clearInterval(raceState.countdownTimer);

  raceState.countdownRemaining = Math.max(1, initialSeconds);
  const roomName = `race_${raceState.raceId}`;

  _io.to(roomName).emit("raceCountdownTick", {
    secondsLeft: raceState.countdownRemaining,
  });

  raceState.countdownTimer = setInterval(async () => {
    raceState.countdownRemaining -= 1;

    _io.to(roomName).emit("raceCountdownTick", {
      secondsLeft: Math.max(0, raceState.countdownRemaining),
    });

    if (raceState.countdownRemaining <= 0) {
      clearInterval(raceState.countdownTimer);
      raceState.countdownTimer = null;
      await launchRace(raceState);
    }
  }, 1000);
}

async function launchRace(raceState) {
  raceState.status = "LIVE";
  raceState.timeRemaining = raceState.duration;
  const roomName = `race_${raceState.raceId}`;

  try {
    await RaceModel.findByIdAndUpdate(raceState.raceId, { status: "LIVE" });
  } catch (err) {
    console.error("[Race] Error updating race to LIVE:", err);
  }

  _io.to(roomName).emit("raceStarted", {
    serverTime: Date.now(),
    duration: raceState.duration,
    status: "LIVE",
  });

  startDurationTimer(raceState);
}

function startDurationTimer(raceState) {
  if (raceState.raceTimer) clearInterval(raceState.raceTimer);

  const roomName = `race_${raceState.raceId}`;
  const now = Date.now();
  const remainingSeconds = Math.max(
    0,
    Math.round((raceState.endTime - now) / 1000)
  );
  raceState.timeRemaining = Math.min(raceState.duration, remainingSeconds);

  raceState.raceTimer = setInterval(async () => {
    raceState.timeRemaining -= 1;

    _io.to(roomName).emit("raceTimerTick", {
      secondsRemaining: Math.max(0, raceState.timeRemaining),
    });

    if (raceState.timeRemaining <= 0) {
      clearInterval(raceState.raceTimer);
      raceState.raceTimer = null;
      await finishRace(raceState.raceId);
    }
  }, 1000);
}

export async function finishRace(raceId) {
  const raceState = activeRaces.get(String(raceId));
  const roomName = `race_${raceId}`;

  if (raceState) {
    if (raceState.countdownTimer) clearInterval(raceState.countdownTimer);
    if (raceState.raceTimer) clearInterval(raceState.raceTimer);
    raceState.status = "ENDED";
  }

  // Build final standings
  let standings = [];
  if (raceState && raceState.participants) {
    standings = Array.from(raceState.participants.values()).sort((a, b) => {
      if (b.meters !== a.meters) return b.meters - a.meters;
      if (b.puzzlesSolved !== a.puzzlesSolved) return b.puzzlesSolved - a.puzzlesSolved;
      return a.mistakes - b.mistakes;
    });
  }

  // Update DB
  try {
    const participantsArray = standings.map((p) => ({
      user: p.userId,
      username: p.username,
      name: p.name,
      avatar: p.avatar,
      vehicle: p.vehicle,
      meters: p.meters,
      speed: p.speed,
      combo: p.combo,
      maxCombo: p.maxCombo,
      puzzlesSolved: p.puzzlesSolved,
      mistakes: p.mistakes,
      skipsUsed: p.skipsUsed,
      currentPuzzleIndex: p.currentPuzzleIndex,
      finishedAt: new Date(),
    }));

    await RaceModel.findByIdAndUpdate(raceId, {
      status: "ENDED",
      participants: participantsArray,
    });
  } catch (err) {
    console.error("[Race] Error updating race to ENDED:", err);
  }

  if (_io) {
    _io.to(roomName).emit("raceEnded", {
      status: "ENDED",
      standings,
      podium: standings.slice(0, 3),
    });
  }
}

/**
 * Move normalization and validation helper
 */
function isMoveMatchingSolution(puzzle, moveData) {
  if (!puzzle) return false;
  const solutions = puzzle.solutionMoves || [];
  const alternativeSolutions = puzzle.alternativeSolutions || [];

  if (solutions.length === 0 && (!alternativeSolutions || alternativeSolutions.length === 0)) {
    return true;
  }

  const cleanPlayedSan = moveData.san ? moveData.san.replace(/[+#]/g, "").trim().toLowerCase() : null;
  const playedFromTo = moveData.from && moveData.to ? `${moveData.from}${moveData.to}`.toLowerCase() : null;
  const playedLan = moveData.from && moveData.to
    ? `${moveData.from}${moveData.to}${moveData.promotion || ""}`.toLowerCase()
    : null;

  // Check main solution (first human move)
  const expectedFirstMove = solutions[0]?.trim();
  if (expectedFirstMove) {
    const cleanExpected = expectedFirstMove.replace(/[+#]/g, "").toLowerCase();
    if (cleanPlayedSan && cleanPlayedSan === cleanExpected) return true;
    if (playedLan && playedLan === cleanExpected) return true;
    if (playedFromTo && (cleanExpected.startsWith(playedFromTo) || cleanExpected === playedFromTo)) return true;
  }

  // Check alternative solutions
  if (Array.isArray(alternativeSolutions)) {
    for (const alt of alternativeSolutions) {
      const altFirst = alt?.[0]?.trim();
      if (altFirst) {
        const cleanAlt = altFirst.replace(/[+#]/g, "").toLowerCase();
        if (cleanPlayedSan && cleanPlayedSan === cleanAlt) return true;
        if (playedLan && playedLan === cleanAlt) return true;
        if (playedFromTo && (cleanAlt.startsWith(playedFromTo) || cleanAlt === playedFromTo)) return true;
      }
    }
  }

  // Additional chess.js move comparison
  try {
    const chess = new Chess(puzzle.fen);
    const result = chess.move(moveData);
    if (result) {
      const resultSanClean = result.san.replace(/[+#]/g, "").toLowerCase();
      if (solutions.some((s) => s.replace(/[+#]/g, "").toLowerCase() === resultSanClean)) return true;
    }
  } catch {
    // ignore parsing errors
  }

  return false;
}

/**
 * Socket initializer for races
 */
export const initializeRaceSocketHandlers = (io) => {
  _io = io;

  // Dedicated namespace or shared instance
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
      }
      next();
    } catch {
      // Continue even if unauthenticated so spectators can watch
      next();
    }
  });

  io.on("connection", (socket) => {
    /* ─── JOIN RACE ROOM ─── */
    socket.on("joinRace", async ({ raceId, userDetails, vehicle }) => {
      try {
        if (!raceId) return;
        const roomName = `race_${raceId}`;
        socket.join(roomName);

        const raceState = await getOrLoadRace(raceId);
        if (!raceState) {
          socket.emit("raceError", { message: "Race not found" });
          return;
        }

        const userId = socket.userId || userDetails?.id || userDetails?._id || socket.id;
        const uIdStr = String(userId);

        // Fetch user from DB or cache if authenticated
        let user = null;
        if (socket.userId) {
          user = await getAuthUserById(socket.userId);
        }

        const username = user?.username || userDetails?.username || user?.name || userDetails?.name || "Racer";
        const avatar = user?.avatar || userDetails?.avatar || null;
        const chosenVehicle = vehicle || {
          id: "supercar",
          name: "Supercar",
          color: "#ef4444",
        };

        // Add or update participant in race state
        let participant = raceState.participants.get(uIdStr);
        if (!participant) {
          // Check if participant already exists in race document to restore progress across refreshes
          const raceDoc = await RaceModel.findById(raceId).lean();
          const dbP = (raceDoc?.participants || []).find(
            (p) => String(p.user?._id || p.user) === uIdStr
          );

          if (dbP) {
            participant = {
              userId: uIdStr,
              username: dbP.username || username,
              name: dbP.name || user?.name || userDetails?.name || "",
              avatar: dbP.avatar || avatar,
              vehicle: vehicle || dbP.vehicle || chosenVehicle,
              meters: dbP.meters || 0,
              speed: dbP.speed || (raceState.status === "LIVE" ? 60 : 0),
              combo: dbP.combo || 0,
              maxCombo: dbP.maxCombo || 0,
              puzzlesSolved: dbP.puzzlesSolved || 0,
              mistakes: dbP.mistakes || 0,
              skipsUsed: dbP.skipsUsed || 0,
              currentPuzzleIndex: dbP.currentPuzzleIndex || 0,
            };
          } else {
            participant = {
              userId: uIdStr,
              username,
              name: user?.name || userDetails?.name || "",
              avatar,
              vehicle: chosenVehicle,
              meters: 0,
              speed: raceState.status === "LIVE" ? 60 : 0,
              combo: 0,
              maxCombo: 0,
              puzzlesSolved: 0,
              mistakes: 0,
              skipsUsed: 0,
              currentPuzzleIndex: 0,
            };

            // Persist participant entry to DB asynchronously
            RaceModel.findByIdAndUpdate(
              raceId,
              {
                $addToSet: {
                  participants: {
                    user: mongoose.Types.ObjectId.isValid(uIdStr) ? uIdStr : new mongoose.Types.ObjectId(),
                    username,
                    name: participant.name,
                    avatar,
                    vehicle: chosenVehicle,
                    meters: 0,
                    speed: 0,
                    currentPuzzleIndex: 0,
                  },
                },
              },
              { new: true }
            ).catch((e) => console.error("[Race] DB participant upsert error:", e.message));
          }
          raceState.participants.set(uIdStr, participant);
        } else if (vehicle) {
          participant.vehicle = chosenVehicle;
        }

        // Broadcast new participant to room
        io.to(roomName).emit("participantJoinedRace", {
          participant,
          totalParticipants: raceState.participants.size,
        });

        // Broadcast to public lobby so other PCs update in real-time without refreshing
        io.emit("raceLobbyUpdate", {
          raceId: String(raceId),
          participantCount: raceState.participants.size,
          status: raceState.status,
        });

        const liveRemaining =
          raceState.status === "LIVE"
            ? Math.max(0, Math.round((raceState.endTime - Date.now()) / 1000))
            : raceState.timeRemaining;

        // Send full race state to the joining socket with restored progress
        socket.emit("raceState", {
          raceId: raceState.raceId,
          name: raceState.name,
          status: raceState.status,
          startTime: raceState.startTime,
          endTime: raceState.endTime,
          duration: raceState.duration,
          countdownRemaining: raceState.countdownRemaining,
          timeRemaining: liveRemaining,
          participants: Array.from(raceState.participants.values()),
          puzzles: raceState.puzzles,
          myParticipant: participant,
        });
      } catch (err) {
        console.error("[SocketRace] joinRace error:", err);
      }
    });

    /* ─── SELECT / UPDATE VEHICLE ─── */
    socket.on("selectVehicle", async ({ raceId, vehicle }) => {
      try {
        if (!raceId || !vehicle) return;
        const raceState = await getOrLoadRace(raceId);
        if (!raceState) return;

        const uIdStr = String(socket.userId || socket.id);
        const participant = raceState.participants.get(uIdStr);
        if (participant) {
          participant.vehicle = vehicle;
          io.to(`race_${raceId}`).emit("participantVehicleChanged", {
            userId: uIdStr,
            vehicle,
          });
        }
      } catch (err) {
        console.error("[SocketRace] selectVehicle error:", err);
      }
    });

    /* ─── SUBMIT MOVE WITH RACING PHYSICS ─── */
    socket.on("submitRaceMove", async ({ raceId, puzzleId, move, timeSpentSeconds }) => {
      try {
        if (!raceId || !puzzleId) return;
        const raceState = await getOrLoadRace(raceId);
        if (!raceState) return;

        if (raceState.status !== "LIVE") {
          socket.emit("raceMoveResult", {
            isCorrect: false,
            error: "Race is not currently live",
          });
          return;
        }

        const uIdStr = String(socket.userId || socket.id);
        const participant = raceState.participants.get(uIdStr);
        if (!participant) return;

        const puzzle = raceState.puzzleMap.get(String(puzzleId));
        if (!puzzle) return;

        const isExplicitSolved = Boolean(move?.isSolved || move?.action === "solved" || move?.status === "solved");
        const isExplicitWrong = Boolean(move?.isWrong || move?.status === "wrong");
        const isCorrect = isExplicitWrong ? false : (isExplicitSolved || isMoveMatchingSolution(puzzle, move));

        if (isCorrect) {
          // ── ACCELERATION & DISTANCE PHYSICS ──
          participant.puzzlesSolved += 1;
          participant.combo += 1;
          if (participant.combo > participant.maxCombo) {
            participant.maxCombo = participant.combo;
          }

          // Time-based speed calculation
          const solveTime = Math.max(0.5, Number(timeSpentSeconds) || 3);
          let speedKmh = 90;
          let timeBonusMeters = 10;

          if (solveTime <= 1.5) {
            speedKmh = 210;
            timeBonusMeters = 40;
          } else if (solveTime <= 3) {
            speedKmh = 175;
            timeBonusMeters = 25;
          } else if (solveTime <= 5) {
            speedKmh = 135;
            timeBonusMeters = 15;
          } else if (solveTime <= 8) {
            speedKmh = 105;
            timeBonusMeters = 8;
          } else {
            speedKmh = 75;
            timeBonusMeters = 4;
          }

          // Combo streak multiplier
          const comboBonusMeters = Math.min(participant.combo * 15, 60);
          const baseMeters = 50;
          const addedMeters = baseMeters + timeBonusMeters + comboBonusMeters;

          participant.meters += addedMeters;
          participant.speed = speedKmh;
          participant.currentPuzzleIndex += 1;

          const isTurbo = participant.combo >= 3;

          // Notify solving player
          socket.emit("raceMoveResult", {
            isCorrect: true,
            combo: participant.combo,
            meters: participant.meters,
            speed: participant.speed,
            addedMeters,
            isTurbo,
            nextPuzzleIndex: participant.currentPuzzleIndex,
          });

          // Broadcast vehicle position update to all racers in real time
          io.to(`race_${raceId}`).emit("racerProgressUpdate", {
            userId: uIdStr,
            username: participant.username,
            meters: participant.meters,
            speed: participant.speed,
            combo: participant.combo,
            isTurbo,
            puzzlesSolved: participant.puzzlesSolved,
            currentPuzzleIndex: participant.currentPuzzleIndex,
            vehicle: participant.vehicle,
          });

          // Persist progress to MongoDB asynchronously so browser refresh never resets progress
          RaceModel.updateOne(
            { _id: raceId, "participants.user": uIdStr },
            {
              $set: {
                "participants.$.meters": participant.meters,
                "participants.$.speed": participant.speed,
                "participants.$.combo": participant.combo,
                "participants.$.maxCombo": participant.maxCombo,
                "participants.$.puzzlesSolved": participant.puzzlesSolved,
                "participants.$.currentPuzzleIndex": participant.currentPuzzleIndex,
              },
            }
          ).catch((e) => console.error("[Race] DB move update error:", e.message));
        } else {
          // ── BRAKING PENALTY PHYSICS (Car brakes a little, speed drops to 20 km/h) ──
          participant.mistakes += 1;
          participant.combo = 0;
          participant.speed = 20;

          socket.emit("raceMoveResult", {
            isCorrect: false,
            combo: 0,
            meters: participant.meters,
            speed: 20,
            nextPuzzleIndex: participant.currentPuzzleIndex,
          });

          // Broadcast brake glow & smoke to other players
          io.to(`race_${raceId}`).emit("racerBrakeUpdate", {
            userId: uIdStr,
            username: participant.username,
            meters: participant.meters,
            speed: 20,
            combo: 0,
          });

          // Persist mistakes and speed to MongoDB
          RaceModel.updateOne(
            { _id: raceId, "participants.user": uIdStr },
            {
              $set: {
                "participants.$.mistakes": participant.mistakes,
                "participants.$.combo": 0,
                "participants.$.speed": 20,
              },
            }
          ).catch((e) => console.error("[Race] DB mistake update error:", e.message));
        }
      } catch (err) {
        console.error("[SocketRace] submitRaceMove error:", err);
      }
    });

    /* ─── SKIP PUZZLE (1 per race) ─── */
    socket.on("skipRacePuzzle", async ({ raceId }) => {
      try {
        if (!raceId) return;
        const raceState = await getOrLoadRace(raceId);
        if (!raceState || raceState.status !== "LIVE") return;

        const uIdStr = String(socket.userId || socket.id);
        const participant = raceState.participants.get(uIdStr);
        if (!participant) return;

        if (participant.skipsUsed >= 1) {
          socket.emit("raceError", { message: "You have already used your 1 skip for this race!" });
          return;
        }

        participant.skipsUsed += 1;
        participant.combo = 0;
        participant.currentPuzzleIndex += 1;

        socket.emit("raceSkipConfirmed", {
          skipsUsed: participant.skipsUsed,
          nextPuzzleIndex: participant.currentPuzzleIndex,
        });

        io.to(`race_${raceId}`).emit("racerSkipped", {
          userId: uIdStr,
          username: participant.username,
          currentPuzzleIndex: participant.currentPuzzleIndex,
        });

        // Persist skip to MongoDB
        RaceModel.updateOne(
          { _id: raceId, "participants.user": uIdStr },
          {
            $set: {
              "participants.$.skipsUsed": participant.skipsUsed,
              "participants.$.currentPuzzleIndex": participant.currentPuzzleIndex,
              "participants.$.combo": 0,
            },
          }
        ).catch((e) => console.error("[Race] DB skip update error:", e.message));
      } catch (err) {
        console.error("[SocketRace] skipRacePuzzle error:", err);
      }
    });

    /* ─── ADMIN FORCE START ─── */
    socket.on("adminStartRace", async ({ raceId }) => {
      try {
        if (!raceId) return;
        const raceState = await getOrLoadRace(raceId);
        if (!raceState) return;

        // Start 5-second quick countdown immediately
        startCountdown(raceState, 5);
      } catch (err) {
        console.error("[SocketRace] adminStartRace error:", err);
      }
    });

    /* ─── DISCONNECT ─── */
    socket.on("disconnect", () => {
      // Keep participant progress intact for seamless reconnect
    });
  });
};

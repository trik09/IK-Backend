import { Chess } from "chess.js";

/** Parse piece placement from FEN without chess.js (works for king-less learning boards). */
export function parseFenPieces(fen, playerSide = "w") {
  if (!fen) return [];
  const placement = fen.split(" ")[0];
  const ranks = placement.split("/");
  const pieces = [];
  for (let r = 0; r < ranks.length; r++) {
    let file = 0;
    for (const char of ranks[r]) {
      if (/\d/.test(char)) {
        file += parseInt(char, 10);
      } else {
        const color = char === char.toUpperCase() ? "w" : "b";
        if (color === playerSide) {
          pieces.push({
            square: String.fromCharCode(97 + file) + (8 - r),
            type: char.toLowerCase(),
            color,
          });
        }
        file += 1;
      }
    }
  }
  return pieces;
}

export function findAllPlayerPiecesInFen(fen, sideToMove = "w") {
  const parsed = parseFenPieces(fen, sideToMove);
  if (parsed.length > 0) return parsed;

  try {
    const chess = new Chess(fen);
    const board = chess.board();
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.color === sideToMove) {
          const square = String.fromCharCode(97 + c) + (8 - r);
          pieces.push({ square, type: piece.type, color: piece.color });
        }
      }
    }
    return pieces;
  } catch {
    return [];
  }
}

/** @deprecated use findAllPlayerPiecesInFen */
export function findPlayerPieceInFen(fen, sideToMove = "w") {
  return findAllPlayerPiecesInFen(fen, sideToMove)[0] || null;
}

export function destinationSquareFromSan(fen, san) {
  if (!fen || !san) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move(san, { sloppy: true });
    return move?.to || null;
  } catch {
    return null;
  }
}

function resolveTargetSquares(exercise) {
  if (Array.isArray(exercise.targetSquares) && exercise.targetSquares.length > 0) {
    return exercise.targetSquares.map((sq) => sq.toLowerCase());
  }
  if (exercise.targetSquare) {
    return [String(exercise.targetSquare).toLowerCase()];
  }
  if (exercise.captureConfig?.targets?.length) {
    return exercise.captureConfig.targets.map((t) => String(t.square).toLowerCase());
  }
  const hintTarget = exercise.hintArrows?.find((a) => a?.to)?.to;
  if (hintTarget) {
    return [String(hintTarget).toLowerCase()];
  }
  const solutionMove = Array.isArray(exercise.solutionMoves)
    ? exercise.solutionMoves[0]
    : null;
  const dest = destinationSquareFromSan(exercise.fen, solutionMove);
  return dest ? [dest.toLowerCase()] : [];
}

export function buildCaptureConfigForLearning(exercise) {
  if (!exercise?.fen) return null;

  const side = exercise.sideToMove || "w";
  const playerPieces =
    Array.isArray(exercise.playerPieces) && exercise.playerPieces.length > 0
      ? exercise.playerPieces.map((p) => ({
          square: p.square.toLowerCase(),
          type: p.type.toLowerCase(),
          color: p.color || side,
        }))
      : findAllPlayerPiecesInFen(exercise.fen, side);
  const targetSquares = resolveTargetSquares(exercise);

  if (playerPieces.length === 0 || targetSquares.length === 0) return null;

  return {
    mode: "objects",
    playerSide: side,
    playerPieces,
    targets: targetSquares.map((square) => ({ square, item: "star" })),
    maximumNoOfMoves: exercise.maximumNoOfMoves || null,
  };
}

export function resolveLearningPuzzleType(exercise) {
  if (exercise?.puzzleType === "capture") return "capture";
  if (buildCaptureConfigForLearning(exercise)) return "capture";
  return exercise?.puzzleType || "move";
}

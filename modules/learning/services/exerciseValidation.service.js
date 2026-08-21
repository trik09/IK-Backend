import { Chess } from "chess.js";

function getRawMovesArray(moves) {
  let result = moves;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      result =
        result.includes(",") || result.includes("\n")
          ? result.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)
          : [result];
    }
  }
  if (!Array.isArray(result)) {
    result = result != null ? [result] : [];
  }
  return result.map((m) => String(m).trim()).filter(Boolean);
}

function normalizeSanToken(san) {
  return String(san).toLowerCase().replace(/[+#]+$/g, "");
}

export function validateFen(fen) {
  if (!fen || typeof fen !== "string") {
    return { valid: false, message: "FEN is required" };
  }
  try {
    const chess = new Chess();
    chess.load(fen);
    return { valid: true, sideToMove: chess.turn() };
  } catch {
    return { valid: false, message: "Invalid FEN position" };
  }
}

export function replayMovesFromFen(fen, moves) {
  const rawMoves = getRawMovesArray(moves);
  if (!fen || rawMoves.length === 0) return null;

  try {
    const chess = new Chess();
    try {
      chess.load(fen);
    } catch {
      return null;
    }

    const sans = [];
    for (const move of rawMoves) {
      const result = chess.move(move, { sloppy: true });
      if (!result) return null;
      sans.push(result.san);
    }

    return {
      sans,
      isCheck: chess.inCheck(),
      isCheckmate: chess.isCheckmate(),
      isGameOver: chess.isGameOver(),
      fen: chess.fen(),
    };
  } catch {
    return null;
  }
}

export function validateMoveAtIndex(fen, solutionMoves, moveIndex, submittedMove) {
  const moves = getRawMovesArray(solutionMoves);
  if (moveIndex < 0 || moveIndex >= moves.length) {
    return { correct: false, message: "Invalid move index" };
  }

  const prefix = moves.slice(0, moveIndex);
  const expected = moves[moveIndex];

  const replayPrefix = replayMovesFromFen(fen, prefix);
  if (!replayPrefix && prefix.length > 0) {
    return { correct: false, message: "Invalid puzzle configuration" };
  }

  const currentFen = replayPrefix ? replayPrefix.fen : fen;
  const attempt = replayMovesFromFen(currentFen, [submittedMove]);
  if (!attempt) {
    return { correct: false, message: "Illegal move" };
  }

  const correct =
    normalizeSanToken(attempt.sans[0]) === normalizeSanToken(expected);

  let opponentMove = null;
  let puzzleComplete = correct && moveIndex === moves.length - 1;

  if (correct && !puzzleComplete && moveIndex + 1 < moves.length) {
    const nextIsOpponent = true;
    if (nextIsOpponent) {
      opponentMove = moves[moveIndex + 1];
      puzzleComplete = moveIndex + 1 === moves.length - 1;
    }
  }

  return {
    correct,
    opponentMove: correct && moveIndex + 1 < moves.length ? moves[moveIndex + 1] : null,
    puzzleComplete: correct && moveIndex === moves.length - 1,
    moveIndex: correct ? moveIndex + 1 : moveIndex,
  };
}

export function validateExercisePayload(exercise) {
  const errors = [];

  const fenCheck = validateFen(exercise.fen);
  if (!fenCheck.valid) {
    errors.push(fenCheck.message);
  }

  const solutions = getRawMovesArray(exercise.solutionMoves);
  if (solutions.length === 0) {
    errors.push("At least one solution move is required");
  } else {
    const replay = replayMovesFromFen(exercise.fen, solutions);
    if (!replay) {
      errors.push("Solution contains illegal moves from the given FEN");
    } else if (exercise.puzzleType === "checkmate" && !replay.isCheckmate) {
      errors.push("Checkmate exercise must end in checkmate");
    } else if (exercise.puzzleType === "check" && !replay.isCheck && !replay.isCheckmate) {
      errors.push("Check exercise should give check");
    }
  }

  if (Array.isArray(exercise.alternativeSolutions)) {
    exercise.alternativeSolutions.forEach((alt, i) => {
      const replay = replayMovesFromFen(exercise.fen, alt);
      if (!replay) {
        errors.push(`Alternative solution ${i + 1} contains illegal moves`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateFullSolution(exercise, submittedMoves) {
  const expectedList = [
    exercise.solutionMoves,
    ...(Array.isArray(exercise.alternativeSolutions) ? exercise.alternativeSolutions : []),
  ];

  const submitted = getRawMovesArray(submittedMoves);
  for (const expected of expectedList) {
    const expectedReplay = replayMovesFromFen(exercise.fen, expected);
    const submittedReplay = replayMovesFromFen(exercise.fen, submitted);
    if (!expectedReplay || !submittedReplay) continue;

    if (expectedReplay.sans.length === submittedReplay.sans.length) {
      const match = expectedReplay.sans.every(
        (m, i) => normalizeSanToken(m) === normalizeSanToken(submittedReplay.sans[i])
      );
      if (match) return { correct: true };
    }
  }

  return { correct: false };
}

export { getRawMovesArray };

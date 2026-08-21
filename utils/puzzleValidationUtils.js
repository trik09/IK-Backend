import { Chess } from "chess.js";

function getRawMovesArray(moves) {
  let result = moves;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      result = result.includes(",") || result.includes("\n")
        ? result.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)
        : [result];
    }
  }
  if (!Array.isArray(result)) {
    result = result != null ? [result] : [];
  }
  return result.map((m) => String(m).trim()).filter(Boolean);
}

function coerceExpectedSolution(path) {
  return getRawMovesArray(path);
}

function replayMovesFromFen(fen, moves) {
  const rawMoves = getRawMovesArray(moves);
  if (!fen || rawMoves.length === 0) return null;

  try {
    const chess = new Chess();
    // chess.js load() returns undefined on success — do NOT treat that as failure
    try {
      chess.load(fen);
    } catch {
      return null;
    }

    const sans = [];
    for (const move of rawMoves) {
      const result = chess.move(move, { sloppy: true });
      if (!result) return null;
      sans.push(result.san.toLowerCase());
    }

    return {
      sans,
      isCheckmate: chess.isCheckmate(),
      isGameOver: chess.isGameOver(),
    };
  } catch {
    return null;
  }
}

function normalizeSanToken(san) {
  return String(san).toLowerCase().replace(/[+#]+$/g, "");
}

function sanArraysMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((m, i) => normalizeSanToken(m) === normalizeSanToken(b[i]));
}

function normalizeMoveTokens(moves) {
  return getRawMovesArray(moves).map((m) => normalizeSanToken(m));
}

function validateNormalPuzzle(puzzle, solution, moveHistory) {
  const submissionCandidates = [solution, moveHistory].filter((v) => {
    if (v == null) return false;
    if (typeof v === "string") return v !== "solved" && v !== "failed";
    return Array.isArray(v) && v.length > 0;
  });

  const expectedSolutions = [
    puzzle.solutionMoves,
    ...(Array.isArray(puzzle.alternativeSolutions)
      ? puzzle.alternativeSolutions
      : []),
  ]
    .map(coerceExpectedSolution)
    .filter((s) => s.length > 0);

  const expectedReplayCache = new Map();
  const getExpectedReplay = (expected) => {
    const key = expected.join("\0");
    if (!expectedReplayCache.has(key)) {
      expectedReplayCache.set(key, replayMovesFromFen(puzzle.fen, expected));
    }
    return expectedReplayCache.get(key);
  };

  for (const submitted of submissionCandidates) {
    const submittedTokens = normalizeMoveTokens(submitted);

    // Cheap path: stored SAN/UCI strings already match (common for exact client lines).
    for (const expected of expectedSolutions) {
      if (sanArraysMatch(submittedTokens, normalizeMoveTokens(expected))) {
        return true;
      }
    }

    const submittedReplay = replayMovesFromFen(puzzle.fen, submitted);

    for (const expected of expectedSolutions) {
      const expectedReplay = getExpectedReplay(expected);
      if (!expectedReplay) continue;

      if (
        submittedReplay &&
        sanArraysMatch(submittedReplay.sans, expectedReplay.sans)
      ) {
        return true;
      }

      if (
        submittedTokens.length > 0 &&
        submittedTokens.length <= expectedReplay.sans.length
      ) {
        const suffix = expectedReplay.sans.slice(-submittedTokens.length);
        if (sanArraysMatch(submittedTokens, suffix)) {
          return true;
        }
      }
    }

    if (submittedReplay?.isCheckmate) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a submitted puzzle solution.
 * Returns { isCorrect: bool, scoreOverride: number|null }
 */
export function validatePuzzleSolution(
  puzzle,
  solution,
  moveCount = null,
  moveHistory = null
) {
  try {
    if (puzzle.type === "illegal") {
      const result =
        typeof solution === "string"
          ? solution
          : Array.isArray(solution)
            ? solution[0]
            : null;
      return { isCorrect: result === "solved", scoreOverride: null };
    }

    if (puzzle.type === "capture") {
      const solvedSignal =
        solution === "solved" ||
        (typeof solution === "string" && solution === "solved") ||
        (Array.isArray(solution) && solution[0] === "solved");

      const isCaptureSolved =
        solvedSignal ||
        (Array.isArray(solution) &&
          solution.length > 0 &&
          solution[0] !== "failed" &&
          solution[0] !== "wrong");

      if (!isCaptureSolved) {
        return { isCorrect: false, scoreOverride: null };
      }

      const moveLimit = parseInt(puzzle.captureConfig?.maximumNoOfMoves) || 0;
      const usedMoves = parseInt(moveCount) || 0;

      if (moveLimit > 0 && usedMoves > moveLimit) {
        return { isCorrect: true, scoreOverride: 5 };
      }

      return { isCorrect: true, scoreOverride: null };
    }

    const isCorrect = validateNormalPuzzle(puzzle, solution, moveHistory);
    return { isCorrect, scoreOverride: null };
  } catch (error) {
    console.error("Solution validation error:", error);
    return { isCorrect: false, scoreOverride: null };
  }
}

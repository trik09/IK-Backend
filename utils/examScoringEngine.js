/**
 * examScoringEngine.js
 *
 * Pure, deterministic scoring logic for all nine quiz types.
 *
 * Design rules:
 *  - No I/O, no side effects. Receives plain objects, returns plain objects.
 *  - scoreAnswer()  → evaluates one quiz question against one answer.
 *  - scoreExam()    → iterates all answers and returns a summary.
 *  - Both functions are idempotent: same input always produces same output.
 */

// ─── Board-builder helpers (pure, no chess.js dependency) ────────────────────

/**
 * Normalise a raw boardBuilderAnswer value from the saved answer document.
 * Accepts either:
 *   { pieces: [...] }          ← shape stored by saveAnswer
 *   [...]                      ← bare array
 *   null / undefined           ← unanswered
 */
function normaliseBoardState(raw) {
  if (!raw) return { pieces: [] };
  if (Array.isArray(raw)) return { pieces: raw };
  if (Array.isArray(raw.pieces)) return { pieces: raw.pieces };
  return { pieces: [] };
}

/**
 * Serialise a board state to a canonical string for equality comparison.
 * Pieces are sorted by square so order differences don't matter.
 */
function serialiseBoardState(boardState) {
  const pieces = [...(boardState.pieces || [])]
    .map(p => ({ square: String(p.square || ""), type: String(p.type || ""), color: String(p.color || "") }))
    .sort((a, b) => a.square.localeCompare(b.square));
  return JSON.stringify(pieces);
}

/**
 * Return true when two board states contain the same set of (square, type, color) triples.
 */
function boardStatesEqual(left, right) {
  const l = normaliseBoardState(left);
  const r = normaliseBoardState(right);
  if (l.pieces.length !== r.pieces.length) return false;
  return serialiseBoardState(l) === serialiseBoardState(r);
}

/**
 * Validate the board_builder answer server-side.
 *
 * Strategy (mirrors the frontend validateBoardBuilderAnswer logic):
 *  1. Check piece count (exact or range mode).
 *  2. Check the configured rules (noSameRow, noSameColumn, noSameDiagonal,
 *     noKnightAttack).  These are the same geometric checks used on the
 *     frontend — we intentionally keep them rule-based so ALL valid
 *     solutions pass, not just the one the admin happened to save.
 *  3. As a final fallback, compare against every stored accepted solution
 *     (correctSolution + alternateSolutions). If the submitted board matches
 *     any of them exactly, it is accepted even when the generic rules would
 *     have rejected it (e.g. exact_position_match type).
 *
 * Returns true when the position is acceptable.
 */
function scoreBoardBuilderAnswer(quizDoc, submittedBoardState) {
  const board = normaliseBoardState(submittedBoardState);

  // ── 0. Must have at least one piece ──────────────────────────────────────
  if (board.pieces.length === 0) return false;

  // ── 1. Piece-count check ──────────────────────────────────────────────────
  const allowedPieces = (quizDoc.allowedPieces || []).map(p => String(p).toLowerCase());
  const targetPieces = board.pieces.filter(p =>
    allowedPieces.length === 0 || allowedPieces.includes(String(p.type || "").toLowerCase())
  );

  const countMode = quizDoc.pieceCountMode === "range" ? "range" : "exact";
  if (countMode === "range") {
    const min = Math.max(1, Number(quizDoc.minimumPieceCount) || 1);
    const max = Math.max(min, Number(quizDoc.maximumPieceCount) || min);
    if (targetPieces.length < min || targetPieces.length > max) return false;
  } else {
    const required = Math.max(1, Number(quizDoc.requiredPieceCount) || 1);
    if (targetPieces.length !== required) return false;
  }

  // ── 2. Rule-based geometric checks ───────────────────────────────────────
  const rules = quizDoc.rules || {};

  // Helper: convert algebraic square ("a1") to { file: 0, rank: 0 }
  const coords = sq => ({
    file: sq.charCodeAt(0) - 97,
    rank: Number(sq[1]) - 1,
  });

  // Check every pair for a conflict matching the predicate
  const hasPairConflict = (pieces, predicate) => {
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        if (predicate(coords(pieces[i].square), coords(pieces[j].square))) return true;
      }
    }
    return false;
  };

  if (rules.noSameRow && hasPairConflict(targetPieces, (a, b) => a.rank === b.rank)) {
    // Two pieces share a row → invalid, but check saved solutions first (below)
  } else if (rules.noSameColumn && hasPairConflict(targetPieces, (a, b) => a.file === b.file)) {
    // Two pieces share a column
  } else if (rules.noSameDiagonal && hasPairConflict(targetPieces, (a, b) =>
    Math.abs(a.file - b.file) === Math.abs(a.rank - b.rank)
  )) {
    // Two pieces share a diagonal
  } else if (rules.noKnightAttack && hasPairConflict(targetPieces, (a, b) => {
    const fd = Math.abs(a.file - b.file);
    const rd = Math.abs(a.rank - b.rank);
    return (fd === 1 && rd === 2) || (fd === 2 && rd === 1);
  })) {
    // Two pieces attack as knights
  } else {
    // All rule checks passed
    return true;
  }

  // ── 3. Saved-solution fallback ─────────────────────────────────────────────
  // If any rule check failed, still accept if the board exactly matches a
  // stored solution (handles exact_position_match and admin-defined exceptions).
  const solutions = [
    quizDoc.correctSolution,
    quizDoc.exampleSolution,
    ...(Array.isArray(quizDoc.alternateSolutions) ? quizDoc.alternateSolutions : []),
  ].filter(Boolean);

  return solutions.some(sol => boardStatesEqual(board, sol));
}

// ─── Per-question scorer ─────────────────────────────────────────────────────

/**
 * Evaluate a single answer against its quiz document.
 *
 * @param {Object} quizDoc  - Populated Mongoose quiz document (plain object or Mongoose doc)
 * @param {Object} answer   - Raw answer from the request body
 * @returns {{ isCorrect: boolean, rawPoints: number }}
 */
export function scoreAnswer(quizDoc, answer) {
  const marks = quizDoc.marks ?? 1; // fall back to 1 if field is somehow missing

  switch (quizDoc.type) {

    // ── MCQ / Yes-No ────────────────────────────────────────────────────────
    // Correct when the submitted option _id matches the option marked isCorrect.
    case "mcq":
    case "yes_no": {
      const correctOpt = quizDoc.options?.find(o => o.isCorrect);
      if (!correctOpt) return { isCorrect: false, rawPoints: 0 };

      const isCorrect = correctOpt._id.toString() === String(answer.selectedOption ?? "");
      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    // ── Fill in the blank ───────────────────────────────────────────────────
    // Accepts two submission shapes:
    //  1. answer.textAnswer — a raw typed/selected string (preferred, case-insensitive compare)
    //  2. answer.selectedOption — the option _id (same UI as MCQ; we resolve its text here)
    // The frontend currently uses the MCQ option-picker UI so selectedOption is the
    // natural answer format, but textAnswer is the canonical scoring field.
    case "fill_in_the_blank": {
      const correctOpt = quizDoc.options?.find(o => o.isCorrect);
      if (!correctOpt) return { isCorrect: false, rawPoints: 0 };

      const expected = (correctOpt.text ?? "").trim().toLowerCase();

      // Path 1 — textAnswer string was sent
      if (answer.textAnswer) {
        const submitted = String(answer.textAnswer).trim().toLowerCase();
        const isCorrect = expected !== "" && expected === submitted;
        return { isCorrect, rawPoints: isCorrect ? marks : 0 };
      }

      // Path 2 — selectedOption _id was sent (frontend MCQ-style picker)
      if (answer.selectedOption) {
        const selectedOpt = quizDoc.options?.find(
          o => o._id.toString() === String(answer.selectedOption)
        );
        const isCorrect = !!selectedOpt?.isCorrect;
        return { isCorrect, rawPoints: isCorrect ? marks : 0 };
      }

      return { isCorrect: false, rawPoints: 0 };
    }

    // ── Column matching ─────────────────────────────────────────────────────
    // All left→right pairs must be correct AND the submitted count must equal quiz pairs count.
    case "column_matching": {
      const pairs = quizDoc.pairs ?? [];
      const submitted = answer.matchedPairs ?? [];

      if (submitted.length !== pairs.length) return { isCorrect: false, rawPoints: 0 };

      // Build a lookup map from submitted pairs for O(1) access
      const submittedMap = new Map(
        submitted.map(p => [String(p.leftItem ?? ""), String(p.rightItem ?? "")])
      );

      const isCorrect = pairs.every(correctPair =>
        submittedMap.get(String(correctPair.leftItem ?? "")) === String(correctPair.rightItem ?? "")
      );

      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    // ── Sequence ordering ───────────────────────────────────────────────────
    // The submitted array of item texts must match the items sorted by `order` asc.
    case "sequence_ordering": {
      const items = quizDoc.sequenceOrdering?.sequenceItems ?? [];
      const submitted = answer.sequenceAnswer ?? [];

      if (submitted.length !== items.length) return { isCorrect: false, rawPoints: 0 };

      // Build correct sequence by sorting on the stored `order` value
      const correctOrder = [...items]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(i => String(i.text ?? ""));

      const isCorrect = correctOrder.every(
        (text, idx) => text === String(submitted[idx] ?? "")
      );

      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    // ── Board move challenge ────────────────────────────────────────────────
    // The submitted move must appear in the acceptedMoves list (match by SAN or from-to string).
    case "board_move_challenge": {
      const bmc = quizDoc.boardMoveChallenge ?? {};
      const accepted = bmc.acceptedMoves ?? quizDoc.acceptedMoves ?? [];
      const submitted = String(answer.boardMove ?? "").trim().toLowerCase();

      if (!submitted) return { isCorrect: false, rawPoints: 0 };

      const isCorrect = accepted.some(move => {
        // Match against SAN notation or "from-to" string (e.g. "e2e4")
        const san   = String(move.san   ?? "").trim().toLowerCase();
        const fromTo = `${move.from ?? ""}${move.to ?? ""}`.toLowerCase();
        return submitted === san || submitted === fromTo;
      });

      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    // ── Piece value ─────────────────────────────────────────────────────────
    // Every piece→value pair submitted must match quiz.pieceValue.pieceValues exactly.
    case "piece_value": {
      const correctValues = quizDoc.pieceValue?.pieceValues ?? [];
      const submitted     = answer.pieceValueAnswer ?? [];

      if (submitted.length !== correctValues.length) return { isCorrect: false, rawPoints: 0 };

      // Build lookup map from correct values
      const correctMap = new Map(
        correctValues.map(pv => [String(pv.piece ?? ""), Number(pv.value)])
      );

      const isCorrect = submitted.every(pv =>
        correctMap.has(String(pv.piece ?? "")) &&
        correctMap.get(String(pv.piece ?? "")) === Number(pv.value)
      );

      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    // ── Piece combination ───────────────────────────────────────────────────
    // The submitted ordered list of piece names must exactly match requiredPieces (order matters).
    case "piece_combination": {
      const required  = quizDoc.pieceCombination?.requiredPieces ?? [];
      const submitted = answer.pieceCombinationAnswer ?? [];

      if (submitted.length !== required.length) return { isCorrect: false, rawPoints: 0 };

      const isCorrect = required.every(
        (piece, idx) => String(piece ?? "") === String(submitted[idx] ?? "")
      );

      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    // ── Board builder ───────────────────────────────────────────────────────
    // The student places pieces on an empty (or pre-filled) board.
    // Scoring runs the same geometric rule-checks used on the frontend,
    // then falls back to exact solution matching as a safety net.
    case "board_builder": {
      const submittedBoard = answer.boardBuilderAnswer ?? null;
      const isCorrect = scoreBoardBuilderAnswer(quizDoc, submittedBoard);
      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
    }

    default:
      // Unknown quiz type — treat as unanswered
      return { isCorrect: false, rawPoints: 0 };
  }
}

// ─── Full-exam scorer ────────────────────────────────────────────────────────

/**
 * Score an entire exam submission.
 *
 * @param {Map<string, Object>} quizDocsMap  - Map<quizId string → populated quiz doc>
 * @param {Array}               answers      - Raw answers array from req.body
 * @returns {{
 *   processedAnswers: Array,
 *   score: number,
 *   totalQuestions: number,
 *   correctCount: number
 * }}
 */
export function scoreExam(quizDocsMap, answers = []) {
  let score = 0;
  const processedAnswers = [];

  for (const answer of answers) {
    const quizId  = String(answer.quizId ?? "");
    const quizDoc = quizDocsMap.get(quizId);

    // Skip answers that don't correspond to a quiz in this exam
    if (!quizDoc) continue;

    const { isCorrect, rawPoints } = scoreAnswer(quizDoc, answer);

    if (isCorrect) score += rawPoints;

    processedAnswers.push({
      quizId:                 answer.quizId,
      selectedOption:         answer.selectedOption         ?? null,
      textAnswer:             answer.textAnswer             ?? null,
      matchedPairs:           answer.matchedPairs           ?? [],
      sequenceAnswer:         answer.sequenceAnswer         ?? [],
      boardMove:              answer.boardMove              ?? null,
      pieceValueAnswer:       answer.pieceValueAnswer       ?? [],
      pieceCombinationAnswer: answer.pieceCombinationAnswer ?? [],
      boardBuilderAnswer:     answer.boardBuilderAnswer     ?? null,
      isCorrect
    });
  }

  const correctCount = processedAnswers.filter(a => a.isCorrect).length;

  return {
    processedAnswers,
    score,
    totalQuestions: quizDocsMap.size,
    correctCount
  };
}

/**
 * Build a Map<quizId string → quizDoc> from a populated exam document.
 * Used by submitExam to avoid repeated array searches during scoring.
 *
 * @param {Object} exam - Populated exam document
 * @returns {Map<string, Object>}
 */
export function buildQuizMap(exam) {
  const map = new Map();
  for (const chapter of (exam.chapters ?? [])) {
    for (const quiz of (chapter.quizIds ?? [])) {
      // quizIds is populated, so quiz is a full document
      map.set(quiz._id.toString(), quiz);
    }
  }
  return map;
}

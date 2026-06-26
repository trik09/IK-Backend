/**
 * examScoringEngine.js
 *
 * Pure, deterministic scoring logic for all eight quiz types.
 *
 * Design rules:
 *  - No I/O, no side effects. Receives plain objects, returns plain objects.
 *  - scoreAnswer()  → evaluates one quiz question against one answer.
 *  - scoreExam()    → iterates all answers and returns a summary.
 *  - Both functions are idempotent: same input always produces same output.
 */

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
    // Case-insensitive, whitespace-trimmed comparison against the correct option text.
    case "fill_in_the_blank": {
      const correctOpt = quizDoc.options?.find(o => o.isCorrect);
      if (!correctOpt) return { isCorrect: false, rawPoints: 0 };

      const expected = (correctOpt.text ?? "").trim().toLowerCase();
      const submitted = (answer.textAnswer ?? "").trim().toLowerCase();
      const isCorrect = expected !== "" && expected === submitted;
      return { isCorrect, rawPoints: isCorrect ? marks : 0 };
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

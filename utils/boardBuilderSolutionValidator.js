/**
 * boardBuilderSolutionValidator.js
 *
 * Server-side validation of the admin-configured correct solution and
 * alternate solutions for board_builder quizzes.
 *
 * This mirrors the frontend validateBoardBuilderConfiguration logic so that
 * invalid solutions (e.g. 9 queens for non_attacking_queens, or queens that
 * attack each other) are rejected at save time — both on create and update.
 *
 * Returns null when everything is valid, or a human-readable error string.
 *
 * Design:
 *  - Pure function, no I/O, no DB access.
 *  - Works on the piece-array format { pieces: [{square, type, color}] }
 *    that the frontend uses — no FEN conversion needed.
 *  - Shares the same geometric predicates as the scoring engine in
 *    examScoringEngine.js so the rules are consistent across the whole stack.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert algebraic square to {file, rank} coordinates (0-indexed). */
const coords = (sq) => ({
  file: sq.charCodeAt(0) - 97,
  rank: Number(sq[1]) - 1,
});

/** Normalise a raw board-state value into { pieces: [...] }. */
function normaliseBoardState(raw) {
  if (!raw) return { pieces: [] };
  if (Array.isArray(raw)) return { pieces: raw };
  if (Array.isArray(raw.pieces)) return { pieces: raw.pieces };
  return { pieces: [] };
}

/**
 * Filter pieces to only those that are geometrically relevant for the
 * validation type.  For non_attacking_queens / non_attacking_knights only
 * the specific piece type matters; for everything else use allowedPieces.
 */
function getTargetPieces(pieces, validationType, allowedPieces = []) {
  const norm = (s) => String(s || "").toLowerCase();

  if (validationType === "non_attacking_queens") {
    return pieces.filter((p) => norm(p.type) === "queen");
  }
  if (validationType === "non_attacking_knights") {
    return pieces.filter((p) => norm(p.type) === "knight");
  }
  // For all other types use the admin-configured allowedPieces list.
  // If no list is set, treat all pieces as target pieces.
  if (allowedPieces.length === 0) return pieces;
  return pieces.filter((p) => allowedPieces.map(norm).includes(norm(p.type)));
}

/** Return true if any two pieces in the array satisfy the predicate. */
function hasPairConflict(pieces, predicate) {
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (predicate(coords(pieces[i].square), coords(pieces[j].square))) {
        return true;
      }
    }
  }
  return false;
}

// ─── Per-rule checkers ───────────────────────────────────────────────────────

function checkNoSameRow(pieces) {
  return hasPairConflict(pieces, (a, b) => a.rank === b.rank)
    ? "Two or more pieces share the same row."
    : null;
}

function checkNoSameColumn(pieces) {
  return hasPairConflict(pieces, (a, b) => a.file === b.file)
    ? "Two or more pieces share the same column."
    : null;
}

function checkNoSameDiagonal(pieces) {
  return hasPairConflict(
    pieces,
    (a, b) => Math.abs(a.file - b.file) === Math.abs(a.rank - b.rank),
  ) ? "Two or more pieces share the same diagonal." : null;
}

function checkNoKnightAttack(pieces) {
  return hasPairConflict(pieces, (a, b) => {
    const fd = Math.abs(a.file - b.file);
    const rd = Math.abs(a.rank - b.rank);
    return (fd === 1 && rd === 2) || (fd === 2 && rd === 1);
  }) ? "Two or more pieces attack each other as knights." : null;
}

// ─── Piece-count checker ─────────────────────────────────────────────────────

/**
 * Validate the number of target pieces in the solution.
 *
 * For non_attacking_queens:  must equal requiredPieceCount (default 8).
 * For non_attacking_knights: must equal requiredPieceCount (default 8).
 * For range mode:            must be within [minimumPieceCount, maximumPieceCount].
 * For exact mode:            must equal requiredPieceCount.
 */
function checkPieceCount(targetPieces, payload, validationType) {
  const count = targetPieces.length;

  if (count === 0) {
    return "The correct solution must contain at least one piece.";
  }

  const countMode = payload.pieceCountMode === "range" ? "range" : "exact";

  if (countMode === "range") {
    const min = Math.max(1, Number(payload.minimumPieceCount) || 1);
    const max = Math.max(min, Number(payload.maximumPieceCount) || min);
    if (count < min || count > max) {
      return `Correct solution has ${count} piece(s) but the rule requires between ${min} and ${max}.`;
    }
  } else {
    // Exact mode — for non_attacking types default to 8 if not set
    let required = Number(payload.requiredPieceCount);
    if (!Number.isFinite(required) || required < 1) {
      required = (validationType === "non_attacking_queens" || validationType === "non_attacking_knights") ? 8 : 1;
    }
    if (count !== required) {
      const pieceName =
        validationType === "non_attacking_queens"
          ? "queen"
          : validationType === "non_attacking_knights"
          ? "knight"
          : "piece";
      return `Correct solution has ${count} ${pieceName}(s) but exactly ${required} ${pieceName}(s) are required.`;
    }
  }

  return null;
}

// ─── Per-validation-type solution check ──────────────────────────────────────

function validateSolutionForType(solution, payload, label) {
  const board = normaliseBoardState(solution);
  const pieces = board.pieces;
  const { validationType, allowedPieces = [], rules = {} } = payload;

  if (pieces.length === 0) {
    // An empty alternate solution is simply skipped (not an error)
    return null;
  }

  const targetPieces = getTargetPieces(pieces, validationType, allowedPieces);

  // ── 1. Piece-count check ──────────────────────────────────────────────────
  const countError = checkPieceCount(targetPieces, payload, validationType);
  if (countError) return `${label}: ${countError}`;

  // ── 2. Rule-based geometric checks ───────────────────────────────────────
  // Derive the effective rules for this validation type.
  // non_attacking_queens always enforces all three spatial rules.
  // non_attacking_knights always enforces noKnightAttack.
  // Other types use whatever rules the admin configured.
  const effectiveRules = { ...rules };

  if (validationType === "non_attacking_queens") {
    effectiveRules.noSameRow      = true;
    effectiveRules.noSameColumn   = true;
    effectiveRules.noSameDiagonal = true;
    effectiveRules.noKnightAttack = false;
  } else if (validationType === "non_attacking_knights") {
    effectiveRules.noSameRow      = false;
    effectiveRules.noSameColumn   = false;
    effectiveRules.noSameDiagonal = false;
    effectiveRules.noKnightAttack = true;
  }

  // Only run the geometric checks for types where they make sense.
  // exact_position_match, mate_in_one, safe_king, control_center, custom_rule
  // are validated entirely on the frontend; we skip them here to avoid
  // duplicating complex chess logic server-side.
  const ruleTypes = [
    "non_attacking_queens",
    "non_attacking_knights",
    "custom_rule",
  ];

  if (ruleTypes.includes(validationType)) {
    if (effectiveRules.noSameRow) {
      const err = checkNoSameRow(targetPieces);
      if (err) return `${label}: ${err}`;
    }
    if (effectiveRules.noSameColumn) {
      const err = checkNoSameColumn(targetPieces);
      if (err) return `${label}: ${err}`;
    }
    if (effectiveRules.noSameDiagonal) {
      const err = checkNoSameDiagonal(targetPieces);
      if (err) return `${label}: ${err}`;
    }
    if (effectiveRules.noKnightAttack) {
      const err = checkNoKnightAttack(targetPieces);
      if (err) return `${label}: ${err}`;
    }
  }

  return null;
}

// ─── Rule-based validation types ─────────────────────────────────────────────

/**
 * Types where the engine evaluates every submission automatically.
 * No stored correct solution is required — the geometric rules are the oracle.
 */
const RULE_BASED_VALIDATION_TYPES = [
  "non_attacking_queens",
  "non_attacking_knights",
  "control_center",
  "mate_in_one",
  "safe_king",
  "custom_rule",
];

const isRuleBasedValidationType = (type) =>
  RULE_BASED_VALIDATION_TYPES.includes(type);

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Validate all saved solutions in a board_builder payload.
 *
 * For rule-based validation types (non_attacking_queens, non_attacking_knights,
 * control_center, mate_in_one, safe_king, custom_rule) no stored solution is
 * required — the engine validates every student submission automatically.
 *
 * For exact_position_match a correctSolution is still mandatory (it IS the answer).
 *
 * @param {Object} payload - The normalised request body for a board_builder quiz.
 * @returns {string|null}  - Error message string, or null if everything is valid.
 */
export function validateBoardBuilderSolution(payload) {
  if (!payload || payload.type !== "board_builder") return null;

  // Rule-based types: skip the correctSolution requirement entirely.
  // Any valid student position will be accepted by the engine at scoring time.
  if (isRuleBasedValidationType(payload.validationType)) {
    // If the admin did happen to save solutions (optional), validate them too
    // so the DB stays clean — but don't require them.
    const alternateSolutions = Array.isArray(payload.alternateSolutions)
      ? payload.alternateSolutions
      : [];
    for (let i = 0; i < alternateSolutions.length; i++) {
      const altBoard = normaliseBoardState(alternateSolutions[i]);
      if (altBoard.pieces.length === 0) continue;
      const altError = validateSolutionForType(alternateSolutions[i], payload, `Alternate solution ${i + 1}`);
      if (altError) return altError;
    }
    return null;
  }

  // Non-rule-based types (exact_position_match): correctSolution is required.
  const correctSolution = payload.correctSolution || payload.exampleSolution;
  const correctBoard = normaliseBoardState(correctSolution);

  if (correctBoard.pieces.length === 0) {
    return "A correct solution with at least one piece is required for this validation type.";
  }

  // Validate primary correct solution
  const correctError = validateSolutionForType(correctSolution, payload, "Correct solution");
  if (correctError) return correctError;

  // Validate each alternate solution
  const alternateSolutions = Array.isArray(payload.alternateSolutions)
    ? payload.alternateSolutions
    : [];

  for (let i = 0; i < alternateSolutions.length; i++) {
    const altBoard = normaliseBoardState(alternateSolutions[i]);
    if (altBoard.pieces.length === 0) continue;
    const altError = validateSolutionForType(alternateSolutions[i], payload, `Alternate solution ${i + 1}`);
    if (altError) return altError;
  }

  return null;
}

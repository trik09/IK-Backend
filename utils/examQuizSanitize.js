/**
 * Strip answer keys from a quiz document before sending it to a student.
 * Returns a shallow-cloned plain object.
 * @param {Object} quiz - The quiz document to sanitize
 * @param {Object} options - Options for sanitization
 * @param {boolean} options.preserveAnswers - If true, preserve correct answers (for results display)
 */
export function sanitizeQuizForUser(quiz, options = {}) {
  if (!quiz) return quiz;
  const { preserveAnswers = false } = options;
  const q = { ...quiz };
  if (q._id) q._id = q._id.toString?.() ?? q._id;
  const idStr = String(q._id || '');
  q.uid = q.uid || `QZ${idStr ? idStr.slice(-5).toUpperCase() : '00000'}`;
  q.shortUid = q.uid.slice(-5).toUpperCase();

  // Use userQuestionTitle for users if available, otherwise fall back to questionText
  if (q.userQuestionTitle && q.userQuestionTitle.trim()) {
    q.questionText = q.userQuestionTitle;
  }

  switch (q.type) {
    case "mcq":
    case "yes_no":
    case "fill_in_the_blank":
      // Only strip isCorrect if we're not preserving answers (e.g., during exam)
      if (!preserveAnswers) {
        q.options = (q.options ?? []).map(({ isCorrect, ...rest }) => rest);
      }
      break;

    case "column_matching":
      if (!preserveAnswers) {
        q.pairs = (q.pairs ?? []).map(({ correctAnswer, ...rest }) => rest);
      }
      break;

    case "board_move_challenge":
      if (!preserveAnswers) {
        if (q.boardMoveChallenge) {
          const { correctMove, acceptedMoves, ...safe } = q.boardMoveChallenge;
          q.boardMoveChallenge = safe;
        }
        delete q.correctMove;
        delete q.acceptedMoves;
      }
      break;

    case "piece_combination":
      if (!preserveAnswers) {
        if (q.pieceCombination) {
          const { requiredPieces, ...safe } = q.pieceCombination;
          q.pieceCombination = safe;
        }
      }
      break;

    case "sequence_ordering":
      if (!preserveAnswers) {
        if (q.sequenceOrdering) {
          q.sequenceOrdering = {
            ...q.sequenceOrdering,
            sequenceItems: (q.sequenceOrdering.sequenceItems ?? []).map(
              ({ order, ...rest }) => rest
            ),
          };
        }
      }
      break;

    case "piece_value":
      if (!preserveAnswers) {
        if (q.pieceValue) {
          q.pieceValue = {
            ...q.pieceValue,
            pieceValues: (q.pieceValue.pieceValues ?? []).map(({ value, ...rest }) => rest),
          };
        }
      }
      break;

    case "board_builder":
      if (!preserveAnswers) {
        delete q.correctSolution;
        delete q.exampleSolution;
        delete q.alternateSolutions;
      }
      break;

    default:
      break;
  }

  return q;
}

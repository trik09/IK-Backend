/**
 * Strip answer keys from a quiz document before sending it to a student.
 * Returns a shallow-cloned plain object.
 */
export function sanitizeQuizForUser(quiz) {
  if (!quiz) return quiz;
  const q = { ...quiz };
  if (q._id) q._id = q._id.toString?.() ?? q._id;

  switch (q.type) {
    case "mcq":
    case "yes_no":
    case "fill_in_the_blank":
      q.options = (q.options ?? []).map(({ isCorrect, ...rest }) => rest);
      break;

    case "column_matching":
      q.pairs = (q.pairs ?? []).map(({ correctAnswer, ...rest }) => rest);
      break;

    case "board_move_challenge":
      if (q.boardMoveChallenge) {
        const { correctMove, acceptedMoves, ...safe } = q.boardMoveChallenge;
        q.boardMoveChallenge = safe;
      }
      delete q.correctMove;
      delete q.acceptedMoves;
      break;

    case "piece_combination":
      if (q.pieceCombination) {
        const { requiredPieces, ...safe } = q.pieceCombination;
        q.pieceCombination = safe;
      }
      break;

    case "sequence_ordering":
      if (q.sequenceOrdering) {
        q.sequenceOrdering = {
          ...q.sequenceOrdering,
          sequenceItems: (q.sequenceOrdering.sequenceItems ?? []).map(
            ({ order, ...rest }) => rest
          ),
        };
      }
      break;

    case "piece_value":
      if (q.pieceValue) {
        q.pieceValue = {
          ...q.pieceValue,
          pieceValues: (q.pieceValue.pieceValues ?? []).map(({ value, ...rest }) => rest),
        };
      }
      break;

    case "board_builder":
      delete q.correctSolution;
      delete q.exampleSolution;
      delete q.alternateSolutions;
      break;

    default:
      break;
  }

  return q;
}

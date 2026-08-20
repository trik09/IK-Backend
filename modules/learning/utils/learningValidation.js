import { Chess } from "chess.js";

const PHANTOM_KING_CORNERS = new Set(["a1", "h1", "a8", "h8"]);

function getPlayerPiecesOnBoard(fen, playerSide = "w") {
  try {
    const chess = new Chess(fen);
    const board = chess.board();
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== playerSide) continue;
        const square = String.fromCharCode(97 + c) + (8 - r);
        if (piece.type === "k" && PHANTOM_KING_CORNERS.has(square)) continue;
        pieces.push({ square, type: piece.type, color: piece.color });
      }
    }
    return pieces;
  } catch {
    return [];
  }
}

/**
 * Returns true when exercise failure rules are violated.
 */
export function isFailureRuleTriggered(fen, rules, playerSide = "w") {
  if (!rules?.type || !fen) return false;

  if (rules.type === "forbiddenPawnSquares") {
    const forbidden = new Set((rules.squares || []).map((s) => s.toLowerCase()));
    for (const sq of forbidden) {
      try {
        const chess = new Chess(fen);
        const board = chess.board();
        const file = sq.charCodeAt(0) - 97;
        const rank = 8 - parseInt(sq[1], 10);
        const piece = board[rank]?.[file];
        if (piece && piece.color === playerSide && piece.type === "p") {
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  if (rules.type === "playerPiecesOnlyOn") {
    const allowed = new Set((rules.squares || []).map((s) => s.toLowerCase()));
    const pieces = getPlayerPiecesOnBoard(fen, playerSide);
    return pieces.some((p) => !allowed.has(p.square.toLowerCase()));
  }

  return false;
}

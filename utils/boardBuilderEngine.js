// utils/boardBuilderEngine.js
import { Chess } from "chess.js";

/** Load a FEN string safely */
function loadPosition(fen) {
  const chess = new Chess();
  try { chess.load(fen); } catch { return null; }
  return chess;
}

/** Validate non‑attacking queens */
function validateNonAttackingQueens(chess) {
  const queens = [];
  chess.board().forEach((row, rIdx) => {
    row.forEach((piece, cIdx) => {
      if (piece && piece.type === "q" && piece.color === "w") {
        const file = String.fromCharCode(97 + cIdx);
        const rank = 8 - rIdx;
        queens.push({ square: `${file}${rank}` });
      }
    });
  });
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const from = queens[i].square;
      const to = queens[j].square;
      if (chess.move({ from, to, promotion: "q" })) return false;
    }
  }
  return true;
}

/** Validate non‑attacking knights */
function validateNonAttackingKnights(chess) {
  const knights = [];
  chess.board().forEach((row, rIdx) => {
    row.forEach((piece, cIdx) => {
      if (piece && piece.type === "n" && piece.color === "w") {
        const file = String.fromCharCode(97 + cIdx);
        const rank = 8 - rIdx;
        knights.push({ square: `${file}${rank}` });
      }
    });
  });
  const knightSquares = knights.map(k => k.square);
  for (const k of knights) {
    const moves = chess.moves({ square: k.square, verbose: true });
    for (const m of moves) {
      if (knightSquares.includes(m.to)) return false;
    }
  }
  return true;
}

/** Validate non‑attacking rooks */
function validateNonAttackingRooks(chess) {
  const rooks = [];
  chess.board().forEach((row, rIdx) => {
    row.forEach((piece, cIdx) => {
      if (piece && piece.type === "r" && piece.color === "w") {
        const file = String.fromCharCode(97 + cIdx);
        const rank = 8 - rIdx;
        rooks.push({ square: `${file}${rank}` });
      }
    });
  });
  for (let i = 0; i < rooks.length; i++) {
    for (let j = i + 1; j < rooks.length; j++) {
      const from = rooks[i].square;
      const to = rooks[j].square;
      if (chess.move({ from, to, promotion: "q" })) return false;
    }
  }
  return true;
}

/** Validate non‑attacking bishops */
function validateNonAttackingBishops(chess) {
  const bishops = [];
  chess.board().forEach((row, rIdx) => {
    row.forEach((piece, cIdx) => {
      if (piece && piece.type === "b" && piece.color === "w") {
        const file = String.fromCharCode(97 + cIdx);
        const rank = 8 - rIdx;
        bishops.push({ square: `${file}${rank}` });
      }
    });
  });
  for (let i = 0; i < bishops.length; i++) {
    for (let j = i + 1; j < bishops.length; j++) {
      const from = bishops[i].square;
      const to = bishops[j].square;
      if (chess.move({ from, to, promotion: "q" })) return false;
    }
  }
  return true;
}

/** Validate non‑attacking pawns */
function validateNonAttackingPawns(chess) {
  const pawns = [];
  chess.board().forEach((row, rIdx) => {
    row.forEach((piece, cIdx) => {
      if (piece && piece.type === "p" && piece.color === "w") {
        const file = String.fromCharCode(97 + cIdx);
        const rank = 8 - rIdx;
        pawns.push({ square: `${file}${rank}` });
      }
    });
  });
  const pawnSquares = pawns.map(p => p.square);
  for (const p of pawns) {
    const moves = chess.moves({ square: p.square, verbose: true });
    for (const m of moves) {
      if (pawnSquares.includes(m.to)) return false;
    }
  }
  return true;
}

/** Control‑center – ensure at least `radius` squares around centre are occupied */
function validateControlCenter(chess, radius) {
  const occupied = [];
  chess.board().forEach((row, rIdx) => {
    row.forEach((piece, cIdx) => {
      if (piece && piece.color === "w") {
        const file = String.fromCharCode(97 + cIdx);
        const rank = 8 - rIdx;
        occupied.push(`${file}${rank}`);
      }
    });
  });
  const files = "abcdefgh".split("");
  const ranks = [1,2,3,4,5,6,7,8];
  const target = [];
  for (const f of files) {
    for (const r of ranks) {
      const df = Math.min(Math.abs(files.indexOf(f) - files.indexOf('d')), Math.abs(files.indexOf(f) - files.indexOf('e')));
      const dr = Math.min(Math.abs(r - 4), Math.abs(r - 5));
      if (df <= radius && dr <= radius) target.push(`${f}${r}`);
    }
  }
  return target.every(sq => occupied.includes(sq));
}

/** Exact position match – compare FEN strings (ignore move counters) */
function normalizeFen(fen) {
  const parts = fen.split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`;
}
function validateExactPositionMatch(chess, targetFEN) {
  return normalizeFen(chess.fen()) === normalizeFen(targetFEN);
}

/** Mate in one – there must be a move that checkmates */
function validateMateInOne(chess) {
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    const clone = new Chess(chess.fen());
    clone.move(m);
    if (clone.isCheckmate()) return true;
  }
  return false;
}

/** Safe king – simple version: king not currently in check */
function validateSafeKing(chess, maxThreatDistance) {
  return !chess.isCheck();
}

export function validateBoardBuilder(payload) {
  const { fen, validationType, rules = {} } = payload;
  const chess = loadPosition(fen);
  if (!chess) return { ok: false, message: "Invalid FEN string" };

  switch (validationType) {
    case "non_attacking_queens":
      return { ok: validateNonAttackingQueens(chess), message: "Queens attack each other" };
    case "non_attacking_knights":
      return { ok: validateNonAttackingKnights(chess), message: "Knights attack each other" };
    case "non_attacking_rooks":
      return { ok: validateNonAttackingRooks(chess), message: "Rooks attack each other" };
    case "non_attacking_bishops":
      return { ok: validateNonAttackingBishops(chess), message: "Bishops attack each other" };
    case "non_attacking_pawns":
      return { ok: validateNonAttackingPawns(chess), message: "Pawns attack each other" };
    case "control_center":
      return { ok: validateControlCenter(chess, rules.radius), message: "Control‑center condition not met" };
    case "exact_position_match":
      return { ok: validateExactPositionMatch(chess, rules.targetFEN), message: "Position does not match target" };
    case "mate_in_one":
      return { ok: validateMateInOne(chess), message: "No mate‑in‑one move found" };
    case "safe_king":
      return { ok: validateSafeKing(chess, rules.maxThreatDistance), message: "King is not safe" };
    case "custom_rule":
      return { ok: true, message: "Custom rule accepted" };
    default:
      return { ok: false, message: "Unsupported validation type" };
  }
}

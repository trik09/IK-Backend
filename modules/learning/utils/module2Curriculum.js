/**
 * Module 2 — Basic Rules (Lesson 1: Piece Value, Lesson 2: Ranks & Files,
 * Lesson 3: Square Names, Lesson 4: Control From the Center, Lesson 5: Capture,
 * Lesson 6: Protection).
 * Quiz exercises; frontend renders MCQ / board / piece-value UI from validationRules.
 */

export const MODULE2_SECTION = {
  title: "Basic Rules",
  slug: "basic-rules",
  description: "Learn ranks, files, captures, protection, and piece values.",
  icon: "FaChessPawn",
  order: 1,
  difficulty: "beginner",
  estimatedMinutes: 10,
};

const EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

function pieceValueRow({
  id,
  piece1,
  operator1 = "none",
  piece2 = "none",
  operator2 = "none",
  piece3 = "none",
}) {
  return {
    id,
    piece: `expression:${id}`,
    piece1,
    operator1,
    piece2,
    operator2,
    piece3,
  };
}

export const MODULE2_CHAPTERS = [
  {
    title: "Lesson 2: Ranks & Files",
    slug: "the-ranks-and-files",
    icon: "FaChessBoard",
    order: 1,
    description: "Learn ranks, files\nand how squares are named",
    exercises: [
      {
        title: "Rank question 1",
        description: "Which rank is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        hintArrows: [{ from: "a4", to: "h4" }],
        validationRules: { lessonType: "rank-file-quiz", questionType: "rank", correctAnswer: "4" },
      },
      {
        title: "Rank question 2",
        description: "Which rank is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        hintArrows: [{ from: "a2", to: "h2" }],
        validationRules: { lessonType: "rank-file-quiz", questionType: "rank", correctAnswer: "2" },
      },
      {
        title: "Rank question 3",
        description: "Which rank is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        hintArrows: [{ from: "a7", to: "h7" }],
        validationRules: { lessonType: "rank-file-quiz", questionType: "rank", correctAnswer: "7" },
      },
      {
        title: "File question 1",
        description: "Which file is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        hintArrows: [{ from: "a1", to: "a8" }],
        validationRules: { lessonType: "rank-file-quiz", questionType: "file", correctAnswer: "a" },
      },
      {
        title: "File question 2",
        description: "Which file is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        hintArrows: [{ from: "g1", to: "g8" }],
        validationRules: { lessonType: "rank-file-quiz", questionType: "file", correctAnswer: "g" },
      },
      {
        title: "File question 3",
        description: "Which file is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        hintArrows: [{ from: "h1", to: "h8" }],
        validationRules: { lessonType: "rank-file-quiz", questionType: "file", correctAnswer: "h" },
      },
    ],
  },
  {
    title: "Lesson 3: Square Names",
    slug: "the-square-names",
    icon: "FaChessBoard",
    order: 2,
    description: "Name the highlighted square\nusing its file and rank together.",
    exercises: [
      {
        title: "Square question 1",
        description: "Which square is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "square-name-quiz",
          questionType: "square",
          correctAnswer: "d4",
          highlightSquare: "d4",
          answerOptions: ["e4", "d4", "d5", "c3"],
        },
      },
      {
        title: "Square question 2",
        description: "Which square is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "square-name-quiz",
          questionType: "square",
          correctAnswer: "f3",
          highlightSquare: "f3",
          answerOptions: ["f2", "e3", "f3", "g4"],
        },
      },
      {
        title: "Square question 3",
        description: "Which square is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "square-name-quiz",
          questionType: "square",
          correctAnswer: "d5",
          highlightSquare: "d5",
          answerOptions: ["d4", "e5", "c6", "d5"],
        },
      },
      {
        title: "Square question 4",
        description: "Which square is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "square-name-quiz",
          questionType: "square",
          correctAnswer: "e8",
          highlightSquare: "e8",
          answerOptions: ["e7", "d8", "e8", "f8"],
        },
      },
      {
        title: "Square question 5",
        description: "Which square is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "square-name-quiz",
          questionType: "square",
          correctAnswer: "h1",
          highlightSquare: "h1",
          answerOptions: ["a1", "h8", "g1", "h1"],
        },
      },
      {
        title: "Square question 6",
        description: "Which square is highlighted?",
        fen: "8/8/8/8/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "square-name-quiz",
          questionType: "square",
          correctAnswer: "b7",
          highlightSquare: "b7",
          answerOptions: ["b8", "a7", "b7", "c7"],
        },
      },
    ],
  },
  {
    title: "Lesson 4: Control From the Center",
    slug: "the-control-from-the-center",
    icon: "FaChessBoard",
    order: 3,
    description: "Control from the center squares",
    exercises: [
      {
        title: "King from the center",
        description: "How many squares does the King control from the center?",
        fen: "8/8/8/8/3K4/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "center-control-quiz",
          questionType: "control",
          pieceName: "King",
          correctAnswer: "8",
          highlightSquares: ["c3", "c4", "c5", "d3", "d5", "e3", "e4", "e5"],
          answerOptions: ["4", "5", "8", "9"],
        },
      },
      {
        title: "Queen from the center",
        description: "How many squares does the Queen control from the center?",
        fen: "8/8/8/8/4Q3/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "center-control-quiz",
          questionType: "control",
          pieceName: "Queen",
          correctAnswer: "27",
          highlightSquares: [],
          answerOptions: ["21", "24", "27", "28"],
        },
      },
      {
        title: "Rook from the center",
        description: "How many squares does the Rook control from the center?",
        fen: "8/8/8/3R4/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "center-control-quiz",
          questionType: "control",
          pieceName: "Rook",
          correctAnswer: "14",
          highlightSquares: [],
          answerOptions: ["7", "13", "14", "16"],
        },
      },
      {
        title: "Bishop from the center",
        description: "How many squares does the Bishop control from the center?",
        fen: "8/8/8/4B3/8/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "center-control-quiz",
          questionType: "control",
          pieceName: "Bishop",
          correctAnswer: "13",
          highlightSquares: [],
          answerOptions: ["9", "11", "13", "14"],
        },
      },
      {
        title: "Knight from the center",
        description: "How many squares does the Knight control from the center?",
        fen: "8/8/8/8/3N4/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "center-control-quiz",
          questionType: "control",
          pieceName: "Knight",
          correctAnswer: "8",
          highlightSquares: [],
          answerOptions: ["2", "4", "6", "8"],
        },
      },
      {
        title: "Pawn from the center",
        description: "How many squares does the Pawn control from the center?",
        fen: "8/8/8/8/4P3/8/8/8 w - - 0 1",
        validationRules: {
          lessonType: "center-control-quiz",
          questionType: "control",
          pieceName: "Pawn",
          correctAnswer: "2",
          highlightSquares: [],
          answerOptions: ["1", "2", "3", "4"],
        },
      },
    ],
  },
  {
    title: "Lesson 5: Capture",
    slug: "the-capture",
    icon: "FaChessBoard",
    order: 4,
    description: "Take opposing pieces by landing on their square.",
    exercises: [
      {
        title: "Rook captures",
        description: "Use the rook to capture every enemy piece.",
        fen: "8/8/3p4/5n2/8/7b/3R4/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "d2", type: "r", color: "w" }],
        targetSquares: ["h3", "f5", "d6"],
        optimalMoveCount: 3,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Take a safe piece first, Capture in this order so the rook stays safe: bishop, then knight, then pawn",
        },
        validationRules: {
          lessonType: "capture-pieces",
          captureMode: "pieces",
          pieceName: "Rook",
          hint: "Take a safe piece first, Capture in this order so the rook stays safe: bishop, then knight, then pawn",
        },
      },
      {
        title: "Bishop captures",
        description: "Use the bishop to capture every enemy piece.",
        fen: "8/8/8/8/8/p3r3/8/2B5 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "c1", type: "b", color: "w" }],
        targetSquares: ["a3", "e3"],
        optimalMoveCount: 2,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Take a safe piece first, Capture in this order so the bishop stays safe: rook, then pawn",
        },
        validationRules: {
          lessonType: "capture-pieces",
          captureMode: "pieces",
          pieceName: "Bishop",
          hint: "Take a safe piece first, Capture in this order so the bishop stays safe: rook, then pawn",
        },
      },
      {
        title: "Queen captures",
        description: "Use the queen to capture every enemy piece.",
        fen: "8/5b2/5p2/3n2p1/8/6Q1/8/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "g3", type: "q", color: "w" }],
        targetSquares: ["f7", "d5", "f6", "g5"],
        optimalMoveCount: 6,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Take a safe piece first, Capture in this order so the queen stays safe: bishop, then knight, then pawn f6, then pawn g5",
        },
        validationRules: {
          lessonType: "capture-pieces",
          captureMode: "pieces",
          pieceName: "Queen",
          hint: "Take a safe piece first, Capture in this order so the queen stays safe: bishop, then knight, then pawn f6, then pawn g5",
        },
      },
      {
        title: "King captures",
        description: "Use the king to capture every enemy piece.",
        fen: "8/8/8/3p4/2n5/b7/8/1K6 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "b1", type: "k", color: "w" }],
        targetSquares: ["d5", "c4", "a3"],
        optimalMoveCount: 5,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Take a safe piece first, Capture in this order so the king stays safe: pawn, then knight, then bishop",
        },
        validationRules: {
          lessonType: "capture-pieces",
          captureMode: "pieces",
          pieceName: "King",
          hint: "Take a safe piece first, Capture in this order so the king stays safe: pawn, then knight, then bishop",
        },
      },
      {
        title: "Knight captures",
        description: "Use the knight to capture every enemy piece.",
        fen: "8/2b5/1p2q3/8/2p1N3/8/8/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "e4", type: "n", color: "w" }],
        targetSquares: ["e6", "c7", "b6", "c4"],
        optimalMoveCount: 5,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Take a safe piece first, Capture in this order so the knight stays safe: queen, then bishop, then the pawns",
        },
        validationRules: {
          lessonType: "capture-pieces",
          captureMode: "pieces",
          pieceName: "Knight",
          hint: "Take a safe piece first, Capture in this order so the knight stays safe: queen, then bishop, then the pawns",
        },
      },
      {
        title: "Pawn captures",
        description: "Use the pawns to capture every enemy piece.",
        fen: "8/6n1/5P2/4q3/2rP4/1P6/8/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [
          { square: "b3", type: "p", color: "w" },
          { square: "d4", type: "p", color: "w" },
          { square: "f6", type: "p", color: "w" },
        ],
        targetSquares: ["c4", "e5", "g7"],
        optimalMoveCount: 3,
        requiresPromotion: false,
        hintsEnabled: true,
        hintLevels: {
          level1: "Pawns capture diagonally. Use each pawn to take a piece.",
        },
        validationRules: {
          lessonType: "capture-pieces",
          captureMode: "pieces",
          pieceName: "Pawn",
          hint: "Pawns capture diagonally. Use each pawn to take a piece.",
        },
      },
    ],
  },
  {
    title: "Lesson 6: Protection",
    slug: "the-protection",
    icon: "FaChessBoard",
    order: 5,
    description: "Defend your pieces so they are not left hanging.",
    exercises: [
      {
        title: "Knight is under attack",
        description: "Knight is under attack! Escape the threat!",
        fen: "8/8/8/2q2N2/8/8/8/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "f5", type: "n", color: "w" }],
        targetSquares: ["g3", "g7", "h4", "h6"],
        optimalMoveCount: 1,
        hintsEnabled: true,
        hintLevels: {
          level1: "Move the knight to a square the queen does not attack.",
        },
        validationRules: {
          lessonType: "protection-escape",
          captureMode: "escape",
          pieceName: "Knight",
          cardTitle: ["Escape the", "Threat"],
          successDetail: "The knight is safe now.",
          hint: "Move the knight to a square the queen does not attack.",
        },
      },
      {
        title: "Protect the knight",
        description: "The knight is under attack! Protect the knight.",
        fen: "8/4q2N/8/8/8/8/R7/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [
          { square: "h7", type: "n", color: "w" },
          { square: "a2", type: "r", color: "w" },
        ],
        targetSquares: ["h2"],
        optimalMoveCount: 1,
        hintsEnabled: true,
        hintLevels: {
          level1: "Use the rook to defend the knight. Put the rook on the same file.",
        },
        validationRules: {
          lessonType: "protection-escape",
          captureMode: "escape",
          pieceName: "Knight",
          cardTitle: ["Protect the", "Knight"],
          successDetail: "The knight is protected now.",
          hint: "Use the rook to defend the knight. Put the rook on the same file.",
        },
      },
      {
        title: "Save the Pieces",
        description: "The bishop & pawn are under attack! Save the pieces",
        fen: "8/8/8/1q1B4/8/8/4P3/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [
          { square: "d5", type: "b", color: "w" },
          { square: "e2", type: "p", color: "w" },
        ],
        targetSquares: ["f3", "e4"],
        optimalMoveCount: 1,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Move the bishop to support the pawn, or move the pawn to support the bishop.",
        },
        validationRules: {
          lessonType: "protection-escape",
          captureMode: "escape",
          pieceName: "Bishop",
          cardTitle: ["Save the Pieces"],
          successDetail: "The pieces are safe now.",
          hint: "Move the bishop to support the pawn, or move the pawn to support the bishop.",
        },
      },
      {
        title: "Defend the rook",
        description:
          "There is no escape for the Rook. But you can still defend. Find the move.",
        fen: "8/8/5b2/5b2/8/4P3/P2P4/R1B5 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [
          { square: "a1", type: "r", color: "w" },
          { square: "c1", type: "b", color: "w" },
          { square: "a2", type: "p", color: "w" },
          { square: "d2", type: "p", color: "w" },
          { square: "e3", type: "p", color: "w" },
        ],
        targetSquares: ["b2", "d4"],
        optimalMoveCount: 1,
        hintsEnabled: true,
        hintLevels: {
          level1: "The rook cannot run. Block the bishop's path or put a defender on the diagonal.",
        },
        validationRules: {
          lessonType: "protection-escape",
          captureMode: "escape",
          pieceName: "Rook",
          cardTitle: ["Defend the", "Rook"],
          successDetail: "The rook is defended now.",
          hint: "The rook cannot run. Block the bishop's path or put a defender on the diagonal.",
        },
      },
      {
        title: "Defend the attacked piece",
        description: "Try to defend the piece that is under attack.",
        fen: "8/1b6/8/8/8/3P2P1/5NRP/r7 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [
          { square: "d3", type: "p", color: "w" },
          { square: "g3", type: "p", color: "w" },
          { square: "h2", type: "p", color: "w" },
          { square: "f2", type: "n", color: "w" },
          { square: "g2", type: "r", color: "w" },
        ],
        targetSquares: ["e4"],
        optimalMoveCount: 1,
        hintsEnabled: true,
        hintLevels: {
          level1: "The rook on g2 is attacked by the bishop. Block the diagonal with the knight.",
        },
        validationRules: {
          lessonType: "protection-escape",
          captureMode: "escape",
          pieceName: "Rook",
          cardTitle: ["Defend the", "Rook"],
          successDetail: "The rook is defended now.",
          hint: "The rook on g2 is attacked by the bishop. Block the diagonal with the knight.",
        },
      },
      {
        title: "Protect the bishop",
        description:
          "Save the Bishop on f3 by moving to a safe square.",
        fen: "7r/8/5n2/1q6/8/r4B2/8/8 w - - 0 1",
        puzzleType: "capture",
        playerPieces: [{ square: "f3", type: "b", color: "w" }],
        targetSquares: ["d1", "g2"],
        optimalMoveCount: 1,
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Save the Bishop on f3 by moving to a safe square.",
        },
        validationRules: {
          lessonType: "protection-escape",
          captureMode: "escape",
          pieceName: "Bishop",
          cardTitle: ["Protect the", "Bishop"],
          successDetail: "The bishop is safe now.",
          hint:
            "Save the Bishop on f3 by moving to a safe square.",
        },
      },
    ],
  },
  {
    title: "Lesson 1: Piece Value",
    slug: "the-piece-value",
    icon: "FaChessQueen",
    order: 0,
    description: "Learn how much each piece is worth.",
    exercises: [
      {
        title: "Match the piece values",
        description: "Match the piece values. Drag a number onto each box.",
        fen: EMPTY_FEN,
        puzzleType: "move",
        hintsEnabled: true,
        hintLevels: {
          level1:
            "A Pawn is 1, Knight and Bishop are 3, Rook is 5, Queen is 9, and the King is the Game.",
        },
        validationRules: {
          lessonType: "piece-value-quiz",
          cardTitle: ["Match the", "Values"],
          successDetail: "Those are the piece values.",
          hint: "A Pawn is 1, Knight and Bishop are 3, Rook is 5, Queen is 9, and the King is the Game.",
          pieceValues: [
            pieceValueRow({ id: "q1-pawn", piece1: "pawn" }),
            pieceValueRow({ id: "q1-knight", piece1: "knight" }),
            pieceValueRow({ id: "q1-bishop", piece1: "bishop" }),
            pieceValueRow({ id: "q1-rook", piece1: "rook" }),
            pieceValueRow({ id: "q1-queen", piece1: "queen" }),
            pieceValueRow({ id: "q1-king", piece1: "king" }),
          ],
        },
      },
      {
        title: "Add or subtract",
        description: "Add or subtract the piece values. Drag the answer onto each box.",
        fen: EMPTY_FEN,
        puzzleType: "move",
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Add or subtract. Pawn is 1, Knight is 3, Bishop is 3, Rook is 5, Queen is 9.",
        },
        validationRules: {
          lessonType: "piece-value-quiz",
          cardTitle: ["Add or Subtract"],
          successDetail: "Those answers are correct.",
          hint: "Add or subtract. Pawn is 1, Knight is 3, Bishop is 3, Rook is 5, Queen is 9.",
          pieceValues: [
            pieceValueRow({
              id: "q2-r1",
              piece1: "rook",
              operator1: "plus",
              piece2: "knight",
            }),
            pieceValueRow({
              id: "q2-r2",
              piece1: "queen",
              operator1: "plus",
              piece2: "pawn",
            }),
            pieceValueRow({
              id: "q2-r3",
              piece1: "knight",
              operator1: "plus",
              piece2: "bishop",
            }),
            pieceValueRow({
              id: "q2-r4",
              piece1: "rook",
              operator1: "minus",
              piece2: "knight",
            }),
            pieceValueRow({
              id: "q2-r5",
              piece1: "queen",
              operator1: "minus",
              piece2: "rook",
            }),
            pieceValueRow({
              id: "q2-r6",
              piece1: "queen",
              operator1: "minus",
              piece2: "bishop",
            }),
          ],
        },
      },
      {
        title: "More add or subtract",
        description: "Add or subtract the piece values. Drag the answer onto each box.",
        fen: EMPTY_FEN,
        puzzleType: "move",
        hintsEnabled: true,
        hintLevels: {
          level1:
            "Work left to right. Pawn is 1, Knight is 3, Bishop is 3, Rook is 5, Queen is 9.",
        },
        validationRules: {
          lessonType: "piece-value-quiz",
          cardTitle: ["Add or Subtract"],
          successDetail: "Those answers are correct.",
          hint: "Work left to right. Pawn is 1, Knight is 3, Bishop is 3, Rook is 5, Queen is 9.",
          pieceValues: [
            pieceValueRow({
              id: "q3-r1",
              piece1: "rook",
              operator1: "plus",
              piece2: "pawn",
            }),
            pieceValueRow({
              id: "q3-r2",
              piece1: "rook",
              operator1: "plus",
              piece2: "bishop",
            }),
            pieceValueRow({
              id: "q3-r3",
              piece1: "bishop",
              operator1: "plus",
              piece2: "bishop",
            }),
            pieceValueRow({
              id: "q3-r4",
              piece1: "queen",
              operator1: "minus",
              piece2: "knight",
            }),
            pieceValueRow({
              id: "q3-r5",
              piece1: "rook",
              operator1: "minus",
              piece2: "pawn",
            }),
            pieceValueRow({
              id: "q3-r6",
              piece1: "queen",
              operator1: "minus",
              piece2: "pawn",
            }),
          ],
        },
      },
    ],
  },
];

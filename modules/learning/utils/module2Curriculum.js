/**
 * Module 2 — Basic Rules (Lesson 1: Ranks & Files, Lesson 2: Square Names).
 * Quiz exercises; frontend renders MCQ UI from validationRules.
 */

export const MODULE2_SECTION = {
  title: "Basic Rules",
  slug: "basic-rules",
  description: "Learn turns, captures, check, checkmate, and stalemate.",
  icon: "FaChessPawn",
  order: 1,
  difficulty: "beginner",
  estimatedMinutes: 10,
};

export const MODULE2_CHAPTERS = [
  {
    title: "Lesson 1: Ranks & Files",
    slug: "the-ranks-and-files",
    icon: "FaChessBoard",
    order: 0,
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
    title: "Lesson 2: Square Names",
    slug: "the-square-names",
    icon: "FaChessBoard",
    order: 1,
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
];

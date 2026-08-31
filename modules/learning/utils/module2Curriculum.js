/**
 * Module 2 — Basic Rules (Lesson 1: Ranks & Files).
 * Six quiz exercises; frontend renders MCQ UI from validationRules.
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
    description: "Learn ranks, files, and how squares are named.",
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
];

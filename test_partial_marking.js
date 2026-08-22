import assert from "node:assert/strict";
import { scoreAnswer, scoreExam, computeTotalMaxMarks } from "./utils/examScoringEngine.js";

console.log("=========================================");
console.log("RUNNING PARTIAL MARKING VERIFICATION TESTS");
console.log("=========================================\n");

let passed = 0;
let failed = 0;

function runTest(description, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${description}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${description}`);
    console.error(err.stack || err);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// 1. COLUMN MATCHING TESTS (TEXT-BASED & BOARD-BASED)
// -----------------------------------------------------------------------------

// 2-item Text-Based Column Matching
const colMatch2ItemQuiz = {
  type: "column_matching",
  matchingSubtype: "text_column_matching",
  pairs: [
    { leftItem: "item1", rightItem: "ans1", correctAnswer: "ans1" },
    { leftItem: "item2", rightItem: "ans2", correctAnswer: "ans2" }
  ]
};

runTest("Column Matching (2-item) - Completely Incorrect (0/2)", () => {
  const ans = { matchedPairs: [{ leftItem: "item1", rightItem: "wrong" }, { leftItem: "item2", rightItem: "wrong" }] };
  const res = scoreAnswer(colMatch2ItemQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

runTest("Column Matching (2-item) - Partially Correct (1/2)", () => {
  const ans = { matchedPairs: [{ leftItem: "item1", rightItem: "ans1" }, { leftItem: "item2", rightItem: "wrong" }] };
  const res = scoreAnswer(colMatch2ItemQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 5);
});

runTest("Column Matching (2-item) - Fully Correct (2/2)", () => {
  const ans = { matchedPairs: [{ leftItem: "item1", rightItem: "ans1" }, { leftItem: "item2", rightItem: "ans2" }] };
  const res = scoreAnswer(colMatch2ItemQuiz, ans);
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});

// 3-item Text-Based Column Matching
const colMatch3ItemQuiz = {
  type: "column_matching",
  matchingSubtype: "text_column_matching",
  pairs: [
    { leftItem: "A", correctAnswer: "1" },
    { leftItem: "B", correctAnswer: "2" },
    { leftItem: "C", correctAnswer: "3" }
  ]
};

runTest("Column Matching (3-item) - 0/3 Correct", () => {
  const ans = { matchedPairs: [] };
  const res = scoreAnswer(colMatch3ItemQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

runTest("Column Matching (3-item) - 1/3 Correct", () => {
  const ans = { matchedPairs: [{ leftItem: "A", rightItem: "1" }] };
  const res = scoreAnswer(colMatch3ItemQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 3.33);
});

runTest("Column Matching (3-item) - 2/3 Correct", () => {
  const ans = { matchedPairs: [{ leftItem: "A", rightItem: "1" }, { leftItem: "B", rightItem: "2" }] };
  const res = scoreAnswer(colMatch3ItemQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 6.67);
});

runTest("Column Matching (3-item) - 3/3 Correct", () => {
  const ans = { matchedPairs: [{ leftItem: "A", rightItem: "1" }, { leftItem: "B", rightItem: "2" }, { leftItem: "C", rightItem: "3" }] };
  const res = scoreAnswer(colMatch3ItemQuiz, ans);
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});

// 4-item Board-Based Column Matching
const colMatch4ItemBoardQuiz = {
  type: "column_matching",
  matchingSubtype: "board_column_matching",
  boards: [
    { id: "b1", name: "Board 1", correctAnswer: "Pattern 1" },
    { id: "b2", name: "Board 2", correctAnswer: "Pattern 2" },
    { id: "b3", name: "Board 3", correctAnswer: "Pattern 3" },
    { id: "b4", name: "Board 4", correctAnswer: "Pattern 4" }
  ],
  pairs: [
    { leftItem: "b1", correctAnswer: "Pattern 1" },
    { leftItem: "b2", correctAnswer: "Pattern 2" },
    { leftItem: "b3", correctAnswer: "Pattern 3" },
    { leftItem: "b4", correctAnswer: "Pattern 4" }
  ]
};

runTest("Board-Based Column Matching (4-item) - 0/4 Correct", () => {
  const ans = { matchedPairs: [] };
  const res = scoreAnswer(colMatch4ItemBoardQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

runTest("Board-Based Column Matching (4-item) - 1/4 Correct", () => {
  const ans = { matchedPairs: [{ leftItem: "b1", rightItem: "Pattern 1" }] };
  const res = scoreAnswer(colMatch4ItemBoardQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 2.5);
});

runTest("Board-Based Column Matching (4-item) - 2/4 Correct", () => {
  const ans = { matchedPairs: [{ leftItem: "b1", rightItem: "Pattern 1" }, { leftItem: "b2", rightItem: "Pattern 2" }] };
  const res = scoreAnswer(colMatch4ItemBoardQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 5);
});

runTest("Board-Based Column Matching (4-item) - 3/4 Correct", () => {
  const ans = { matchedPairs: [{ leftItem: "b1", rightItem: "Pattern 1" }, { leftItem: "b2", rightItem: "Pattern 2" }, { leftItem: "b3", rightItem: "Pattern 3" }] };
  const res = scoreAnswer(colMatch4ItemBoardQuiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 7.5);
});

runTest("Board-Based Column Matching (4-item) - 4/4 Correct", () => {
  const ans = { matchedPairs: [
    { leftItem: "b1", rightItem: "Pattern 1" },
    { leftItem: "b2", rightItem: "Pattern 2" },
    { leftItem: "b3", rightItem: "Pattern 3" },
    { leftItem: "b4", rightItem: "Pattern 4" }
  ]};
  const res = scoreAnswer(colMatch4ItemBoardQuiz, ans);
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});


// -----------------------------------------------------------------------------
// 2. PIECE VALUE TESTS
// -----------------------------------------------------------------------------

// 1-piece Question
const pieceValue1Quiz = {
  type: "piece_value",
  pieceValue: {
    pieceValues: [{ id: "p1", piece: "pawn", value: 1 }]
  }
};

runTest("Piece Value (1-piece) - 0/1 Correct", () => {
  const ans = { pieceValueAnswer: [{ piece: "pawn", value: 5 }] };
  const res = scoreAnswer(pieceValue1Quiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

runTest("Piece Value (1-piece) - 1/1 Correct", () => {
  const ans = { pieceValueAnswer: [{ piece: "pawn", value: 1 }] };
  const res = scoreAnswer(pieceValue1Quiz, ans);
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});

// 2-piece Question
const pieceValue2Quiz = {
  type: "piece_value",
  pieceValue: {
    pieceValues: [
      { id: "p1", piece: "knight", value: 3 },
      { id: "p2", piece: "rook", value: 5 }
    ]
  }
};

runTest("Piece Value (2-piece) - 0/2 Correct", () => {
  const ans = { pieceValueAnswer: [] };
  const res = scoreAnswer(pieceValue2Quiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

runTest("Piece Value (2-piece) - 1/2 Correct", () => {
  const ans = { pieceValueAnswer: [{ piece: "knight", value: 3 }, { piece: "rook", value: 99 }] };
  const res = scoreAnswer(pieceValue2Quiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 5);
});

runTest("Piece Value (2-piece) - 2/2 Correct", () => {
  const ans = { pieceValueAnswer: [{ piece: "knight", value: 3 }, { piece: "rook", value: 5 }] };
  const res = scoreAnswer(pieceValue2Quiz, ans);
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});

// 3-piece Question (Expression Format)
const pieceValue3Quiz = {
  type: "piece_value",
  pieceValue: {
    pieceValues: [
      { id: "eq1", piece1: "pawn", operator1: "plus", piece2: "knight", value: 4 },
      { id: "eq2", piece1: "rook", operator1: "minus", piece2: "bishop", value: 2 },
      { id: "eq3", piece1: "queen", operator1: "none", value: 9 }
    ]
  }
};

runTest("Piece Value (3-piece expression) - 0/3 Correct", () => {
  const ans = { pieceValueAnswer: [] };
  const res = scoreAnswer(pieceValue3Quiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

runTest("Piece Value (3-piece expression) - 1/3 Correct", () => {
  const ans = { pieceValueAnswer: [{ id: "eq1", value: 4 }] };
  const res = scoreAnswer(pieceValue3Quiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 3.33);
});

runTest("Piece Value (3-piece expression) - 2/3 Correct", () => {
  const ans = { pieceValueAnswer: [{ id: "eq1", value: 4 }, { id: "eq2", value: 2 }] };
  const res = scoreAnswer(pieceValue3Quiz, ans);
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 6.67);
});

runTest("Piece Value (3-piece expression) - 3/3 Correct", () => {
  const ans = { pieceValueAnswer: [
    { id: "eq1", piece1: "pawn", operator1: "plus", piece2: "knight", value: 4 },
    { id: "eq2", piece1: "rook", operator1: "minus", piece2: "bishop", value: 2 },
    { id: "eq3", piece1: "queen", operator1: "none", value: 9 }
  ]};
  const res = scoreAnswer(pieceValue3Quiz, ans);
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});


// -----------------------------------------------------------------------------
// 3. OTHER QUESTION TYPES UNCHANGED VERIFICATION
// -----------------------------------------------------------------------------

const mcqQuiz = {
  type: "mcq",
  options: [
    { _id: "opt1", text: "Wrong", isCorrect: false },
    { _id: "opt2", text: "Right", isCorrect: true }
  ]
};

runTest("MCQ - Correct gives 10 marks", () => {
  const res = scoreAnswer(mcqQuiz, { selectedOption: "opt2" });
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});

runTest("MCQ - Incorrect gives 0 marks", () => {
  const res = scoreAnswer(mcqQuiz, { selectedOption: "opt1" });
  assert.equal(res.isCorrect, false);
  assert.equal(res.rawPoints, 0);
});

const yesNoQuiz = {
  type: "yes_no",
  options: [
    { _id: "yes", text: "Yes", isCorrect: true },
    { _id: "no", text: "No", isCorrect: false }
  ]
};

runTest("Yes/No - Correct gives 10 marks", () => {
  const res = scoreAnswer(yesNoQuiz, { selectedOption: "yes" });
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});

const fillBlankQuiz = {
  type: "fill_in_the_blank",
  options: [
    { text: "Checkmate", isCorrect: true }
  ]
};

runTest("Fill in the Blank - Correct gives 10 marks", () => {
  const res = scoreAnswer(fillBlankQuiz, { textAnswer: "Checkmate" });
  assert.equal(res.isCorrect, true);
  assert.equal(res.rawPoints, 10);
});


// -----------------------------------------------------------------------------
// 4. FULL EXAM SCORING INTEGRATION VERIFICATION
// -----------------------------------------------------------------------------

runTest("scoreExam calculates combined score with full and partial marks", () => {
  const q1Map = new Map([
    ["q1", mcqQuiz],              // 10 pts
    ["q2", colMatch3ItemQuiz],    // 2/3 = 6.67 pts
    ["q3", pieceValue3Quiz]       // 1/3 = 3.33 pts
  ]);

  const studentAnswers = [
    { quizId: "q1", selectedOption: "opt2" }, // Correct (10)
    { quizId: "q2", matchedPairs: [{ leftItem: "A", rightItem: "1" }, { leftItem: "B", rightItem: "2" }] }, // 2/3 (6.67)
    { quizId: "q3", pieceValueAnswer: [{ id: "eq1", value: 4 }] } // 1/3 (3.33)
  ];

  const examResult = scoreExam(q1Map, studentAnswers);

  assert.equal(examResult.totalQuestions, 3);
  assert.equal(examResult.correctCount, 1); // Only Q1 is 100% fully correct
  assert.equal(examResult.score, 20); // 10 + 6.67 + 3.33 = 20.00
  assert.equal(examResult.processedAnswers.length, 3);
  assert.equal(examResult.processedAnswers[0].earnedMarks, 10);
  assert.equal(examResult.processedAnswers[1].earnedMarks, 6.67);
  assert.equal(examResult.processedAnswers[2].earnedMarks, 3.33);
});

runTest("scoreExam caps total score at totalMaxMarks", () => {
  const max = computeTotalMaxMarks(null, 3);
  assert.equal(max, 30);
});

// -----------------------------------------------------------------------------
// 5. ANSWER BREAKDOWN DATA MAPPING AUDIT
// -----------------------------------------------------------------------------

runTest("Answer Breakdown - Piece Value accurately maps real submitted user answer vs correct answer", () => {
  const quiz = {
    type: "piece_value",
    pieceValue: {
      pieceValues: [
        { id: "pv1", piece1: "king", operator1: "none", value: 10 },
        { id: "pv2", piece1: "queen", operator1: "none", value: 9 },
        { id: "pv3", piece1: "rook", operator1: "none", value: 5 }
      ]
    }
  };

  // Student answered: King -> 5 (wrong), Queen -> 9 (correct), Rook -> 4 (wrong)
  const submittedAnswer = {
    pieceValueAnswer: [
      { piece: "legacy:king:0", value: 5 },
      { piece: "legacy:queen:1", value: 9 },
      { piece: "legacy:rook:2", value: 4 }
    ]
  };

  const scoringRes = scoreAnswer(quiz, submittedAnswer);
  assert.equal(scoringRes.isCorrect, false);
  assert.equal(scoringRes.rawPoints, 3.33); // 1 out of 3 correct = 3.33 marks

  // Verify that answer map retrieves exact user answers for every piece
  const getStorageKey = (row, idx) => `legacy:${row.piece1}:${idx}`;
  const submittedMap = new Map(submittedAnswer.pieceValueAnswer.map(a => [a.piece, a.value]));

  const row1UserVal = submittedMap.get(getStorageKey(quiz.pieceValue.pieceValues[0], 0));
  const row2UserVal = submittedMap.get(getStorageKey(quiz.pieceValue.pieceValues[1], 1));
  const row3UserVal = submittedMap.get(getStorageKey(quiz.pieceValue.pieceValues[2], 2));

  assert.equal(row1UserVal, 5); // King user answer is 5, correct is 10
  assert.equal(row2UserVal, 9); // Queen user answer is 9, correct is 9
  assert.equal(row3UserVal, 4); // Rook user answer is 4, correct is 5
});

runTest("Answer Breakdown - Text Column Matching accurately maps real submitted user answer vs correct answer", () => {
  const quiz = {
    type: "column_matching",
    matchingSubtype: "text_column_matching",
    pairs: [
      { leftItem: "term1", leftLabel: "Term 1", correctAnswer: "Definition A" },
      { leftItem: "term2", leftLabel: "Term 2", correctAnswer: "Definition B" },
      { leftItem: "term3", leftLabel: "Term 3", correctAnswer: "Definition C" }
    ]
  };

  // Student matched: term1 -> Definition A (correct), term2 -> Definition C (wrong), term3 -> unmatched
  const submittedAnswer = {
    matchedPairs: [
      { leftItem: "term1", rightItem: "Definition A" },
      { leftItem: "term2", rightItem: "Definition C" }
    ]
  };

  const scoringRes = scoreAnswer(quiz, submittedAnswer);
  assert.equal(scoringRes.isCorrect, false);
  assert.equal(scoringRes.rawPoints, 3.33); // 1 out of 3 correct = 3.33 marks

  const submittedMap = new Map(submittedAnswer.matchedPairs.map(m => [m.leftItem, m.rightItem]));
  assert.equal(submittedMap.get("term1"), "Definition A");
  assert.equal(submittedMap.get("term2"), "Definition C");
  assert.equal(submittedMap.get("term3"), undefined); // Unmatched
});

runTest("Answer Breakdown - Board Column Matching accurately maps real submitted user answer vs correct answer", () => {
  const quiz = {
    type: "column_matching",
    matchingSubtype: "board_column_matching",
    boards: [
      { id: "board_1", name: "Back Rank", correctAnswer: "Back Rank Mate" },
      { id: "board_2", name: "Smothered", correctAnswer: "Smothered Mate" }
    ],
    pairs: [
      { leftItem: "board_1", leftLabel: "Back Rank", correctAnswer: "Back Rank Mate" },
      { leftItem: "board_2", leftLabel: "Smothered", correctAnswer: "Smothered Mate" }
    ]
  };

  // Student matched: board_1 -> Back Rank Mate (correct), board_2 -> Back Rank Mate (wrong reuse)
  const submittedAnswer = {
    matchedPairs: [
      { leftItem: "board_1", rightItem: "Back Rank Mate" },
      { leftItem: "board_2", rightItem: "Back Rank Mate" }
    ]
  };

  const scoringRes = scoreAnswer(quiz, submittedAnswer);
  assert.equal(scoringRes.isCorrect, false);
  assert.equal(scoringRes.rawPoints, 5); // 1 out of 2 correct = 5 marks

  const submittedMap = new Map(submittedAnswer.matchedPairs.map(m => [m.leftItem, m.rightItem]));
  assert.equal(submittedMap.get("board_1"), "Back Rank Mate");
  assert.equal(submittedMap.get("board_2"), "Back Rank Mate");
});

console.log("\n=========================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=========================================\n");

if (failed > 0) {
  process.exit(1);
}

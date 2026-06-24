import mongoose from "mongoose";

const QuizSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      "mcq",
      "column_matching",
      "piece_combination",
      "piece_value",
      "sequence_ordering",
      "board_move_challenge",
      "fill_in_the_blank",
      "yes_no",
    ],
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  difficulty: {
    type: String,
    default: "Medium"
  },
  marks: {
    type: Number,
    default: 1
  },
  tags: [{
    type: String
  }],
  mcqSubtype: {
    type: String
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "QuizCategory",
    required: true
  },
  questionText: {
    type: String,
    required: true
  },
  // MCQ Specific Fields
  isBoardBased: {
    type: Boolean,
    default: false
  },
  fen: {
    type: String
  },
  options: [{
    text: String,
    isCorrect: Boolean
  }],
  // Column Matching Specific Fields
  pairs: [{
    leftItem: String,
    rightItem: String,
    correctAnswer: String
  }],
  // Piece Combination Specific Fields
  pieceCombination: {
    description: { type: String },
    targetPiece: { type: String },
    slotCount: { type: Number },
    requiredPieces: [{ type: String }]
  },
  // Piece Value Specific Fields
  pieceValue: {
    description: { type: String },
    pieceValues: [{ piece: { type: String }, value: { type: Number } }]
  },
  // Sequence Ordering Specific Fields
  sequenceOrdering: {
    description: { type: String },
    sequenceItems: [{ text: { type: String }, order: { type: Number } }]
  },
  // Board Move Challenge Specific Fields
  boardMoveChallenge: {
    description: { type: String },
    fen: { type: String },
    firstMoveBy: { type: String },
    acceptedMoves: [{
      from: { type: String },
      to: { type: String },
      promotion: { type: String },
      san: { type: String },
      resultingFen: { type: String },
    }],
    correctMove: { type: String },
  },
  firstMoveBy: { type: String },
  acceptedMoves: [{
    from: { type: String },
    to: { type: String },
    promotion: { type: String },
    san: { type: String },
    resultingFen: { type: String },
  }],
  correctMove: { type: String },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

QuizSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

const QuizModel = mongoose.model("Quiz", QuizSchema);

export default QuizModel;

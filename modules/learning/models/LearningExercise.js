import mongoose from "mongoose";

const LearningExerciseSchema = new mongoose.Schema(
  {
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningChapter",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, required: true, default: 0 },
    puzzleType: {
      type: String,
      enum: ["move", "capture", "check", "checkmate", "tactical", "sequence"],
      default: "move",
    },
    fen: { type: String, required: true },
    /** Explicit pieces the learner controls (minimal board — not full starting position). */
    playerPieces: [
      {
        square: { type: String, trim: true },
        type: { type: String, trim: true },
        color: { type: String, enum: ["w", "b"], default: "w" },
      },
    ],
    targetSquare: { type: String, default: null, trim: true },
    targetSquares: [{ type: String, trim: true }],
    optimalMoveCount: { type: Number, default: null },
    hintArrows: [
      {
        from: { type: String, trim: true },
        to: { type: String, trim: true },
      },
    ],
    validationRules: { type: mongoose.Schema.Types.Mixed, default: null },
    requiresPromotion: { type: Boolean, default: false },
    sideToMove: { type: String, enum: ["w", "b"], default: "w" },
    maximumNoOfMoves: { type: Number, default: null },
    solutionMoves: [{ type: String }],
    alternativeSolutions: [[{ type: String }]],
    initialMove: { type: String, default: null },
    hintLevels: {
      level1: { type: String, default: "" },
      level2: { type: String, default: "" },
      level3: { type: String, default: "" },
    },
    hintsEnabled: { type: Boolean, default: true },
    maxHints: { type: Number, default: 3 },
    explanation: { type: String, default: "" },
    successMessage: { type: String, default: "Correct!" },
    failureMessage: { type: String, default: "Not quite. Try again." },
    theme: { type: String, default: "" },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "easy",
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    isActive: { type: Boolean, default: true },
    legacyPuzzleId: { type: mongoose.Schema.Types.ObjectId, ref: "Puzzle" },
    source: {
      type: String,
      enum: ["manual", "lichess-cc0", "import"],
      default: "manual",
    },
    sourceMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
    isValidated: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

LearningExerciseSchema.index({ chapterId: 1, order: 1 });
LearningExerciseSchema.index({ chapterId: 1, status: 1 });
LearningExerciseSchema.index({ status: 1, isActive: 1 });

const LearningExercise = mongoose.model("LearningExercise", LearningExerciseSchema);
export default LearningExercise;

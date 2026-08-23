import mongoose from "mongoose";

const PuzzleRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    fen: {
      type: String,
      required: true,
      default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },
    turnToPlay: {
      type: String,
      enum: ["w", "b"],
      default: "w",
    },
    solutionMoves: {
      type: [String],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export default mongoose.model("PuzzleRequest", PuzzleRequestSchema);

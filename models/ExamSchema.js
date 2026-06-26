import mongoose from "mongoose";

const ExamSchema = new mongoose.Schema({
  name: { type: String },
  description: { type: String },

  // Exam timing
  startTime: { type: Date },
  endTime:   { type: Date },
  duration:  { type: Number }, // Duration in minutes

  // Chapters — organises quizzes into named sections
  chapters: [{
    name:    { type: String },
    quizIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Quiz" }]
  }],

  // Access constraints
  maxParticipants: { type: Number },
  accessCode:      { type: String },   // optional passphrase to join

  // Visibility
  isActive:         { type: Boolean, default: false },
  resultsPublished: { type: Boolean, default: false }, // admin controls when results are visible
  status: {
    type:    String,
    enum:    ["UPCOMING", "LIVE", "ENDED"],
    default: "UPCOMING"
  },

  // Participants & their submissions
  participants: [{
    user:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    score: { type: Number, default: 0 },

    submittedAt: { type: Date },

    // Total active solving time in seconds.
    // Accumulated from per-question timeSpent values sent by the frontend.
    // NOT derived from (submittedAt - joinedAt) — idle/away time is excluded.
    timeSpent: { type: Number, default: 0 },

    // Per-question answers — raw input preserved alongside isCorrect for audit
    answers: [{
      quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz" },

      // Active seconds the student spent on THIS specific question (sent from frontend).
      // On answer change, the frontend sends the additional time spent on the revision.
      // Backend adds it to the running total.
      questionTimeSpent: { type: Number, default: 0 },

      // MCQ / yes_no / fill_in_the_blank — selected option _id string
      selectedOption: { type: String },

      // fill_in_the_blank — raw typed text (compared case-insensitively)
      textAnswer: { type: String },

      // column_matching — user's left→right pairings
      matchedPairs: [{
        leftItem:  { type: String },
        rightItem: { type: String }
      }],

      // sequence_ordering — ordered array of item texts/identifiers
      sequenceAnswer: [{ type: String }],

      // board_move_challenge — move in "from-to" or SAN notation
      boardMove: { type: String },

      // piece_value — user's piece→value entries
      pieceValueAnswer: [{
        piece: { type: String },
        value: { type: Number }
      }],

      // piece_combination — ordered list of piece names the user placed
      pieceCombinationAnswer: [{ type: String }],

      // Computed at submission time; stored so results can be read without re-scoring
      isCorrect: { type: Boolean }
    }],

    joinedAt: { type: Date, default: Date.now }
  }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Keep updatedAt current on every save
ExamSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

// ── Indexes ──────────────────────────────────────────────────────────────────
ExamSchema.index({ status: 1, startTime: 1 });
ExamSchema.index({ status: 1, endTime: 1 });          // for LIVE→ENDED boundary queries
ExamSchema.index({ startTime: 1, endTime: 1 });        // time-window checks
ExamSchema.index({ isActive: 1 });
ExamSchema.index({ "participants.user": 1 });           // participant lookup

const ExamModel = mongoose.model("Exam", ExamSchema);

export default ExamModel;

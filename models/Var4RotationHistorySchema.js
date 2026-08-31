import mongoose from 'mongoose';

const Var4RotationEntrySchema = new mongoose.Schema(
  {
    generatedAt: { type: Date, default: Date.now },
    rotatingCategories: [{ type: String, required: true }],
    chapterCategories: [{ type: String }],
  },
  { _id: false },
);

const Var4RotationHistorySchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'var4' },
    entries: { type: [Var4RotationEntrySchema], default: [] },
    cycleUsedCategories: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model('Var4RotationHistory', Var4RotationHistorySchema);

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quickchess').then(async () => {
  // Define Event Schema
  const EventSchema = new mongoose.Schema({
    puzzles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Puzzle' }]
  }, { strict: false });
  const Event = mongoose.model('Event', EventSchema);

  // Define Puzzle Schema
  const PuzzleSchema = new mongoose.Schema({}, { strict: false });
  const Puzzle = mongoose.model('Puzzle', PuzzleSchema);

  const latestEvent = await Event.findOne({}).sort({ createdAt: -1 });
  if (!latestEvent) {
    console.log('No events found');
    process.exit();
  }

  const populatedEvent = await Event.findById(latestEvent._id).populate('puzzles');
  console.log('--- POPULATED EVENT PUZZLES ---');
  console.log('Populated puzzles count:', populatedEvent.puzzles?.length);
  if (populatedEvent.puzzles) {
    populatedEvent.puzzles.forEach((p, idx) => {
      if (p) {
        console.log(`Puzzle ${idx}: ID=${p._id}, title=${p.title}`);
      } else {
        console.log(`Puzzle ${idx}: null/unpopulated`);
      }
    });
  }
  process.exit();
}).catch(err => {
  console.error(err);
  process.exit(1);
});

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quickchess').then(async () => {
  const EventSchema = new mongoose.Schema({}, { strict: false });
  const Event = mongoose.model('Event', EventSchema);
  const events = await Event.find({}).sort({ createdAt: -1 });
  console.log(`Found ${events.length} events:`);
  events.forEach((e, idx) => {
    console.log(`Event ${idx}: ID=${e._id}, Name=${e.name}, PuzzlesCount=${e.puzzles?.length}, ChaptersCount=${e.chapters?.length}`);
    if (e.chapters) {
      e.chapters.forEach((ch, cidx) => {
        console.log(`  Chapter ${cidx}: Name=${ch.name}, PuzzlesCount=${ch.puzzleIds?.length}`);
      });
    }
  });
  process.exit();
}).catch(err => {
  console.error(err);
  process.exit(1);
});

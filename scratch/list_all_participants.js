import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quickchess').then(async () => {
  const EventParticipantSchema = new mongoose.Schema({}, { strict: false });
  const EventParticipant = mongoose.model('EventParticipant', EventParticipantSchema);
  const parts = await EventParticipant.find({}).sort({ joinedAt: -1 }).limit(10);
  console.log(`Latest 10 participants:`);
  parts.forEach((p, idx) => {
    console.log(`Part ${idx}: EventId=${p.eventId}, UserId=${p.userId}, Username=${p.username}, Status=${p.status}, JoinedAt=${p.joinedAt}`);
  });
  process.exit();
}).catch(err => {
  console.error(err);
  process.exit(1);
});

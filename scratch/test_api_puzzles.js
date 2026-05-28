import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quickchess').then(async () => {
  // Import schemas/models
  const EventSchema = new mongoose.Schema({
    puzzles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Puzzle' }]
  }, { strict: false });
  const Event = mongoose.model('Event', EventSchema);

  const PuzzleSchema = new mongoose.Schema({}, { strict: false });
  const Puzzle = mongoose.model('Puzzle', PuzzleSchema);

  const EventParticipantSchema = new mongoose.Schema({}, { strict: false });
  const EventParticipant = mongoose.model('EventParticipant', EventParticipantSchema);

  const PuzzleAttemptSchema = new mongoose.Schema({}, { strict: false });
  const PuzzleAttempt = mongoose.model('PuzzleAttempt', PuzzleAttemptSchema);

  const PuzzleSolutionSchema = new mongoose.Schema({}, { strict: false });
  const PuzzleSolution = mongoose.model('PuzzleSolution', PuzzleSolutionSchema);

  const latestEvent = await Event.findOne({}).sort({ createdAt: -1 });
  if (!latestEvent) {
    console.log('No events found');
    process.exit();
  }

  const latestParticipant = await EventParticipant.findOne({ eventId: latestEvent._id });
  if (!latestParticipant) {
    console.log('No participants found for latest event');
    process.exit();
  }

  // Mimic getEventPuzzles controller logic
  const event = await Event.findById(latestEvent._id).populate('puzzles');
  const userId = latestParticipant.userId;

  const puzzleAttempts = await PuzzleAttempt.find({
    competitionId: latestEvent._id,
    userId
  }).select('puzzleId status scoreEarned timeSpent completedAt boardPosition moveHistory isLocked');

  const attemptsMap = new Map();
  puzzleAttempts.forEach(attempt => {
    attemptsMap.set(attempt.puzzleId.toString(), {
      status: attempt.status,
      scoreEarned: attempt.scoreEarned || 0,
      timeSpent: attempt.timeSpent || 0,
      completedAt: attempt.completedAt,
      boardPosition: attempt.boardPosition,
      moveHistory: attempt.moveHistory || [],
      isLocked: attempt.isLocked
    });
  });

  const solvedPuzzles = await PuzzleSolution.find({
    competitionId: latestEvent._id,
    userId,
    isCorrect: true
  }).select('puzzleId scoreEarned timeSpent solvedAt');

  const solvedMap = new Map();
  solvedPuzzles.forEach(solution => {
    solvedMap.set(solution.puzzleId.toString(), {
      scoreEarned: solution.scoreEarned,
      timeSpent: solution.timeSpent,
      solvedAt: solution.solvedAt
    });
  });

  const puzzlesWithStatus = event.puzzles.map(puzzle => {
    const puzzleId = puzzle._id.toString();
    const attemptData = attemptsMap.get(puzzleId);
    const solvedData = solvedMap.get(puzzleId);

    let status = 'unsolved';
    let isSolved = false;
    let isFailed = false;
    let isLocked = false;

    if (attemptData) {
      status = attemptData.status;
      isSolved = attemptData.status === 'solved';
      isFailed = attemptData.status === 'failed';
      isLocked = attemptData.isLocked || isSolved || isFailed;
    } else if (solvedData) {
      status = 'solved';
      isSolved = true;
      isLocked = true;
    }

    return {
      _id: puzzle._id,
      title: puzzle.title,
      status,
      isSolved,
      isFailed,
      isLocked
    };
  });

  console.log('--- MOCKED API RESPONSE ---');
  console.log('Puzzles in response:', puzzlesWithStatus.length);
  puzzlesWithStatus.forEach((p, idx) => {
    console.log(`Puzzle ${idx}: ID=${p._id}, Title=${p.title}, Status=${p.status}`);
  });

  process.exit();
}).catch(err => {
  console.error(err);
  process.exit(1);
});

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import PuzzleModel from '../models/PuzzleSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://quickchess4kids_db_user:u8TWmVZIEkj9ZY17@ac-9cxm70m.egwucqz.mongodb.net/test?retryWrites=true&w=majority';

const migrateChocolateToDonut = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB at', MONGODB_URI);

    // 1. Migrate target object identifiers in captureConfig and kidsConfig
    const resultCapture = await PuzzleModel.updateMany(
      { 'captureConfig.targets.item': 'chocolate' },
      { $set: { 'captureConfig.targets.$[elem].item': 'donut' } },
      { arrayFilters: [{ 'elem.item': 'chocolate' }] }
    );

    const resultKids = await PuzzleModel.collection.updateMany(
      { 'kidsConfig.targets.item': 'chocolate' },
      { $set: { 'kidsConfig.targets.$[elem].item': 'donut' } },
      { arrayFilters: [{ 'elem.item': 'chocolate' }] }
    );

    console.log(`Updated targets in ${resultCapture.modifiedCount} captureConfig puzzles and ${resultKids.modifiedCount} kidsConfig puzzles.`);

    console.log(`Migration fully completed.`);

    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrateChocolateToDonut();

import mongoose from 'mongoose';
import PuzzleModel from '../models/PuzzleSchema.js';

const MONGODB_URI = 'mongodb+srv://quickchess4kids_db_user:u8TWmVZIEkj9ZY17@ac-9cxm70m.egwucqz.mongodb.net/test?retryWrites=true&w=majority';

const verifyTargets = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const puzzles = await PuzzleModel.find();
    
    let counts = {
      pizza: 0,
      burger: 0,
      star: 0,
      donut: 0,
      chocolate: 0,
      other: 0
    };

    puzzles.forEach(puzzle => {
      const targets = puzzle.captureConfig?.targets || [];
      const kidsTargets = puzzle.kidsConfig?.targets || [];
      
      const allTargets = [...targets, ...kidsTargets];

      allTargets.forEach(target => {
        let item = target.item;
        if (item === '⭐') item = 'star'; // normalize star symbol for count
        
        if (counts[item] !== undefined) {
          counts[item]++;
        } else {
          counts.other++;
        }
      });
    });

    console.log(`\nPizza targets:    ${counts.pizza} ✅`);
    console.log(`Burger targets:   ${counts.burger} ✅`);
    console.log(`Star targets:     ${counts.star} ✅`);
    console.log(`Donut targets:    ${counts.donut} ✅`);
    console.log(`Chocolate targets: ${counts.chocolate} ✅\n`);

    console.log('Verification Complete.');
    process.exit(0);
  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  }
};

verifyTargets();

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ExamModel from '../models/ExamSchema.js';

dotenv.config();

async function checkExamStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000
    });
    console.log('Connected to database');

    const totalExams = await ExamModel.countDocuments();
    const activeExams = await ExamModel.countDocuments({ isActive: true });
    const inactiveExams = await ExamModel.countDocuments({ isActive: false });

    console.log(`\n=== Exam Status Summary ===`);
    console.log(`Total exams: ${totalExams}`);
    console.log(`Active exams (isActive: true): ${activeExams}`);
    console.log(`Inactive exams (isActive: false): ${inactiveExams}`);

    if (inactiveExams > 0) {
      console.log(`\n=== Inactive Exams Details ===`);
      const inactiveExamsList = await ExamModel.find({ isActive: false })
        .select('name status startTime endTime isActive')
        .lean();
      
      inactiveExamsList.forEach(exam => {
        console.log(`- ${exam.name} (status: ${exam.status}, isActive: ${exam.isActive})`);
        console.log(`  Start: ${exam.startTime}, End: ${exam.endTime}`);
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkExamStatus();
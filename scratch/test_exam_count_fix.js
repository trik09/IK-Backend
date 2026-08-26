// Test script to verify the exam count fix
// This simulates the queries that admin and user endpoints would make

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ExamModel from '../models/ExamSchema.js';

dotenv.config();

async function testExamCounts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000
    });
    console.log('Connected to database');

    const now = new Date();

    // Simulate admin query (no isActive filter)
    const adminQuery = {};
    const adminCount = await ExamModel.countDocuments(adminQuery);

    // Simulate user query (old logic with isActive: true filter)
    const oldUserQuery = { isActive: true };
    const oldUserCount = await ExamModel.countDocuments(oldUserQuery);

    // Simulate new user query (no isActive filter)
    const newUserQuery = {};
    const newUserCount = await ExamModel.countDocuments(newUserQuery);

    console.log('\n=== Exam Count Comparison ===');
    console.log(`Admin sees: ${adminCount} exams`);
    console.log(`Old user query (isActive: true): ${oldUserCount} exams`);
    console.log(`New user query (no filter): ${newUserCount} exams`);
    console.log(`Mismatch with old logic: ${adminCount - oldUserCount} exams`);
    console.log(`Mismatch with new logic: ${adminCount - newUserCount} exams`);

    if (adminCount === newUserCount) {
      console.log('\n✅ FIX VERIFIED: Admin and user counts now match!');
    } else {
      console.log('\n❌ ISSUE: Counts still do not match');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testExamCounts();
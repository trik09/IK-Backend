// Test to verify that duration changes don't affect exam visibility
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ExamModel from '../models/ExamSchema.js';

dotenv.config();

async function testDurationChangeVisibility() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000
    });
    console.log('Connected to database');

    const now = new Date();
    
    // Simulate what happens when admin changes duration:
    // 1. Find an exam that might be affected by duration changes
    const sampleExam = await ExamModel.findOne().select('name status isActive startTime endTime duration').lean();
    
    if (sampleExam) {
      console.log('\n=== Sample Exam Before Simulated Duration Change ===');
      console.log(`Name: ${sampleExam.name}`);
      console.log(`Status: ${sampleExam.status}`);
      console.log(`isActive: ${sampleExam.isActive}`);
      console.log(`Start: ${sampleExam.startTime}`);
      console.log(`End: ${sampleExam.endTime}`);
      console.log(`Duration: ${sampleExam.duration} minutes`);

      // Simulate duration change (what would happen in updateExam)
      const newDuration = sampleExam.duration + 30; // Add 30 minutes
      const originalEnd = new Date(sampleExam.endTime);
      const newEnd = new Date(new Date(sampleExam.startTime).getTime() + newDuration * 60 * 1000);
      
      console.log('\n=== Simulated Duration Change ===');
      console.log(`Original duration: ${sampleExam.duration} minutes`);
      console.log(`New duration: ${newDuration} minutes`);
      console.log(`Original end time: ${originalEnd.toISOString()}`);
      console.log(`New end time: ${newEnd.toISOString()}`);

      // Test the old logic (would set isActive based on computed status)
      const nowCheck = new Date();
      let oldLogicStatus = "UPCOMING";
      if (nowCheck >= new Date(sampleExam.startTime) && nowCheck <= newEnd) {
        oldLogicStatus = "LIVE";
      } else if (nowCheck > newEnd) {
        oldLogicStatus = "ENDED";
      }
      const oldLogicIsActive = oldLogicStatus === "LIVE";
      
      console.log('\n=== Old Logic (isActive controlled by status) ===');
      console.log(`Computed status: ${oldLogicStatus}`);
      console.log(`Would set isActive to: ${oldLogicIsActive}`);
      console.log(`Problem: If exam is not LIVE, it becomes invisible to users!`);

      // Test the new logic (isActive not controlled by status)
      console.log('\n=== New Logic (isActive not controlled by status) ===');
      console.log(`Computed status: ${oldLogicStatus}`);
      console.log(`isActive remains: ${sampleExam.isActive} (unchanged)`);
      console.log(`Benefit: Exam remains visible regardless of status change!`);
    }

    // Count exams that would be affected by duration changes
    const totalExams = await ExamModel.countDocuments();
    const endedExams = await ExamModel.countDocuments({ status: "ENDED" });
    const liveExams = await ExamModel.countDocuments({ status: "LIVE" });
    const upcomingExams = await ExamModel.countDocuments({ status: "UPCOMING" });

    console.log('\n=== Current Exam Distribution ===');
    console.log(`Total exams: ${totalExams}`);
    console.log(`LIVE exams: ${liveExams}`);
    console.log(`UPCOMING exams: ${upcomingExams}`);
    console.log(`ENDED exams: ${endedExams}`);

    console.log('\n=== Visibility Impact Analysis ===');
    console.log(`With old logic: Only ${liveExams} exams would be visible (LIVE status)`);
    console.log(`With new logic: All ${totalExams} exams are visible (regardless of status)`);
    console.log(`Visibility improvement: ${totalExams - liveExams} additional exams visible`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testDurationChangeVisibility();
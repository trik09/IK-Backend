import mongoose from "mongoose";

const connectDB = async () => {
  try {

    const connection = await mongoose.connect(process.env.MONGODB_URI, {
      // Tuned for concurrent live competition traffic
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    if(connection){
        console.log("MongoDB connected");
    }
    
  } catch (err) {
    console.error("MongoDB connection failed", err);
    process.exit(1);
  }
};



export default connectDB;

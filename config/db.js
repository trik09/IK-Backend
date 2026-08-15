import mongoose from "mongoose";

const connectDB = async () => {
  try {
    // PERFORMANCE OPTIMIZATION: Connection pooling for 100+ concurrent users
    // These settings prevent connection pool exhaustion under high load
    const connection = await mongoose.connect(process.env.MONGODB_URI, {
      // Connection pool settings
      minPoolSize: 10,           // Minimum connections to maintain
      maxPoolSize: 100,          // Concurrent exam saves/joins for 100–500 users
      maxIdleTimeMS: 30000,      // Close idle connections after 30 seconds
      
      // Timeout settings
      serverSelectionTimeoutMS: 5000,  // Timeout for server selection
      socketTimeoutMS: 45000,         // Socket timeout
      connectTimeoutMS: 10000,        // Connection timeout
      
      // Retry settings
      retryWrites: true,
      retryReads: true,
    });
    
    if(connection){
        console.log("MongoDB connected with optimized connection pooling");
    }
    
  } catch (err) {
    console.error("MongoDB connection failed", err);
    process.exit(1);
  }
};



export default connectDB;

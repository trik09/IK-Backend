import jwt from "jsonwebtoken";
import User from "../models/UserSchema.js";

const isUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Token is required", code: "NO_TOKEN" });
    }
    
    const token = authHeader.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ message: "Token is required", code: "NO_TOKEN" });
    }
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Session expired. Please log in again.", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ message: "Invalid token. Please log in again.", code: "TOKEN_INVALID" });
    }

    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
    }
    
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Authentication failed", code: "AUTH_ERROR" });
  }
};

export const optionalUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const user = await User.findById(decoded.id);
          if (user) {
            req.user = user;
          }
        } catch (jwtErr) {
          // ignore errors in optional mode
        }
      }
    }
    next();
  } catch (err) {
    next();
  }
};

export default isUser;

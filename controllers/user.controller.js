import User from "../models/UserSchema.js";
import OTP from "../models/OTPSchema.js";
import bcrypt from "bcryptjs";
import sendOTPEmail from "../utils/emailService.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import PuzzleHistoryModel from "../models/PuzzleHistorySchema.js";
import CompetitionModel from "../models/CompetitionSchema.js";
import fs from "fs";
import path from "path";
import { generateToken } from "../utils/tokenUtils.js";

const validatePassword = (password) => {
  const minLength = 8;
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLetter = /[a-zA-Z]/.test(password);

  if (password.length < minLength) return "Password must be at least 8 characters long";
  if (!hasNumber) return "Password must contain at least one number";
  if (!hasSpecialChar) return "Password must contain at least one special character";
  if (!hasLetter) return "Password must contain at least one letter";
  return null;
};

const register = async (req, res) => {
  try {
    const { name, email, password, username, wins, losses, draws } = req.body;
    if (!name || !email || !password || !username) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const avatar = req.file ? req.file.path : "";
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, username, avatar, wins, losses, draws });

    const token = generateToken(user._id);
    const safeUser = { name: user.name, username: user.username, email: user.email, authProvider: user.authProvider };
    return res.status(200).json({ message: "User registered successfully", user: safeUser, token });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findOne({
      $or: [{ email }, { username: email }]
    });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = generateToken(user._id);
    const safeUser = { name: user.name, username: user.username, email: user.email, authProvider: user.authProvider };
    return res.status(200).json({ message: "User logged in successfully", user: safeUser, token });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found. Please register first." });
    }

    await OTP.deleteMany({ email });

    const otp = generateOTP();
    await OTP.create({
      email,
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const emailSent = await sendOTPEmail(email, otp);
    if (!emailSent) {
      return res.status(500).json({ message: "Failed to send OTP email" });
    }

    return res.status(200).json({
      message: "OTP sent successfully to your email",
      ...(process.env.NODE_ENV === 'development' && { otp })
    });
  } catch (error) {
    console.error("Send OTP error:", error.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const sendSignupOTP = async (req, res) => {
  try {
    const { email, name, username, password } = req.body;

    if (!email || !name || !username || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: "Username already taken" });
    }

    await OTP.deleteMany({ email });

    const otp = generateOTP();
    await OTP.create({
      email,
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const emailSent = await sendOTPEmail(email, otp);
    if (!emailSent) {
      return res.status(500).json({ message: "Failed to send OTP email" });
    }

    return res.status(200).json({
      message: "OTP sent successfully to your email. Please verify to complete registration.",
      ...(process.env.NODE_ENV === 'development' && { otp })
    });
  } catch (error) {
    console.error("Send Signup OTP error:", error.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const verifySignupOTP = async (req, res) => {
  try {
    const { email, otp, name, username, password } = req.body;

    if (!email || !otp || !name || !username || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const otpRecord = await OTP.findOne({
      email,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: "Username already taken" });
    }

    otpRecord.isUsed = true;
    await otpRecord.save();

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, username, avatar: "" });

    const token = generateToken(user._id);
    const safeUser = { name: user.name, username: user.username, email: user.email, authProvider: user.authProvider };
    return res.status(200).json({ message: "User registered successfully", user: safeUser, token });
  } catch (error) {
    console.error("Verify Signup OTP error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const otpRecord = await OTP.findOne({
      email,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    otpRecord.isUsed = true;
    await otpRecord.save();

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const token = generateToken(user._id);
    const safeUser = { name: user.name, username: user.username, email: user.email, authProvider: user.authProvider };
    return res.status(200).json({ message: "OTP verified successfully. Logged in.", user: safeUser, token });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user._id;

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getAllPuzzles = async (req, res) => {
  try {
    const puzzles = await PuzzleModel.find();
    return res.status(200).json({ puzzles });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const puzzlesSolved = await PuzzleHistoryModel.countDocuments({ userId, isSolved: true });
    const competitionsParticipated = await CompetitionModel.countDocuments({ 'participants.user': userId });

    const userObject = user.toObject();
    userObject.statistics = { puzzlesSolved, competitionsParticipated };

    return res.status(200).json({ message: "User data retrieved successfully", user: userObject });
  } catch (error) {
    console.error("Get current user error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const updateUser = async (req, res) => {
  try {
    const { name, username } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
    }

    let avatarPath = user.avatar;
    if (req.file) {
      if (user.avatar) {
        const oldAvatarPath = path.join(process.cwd(), user.avatar);
        try {
          if (fs.existsSync(oldAvatarPath)) fs.unlinkSync(oldAvatarPath);
        } catch (err) {
          console.error("Error deleting old avatar:", err);
        }
      }
      avatarPath = req.file.path;
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (username) updateData.username = username;
    if (req.file) updateData.avatar = avatarPath;

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true });

    return res.status(200).json({ message: "User updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Update user error:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: "Username already exists" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });

    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const puzzlesSolved = await PuzzleHistoryModel.countDocuments({ userId: user._id, isSolved: true });
        const competitionsParticipated = await CompetitionModel.countDocuments({ 'participants.user': user._id });
        return { ...user.toObject(), statistics: { puzzlesSolved, competitionsParticipated } };
      })
    );

    return res.status(200).json({ message: "Users retrieved successfully", success: true, data: usersWithStats, count: usersWithStats.length });
  } catch (error) {
    console.error("Get all users error:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};

const deleteUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    if (user.avatar) {
      const avatarPath = path.join(process.cwd(), user.avatar);
      try {
        if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
      } catch (err) {
        console.error("Error deleting avatar:", err);
      }
    }

    await User.findByIdAndDelete(id);

    return res.status(200).json({
      message: "User deleted successfully",
      success: true,
      deletedUser: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};

const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ message: "Google credential is required" });
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!response.ok) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    const googleUser = await response.json();
    if (googleUser.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ message: "Token not intended for this app" });
    }

    const { sub: googleId, email, name, picture } = googleUser;

    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = 'google';
        if (!user.avatar && picture) user.avatar = picture;
        await user.save();
      }
    } else {
      let baseUsername = email.split('@')[0];
      let username = baseUsername;
      let counter = 1;
      while (await User.findOne({ username })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      user = await User.create({
        name: name || email.split('@')[0],
        email,
        username,
        googleId,
        authProvider: 'google',
        avatar: picture || ''
      });
    }

    const token = generateToken(user._id);
    const safeUser = { name: user.name, username: user.username, email: user.email, authProvider: user.authProvider };
    return res.status(200).json({ message: "Google authentication successful", user: safeUser, token });
  } catch (error) {
    console.error("Google auth error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const checkUsername = async (req, res) => {
  try {
    const { username } = req.query;

    if (!username || !username.trim()) {
      return res.status(400).json({ message: "Username is required" });
    }

    const trimmed = username.trim();
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(trimmed)) {
      return res.status(400).json({
        available: false,
        message: "Username must be 3–20 characters and contain only letters, numbers, or underscores"
      });
    }

    const existingUser = await User.findOne({ username: trimmed });
    if (existingUser) {
      return res.status(200).json({ available: false, message: "Username is already taken" });
    }

    return res.status(200).json({ available: true, message: "Username is available" });
  } catch (error) {
    console.error("Check username error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export {
  register, login, sendOTP, verifyOTP, resetPassword,
  sendSignupOTP, verifySignupOTP, getAllPuzzles, getCurrentUser,
  updateUser, getAllUsers, deleteUserById, googleAuth, checkUsername
};

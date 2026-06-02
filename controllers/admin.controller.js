//import AdminModel from "../models/AdminSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import jwt from "jsonwebtoken";
//import bcrypt from "bcryptjs";


//  const registerAdmin = async (req, res) => {
//     try {
//         const {  email, password } = req.body;
//         if (!email || !password) {
//             return res.status(400).json({ message: "All fields are required" });
//         }
//         const existingAdmin = await AdminModel.findOne({ email });
//         if (existingAdmin) {
//             return res.status(400).json({ message: "Admin already exists" });
//         }
//         const hashedPassword = await bcrypt.hash(password, 10);
//
//         const admin = await AdminModel.create({ email, password: hashedPassword });
//         const atoken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET_KEY);
//         res.status(201).json({ message: "Admin registered successfully", admin,atoken });
//     } catch (error) {
//         console.error("Error registering admin:", error);
//         res.status(500).json({ message: "Failed to register admin" });
//     }
// };

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (
      email !== process.env.ADMIN_EMAIL ||
      password !== process.env.ADMIN_PASSWORD
    ) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const atoken = jwt.sign({ email, role: "admin" }, process.env.JWT_SECRET);
    res.status(200).json({ message: "Admin logged in successfully", atoken });
  } catch (error) {
    //console.error("Error logging in admin:", error);
    res.status(500).json({ message: "Failed to login admin" });
  }
};



export {
  loginAdmin,
 
};


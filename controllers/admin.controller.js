import AdminModel from "../models/AdminSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// Login Admin (supports superadmin and subadmin)
const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 1. Check Super Admin (environment variables)
    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const superAdminPermissions = {
        puzzles: { create: true, read: true, update: true, delete: true },
        categories: { create: true, read: true, update: true, delete: true },
        competitions: { create: true, read: true, update: true, delete: true },
        events: { create: true, read: true, update: true, delete: true },
        exams: { create: true, read: true, update: true, delete: true },
        quizzes: { create: true, read: true, update: true, delete: true },
        students: { create: true, read: true, update: true, delete: true }
      };

      const atoken = jwt.sign(
        { email, role: "superadmin" },
        process.env.JWT_SECRET
      );

      return res.status(200).json({
        message: "Super Admin logged in successfully",
        atoken,
        admin: {
          email,
          role: "superadmin",
          permissions: superAdminPermissions
        }
      });
    }

    // 2. Check Database Sub Admins
    const subAdmin = await AdminModel.findOne({ email });
    if (!subAdmin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, subAdmin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const atoken = jwt.sign(
      { id: subAdmin._id, email: subAdmin.email, role: "subadmin" },
      process.env.JWT_SECRET
    );

    return res.status(200).json({
      message: "Admin logged in successfully",
      atoken,
      admin: {
        id: subAdmin._id,
        email: subAdmin.email,
        role: "subadmin",
        permissions: subAdmin.permissions
      }
    });

  } catch (error) {
    console.error("Error logging in admin:", error);
    res.status(500).json({ message: "Failed to login admin" });
  }
};

// Get all sub-admins (Super Admin only)
const getSubAdmins = async (req, res) => {
  try {
    if (req.admin.role !== "superadmin") {
      return res.status(403).json({ message: "Access denied: Super Admin only" });
    }

    const subAdmins = await AdminModel.find({ role: "subadmin" }).select("-password").sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: subAdmins });
  } catch (error) {
    console.error("Error fetching sub-admins:", error);
    return res.status(500).json({ message: "Failed to fetch sub-admins" });
  }
};

// Create a new sub-admin (Super Admin only)
const createSubAdmin = async (req, res) => {
  try {
    if (req.admin.role !== "superadmin") {
      return res.status(403).json({ message: "Access denied: Super Admin only" });
    }

    const { email, password, permissions } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Check if sub-admin already exists
    const existing = await AdminModel.findOne({ email });
    if (existing || email === process.env.ADMIN_EMAIL) {
      return res.status(400).json({ message: "Admin with this email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newSubAdmin = await AdminModel.create({
      email,
      password: hashedPassword,
      role: "subadmin",
      permissions: permissions || {}
    });

    const responseData = newSubAdmin.toObject();
    delete responseData.password;

    return res.status(201).json({
      success: true,
      message: "Sub-admin created successfully",
      data: responseData
    });
  } catch (error) {
    console.error("Error creating sub-admin:", error);
    return res.status(500).json({ message: "Failed to create sub-admin" });
  }
};

// Update sub-admin permissions/password (Super Admin only)
const updateSubAdmin = async (req, res) => {
  try {
    if (req.admin.role !== "superadmin") {
      return res.status(403).json({ message: "Access denied: Super Admin only" });
    }

    const { id } = req.params;
    const { password, permissions } = req.body;

    const subAdmin = await AdminModel.findById(id);
    if (!subAdmin) {
      return res.status(404).json({ message: "Sub-admin not found" });
    }

    const updateData = {};
    if (permissions) {
      updateData.permissions = permissions;
    }
    if (password && password.trim() !== "") {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedSubAdmin = await AdminModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).select("-password");

    return res.status(200).json({
      success: true,
      message: "Sub-admin updated successfully",
      data: updatedSubAdmin
    });
  } catch (error) {
    console.error("Error updating sub-admin:", error);
    return res.status(500).json({ message: "Failed to update sub-admin" });
  }
};

// Delete a sub-admin (Super Admin only)
const deleteSubAdmin = async (req, res) => {
  try {
    if (req.admin.role !== "superadmin") {
      return res.status(403).json({ message: "Access denied: Super Admin only" });
    }

    const { id } = req.params;
    const deleted = await AdminModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Sub-admin not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Sub-admin deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting sub-admin:", error);
    return res.status(500).json({ message: "Failed to delete sub-admin" });
  }
};

export {
  loginAdmin,
  getSubAdmins,
  createSubAdmin,
  updateSubAdmin,
  deleteSubAdmin
};

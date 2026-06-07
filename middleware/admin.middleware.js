import jwt from "jsonwebtoken";
import AdminModel from "../models/AdminSchema.js";

const isAdmin = async (req, res, next) => {
    try {
        // Check if Authorization header exists
        if (!req.headers.authorization) {
            return res.status(401).json({ message: "Authorization header missing" });
        }

        // Extract "Bearer atoken"
        const [type, atoken] = req.headers.authorization.split(" ");

        if (type !== "Bearer" || !atoken) {
            return res.status(401).json({ message: "Invalid authorization format" });
        }

        // Verify JWT using same secret used in login
        const decoded = jwt.verify(atoken, process.env.JWT_SECRET);

        // Check if Super Admin
        if (decoded.email === process.env.ADMIN_EMAIL) {
            req.admin = {
                email: decoded.email,
                role: "superadmin",
                permissions: {
                    puzzles: { create: true, read: true, update: true, delete: true },
                    categories: { create: true, read: true, update: true, delete: true },
                    competitions: { create: true, read: true, update: true, delete: true },
                    events: { create: true, read: true, update: true, delete: true },
                    exams: { create: true, read: true, update: true, delete: true },
                    quizzes: { create: true, read: true, update: true, delete: true },
                    students: { create: true, read: true, update: true, delete: true }
                }
            };
            return next();
        }

        // Check if database sub-admin
        const subAdmin = await AdminModel.findOne({ email: decoded.email }).lean();
        if (!subAdmin) {
            return res.status(403).json({ message: "Access denied: Not an admin" });
        }

        // Store admin data
        req.admin = {
            id: subAdmin._id,
            email: subAdmin.email,
            role: "subadmin",
            permissions: subAdmin.permissions
        };

        return next();

    } catch (error) {
        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({ message: "Invalid token" });
        }
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token expired" });
        }

        console.error("Admin authentication error:", error);
        return res.status(500).json({ message: "Authentication failed" });
    }
};

export default isAdmin;


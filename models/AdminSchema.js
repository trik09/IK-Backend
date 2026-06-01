import mongoose from "mongoose";

const permissionActions = {
    create: { type: Boolean, default: false },
    read: { type: Boolean, default: false },
    update: { type: Boolean, default: false },
    delete: { type: Boolean, default: false }
};

const adminSchema = new mongoose.Schema({
    email:{
        type:String,
        required:true,
        unique:true
    },
    password:{
        type:String,
        required:true,
        min:8
    },
    role: {
        type: String,
        enum: ["superadmin", "subadmin"],
        default: "subadmin"
    },
    permissions: {
        puzzles: { type: permissionActions, default: () => ({}) },
        categories: { type: permissionActions, default: () => ({}) },
        competitions: { type: permissionActions, default: () => ({}) },
        events: { type: permissionActions, default: () => ({}) },
        exams: { type: permissionActions, default: () => ({}) },
        quizzes: { type: permissionActions, default: () => ({}) },
        students: { type: permissionActions, default: () => ({}) }
    }
}, { timestamps: true });

const AdminModel = mongoose.model("Admin",adminSchema)

export default AdminModel
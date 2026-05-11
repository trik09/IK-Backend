import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

function genToken() {
  const token = jwt.sign(
    { id: "697b13b81c468af778671311" },
    process.env.JWT_SECRET || "asdfgctyrusdgdjsiwsos"
  );
  console.log("TOKEN:", token);
}

genToken();

/**
 * Insert user1–user100 for Arena load tests into the DB from Qcfy-BackEnd/.env (MONGODB_URI).
 *
 * Create:  node scripts/seedLoadTestUsers.js
 * Revert:  node scripts/seedLoadTestUsers.js --revert
 *
 * Only documents with email *@loadtest.qcfy.local are created/deleted.
 * Existing real accounts (same username, different email) are skipped, not overwritten.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/UserSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const COUNT = 100;
const PASSWORD = "user@123";
const EMAIL_DOMAIN = "loadtest.qcfy.local";
const MANIFEST_PATH = path.join(__dirname, ".loadtest-users.manifest.json");

function loadTestEmail(i) {
  return `user${i}@${EMAIL_DOMAIN}`;
}

function mongoHost(uri) {
  try {
    return new URL(uri.replace("mongodb+srv://", "https://")).host;
  } catch {
    return "(unparsed)";
  }
}

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing in Qcfy-BackEnd/.env");
  }
  console.log(`Connecting to Mongo host: ${mongoHost(uri)}`);
  await mongoose.connect(uri);
}

async function seed() {
  await connect();
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  const created = [];
  let skipped = 0;

  for (let i = 1; i <= COUNT; i++) {
    const username = `user${i}`;
    const email = loadTestEmail(i);
    const name = `LoadTest User ${i}`;

    const existingEmail = await User.findOne({ email }).select("_id").lean();
    if (existingEmail) {
      skipped += 1;
      continue;
    }

    const existingUsername = await User.findOne({ username }).select("_id email").lean();
    if (existingUsername) {
      if (existingUsername.email === email) {
        skipped += 1;
        continue;
      }
      console.log(`Skip ${username}: username already used by ${existingUsername.email}`);
      skipped += 1;
      continue;
    }

    const doc = await User.create({
      name,
      email,
      username,
      password: hashedPassword,
      rating: 1200,
      wins: 0,
      losses: 0,
      draws: 0,
    });
    created.push({ _id: String(doc._id), username, email });
  }

  const prev = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : { users: [] };
  const byId = new Map(prev.users.map((u) => [u._id, u]));
  for (const u of created) byId.set(u._id, u);

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        emailDomain: EMAIL_DOMAIN,
        users: Array.from(byId.values()),
      },
      null,
      2
    )
  );

  console.log(`Created ${created.length} load-test users (skipped ${skipped}).`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log("Revert with: node scripts/seedLoadTestUsers.js --revert");
}

async function revert() {
  await connect();

  const byEmail = await User.deleteMany({
    email: { $regex: `@${EMAIL_DOMAIN.replace(/\./g, "\\.")}$` },
  });

  let byManifest = { deletedCount: 0 };
  if (fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const ids = (manifest.users || []).map((u) => u._id).filter(Boolean);
    if (ids.length) {
      byManifest = await User.deleteMany({ _id: { $in: ids } });
    }
    fs.unlinkSync(MANIFEST_PATH);
  }

  console.log(
    `Removed load-test users: ${byEmail.deletedCount} by email domain, ${byManifest.deletedCount} extra by manifest ids.`
  );
}

const revertFlag = process.argv.includes("--revert");

(revertFlag ? revert() : seed())
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err.message || err);
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exit(1);
  });

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const SuperAdmin = require("./models/SuperAdmin");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const email = "devnity10@gmail.com";       // ⬅️ apna email daal
  const password = "EkStrongPassword123!";       // ⬅️ apna strong password daal

  const existing = await SuperAdmin.findOne({ email });
  if (existing) {
    console.log("Already exists!");
    process.exit(0);
  }

  const hashed = await bcrypt.hash(password, 10);
  await SuperAdmin.create({ email, password: hashed, name: "Nitin" });
  console.log("Super admin created ✅");
  process.exit(0);
}

run();
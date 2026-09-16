require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const SuperAdmin = require("./models/SuperAdmin");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const email = "devnity10@gmail.com";       // ⬅️ apna email daal
  const password = "draftbillsuperadmin123";       // ⬅️ apna strong password daal

  const hashed = await bcrypt.hash(password, 10);

  const existing = await SuperAdmin.findOne({ email });

  if (existing) {
    existing.password = hashed;
    await existing.save();
    console.log("✅ Password updated for existing super admin:", email);
  } else {
    await SuperAdmin.create({ email, password: hashed, name: "Nitin" });
    console.log("✅ Super admin created:", email);
  }

  process.exit(0);
}

run();
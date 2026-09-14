// ── ONE-TIME MIGRATION SCRIPT ───────────────────────────────────────────
// Purpose: purane Invoice documents jinme shopId missing hai, unme
// sahi shopId set karta hai. Ek hi baar chalana hai, fir isko delete
// kar sakte ho.
//
// Usage:
//   1. Apna shopId neeche SHOP_ID variable me daalo
//   2. Terminal me project folder ke andar jaake chalao:
//        node migrate-invoices.js
//   3. Confirm hone ke baad ye file delete kar do

require("dotenv").config();
const mongoose = require("mongoose");
const Invoice = require("./models/Invoice");

// ⚠️ APNA SHOPID YAHAN DAALO (Order document se copy kiya hua) ──────────
const SHOP_ID = "shop_1ce487bcfb";

async function migrate() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI .env me nahi mila");
    process.exit(1);
  }
  if (SHOP_ID === "PASTE_YOUR_SHOP_ID_HERE") {
    console.error("❌ Pehle SHOP_ID variable me apna asli shopId daalo");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB se connect ho gaya");

  // Sirf un invoices ko update karo jinme shopId set nahi hai
  const result = await Invoice.updateMany(
    { shopId: { $exists: false } },
    { $set: { shopId: SHOP_ID } }
  );

  console.log(`✅ ${result.modifiedCount} purane invoices update ho gaye (shopId = ${SHOP_ID})`);

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration fail hui:", err.message);
  process.exit(1);
});
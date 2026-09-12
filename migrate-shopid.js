require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("./models/Product");
const Order = require("./models/Order");
const Shop = require("./models/Shop");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  // ⬇️ Apni ASLI/pehli shop ka shopId yahan daal — jiske paas yeh purana
  // data (products/orders) belong karta hai. Shop model mein "shopId" field
  // dekh ke copy kar (MongoDB Atlas mein shops collection khol ke).
 const TARGET_SHOP_ID = "shop_1ce487bcfb"; // ⬅️ YAHAN APNA SAHI shopId DAAL

  const shop = await Shop.findOne({ shopId: TARGET_SHOP_ID });
  if (!shop) {
    console.log("❌ Yeh shopId nahi mila. Sahi shopId daal ke dobara chala.");
    process.exit(1);
  }

  const productResult = await Product.updateMany(
    { shopId: { $exists: false } },
    { $set: { shopId: TARGET_SHOP_ID } }
  );
  console.log(`✅ ${productResult.modifiedCount} products migrated to ${TARGET_SHOP_ID}`);

  const orderResult = await Order.updateMany(
    { shopId: { $exists: false } },
    { $set: { shopId: TARGET_SHOP_ID } }
  );
  console.log(`✅ ${orderResult.modifiedCount} orders migrated to ${TARGET_SHOP_ID}`);

  process.exit(0);
}

run();
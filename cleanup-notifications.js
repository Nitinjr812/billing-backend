require("dotenv").config();
const mongoose = require("mongoose");
const Notification = require("./models/Notification");
const Product = require("./models/Product");

async function cleanup() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected. Scanning notifications...");

  const notifs = await Notification.find({
    type: { $in: ["outOfStock", "lowStock", "slowMoving"] },
    productId: { $ne: null },
  }).lean();

  let deletedCount = 0;

  for (const n of notifs) {
    const belongsToShop = await Product.exists({
      shopId: n.shopId,
      productId: n.productId,
    });

    if (!belongsToShop) {
      await Notification.deleteOne({ _id: n._id });
      deletedCount++;
      console.log(`Deleted leaked notification: shop=${n.shopId} product=${n.productId} type=${n.type}`);
    }
  }

  console.log(`\nDone. Checked ${notifs.length}, deleted ${deletedCount} leaked notifications.`);
  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
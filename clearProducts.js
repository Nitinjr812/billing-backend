// clearProducts.js
const mongoose = require("mongoose");
const Product = require("./models/Product");

mongoose.connect("YOUR_MONGO_URI").then(async () => {
  await Product.deleteMany({});
  console.log("✅ Saare dummy products delete ho gaye");
  process.exit();
});
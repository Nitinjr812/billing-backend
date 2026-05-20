// seed.js — node seed.js
const mongoose = require("mongoose");
require("dotenv").config();
const Order = require("./models/Order");
const Product = require("./models/Product");

mongoose.connect(process.env.MONGO_URI).then(async () => {
  await Order.deleteMany();
  await Product.deleteMany();

  await Product.insertMany([
    { productId: "P001", name: "Prod-Alpha", stock: 420, price: 1200, category: "Electronics", growthPercent: 12 },
    { productId: "P002", name: "Prod-Beta",  stock: 280, price: 850,  category: "Apparel",     growthPercent: 8  },
    { productId: "P003", name: "Prod-Gamma", stock: 610, price: 3400, category: "Electronics", growthPercent: 18 },
    { productId: "P004", name: "Prod-Delta", stock: 42,  price: 560,  category: "Home Goods",  growthPercent: 5  },
    { productId: "P005", name: "Prod-Sigma", stock: 380, price: 1750, category: "Apparel",     growthPercent: 22 },
    { productId: "P006", name: "Prod-Omega", stock: 0,   price: 2200, category: "Electronics", growthPercent: 0  },
    { productId: "P007", name: "Prod-Zeta",  stock: 28,  price: 990,  category: "Home Goods",  growthPercent: 3  },
  ]);

  await Order.insertMany([
    { orderId: "ORD-001", customer: "Arjun Sharma",  amount: 12400, status: "Delivered",  product: "Prod-Alpha", date: new Date("2024-05-07") },
    { orderId: "ORD-002", customer: "Priya Verma",   amount: 8750,  status: "Pending",    product: "Prod-Beta",  date: new Date("2024-05-06") },
    { orderId: "ORD-003", customer: "Ravi Patel",    amount: 21000, status: "Delivered",  product: "Prod-Gamma", date: new Date("2024-05-05") },
    { orderId: "ORD-004", customer: "Sneha Mehta",   amount: 5300,  status: "Cancelled",  product: "Prod-Delta", date: new Date("2024-05-02") },
    { orderId: "ORD-005", customer: "Vikram Das",    amount: 9800,  status: "Delivered",  product: "Prod-Sigma", date: new Date("2024-05-01") },
    { orderId: "ORD-006", customer: "Neha Joshi",    amount: 34200, status: "Processing", product: "Prod-Gamma", date: new Date("2024-05-08") },
    { orderId: "ORD-007", customer: "Karan Malhotra",amount: 18600, status: "Delivered",  product: "Prod-Alpha", date: new Date("2024-05-09") },
  ]);

  console.log("✅ Seed data inserted!");
  process.exit();
});
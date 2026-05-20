const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const ordersRouter = require("./routes/orders");
const productsRouter = require("./routes/products");

const app = express();

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected 🚀"))
  .catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.json({ message: "Billing Backend Running 🚀" });
});

// Routes
app.use("/api/orders", ordersRouter);
app.use("/api/products", productsRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
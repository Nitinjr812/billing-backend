const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const chatRouter = require("./routes/chat");
const ordersRouter = require("./routes/orders");
const productsRouter = require("./routes/products");
const reportsRouter = require("./routes/reports");
const reportChatRouter = require("./routes/reportChat");
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
app.use("/api/chat", chatRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/report-chat", reportChatRouter);


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
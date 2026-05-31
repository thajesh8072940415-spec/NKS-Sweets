const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ── MongoDB Connection ────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || "YOUR_MONGODB_URI_HERE", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.log("❌ MongoDB Error:", err));

// ══════════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════════════

// Category Schema
const CategorySchema = new mongoose.Schema({
  label:  { type: String, required: true },
  emoji:  { type: String, default: "🛍️" },
  color:  { type: String, default: "#c9972b" },
  order:  { type: Number, default: 0 },
}, { timestamps: true });
const Category = mongoose.model("Category", CategorySchema);

// Product Schema
const ProductSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  ta:       { type: String, default: "" },   // Tamil name
  price:    { type: Number, required: true },
  unit:     { type: String, enum: ["kg", "pcs"], default: "kg" },
  catId:    { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
}, { timestamps: true });
const Product = mongoose.model("Product", ProductSchema);

// Bill Schema
const BillSchema = new mongoose.Schema({
  billId:    { type: String, required: true, unique: true }, // NKS-YYYYMMDD-XXXX
  items: [{
    name:       String,
    ta:         String,
    catId:      String,
    displayQty: String,
    total:      Number,
  }],
  total:     { type: Number, required: true },
  itemCount: { type: Number, default: 0 },
}, { timestamps: true });
const Bill = mongoose.model("Bill", BillSchema);

// ── Bill ID generator (server-side) ──────────────────────────────────────────
function genBillId() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
  const uid  = Math.floor(1000 + Math.random() * 9000); // 4-digit
  return `NKS-${date}-${uid}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
app.get("/api/categories", async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1, createdAt: 1 });
    res.json({ success: true, data: cats });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/categories", async (req, res) => {
  try {
    const { label, emoji, color } = req.body;
    if (!label) return res.status(400).json({ success: false, message: "Label required" });
    const count = await Category.countDocuments();
    const cat = new Category({ label, emoji: emoji || "🛍️", color: color || "#c9972b", order: count });
    await cat.save();
    res.json({ success: true, data: cat });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete("/api/categories/:id", async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    await Product.deleteMany({ catId: req.params.id });
    res.json({ success: true, message: "Category and its products deleted" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCT ROUTES
// ══════════════════════════════════════════════════════════════════════════════
app.get("/api/products", async (req, res) => {
  try {
    const prods = await Product.find().populate("catId");
    // group by catId
    const grouped = {};
    prods.forEach(p => {
      const cid = p.catId?._id?.toString() || p.catId?.toString();
      if (!grouped[cid]) grouped[cid] = [];
      grouped[cid].push({
        _id: p._id, id: p._id.toString(),
        name: p.name, ta: p.ta,
        price: p.price, unit: p.unit,
        catId: cid,
      });
    });
    res.json({ success: true, data: grouped });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, ta, price, unit, catId } = req.body;
    if (!name || !price || !catId) return res.status(400).json({ success: false, message: "name, price, catId required" });
    const prod = new Product({ name, ta: ta||"", price: parseFloat(price), unit: unit||"kg", catId });
    await prod.save();
    res.json({ success: true, data: prod });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Product deleted" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// BILL ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Create bill
app.post("/api/bills", async (req, res) => {
  try {
    const { items, total } = req.body;
    if (!items?.length) return res.status(400).json({ success: false, message: "Items required" });
    const billId = genBillId();
    const bill = new Bill({ billId, items, total, itemCount: items.length });
    await bill.save();
    res.json({ success: true, data: bill });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Get all bills (for analytics/history)
app.get("/api/bills", async (req, res) => {
  try {
    const { filter } = req.query; // today | week | month | all
    let dateFilter = {};
    const now = new Date();
    if (filter === "today") {
      const start = new Date(now); start.setHours(0,0,0,0);
      dateFilter = { createdAt: { $gte: start } };
    } else if (filter === "week") {
      const start = new Date(now); start.setDate(start.getDate()-7);
      dateFilter = { createdAt: { $gte: start } };
    } else if (filter === "month") {
      const start = new Date(now); start.setDate(start.getDate()-30);
      dateFilter = { createdAt: { $gte: start } };
    }
    const bills = await Bill.find(dateFilter).sort({ createdAt: -1 });
    res.json({ success: true, data: bills });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Get single bill by full ID (NKS-YYYYMMDD-XXXX)
app.get("/api/bills/:billId", async (req, res) => {
  try {
    const bill = await Bill.findOne({ billId: req.params.billId });
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
    res.json({ success: true, data: bill });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Customer lookup: provide last-4 digits + today's date → return bill
// GET /api/bills/lookup/3456  → searches NKS-YYYYMMDD-3456 for today
app.get("/api/bills/lookup/:last4", async (req, res) => {
  try {
    const { last4 } = req.params;
    const { date } = req.query; // optional: YYYYMMDD, defaults to today
    const d = date || (() => {
      const n = new Date();
      const p = x => String(x).padStart(2,"0");
      return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}`;
    })();
    const billId = `NKS-${d}-${last4}`;
    const bill = await Bill.findOne({ billId });
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
    res.json({ success: true, data: bill });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Analytics: daily sales for last N days
app.get("/api/analytics/daily", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const result = [];
    const now = new Date();
    for (let i = days-1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate()-i);
      const start = new Date(d); start.setHours(0,0,0,0);
      const end   = new Date(d); end.setHours(23,59,59,999);
      const bills = await Bill.find({ createdAt: { $gte: start, $lte: end } });
      const p = n => String(n).padStart(2,"0");
      result.push({
        date: `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`,
        label: d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"}),
        total: bills.reduce((s,b)=>s+b.total,0),
        count: bills.length,
      });
    }
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.listen(5000, () => console.log("🚀 NKS Billing Server on port 5000"));

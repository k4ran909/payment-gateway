require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ── JSON file storage ──
const DATA_DIR = path.join(__dirname, "data");
const TXN_FILE = path.join(DATA_DIR, "transactions.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TXN_FILE)) fs.writeFileSync(TXN_FILE, "[]");

function readTxns() {
    try { return JSON.parse(fs.readFileSync(TXN_FILE, "utf8")); }
    catch { return []; }
}

function writeTxns(txns) {
    fs.writeFileSync(TXN_FILE, JSON.stringify(txns, null, 2));
}

// ═══════════════════════════════════════
//  ORDER ENDPOINTS
// ═══════════════════════════════════════

// 1. Create Order
app.post("/api/create-order", (req, res) => {
    const { amount, note } = req.body;
    if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
    }

    const orderId = "ORD_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const txns = readTxns();

    txns.unshift({
        orderId,
        amount: Number(amount),
        note: note || "",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });

    if (txns.length > 500) txns.length = 500;
    writeTxns(txns);

    res.json({ success: true, orderId, amount: Number(amount) });
});

// 2. Check order status (customer polls this)
app.get("/api/check-status/:orderId", (req, res) => {
    const txns = readTxns();
    const txn = txns.find(t => t.orderId === req.params.orderId);
    if (!txn) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, orderId: txn.orderId, status: txn.status, amount: txn.amount });
});

// 3. Customer confirms payment with UTR (AUTO-CONFIRM) 🚀
app.post("/api/mark-paid/:orderId", (req, res) => {
    const { utr } = req.body;
    const txns = readTxns();
    const txn = txns.find(t => t.orderId === req.params.orderId);

    if (!txn) return res.status(404).json({ error: "Order not found" });

    if (txn.status === "confirmed") {
        return res.json({ success: true, message: "Already confirmed" });
    }

    // Validate UTR format (12 digits)
    const cleanUtr = (utr || "").replace(/\s/g, "");
    if (cleanUtr && /^\d{12}$/.test(cleanUtr)) {
        txn.upiRef = cleanUtr;
    }

    // Auto-confirm the order
    txn.status = "confirmed";
    txn.confirmedBy = cleanUtr ? "customer-utr" : "customer-self";
    txn.confirmedAt = new Date().toISOString();
    txn.updatedAt = new Date().toISOString();
    writeTxns(txns);

    console.log(`✅ Auto-confirmed: ${txn.orderId} (₹${txn.amount}) UTR: ${cleanUtr || "N/A"}`);
    res.json({ success: true, status: "confirmed", orderId: txn.orderId });
});

// 4. Admin manually confirms/rejects (fallback)
app.post("/api/update-status/:orderId", (req, res) => {
    const { status } = req.body;
    if (!["confirmed", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Status must be 'confirmed' or 'rejected'" });
    }
    const txns = readTxns();
    const txn = txns.find(t => t.orderId === req.params.orderId);
    if (!txn) return res.status(404).json({ error: "Order not found" });
    txn.status = status;
    txn.updatedAt = new Date().toISOString();
    writeTxns(txns);
    res.json({ success: true, status: txn.status });
});

// 5. Get all transactions
app.get("/api/transactions", (req, res) => {
    res.json({ success: true, transactions: readTxns() });
});

// 6. Delete one
app.delete("/api/transactions/:orderId", (req, res) => {
    const txns = readTxns().filter(t => t.orderId !== req.params.orderId);
    writeTxns(txns);
    res.json({ success: true });
});

// 7. Clear all
app.delete("/api/transactions", (req, res) => {
    writeTxns([]);
    res.json({ success: true });
});

// ── Start server ──
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`\n🚀 PayQR Server running on http://localhost:${PORT}`);
    console.log(`📂 Data stored in: ${DATA_DIR}`);
    console.log(`🔑 No merchant account needed!\n`);
});

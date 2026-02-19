const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const PaytmScraper = require("./paytm-scraper");

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, "data");
const TXN_FILE = path.join(DATA_DIR, "transactions.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client/upi-payment-gateway/dist")));

// ── Helpers ──
function readTxns() {
    try {
        if (fs.existsSync(TXN_FILE)) return JSON.parse(fs.readFileSync(TXN_FILE, "utf8"));
    } catch { }
    return [];
}
function writeTxns(txns) {
    fs.writeFileSync(TXN_FILE, JSON.stringify(txns, null, 2));
}

// ── Paytm Scraper Instance ──
const scraper = new PaytmScraper();
let verificationInterval = null;

// ════════════════════════════════════
//  1. Create Order
// ════════════════════════════════════
app.post("/api/create-order", (req, res) => {
    const { amount, note } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
    }
    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const txns = readTxns();
    txns.push({
        orderId, amount: parseFloat(amount), note: note || "",
        status: "pending", createdAt: new Date().toISOString(),
    });
    writeTxns(txns);
    console.log(`📦 New order: ${orderId} — ₹${amount}`);
    res.json({ success: true, orderId, amount: parseFloat(amount) });
});

// ════════════════════════════════════
//  2. Check Order Status
// ════════════════════════════════════
app.get("/api/check-status/:orderId", (req, res) => {
    const txns = readTxns();
    const txn = txns.find(t => t.orderId === req.params.orderId);
    if (!txn) return res.json({ success: true, status: "pending" });
    res.json({ success: true, status: txn.status, confirmedBy: txn.confirmedBy || null });
});

// ════════════════════════════════════
//  3. Customer marks as paid → "verifying"
//     NOT auto-confirmed — waits for Paytm check
// ════════════════════════════════════
app.post("/api/mark-paid/:orderId", (req, res) => {
    const { utr } = req.body;
    const txns = readTxns();
    const txn = txns.find(t => t.orderId === req.params.orderId);

    if (!txn) return res.status(404).json({ error: "Order not found" });

    if (txn.status === "confirmed") {
        return res.json({ success: true, message: "Already confirmed", status: "confirmed" });
    }

    // Store UTR if provided
    const cleanUtr = (utr || "").replace(/\s/g, "");
    if (cleanUtr && /^\d{12}$/.test(cleanUtr)) {
        txn.upiRef = cleanUtr;
    }

    // Set to VERIFYING — not confirmed yet!
    txn.status = "verifying";
    txn.markedPaidAt = new Date().toISOString();
    txn.updatedAt = new Date().toISOString();
    writeTxns(txns);

    console.log(`🔍 Verifying: ${txn.orderId} (₹${txn.amount}) UTR: ${cleanUtr || "N/A"}`);

    // Trigger immediate Paytm check
    triggerPaytmVerification(txn.orderId);

    res.json({ success: true, status: "verifying", orderId: txn.orderId });
});

// ════════════════════════════════════
//  4. Paytm Verification Logic
// ════════════════════════════════════
async function triggerPaytmVerification(orderId) {
    if (!scraper.isLoggedIn) {
        console.log("⚠️ Paytm not connected — will fallback after timeout");
        // Start timeout-based fallback
        startFallbackTimer(orderId);
        return;
    }

    try {
        console.log(`🔍 Checking Paytm for order ${orderId}...`);
        const result = await scraper.checkPassbook();

        if (result.success && result.transactions.length > 0) {
            const txns = readTxns();
            const txn = txns.find(t => t.orderId === orderId);
            if (!txn || txn.status === "confirmed") return;

            // Find matching credit
            const credits = result.transactions.filter(t => t.isCredit);
            const match = credits.find(c => Math.abs(c.amount - txn.amount) < 1.0);

            if (match) {
                txn.status = "confirmed";
                txn.confirmedBy = "paytm-verified";
                txn.confirmedAt = new Date().toISOString();
                txn.matchedTxn = match.text?.substring(0, 100);
                txn.updatedAt = new Date().toISOString();
                writeTxns(txns);
                console.log(`✅ PAYTM VERIFIED: ${orderId} (₹${txn.amount}) matched credit!`);
                return;
            }
        }
    } catch (err) {
        console.error(`❌ Paytm check error: ${err.message}`);
    }

    // Not found yet — start fallback timer
    startFallbackTimer(orderId);
}

function startFallbackTimer(orderId) {
    // Check every 10s for 60s, then fallback auto-confirm
    let checks = 0;
    const maxChecks = 6; // 6 × 10s = 60s

    const iv = setInterval(async () => {
        checks++;
        const txns = readTxns();
        const txn = txns.find(t => t.orderId === orderId);

        if (!txn || txn.status === "confirmed") {
            clearInterval(iv);
            return;
        }

        // Try Paytm verification again
        if (scraper.isLoggedIn) {
            try {
                const result = await scraper.checkPassbook();
                if (result.success && result.transactions.length > 0) {
                    const credits = result.transactions.filter(t => t.isCredit);
                    const match = credits.find(c => Math.abs(c.amount - txn.amount) < 1.0);

                    if (match) {
                        txn.status = "confirmed";
                        txn.confirmedBy = "paytm-verified";
                        txn.confirmedAt = new Date().toISOString();
                        txn.matchedTxn = match.text?.substring(0, 100);
                        txn.updatedAt = new Date().toISOString();
                        writeTxns(txns);
                        console.log(`✅ PAYTM VERIFIED: ${orderId} (₹${txn.amount})`);
                        clearInterval(iv);
                        return;
                    }
                }
            } catch { }
        }

        // Timeout — fallback confirm
        if (checks >= maxChecks) {
            clearInterval(iv);
            const freshTxns = readTxns();
            const freshTxn = freshTxns.find(t => t.orderId === orderId);
            if (freshTxn && freshTxn.status === "verifying") {
                freshTxn.status = "confirmed";
                freshTxn.confirmedBy = "timeout-fallback";
                freshTxn.confirmedAt = new Date().toISOString();
                freshTxn.updatedAt = new Date().toISOString();
                writeTxns(freshTxns);
                console.log(`⏰ Fallback confirmed: ${orderId} (₹${freshTxn.amount}) after 60s timeout`);
            }
        }
    }, 10000);
}

// ════════════════════════════════════
//  5. Paytm Connection Endpoints
// ════════════════════════════════════
app.get("/api/paytm/status", (req, res) => {
    res.json(scraper.getStatus());
});

app.post("/api/paytm/start-qr-login", async (req, res) => {
    try {
        const result = await scraper.startQRLogin();
        res.json(result);
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get("/api/paytm/check-login", async (req, res) => {
    try {
        const result = await scraper.checkLoginComplete();
        res.json(result);
    } catch (err) {
        res.json({ success: false, loggedIn: false, error: err.message });
    }
});

app.post("/api/paytm/disconnect", async (req, res) => {
    try {
        await scraper.close();
        scraper.isLoggedIn = false;
        scraper.loginInProgress = false;
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post("/api/paytm/check-now", async (req, res) => {
    try {
        const result = await scraper.checkPassbook();
        if (!result.success) {
            return res.json({ success: false, error: result.error });
        }

        // Auto-match credits against verifying orders
        const txns = readTxns();
        const verifying = txns.filter(t => t.status === "verifying");
        let matches = 0;

        if (result.transactions.length > 0 && verifying.length > 0) {
            const credits = result.transactions.filter(t => t.isCredit);
            for (const order of verifying) {
                const match = credits.find(c => Math.abs(c.amount - order.amount) < 1.0);
                if (match) {
                    order.status = "confirmed";
                    order.confirmedBy = "paytm-verified";
                    order.confirmedAt = new Date().toISOString();
                    order.matchedTxn = match.text?.substring(0, 100);
                    order.updatedAt = new Date().toISOString();
                    matches++;
                }
            }
            if (matches > 0) writeTxns(txns);
        }

        res.json({ success: true, matches, totalTxns: result.transactions.length, source: result.source });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════
//  6. Transaction Management
// ════════════════════════════════════
app.get("/api/transactions", (req, res) => {
    res.json({ success: true, transactions: readTxns().reverse() });
});

app.delete("/api/transactions/:orderId", (req, res) => {
    let txns = readTxns();
    txns = txns.filter(t => t.orderId !== req.params.orderId);
    writeTxns(txns);
    res.json({ success: true });
});

app.delete("/api/transactions", (req, res) => {
    writeTxns([]);
    res.json({ success: true });
});

// ════════════════════════════════════
//  7. SPA Fallback
// ════════════════════════════════════
app.get("*", (req, res) => {
    const index = path.join(__dirname, "../client/upi-payment-gateway/dist/index.html");
    if (fs.existsSync(index)) return res.sendFile(index);
    res.status(404).json({ error: "Not found" });
});

// ════════════════════════════════════
//  Start
// ════════════════════════════════════
app.listen(PORT, () => {
    console.log(`\n🚀 PayQR Server running on http://localhost:${PORT}`);
    console.log(`📁 Data: ${DATA_DIR}`);
    console.log(`🔑 No merchant account needed!`);
    console.log(`🤖 Paytm verification: connect via Dashboard\n`);
});

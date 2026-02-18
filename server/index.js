require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const PaytmScraper = require("./paytm-scraper");

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

// ── Paytm Scraper ──
const scraper = new PaytmScraper();
let pollingInterval = null;

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

// 3. Admin manually confirms/rejects (fallback)
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

// 4. Get all transactions
app.get("/api/transactions", (req, res) => {
    res.json({ success: true, transactions: readTxns() });
});

// 5. Delete one
app.delete("/api/transactions/:orderId", (req, res) => {
    const txns = readTxns().filter(t => t.orderId !== req.params.orderId);
    writeTxns(txns);
    res.json({ success: true });
});

// 6. Clear all
app.delete("/api/transactions", (req, res) => {
    writeTxns([]);
    res.json({ success: true });
});

// ═══════════════════════════════════════
//  PAYTM SCRAPER ENDPOINTS
// ═══════════════════════════════════════

// 7. Start Paytm QR login — returns QR image to display
app.post("/api/paytm/start-qr-login", async (req, res) => {
    console.log("📱 Starting Paytm QR login...");
    try {
        const result = await scraper.startQRLogin();
        res.json(result);
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// 8. Check if QR was scanned (poll this)
app.get("/api/paytm/check-login", async (req, res) => {
    try {
        const result = await scraper.checkLoginComplete();
        if (result.loggedIn) {
            startPassbookPolling();
        }
        res.json(result);
    } catch (err) {
        res.json({ success: false, loggedIn: false, error: err.message });
    }
});

// 9. Get current QR code (refresh)
app.get("/api/paytm/get-qr", async (req, res) => {
    try {
        const result = await scraper.getQRCode();
        res.json(result);
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// 9. Get Paytm session status
app.get("/api/paytm/status", (req, res) => {
    const status = scraper.getStatus();
    res.json({ success: true, ...status });
});

// 10. Manually trigger a passbook check
app.post("/api/paytm/check-now", async (req, res) => {
    console.log("🔍 Manual passbook check...");
    const result = await checkAndMatchPassbook();
    res.json(result);
});

// 11. SMS Webhook — The Reliable Way 🚀
// App: "SMS to URL Forwarder" (Android) -> POST to this URL
app.post("/api/paytm/sms-webhook", (req, res) => {
    try {
        const { body, from, content } = req.body; // Adapt based on app's payload
        const msg = body || content || "";

        console.log(`📩 Received SMS from ${from}: ${msg}`);

        // 1. Extract Amount (Matches: Rs. 100, INR 100, ₹100.00)
        const amtMatch = msg.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{2})?)/i);

        // 2. Extract 12-digit Ref/UTR (Matches: UPI Ref 123..., UTR: 123...)
        const refMatch = msg.match(/(?:UPI|Ref\.?|UTR|No\.?|Id)\s*[:\-]?\s*(\d{12})/i);

        if (amtMatch && refMatch) {
            const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
            const upiRef = refMatch[1];

            console.log(`✅ Parsed: ₹${amount} | Ref: ${upiRef}`);

            // Find matching pending order
            const txns = readTxns();
            const order = txns.find(t =>
                t.status === 'pending' &&
                Math.abs(t.amount - amount) < 1.0
            );

            if (order) {
                console.log(`🎉 MATCH FOUND! Auto-confirming Order ${order.orderId}`);
                order.status = 'confirmed';
                order.confirmedBy = 'sms-webhook';
                order.upiRef = upiRef;
                order.confirmedAt = new Date().toISOString();
                writeTxns(txns);
                return res.json({ success: true, message: "Payment auto-confirmed" });
            }
        } else {
            console.log("⚠️ Could not parse payment details from SMS");
        }

        res.json({ success: true, message: "SMS received" });
    } catch (err) {
        console.error("Webhook Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 11. Disconnect Paytm
app.post("/api/paytm/disconnect", async (req, res) => {
    stopPassbookPolling();
    await scraper.close();
    scraper.isLoggedIn = false;
    scraper.loginInProgress = false;
    scraper.saveSession({ status: "disconnected", disconnectedAt: new Date().toISOString() });

    // Clean up cookie files
    const cookiesFile = path.join(DATA_DIR, "paytm-cookies.json");
    if (fs.existsSync(cookiesFile)) fs.unlinkSync(cookiesFile);

    console.log("🔌 Paytm disconnected");
    res.json({ success: true, message: "Paytm disconnected" });
});

// ═══════════════════════════════════════
//  BACKGROUND PASSBOOK POLLING
// ═══════════════════════════════════════

async function checkAndMatchPassbook() {
    try {
        const passbookResult = await scraper.checkPassbook();

        if (!passbookResult.success) {
            console.log("❌ Passbook check failed:", passbookResult.error);
            return passbookResult;
        }

        const credits = passbookResult.transactions.filter(t => t.isCredit);
        if (credits.length === 0) {
            return { success: true, matches: 0, message: "No credits found" };
        }

        // Get pending orders
        const txns = readTxns();
        const pending = txns.filter(t => t.status === "pending");

        if (pending.length === 0) {
            return { success: true, matches: 0, message: "No pending orders" };
        }

        // Match credits to pending orders
        const matches = scraper.matchPayments(credits, pending);

        if (matches.length > 0) {
            // Auto-confirm matched orders
            for (const match of matches) {
                const txn = txns.find(t => t.orderId === match.orderId);
                if (txn) {
                    txn.status = "confirmed";
                    txn.confirmedBy = "paytm-auto";
                    txn.matchedTransaction = match.matchedTransaction;
                    txn.updatedAt = new Date().toISOString();
                    console.log(`✅ Auto-confirmed: ${match.orderId} (₹${match.amount})`);
                }
            }
            writeTxns(txns);
        }

        return {
            success: true,
            matches: matches.length,
            totalCredits: credits.length,
            checkedAt: passbookResult.checkedAt,
        };
    } catch (err) {
        console.error("Passbook polling error:", err.message);
        return { success: false, error: err.message };
    }
}

function startPassbookPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    console.log("🔄 Started passbook polling (every 10s)");

    pollingInterval = setInterval(async () => {
        if (!scraper.isLoggedIn) {
            console.log("⚠️ Paytm not logged in, stopping polling");
            stopPassbookPolling();
            return;
        }

        const txns = readTxns();
        const hasPending = txns.some(t => t.status === "pending");

        if (hasPending) {
            await checkAndMatchPassbook();
        }
    }, 10000); // Every 10 seconds
}

function stopPassbookPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log("⏹️ Stopped passbook polling");
    }
}

// ── On startup, check if we have a saved session ──
(async () => {
    const session = scraper.loadSession();
    if (session && session.status === "connected") {
        console.log("📦 Found saved session, checking if still valid...");
        const isValid = await scraper.checkSession();
        if (isValid) {
            console.log("✅ Saved Paytm session is still valid!");
            startPassbookPolling();
        } else {
            console.log("⚠️ Saved session expired, login again from dashboard");
        }
    }
})();

// ── Start server ──
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`\n🚀 PayQR Server running on http://localhost:${PORT}`);
    console.log(`📂 Data stored in: ${DATA_DIR}`);
    console.log(`🔑 No merchant account needed!\n`);
});

// Cleanup on exit
process.on("SIGINT", async () => {
    stopPassbookPolling();
    await scraper.close();
    process.exit(0);
});

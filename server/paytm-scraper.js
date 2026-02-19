const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const COOKIES_FILE = path.join(DATA_DIR, "paytm-cookies.json");
const SESSION_FILE = path.join(DATA_DIR, "paytm-session.json");

const PAYTM_LOGIN_URL = "https://paytm.com/login";
const PAYTM_HOME = "https://paytm.com";

// Known Paytm internal API endpoints for passbook/transaction history
const PAYTM_API_URLS = [
    "https://paytm.com/papi/v1/passbook",
    "https://paytm.com/papi/v2/passbook",
    "https://paytm.com/papi/passbook/txn-history",
    "https://paytm.com/bpay/api/v1/passbook/transaction/list",
    "https://paytm.com/bpay/api/v1/passbook",
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class PaytmScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        this.loginInProgress = false;
        this.lastCheckedTxns = [];
        this.discoveredApiUrls = []; // URLs captured during login/navigation
    }

    // ── Launch browser ──
    async launch() {
        if (this.browser) {
            try { if (this.browser.isConnected()) return; } catch { }
            this.browser = null;
            this.page = null;
        }

        const profileDir = path.join(DATA_DIR, "chrome-profile");
        if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

        // Clean stale lock files
        for (const f of ["lockfile", "SingletonLock"]) {
            try { const p = path.join(profileDir, f); if (fs.existsSync(p)) fs.unlinkSync(p); } catch { }
        }

        this.browser = await puppeteer.launch({
            headless: "new",
            userDataDir: profileDir,
            args: [
                "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
                "--disable-gpu", "--no-first-run", "--disable-extensions",
                "--window-size=1280,800",
            ],
            defaultViewport: { width: 1280, height: 800 },
        });
        this.page = await this.browser.newPage();
        await this.page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        await this.loadCookies();

        // Intercept network to discover Paytm's internal API endpoints
        this.page.on('response', (response) => {
            const url = response.url();
            if (url.includes('passbook') || url.includes('txn') || url.includes('transaction')) {
                if (!this.discoveredApiUrls.includes(url)) {
                    this.discoveredApiUrls.push(url);
                    console.log(`🔍 Discovered API: ${url}`);
                }
            }
        });
    }

    // ── Cookie persistence ──
    async saveCookies() {
        try {
            const cookies = await this.page.cookies();
            fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        } catch (err) {
            console.error("Failed to save cookies:", err.message);
        }
    }

    async loadCookies() {
        try {
            if (fs.existsSync(COOKIES_FILE)) {
                const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
                if (cookies.length > 0) {
                    await this.page.setCookie(...cookies);
                    console.log(`🍪 Loaded ${cookies.length} saved cookies`);
                }
            }
        } catch (err) {
            console.error("Failed to load cookies:", err.message);
        }
    }

    saveSession(data) {
        try {
            fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error("Failed to save session:", err.message);
        }
    }

    loadSession() {
        try {
            if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        } catch { }
        return null;
    }

    // ── Check if already logged in ──
    async checkSession() {
        try {
            await this.launch();
            await this.page.goto(PAYTM_HOME, { waitUntil: "networkidle2", timeout: 20000 });
            await delay(3000);

            const url = this.page.url();
            const content = await this.page.content();

            if (url.includes("/login") || url.includes("/signin")) {
                this.isLoggedIn = false;
                return false;
            }

            const loggedIn =
                content.includes("passbook") || content.includes("Passbook") ||
                content.includes("logout") || content.includes("Logout") ||
                content.includes("Hi ") || content.includes("profile");

            this.isLoggedIn = loggedIn;
            if (loggedIn) await this.saveCookies();
            return loggedIn;
        } catch (err) {
            console.error("Session check error:", err.message);
            this.isLoggedIn = false;
            return false;
        }
    }

    // ── QR Login ──
    // Step 1: Open login page, extract the QR code image as base64
    async startQRLogin() {
        if (this.loginInProgress) {
            return { success: false, error: "Login already in progress" };
        }
        this.loginInProgress = true;

        try {
            await this.launch();
            await this.page.goto(PAYTM_LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
            await delay(2000);

            const qrResult = await this.extractQR();
            if (qrResult.success) {
                return qrResult;
            }

            return { success: false, error: "Could not find QR code on login page" };
        } catch (err) {
            this.loginInProgress = false;
            return { success: false, error: err.message };
        }
    }

    // Extract QR code image from the login page
    async extractQR() {
        try {
            // Wait for QR to appear
            const qrSelectors = [
                'img[src*="qr"]', 'img[alt*="QR"]', 'img[alt*="qr"]',
                'canvas', '[class*="qr" i] img', '[class*="qr" i] canvas',
                '[data-testid*="qr" i]', 'img[src*="authenticator"]',
            ];

            let qrImage = null;

            for (const selector of qrSelectors) {
                try {
                    const el = await this.page.$(selector);
                    if (el) {
                        const tagName = await el.evaluate(e => e.tagName.toLowerCase());

                        if (tagName === 'canvas') {
                            qrImage = await el.evaluate(canvas => canvas.toDataURL('image/png'));
                        } else if (tagName === 'img') {
                            const src = await el.evaluate(img => img.src);
                            if (src && (src.startsWith('data:') || src.includes('qr'))) {
                                if (src.startsWith('data:')) {
                                    qrImage = src;
                                } else {
                                    qrImage = await el.screenshot({ encoding: 'base64' });
                                    qrImage = `data:image/png;base64,${qrImage}`;
                                }
                            }
                        }

                        if (qrImage) break;
                    }
                } catch { }
            }

            // Fallback: screenshot the QR area
            if (!qrImage) {
                await this.page.screenshot({ path: path.join(DATA_DIR, "login-page.png") });

                try {
                    const qrContainer = await this.page.$('[class*="qr" i], [class*="scan" i], [class*="barcode" i]');
                    if (qrContainer) {
                        const screenshot = await qrContainer.screenshot({ encoding: 'base64' });
                        qrImage = `data:image/png;base64,${screenshot}`;
                    }
                } catch { }
            }

            // Last resort: take full page screenshot
            if (!qrImage) {
                const fullScreenshot = await this.page.screenshot({ encoding: 'base64', fullPage: true });
                qrImage = `data:image/png;base64,${fullScreenshot}`;
            }

            return { success: true, qrImage };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Get current QR (re-extract from page)
    async getQRCode() {
        if (!this.page) return { success: false, error: "No page open" };
        return this.extractQR();
    }

    // Step 2: Check if QR scan completed
    async checkLoginComplete() {
        try {
            if (!this.page) return { success: false, loggedIn: false, error: "No page open" };

            const url = this.page.url();
            const content = await this.page.content();

            await this.page.screenshot({ path: path.join(DATA_DIR, "login-check.png") });

            const stillOnLogin = url.includes("/login") || url.includes("/signin");
            const hasLoggedInIndicators =
                content.includes("passbook") || content.includes("Passbook") ||
                content.includes("logout") || content.includes("Logout") ||
                content.includes("Hi ") || content.includes("Welcome");

            if (!stillOnLogin || hasLoggedInIndicators) {
                this.isLoggedIn = true;
                this.loginInProgress = false;
                await this.saveCookies();
                this.saveSession({
                    loggedInAt: new Date().toISOString(),
                    status: "connected",
                });
                console.log("✅ Paytm QR login successful!");
                return { success: true, loggedIn: true };
            }

            return { success: true, loggedIn: false, message: "Waiting for QR scan..." };
        } catch (err) {
            console.error("Login check error:", err.message);
            return { success: false, loggedIn: false, error: err.message };
        }
    }

    // ═══════════════════════════════════════════════
    //  FIXED: Check passbook WITHOUT navigating away
    // ═══════════════════════════════════════════════
    async checkPassbook() {
        if (!this.isLoggedIn) {
            return { success: false, error: "Not logged in", transactions: [] };
        }

        try {
            await this.launch();

            // Strategy 1: Use page.evaluate to call Paytm's internal APIs
            // This stays on the same page, keeping the session alive
            const allApiUrls = [...this.discoveredApiUrls, ...PAYTM_API_URLS];

            for (const apiUrl of allApiUrls) {
                try {
                    console.log(`🔍 Trying API: ${apiUrl}`);
                    const result = await this.page.evaluate(async (url) => {
                        try {
                            const res = await fetch(url, {
                                method: 'GET',
                                credentials: 'include',
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                },
                            });
                            if (!res.ok) return { ok: false, status: res.status };
                            const data = await res.json();
                            return { ok: true, data };
                        } catch (err) {
                            return { ok: false, error: err.message };
                        }
                    }, apiUrl);

                    if (result.ok && result.data) {
                        console.log(`✅ API returned data from: ${apiUrl}`);
                        const transactions = this.parseApiResponse(result.data);
                        if (transactions.length > 0) {
                            this.lastCheckedTxns = transactions;
                            return { success: true, transactions, source: 'api', checkedAt: new Date().toISOString() };
                        }
                    }
                } catch (err) {
                    console.log(`❌ API failed: ${apiUrl} — ${err.message}`);
                }
            }

            // Strategy 2: Try POST variants with common payloads
            for (const apiUrl of PAYTM_API_URLS) {
                try {
                    const result = await this.page.evaluate(async (url) => {
                        try {
                            const res = await fetch(url, {
                                method: 'POST',
                                credentials: 'include',
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    pageSize: 20,
                                    pageNumber: 0,
                                    type: "CREDIT",
                                }),
                            });
                            if (!res.ok) return { ok: false, status: res.status };
                            const data = await res.json();
                            return { ok: true, data };
                        } catch (err) {
                            return { ok: false, error: err.message };
                        }
                    }, apiUrl);

                    if (result.ok && result.data) {
                        console.log(`✅ POST API returned data from: ${apiUrl}`);
                        const transactions = this.parseApiResponse(result.data);
                        if (transactions.length > 0) {
                            this.lastCheckedTxns = transactions;
                            return { success: true, transactions, source: 'api-post', checkedAt: new Date().toISOString() };
                        }
                    }
                } catch { }
            }

            // Strategy 3: Scrape the current page content for transaction data
            // (Works if the home page shows recent transactions)
            console.log("🔍 Fallback: scraping current page content...");
            const pageTransactions = await this.scrapePageContent();
            if (pageTransactions.length > 0) {
                this.lastCheckedTxns = pageTransactions;
                return { success: true, transactions: pageTransactions, source: 'page-scrape', checkedAt: new Date().toISOString() };
            }

            // Strategy 4: Navigate to passbook as last resort, but handle re-login gracefully
            console.log("🔍 Last resort: navigating to passbook...");
            try {
                const passbookResult = await this.navigateAndScrapePassbook();
                if (passbookResult.success && passbookResult.transactions.length > 0) {
                    return passbookResult;
                }
            } catch (err) {
                console.log(`❌ Passbook navigation failed: ${err.message}`);
            }

            return { success: true, transactions: [], source: 'no-data', checkedAt: new Date().toISOString() };
        } catch (err) {
            console.error("Passbook check error:", err.message);
            return { success: false, error: err.message, transactions: [] };
        }
    }

    // Parse various Paytm API response formats
    parseApiResponse(data) {
        const transactions = [];

        // Try common response formats
        const txnArrays = [
            data.transactions, data.data, data.transactionList,
            data.result?.transactions, data.result?.data,
            data.body?.transactions, data.body?.data,
            data.response?.transactions,
        ].filter(Boolean);

        for (const arr of txnArrays) {
            if (!Array.isArray(arr)) continue;
            for (const t of arr) {
                const amount = parseFloat(t.amount || t.txnAmount || t.transactionAmount || 0);
                const isCredit = (t.type === 'CREDIT' || t.transactionType === 'CREDIT' ||
                    t.status === 'CREDIT' || t.direction === 'CREDIT' ||
                    (t.description || '').toLowerCase().includes('received') ||
                    (t.description || '').toLowerCase().includes('credited'));

                if (amount > 0) {
                    transactions.push({
                        amount,
                        isCredit,
                        text: t.description || t.narration || t.title || JSON.stringify(t).slice(0, 200),
                        timestamp: t.timestamp || t.date || t.createdAt || new Date().toISOString(),
                        ref: t.transactionId || t.txnId || t.utr || t.refId || '',
                    });
                }
            }
        }

        return transactions;
    }

    // Scrape the current page without navigating
    async scrapePageContent() {
        try {
            return await this.page.evaluate(() => {
                const txns = [];
                const bodyText = document.body.innerText || "";
                const lines = bodyText.split("\n").filter(l => l.trim());

                for (const line of lines) {
                    const amountMatch = line.match(/[₹Rs.]*\s*([\d,]+\.?\d*)/);
                    if (amountMatch) {
                        const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
                        if (amount > 0 && amount < 1000000) {
                            const isCredit =
                                line.toLowerCase().includes("received") ||
                                line.toLowerCase().includes("credited") ||
                                line.toLowerCase().includes("credit") ||
                                line.includes("+");
                            txns.push({
                                text: line.substring(0, 200), amount, isCredit,
                                timestamp: new Date().toISOString(),
                            });
                        }
                    }
                }
                return txns;
            });
        } catch { return []; }
    }

    // Navigate to passbook (last resort — may break session)
    async navigateAndScrapePassbook() {
        try {
            // Save current URL to go back
            const currentUrl = this.page.url();

            await this.page.goto("https://paytm.com/passbook", { waitUntil: "networkidle2", timeout: 15000 });
            await delay(2000);

            const url = this.page.url();
            if (url.includes("/login") || url.includes("/signin")) {
                // Session died — go back and mark as disconnected
                this.isLoggedIn = false;
                this.saveSession({ status: "disconnected", expiredAt: new Date().toISOString() });
                // Try to go back to maintain whatever session might be left
                try { await this.page.goto(currentUrl, { waitUntil: "networkidle2", timeout: 10000 }); } catch { }
                return { success: false, error: "Session expired", transactions: [] };
            }

            const transactions = await this.scrapePageContent();
            await this.saveCookies();

            // Go back to home to keep session alive for future checks
            try { await this.page.goto(PAYTM_HOME, { waitUntil: "networkidle2", timeout: 10000 }); } catch { }

            return { success: true, transactions, source: 'passbook-page', checkedAt: new Date().toISOString() };
        } catch (err) {
            return { success: false, error: err.message, transactions: [] };
        }
    }

    // Match passbook credits to pending orders
    matchPayments(passbookCredits, pendingOrders) {
        const matches = [];
        const credits = passbookCredits.filter(t => t.isCredit);

        for (const order of pendingOrders) {
            const match = credits.find(c =>
                Math.abs(c.amount - order.amount) < 1.0
            );
            if (match) {
                matches.push({
                    orderId: order.orderId,
                    amount: order.amount,
                    matchedTransaction: match,
                });
            }
        }
        return matches;
    }

    // Session status
    getStatus() {
        return {
            isLoggedIn: this.isLoggedIn,
            loginInProgress: this.loginInProgress,
            lastCheckedTxns: this.lastCheckedTxns.length,
            discoveredApis: this.discoveredApiUrls.length,
        };
    }

    // Cleanup
    async close() {
        try {
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
                this.page = null;
            }
        } catch { }
    }
}

module.exports = PaytmScraper;

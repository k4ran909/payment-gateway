const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const COOKIES_FILE = path.join(DATA_DIR, "paytm-cookies.json");
const SESSION_FILE = path.join(DATA_DIR, "paytm-session.json");

const PAYTM_LOGIN_URL = "https://paytm.com/login";
const PAYTM_PASSBOOK_URL = "https://paytm.com/passbook";
const PAYTM_HOME = "https://paytm.com";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class PaytmScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        this.loginInProgress = false;
        this.lastCheckedTxns = [];
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
    }

    // ── Cookie persistence ──
    async saveCookies() {
        if (!this.page) return;
        try {
            const cookies = await this.page.cookies();
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        } catch (err) { console.error("Save cookies error:", err.message); }
    }

    async loadCookies() {
        if (!this.page) return;
        try {
            if (fs.existsSync(COOKIES_FILE)) {
                const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
                if (cookies.length > 0) {
                    await this.page.setCookie(...cookies);
                    console.log(`📦 Loaded ${cookies.length} saved cookies`);
                }
            }
        } catch (err) { console.error("Load cookies error:", err.message); }
    }

    saveSession(data) {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
        } catch { }
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

    // ══════════════════════════════════════
    //  QR CODE LOGIN FLOW
    //  Paytm web login shows a QR code that
    //  you scan with the Paytm app.
    // ══════════════════════════════════════

    // Step 1: Open login page, extract the QR code image as base64
    async startQRLogin() {
        if (this.loginInProgress) {
            // Return existing QR if still on login page
            return await this.getQRCode();
        }

        this.loginInProgress = true;

        try {
            await this.launch();
            console.log("🔄 Opening Paytm login page...");

            await this.page.goto(PAYTM_LOGIN_URL, { waitUntil: "networkidle2", timeout: 25000 });
            await delay(3000);

            // Take debug screenshot
            await this.page.screenshot({ path: path.join(DATA_DIR, "login-page.png") });

            // Extract the QR code
            const qrResult = await this.extractQR();

            this.saveSession({
                loginStarted: new Date().toISOString(),
                status: "awaiting_scan",
            });

            return qrResult;
        } catch (err) {
            console.error("QR login start error:", err.message);
            this.loginInProgress = false;
            return { success: false, error: err.message };
        }
    }

    // Extract QR code image from the login page
    async extractQR() {
        try {
            if (!this.page) return { success: false, error: "No page open" };

            // Try to find the QR code image element
            const qrBase64 = await this.page.evaluate(() => {
                // Look for QR code images
                const imgs = document.querySelectorAll("img");
                for (const img of imgs) {
                    const src = img.src || "";
                    const alt = (img.alt || "").toLowerCase();
                    const cls = (img.className || "").toLowerCase();
                    const w = img.offsetWidth || img.naturalWidth || 0;
                    const h = img.offsetHeight || img.naturalHeight || 0;

                    // QR codes are usually square images, ~150-400px
                    const isSquarish = w > 100 && h > 100 && Math.abs(w - h) < 50;
                    const isQR =
                        src.includes("qr") || alt.includes("qr") || cls.includes("qr") ||
                        src.includes("data:image") || isSquarish;

                    if (isQR && src) {
                        // If it's already a data URL, return it
                        if (src.startsWith("data:image")) return src;

                        // Try to convert to base64 via canvas
                        try {
                            const canvas = document.createElement("canvas");
                            canvas.width = img.naturalWidth || w;
                            canvas.height = img.naturalHeight || h;
                            const ctx = canvas.getContext("2d");
                            ctx.drawImage(img, 0, 0);
                            return canvas.toDataURL("image/png");
                        } catch {
                            return src; // Return URL if canvas fails (CORS)
                        }
                    }
                }

                // Also check for SVG QR codes
                const svgs = document.querySelectorAll("svg");
                for (const svg of svgs) {
                    const w = svg.offsetWidth || 0;
                    const h = svg.offsetHeight || 0;
                    if (w > 100 && h > 100 && Math.abs(w - h) < 50) {
                        // Convert SVG to data URL
                        const serializer = new XMLSerializer();
                        const svgStr = serializer.serializeToString(svg);
                        return "data:image/svg+xml;base64," + btoa(svgStr);
                    }
                }

                // Check for canvas-based QR
                const canvases = document.querySelectorAll("canvas");
                for (const canvas of canvases) {
                    const w = canvas.width || 0;
                    const h = canvas.height || 0;
                    if (w > 100 && h > 100 && Math.abs(w - h) < 50) {
                        try { return canvas.toDataURL("image/png"); } catch { }
                    }
                }

                return null;
            });

            if (qrBase64) {
                console.log("✅ QR code extracted from Paytm login page");
                return { success: true, qrImage: qrBase64 };
            }

            // Fallback: screenshot just the QR area
            console.log("⚠️ Could not extract QR element, taking full page screenshot");
            const screenshotBuffer = await this.page.screenshot({ encoding: "base64" });
            return {
                success: true,
                qrImage: "data:image/png;base64," + screenshotBuffer,
                fallback: true,
            };
        } catch (err) {
            console.error("QR extract error:", err.message);
            return { success: false, error: err.message };
        }
    }

    // Get current QR (re-extract from page)
    async getQRCode() {
        try {
            if (!this.page) return { success: false, error: "No login page open" };
            return await this.extractQR();
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Step 2: Check if QR scan completed (user scanned with Paytm app)
    async checkLoginComplete() {
        try {
            if (!this.page) return { success: false, loggedIn: false, error: "No page open" };

            const url = this.page.url();
            const content = await this.page.content();

            // Take debug screenshot
            await this.page.screenshot({ path: path.join(DATA_DIR, "login-check.png") });

            // If we're no longer on the login page, login succeeded!
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

    // ══════════════════════════════════════
    //  PASSBOOK SCRAPING
    // ══════════════════════════════════════

    async checkPassbook() {
        if (!this.isLoggedIn) {
            return { success: false, error: "Not logged in", transactions: [] };
        }

        try {
            await this.launch();
            await this.page.goto(PAYTM_PASSBOOK_URL, { waitUntil: "networkidle2", timeout: 20000 });
            await delay(3000);

            const url = this.page.url();
            if (url.includes("/login") || url.includes("/signin")) {
                this.isLoggedIn = false;
                this.saveSession({ status: "disconnected", expiredAt: new Date().toISOString() });
                return { success: false, error: "Session expired", transactions: [] };
            }

            await this.page.screenshot({ path: path.join(DATA_DIR, "passbook.png") });

            const transactions = await this.page.evaluate(() => {
                const txns = [];
                const selectors = [
                    '[class*="transaction" i]', '[class*="txn" i]',
                    '[class*="passbook" i] li', '[class*="passbook" i] [class*="item" i]',
                    '[class*="history" i] li', '[class*="list" i] [class*="item" i]',
                    'table tbody tr', '[data-testid*="transaction" i]',
                ];

                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        elements.forEach((el) => {
                            const text = el.innerText || el.textContent || "";
                            const amountMatch = text.match(/[₹Rs.]*\s*([\d,]+\.?\d*)/);
                            const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : 0;
                            const isCredit =
                                text.toLowerCase().includes("received") ||
                                text.toLowerCase().includes("credited") ||
                                text.toLowerCase().includes("credit") ||
                                text.includes("+") ||
                                text.toLowerCase().includes("from");

                            if (amount > 0) {
                                txns.push({
                                    text: text.substring(0, 200), amount, isCredit,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                        });
                        if (txns.length > 0) break;
                    }
                }

                // Fallback: parse all visible text
                if (txns.length === 0) {
                    const bodyText = document.body.innerText || "";
                    const lines = bodyText.split("\n").filter((l) => l.trim());
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
                }

                return txns;
            });

            await this.saveCookies();
            this.lastCheckedTxns = transactions;
            return { success: true, transactions, checkedAt: new Date().toISOString() };
        } catch (err) {
            console.error("Passbook check error:", err.message);
            return { success: false, error: err.message, transactions: [] };
        }
    }

    // Match passbook credits to pending orders
    matchPayments(passbookCredits, pendingOrders) {
        const matches = [];
        for (const order of pendingOrders) {
            const match = passbookCredits.find(
                (c) => c.isCredit && Math.abs(c.amount - order.amount) < 0.01
            );
            if (match) {
                matches.push({
                    orderId: order.orderId,
                    amount: order.amount,
                    matchedTransaction: match.text,
                });
            }
        }
        return matches;
    }

    // Session status
    getStatus() {
        const session = this.loadSession();
        return {
            isLoggedIn: this.isLoggedIn,
            loginInProgress: this.loginInProgress,
            session: session || { status: "disconnected" },
        };
    }

    // Cleanup
    async close() {
        this.loginInProgress = false;
        if (this.browser) {
            try { await this.browser.close(); } catch { }
            this.browser = null;
            this.page = null;
        }
    }
}

module.exports = PaytmScraper;

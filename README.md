# PayQR - Personal UPI Payment Gateway

A self-hosted UPI payment gateway that allows you to verify payments **without a merchant account** or business registration. It uses your personal UPI ID and automates payment verification via **Bank SMS Forwarding** or **Paytm Web Scraping**.

## Features

- **No Merchant Account Needed**: Use your personal UPI ID (e.g., `phone@paytm`, `name@okhdfcbank`).
- **Real-Time Verification**:
  - **Primary (Recommended):** Auto-verifies payments by parsing bank SMS forwarded from your phone.
  - **Secondary:** Paytm Web Scraping (logs in via QR code and checks passbook).
- **Direct Settlement**: Money goes directly to your bank account instantly.
- **Zero Fees**: No transaction fees or commission.

## Prerequisites

- **Node.js** (v18+)
- **Android Phone** (for reliable SMS auto-verification)
- **Paytm Account** (optional, for web scraping method)

## Installation

1. Clone the repo:
   ```bash
   git clone https://github.com/k4ran909/payment-gateway.git
   cd payment-gateway
   ```

2. Install dependencies:
   ```bash
   # Install Server dependencies
   cd server
   npm install

   # Install Client dependencies
   cd ../client/upi-payment-gateway
   npm install
   ```

3. Start the application:
   - **Server** (Runs on port 10000):
     ```bash
     cd server
     node index.js
     ```
   - **Client** (Runs on port 5173):
     ```bash
     cd client/upi-payment-gateway
     npm run dev
     ```

4. Access the Dashboard at `http://localhost:5173/admin`  
   - **Default Credentials**: `admin` / `admin123`

## 🚀 Setup Guide: SMS Auto-Verification (Reliable)

This is the most reliable method. It works by forwarding your bank's transaction SMS to the server.

1. **Install App**: Download **[SMS to URL Forwarder](https://f-droid.org/packages/tech.httptoolkit.sms_to_url/)** or a similar app on your Android phone.
2. **Configure App**:
   - **URL**: `http://<YOUR_PC_IP>:10000/api/paytm/sms-webhook`
     - *Replace `<YOUR_PC_IP>` with your computer's local IP (e.g., `192.168.1.5`).*
     - *Ensure your phone and PC are on the same WiFi.*
   - **HTTP Method**: `POST`
   - **Body/Content**: Ensure it sends the SMS body text.
3. **Test**:
   - Send a test SMS to yourself: `Rs. 100 credited to A/c XX1234. UPI Ref 123456789012`
   - Check the server logs. If it says `🎉 MATCH FOUND`, it's working!

## ⚠️ Known Limitations
- **Paytm Web Scraping**: The session often expires quickly due to Paytm's security. Re-login via QR code is required frequently. Use the SMS method for full automation.
- **Network**: Your phone must be able to reach your PC's IP. Use `ngrok` if you are on different networks.

## License
MIT

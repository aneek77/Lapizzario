# La Pizzario — Real Online Ordering: Setup Guide

Your website now takes **real orders, real payments, and sends real email receipts**. This guide gets you live in about 30–45 minutes.

---

## What you got

```
lapizzario-app/
├── server.js          ← the order server (payments, emails, order storage)
├── package.json       ← dependencies list
├── .env.example       ← settings template (copy to .env and fill in)
├── SETUP-GUIDE.md     ← this file
└── public/
    ├── index.html     ← your customer website
    └── dashboard.html ← STAFF dashboard (see & manage orders live)
```

## How it works (the real flow)

1. Customer builds a cart on the website and checks out with **Pay Online (UPI/card via Razorpay)** or **Cash on Delivery**.
2. The server **recalculates the price from its own price list** (so nobody can tamper with prices), takes the payment, and saves the order.
3. **Two emails go out automatically**: a receipt to the customer, and a "NEW ORDER" alert to the restaurant's email.
4. Staff open **dashboard.html**, see the order instantly (with a sound alert), and click **Preparing → Out for Delivery → Delivered**. When marking "Out for Delivery", staff type the **real driver's name & phone**.
5. The customer can enter their Order ID on the website's "Track it live" box and see the **real status and the real driver** you assigned — nothing fake.

---

## Step 1 — Get the accounts you need (one-time)

### A. UPI QR payments (easiest — zero fees, instant setup) 📱
1. You already have this if you use GPay / PhonePe / Paytm to receive money!
2. Find your **UPI ID** (e.g. `9126996094@ybl` or `lapizzario@okhdfcbank`).
3. Put it in your `.env` file as `UPI_ID=...` — done. Customers now see a scan-and-pay QR at checkout with the exact amount and order ID.
4. ⚠️ **Important:** UPI QR payments have no automatic confirmation. The dashboard marks these orders **"📱 UPI — VERIFY IN YOUR UPI APP"** with the customer's transaction ref. Staff must check the money actually arrived before preparing the order.

### B. Razorpay (for card/netbanking payments) — free to open
1. Go to **https://razorpay.com** → Sign Up (business account).
2. Complete KYC (PAN, bank account, business details). Approval usually takes 1–3 days.
3. Dashboard → **Settings → API Keys → Generate Keys**.
4. You get a **Key ID** and **Key Secret**. Start with **Test Mode** keys.
   - Razorpay charges ~2% per transaction (standard for all gateways in India).

### B. Gmail (for sending receipts) — free
1. Create a Gmail like `lapizzario.orders@gmail.com` (or use an existing one).
2. Turn on **2-Step Verification** on that Google account.
3. Go to **https://myaccount.google.com/apppasswords** → create an App Password.
4. Copy the 16-character password — that goes in your settings file.

---

## Step 2 — Put it online (choose ONE host)

The server needs to run somewhere 24/7. Easiest free/cheap option:

### Render.com (recommended, has a free tier)
1. Create an account at **https://render.com**.
2. Push this folder to a GitHub repository (or use Render's manual deploy).
3. New → **Web Service** → connect your repo.
4. Settings: Build command — leave empty (no dependencies!) · Start command `node server.js`.
5. In the Render dashboard, open **Environment** and add each variable from `.env.example` with your real values (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SMTP_USER, SMTP_PASS, RESTAURANT_EMAIL, STAFF_PASSWORD).
6. Deploy. You'll get a URL like `https://lapizzario.onrender.com` — that IS your website, and `https://lapizzario.onrender.com/dashboard.html` is your staff dashboard.

(Railway.app and a ₹400–800/month VPS like Hostinger/DigitalOcean also work the same way.)

### Or test on your own computer first (2 minutes)
1. Install Node.js (v18 or newer) from https://nodejs.org — one-time.
2. Then:
```bash
cd lapizzario-app
node server.js
```
That's it — **no npm install needed** (the server has zero dependencies).

3. Open **http://localhost:3000** → the website
4. Open **http://localhost:3000/dashboard.html** → the staff dashboard (password: `pizzario123` until you change it)

> ⚠️ **IMPORTANT — how to open the dashboard:** the dashboard ONLY works through the server URL (http://localhost:3000/dashboard.html or your deployed site's /dashboard.html). If you double-click the dashboard.html file directly, it can't reach the orders and will show you a warning explaining this.

To add your Razorpay/Gmail keys: copy `.env.example` to a file named `.env`, fill in your values, and restart the server.

---

## Step 3 — Test before going live
1. Keep Razorpay in **Test Mode**. Place an order and pay with Razorpay's test card: `4111 1111 1111 1111`, any future expiry, any CVV.
2. Check: order appears in the dashboard, customer email arrives, restaurant email arrives.
3. Test a **Cash on Delivery** order too.
4. When happy: switch the `.env` keys to your **Live** Razorpay keys and redeploy.

---

## Daily use for staff
- Bookmark `https://YOUR-SITE/dashboard.html` on the counter phone/tablet.
- Log in with your staff password (set in `.env` — please change the default!).
- The page refreshes every 30 s and **plays a sound** when a new order lands.
- Click the status buttons as the order progresses. Type the driver's name/phone when handing it over — the customer sees it in live tracking.

## Important notes (honest ones)
- **Money goes straight to your Razorpay account** → auto-settled to your bank in T+2 days.
- Orders are stored in `orders.json` on the server. On Render's free tier this file resets if the service restarts — the email notifications are your permanent record, or upgrade to a paid instance/disk for persistence.
- The old Swiggy/Zomato/phone options still work on the site — this adds a direct channel with **no commission**.
- If Razorpay keys aren't configured yet, the site automatically still accepts **Cash on Delivery** orders (with emails), so you can go live with COD on day one and add online payment when KYC clears.

## Need to change menu prices later?
Edit the `PRICES` list at the top of `server.js` (and the matching prices in `public/index.html`), then redeploy. The server's list is what actually gets charged.

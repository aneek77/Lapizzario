/**
 * LA PIZZARIO — Order Server (zero dependencies!)
 * ------------------------------------------------
 * Runs with plain Node.js (v18+). No npm install needed. Just:  node server.js
 *
 * What it does:
 *  - Serves the website (public/index.html) and staff dashboard (public/dashboard.html)
 *  - Receives orders; recalculates totals server-side so prices can't be tampered with
 *  - Takes real online payments via Razorpay REST API and verifies signatures
 *  - Emails a receipt to the customer and a "new order" alert to the restaurant (Gmail SMTP)
 *  - Stores orders in orders.json; the staff dashboard reads & updates them live
 *
 * Setup: see SETUP-GUIDE.md  (put your keys in a file named ".env")
 */

const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------
// Tiny .env loader (no dotenv package needed)
// ---------------------------------------------------------------
(function loadEnv(){
  const envPath = path.join(__dirname, '.env');
  if(!fs.existsSync(envPath)) return;
  for(const line of fs.readFileSync(envPath, 'utf-8').split('\n')){
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if(m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const PORT = parseInt(process.env.PORT || '3000');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'pizzario123';

// ---------------------------------------------------------------
// SERVER-SIDE PRICE LIST — the single source of truth for pricing
// Key format: "Item Name|SIZE" for sized items, "Item Name" otherwise
// ---------------------------------------------------------------
const PRICES = {
  // Veg pizzas (S/M/L)
  'Hawaiian Pizza|S': 240, 'Hawaiian Pizza|M': 360, 'Hawaiian Pizza|L': 570,
  'Margherita|S': 100, 'Margherita|M': 200, 'Margherita|L': 320,
  'Paneer Deluxe|S': 260, 'Paneer Deluxe|M': 390, 'Paneer Deluxe|L': 530,
  'Veggie Deluxe|S': 230, 'Veggie Deluxe|M': 340, 'Veggie Deluxe|L': 470,
  'Classic Veg Pizza|S': 160, 'Classic Veg Pizza|M': 280, 'Classic Veg Pizza|L': 410,
  'Green Pepper Pizza|S': 130, 'Green Pepper Pizza|M': 240, 'Green Pepper Pizza|L': 350,
  'Pizzario Garden Fresh|S': 170, 'Pizzario Garden Fresh|M': 280, 'Pizzario Garden Fresh|L': 430,
  'Paneer Tikka Pizza|S': 250, 'Paneer Tikka Pizza|M': 380, 'Paneer Tikka Pizza|L': 520,
  'Veggie Exotica Pizza|S': 240, 'Veggie Exotica Pizza|M': 360, 'Veggie Exotica Pizza|L': 510,
  // Non-veg pizzas (S/M/L)
  'Tandoori Chicken Pizza|S': 230, 'Tandoori Chicken Pizza|M': 360, 'Tandoori Chicken Pizza|L': 510,
  'Hot & Spicy Chicken Pizza|S': 230, 'Hot & Spicy Chicken Pizza|M': 360, 'Hot & Spicy Chicken Pizza|L': 510,
  'Pizzario Special Pizza|S': 290, 'Pizzario Special Pizza|M': 430, 'Pizzario Special Pizza|L': 620,
  'Chicken Deluxe Pizza|S': 260, 'Chicken Deluxe Pizza|M': 370, 'Chicken Deluxe Pizza|L': 530,
  'Chicken Olicano Pizza|S': 220, 'Chicken Olicano Pizza|M': 360, 'Chicken Olicano Pizza|L': 510,
  'Golden Corn Chicken Pizza|S': 200, 'Golden Corn Chicken Pizza|M': 310, 'Golden Corn Chicken Pizza|L': 430,
  'Chicken Hawaiian Pizza|S': 260, 'Chicken Hawaiian Pizza|M': 370, 'Chicken Hawaiian Pizza|L': 550,
  'Cheesy Chicken Pizza|S': 180, 'Cheesy Chicken Pizza|M': 290, 'Cheesy Chicken Pizza|L': 410,
  'Chicken Salami Lover Pizza|S': 230, 'Chicken Salami Lover Pizza|M': 360, 'Chicken Salami Lover Pizza|L': 510,
  // Sides / starters / burgers / desserts
  'French Fries': 70,
  'Garlic Bread with Cheese': 130,
  'Fried Chicken Wings (2pcs)': 110,
  'Chicken Nuggets': 100,
  'Chicken Popcorn': 100,
  'Chicken Sheek Kebab': 180,
  'Veg Burger': 70,
  'Paneer Burger': 90,
  'Chicken Burger': 90,
  'Pizza Pocket Veg': 140,
  'Pizza Pocket Chicken': 170,
  'Brownie': 60,
  'Chocolava Cake': 60,
  // Combos
  'Executive Meal (Veg)': 290,
  'Executive Meal (Non-Veg)': 310,
  'Combo Burger (Veg)': 140,
  'Combo Burger (Non-Veg)': 160,
  'Burger + Choco Lava (Veg)': 140,
  'Burger + Choco Lava (Non-Veg)': 160,
  'Meal for Two (Veg)': 450,
  'Meal for Two (Non-Veg)': 480,
  'Meal for Four (Veg)': 650,
  'Meal for Four (Non-Veg)': 660,
};

const BRANCHES = {
  'Bidhannagar': '9126996094', 'Chandidas': '9734232559', 'S.B.More': '9749426800',
  'Prantika': '7679589054', 'Raniganj': '9800439020', 'Asansol': '9907626621', 'Bolpur': '8900791229'
};

// ---------------------------------------------------------------
// Order storage (JSON file — simple and reliable for one restaurant)
// ---------------------------------------------------------------
function loadOrders(){
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8')); }
  catch { return []; }
}
function saveOrders(orders){
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}
function nextOrderId(){
  const d = new Date();
  const stamp = d.getFullYear().toString().slice(2) + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LP-${stamp}-${rand}`;
}

// ---------------------------------------------------------------
// Razorpay via plain HTTPS (no SDK needed)
// ---------------------------------------------------------------
function razorpayConfigured(){
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
function createRazorpayOrder(amountPaise, receipt){
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ amount: amountPaise, currency: 'INR', receipt });
    const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
    const req = https.request({
      hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Basic ' + auth }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if(res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(json.error?.description || 'Razorpay error ' + res.statusCode));
        } catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ---------------------------------------------------------------
// Minimal Gmail SMTP client (no nodemailer needed)
// Uses smtp.gmail.com:465 (TLS) with an App Password
// ---------------------------------------------------------------
function emailConfigured(){
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}
function sendMail(to, subject, htmlBody){
  return new Promise((resolve, reject) => {
    if(!emailConfigured()) return resolve(false);
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS.replace(/\s+/g, '');
    const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' });
    let buffer = '';
    const steps = [
      { expect: 220, send: () => 'EHLO lapizzario.local\r\n' },
      { expect: 250, send: () => 'AUTH LOGIN\r\n' },
      { expect: 334, send: () => Buffer.from(user).toString('base64') + '\r\n' },
      { expect: 334, send: () => Buffer.from(pass).toString('base64') + '\r\n' },
      { expect: 235, send: () => `MAIL FROM:<${user}>\r\n` },
      { expect: 250, send: () => `RCPT TO:<${to}>\r\n` },
      { expect: 250, send: () => 'DATA\r\n' },
      { expect: 354, send: () => {
          const encSubject = '=?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=';
          return [
            `From: "La Pizzario" <${user}>`,
            `To: <${to}>`,
            `Subject: ${encSubject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            'Content-Transfer-Encoding: base64',
            '',
            Buffer.from(htmlBody).toString('base64').replace(/(.{76})/g, '$1\r\n'),
            '.', ''
          ].join('\r\n');
        } },
      { expect: 250, send: () => 'QUIT\r\n' },
      { expect: 221, send: null }
    ];
    let step = 0;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('SMTP timeout')); }, 30000);

    socket.on('data', chunk => {
      buffer += chunk.toString();
      // process complete lines; final line of a reply has "NNN " (space after code)
      let idx;
      while((idx = buffer.indexOf('\r\n')) !== -1){
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        if(!/^\d{3} /.test(line)) continue;          // skip multiline continuations "250-..."
        const code = parseInt(line.slice(0, 3));
        const cur = steps[step];
        if(!cur) return;
        if(code !== cur.expect){
          clearTimeout(timer); socket.destroy();
          return reject(new Error(`SMTP step ${step} expected ${cur.expect} got: ${line}`));
        }
        step++;
        if(cur.send){
          socket.write(cur.send());
        }
        if(step >= steps.length){
          clearTimeout(timer); socket.end(); return resolve(true);
        }
      }
    });
    socket.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// ---------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------
function receiptHtml(order){
  const rows = order.items.map(it =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${it.qty}x ${it.name}${it.size ? ' ('+it.size+')' : ''}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">₹${it.lineTotal}</td></tr>`).join('');
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;border:1px solid #e5d9bd;border-radius:10px;overflow:hidden;">
    <div style="background:#1C1310;color:#F7F1E4;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:1.6rem;">La Pizzario</h1>
      <div style="color:#C9A227;font-size:0.8rem;letter-spacing:2px;">THE BEST PIZZA IN TOWN</div>
    </div>
    <div style="padding:24px;background:#F4EAD6;">
      <h2 style="color:#7A1F1F;margin-top:0;">Order Confirmed ✅</h2>
      <p>Hi ${order.customer.name}, thanks for your order! Here's your receipt:</p>
      <p style="font-family:monospace;background:#fff;padding:8px 12px;border-radius:6px;display:inline-block;">Order ID: <b>${order.orderId}</b></p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin:12px 0;">
        ${rows}
        <tr><td style="padding:10px 12px;font-weight:bold;">Total (${order.payMethod === 'cod' ? 'pay on delivery' : order.payMethod === 'upi' ? 'PAID VIA UPI — being verified' : 'PAID ONLINE'})</td>
        <td style="padding:10px 12px;text-align:right;font-weight:bold;color:#7A1F1F;">₹${order.total}</td></tr>
      </table>
      <p style="font-size:0.9rem;line-height:1.6;">
        📍 Delivering to: ${order.customer.address}<br>
        🏪 Branch: ${order.customer.branch} (${BRANCHES[order.customer.branch] || ''})<br>
        🕒 Typical delivery time: 30–45 minutes<br>
        🔎 Track your order anytime: enter <b>${order.orderId}</b> in the "Track it live" box on our website.
      </p>
    </div>
    <div style="background:#1C1310;color:#8A7A67;padding:14px;text-align:center;font-size:0.75rem;">
      Free home delivery · Fresh ingredients · Cheese loaded in every bite
    </div>
  </div>`;
}

async function sendOrderEmails(order){
  if(!emailConfigured()){
    console.log(`   ⚠️ Email not configured — no receipts sent for ${order.orderId}`);
    return;
  }
  const html = receiptHtml(order);
  try {
    await sendMail(order.customer.email, `Order Confirmed — ${order.orderId} — La Pizzario 🍕`, html);
    console.log(`   📧 Receipt sent to ${order.customer.email}`);
  } catch(e){ console.error('   ❌ Customer email failed:', e.message); }
  try {
    const notifyTo = process.env.RESTAURANT_EMAIL || process.env.SMTP_USER;
    const staffHtml = html + `<div style="margin-top:16px;padding:12px;background:#fff3cd;border-radius:8px;font-family:sans-serif;">
      <b>Customer:</b> ${order.customer.name} — ${order.customer.phone}<br>
      <b>Open the staff dashboard to manage this order.</b></div>`;
    await sendMail(notifyTo, `🔔 NEW ORDER ${order.orderId} — ${order.customer.branch} — ₹${order.total} (${order.payMethod.toUpperCase()})`, staffHtml);
    console.log(`   📧 Alert sent to restaurant (${notifyTo})`);
  } catch(e){ console.error('   ❌ Restaurant email failed:', e.message); }
}

// ---------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------
function json(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if(data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.json':'application/json' };

// ---------------------------------------------------------------
// The server
// ---------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = req.method + ' ' + url.pathname;

  // CORS — lets the site work even when opened as a file:// during local testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-staff-pass');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if(req.method === 'OPTIONS'){ res.writeHead(204); return res.end(); }

  try {
    // ---------- API: place order ----------
    if(route === 'POST /api/orders'){
      const { customer, items, payMethod } = await readBody(req);
      if(!customer || !customer.name || !customer.phone || !customer.email || !customer.address || !customer.branch)
        return json(res, 400, { error: 'Missing customer details' });
      if(!BRANCHES[customer.branch]) return json(res, 400, { error: 'Unknown branch' });
      if(!Array.isArray(items) || items.length === 0) return json(res, 400, { error: 'Cart is empty' });
      if(!['online','cod','upi'].includes(payMethod)) return json(res, 400, { error: 'Invalid payment method' });

      // Server-side price verification — never trust client prices
      let total = 0;
      const verifiedItems = [];
      for(const it of items){
        const qty = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
        const key = it.size ? `${it.name}|${it.size}` : it.name;
        const price = PRICES[key];
        if(price === undefined) return json(res, 400, { error: `Unknown item: ${it.name}` });
        const lineTotal = price * qty;
        total += lineTotal;
        verifiedItems.push({ name: it.name, size: it.size || '', qty, price, lineTotal });
      }

      const order = {
        orderId: nextOrderId(),
        timestamp: new Date().toISOString(),
        customer, items: verifiedItems, total, payMethod,
        status: payMethod === 'cod' ? 'RECEIVED' : 'AWAITING_PAYMENT',
        payment: null
      };

      if(payMethod === 'online'){
        if(!razorpayConfigured())
          return json(res, 503, { error: 'Online payment is not configured yet. Please choose UPI QR or Cash on Delivery.' });
        const rzp = await createRazorpayOrder(total * 100, order.orderId);
        order.payment = { razorpayOrderId: rzp.id };
        const orders = loadOrders(); orders.push(order); saveOrders(orders);
        return json(res, 200, {
          orderId: order.orderId, razorpayOrderId: rzp.id,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID, amountPaise: total * 100,
          total, items: verifiedItems, branch: customer.branch, customerEmail: customer.email, payMethod
        });
      }

      if(payMethod === 'upi'){
        if(!process.env.UPI_ID)
          return json(res, 503, { error: 'UPI payment is not set up yet. Please choose Cash on Delivery.' });
        order.status = 'RECEIVED';
        order.payment = { method: 'upi', verified: false };
        const orders = loadOrders(); orders.push(order); saveOrders(orders);
        console.log(`📱 NEW UPI ORDER ${order.orderId} — ${customer.branch} — ₹${total} (awaiting customer payment)`);
        return json(res, 200, {
          orderId: order.orderId, total, items: verifiedItems,
          branch: customer.branch, customerEmail: customer.email, payMethod,
          upiId: process.env.UPI_ID,
          upiName: process.env.UPI_NAME || 'La Pizzario'
        });
      }

      // Cash on delivery — save + email now
      const orders = loadOrders(); orders.push(order); saveOrders(orders);
      console.log(`📦 NEW COD ORDER ${order.orderId} — ${customer.branch} — ₹${total}`);
      sendOrderEmails(order); // async, fire-and-forget
      return json(res, 200, {
        orderId: order.orderId, total, items: verifiedItems,
        branch: customer.branch, customerEmail: customer.email, payMethod
      });
    }

    // ---------- API: customer confirms UPI payment ----------
    if(route === 'POST /api/upi-paid'){
      const { orderId, upiRef } = await readBody(req);
      const orders = loadOrders();
      const order = orders.find(o => o.orderId === orderId);
      if(!order || !order.payment || order.payment.method !== 'upi')
        return json(res, 400, { error: 'Order not found' });
      order.payment.customerClaimedPaid = true;
      order.payment.upiRef = (upiRef || '').slice(0, 40);
      order.payment.claimedAt = new Date().toISOString();
      saveOrders(orders);
      console.log(`📱 UPI PAYMENT CLAIMED ${order.orderId} — ref: ${order.payment.upiRef || '(none given)'}`);
      sendOrderEmails(order);
      return json(res, 200, {
        orderId: order.orderId, total: order.total, items: order.items,
        branch: order.customer.branch, customerEmail: order.customer.email, payMethod: 'upi'
      });
    }

    // ---------- API: verify Razorpay payment ----------
    if(route === 'POST /api/verify-payment'){
      const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await readBody(req);
      const orders = loadOrders();
      const order = orders.find(o => o.orderId === orderId);
      if(!order || !order.payment || order.payment.razorpayOrderId !== razorpay_order_id)
        return json(res, 400, { verified: false, error: 'Order not found' });

      const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
      if(expected !== razorpay_signature)
        return json(res, 400, { verified: false, error: 'Signature mismatch' });

      order.status = 'RECEIVED';
      order.payment.razorpayPaymentId = razorpay_payment_id;
      order.payment.paidAt = new Date().toISOString();
      saveOrders(orders);
      console.log(`💳 PAID ORDER ${order.orderId} — ${order.customer.branch} — ₹${order.total}`);
      sendOrderEmails(order);
      return json(res, 200, {
        verified: true, orderId: order.orderId, total: order.total, items: order.items,
        branch: order.customer.branch, customerEmail: order.customer.email, payMethod: 'online'
      });
    }

    // ---------- API: staff (password-protected) ----------
    if(url.pathname.startsWith('/api/staff/')){
      if(req.headers['x-staff-pass'] !== STAFF_PASSWORD)
        return json(res, 401, { error: 'Wrong password' });

      if(route === 'GET /api/staff/orders')
        return json(res, 200, loadOrders().slice().reverse());

      const m = url.pathname.match(/^\/api\/staff\/orders\/([^/]+)\/status$/);
      if(m && req.method === 'POST'){
        const { status, driverName, driverPhone } = await readBody(req);
        const valid = ['RECEIVED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
        if(!valid.includes(status)) return json(res, 400, { error: 'Invalid status' });
        const orders = loadOrders();
        const order = orders.find(o => o.orderId === m[1]);
        if(!order) return json(res, 404, { error: 'Order not found' });
        order.status = status;
        if(driverName) order.driver = { name: driverName, phone: driverPhone || '' };
        saveOrders(orders);
        return json(res, 200, { ok: true });
      }
    }

    // ---------- API: customer order tracking ----------
    const trackMatch = url.pathname.match(/^\/api\/track\/([^/]+)$/);
    if(trackMatch && req.method === 'GET'){
      const order = loadOrders().find(o => o.orderId === decodeURIComponent(trackMatch[1]).toUpperCase());
      if(!order) return json(res, 404, { error: 'Order not found' });
      return json(res, 200, {
        orderId: order.orderId, status: order.status, total: order.total,
        driver: order.driver || null, branch: order.customer.branch
      });
    }

    // ---------- Static files ----------
    if(req.method === 'GET'){
      let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
      filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
      const full = path.join(PUBLIC_DIR, filePath);
      if(full.startsWith(PUBLIC_DIR) && fs.existsSync(full) && fs.statSync(full).isFile()){
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
        return fs.createReadStream(full).pipe(res);
      }
    }

    json(res, 404, { error: 'Not found' });
  } catch(err){
    console.error(err);
    json(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log('\n🍕 La Pizzario server running!');
  console.log(`   Website:         http://localhost:${PORT}`);
  console.log(`   Staff dashboard: http://localhost:${PORT}/dashboard.html  (password: ${STAFF_PASSWORD === 'pizzario123' ? 'pizzario123 — CHANGE THIS in .env!' : 'set in .env ✅'})`);
  console.log(`   Razorpay: ${razorpayConfigured() ? '✅ configured' : '❌ not configured (only Cash on Delivery will work)'}`);
  console.log(`   Email:    ${emailConfigured() ? '✅ configured' : '❌ not configured (no receipts will be sent)'}\n`);
});

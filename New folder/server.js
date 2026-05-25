const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const WALLET_NUMBER = process.env.WALLET_NUMBER || '01016380970';
const PRODUCT_PRICE = parseFloat(process.env.PRODUCT_PRICE || '100');
const MIN_PAYMENT_AMOUNT = parseFloat(process.env.MIN_PAYMENT_AMOUNT || '90');
const KIT_DIR = path.join(__dirname, '..');

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(KIT_DIR));

// Ensure uploads and database directories exist
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

const DB_FILE = path.join(__dirname, 'db.json');

// Initialize local JSON Database helper
const db = {
  read: () => {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = {
        orders: [],
        smsLogs: [],
        settings: { walletNumber: WALLET_NUMBER, productPrice: PRODUCT_PRICE }
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error("Error reading DB file, resetting...", e);
      return { orders: [], smsLogs: [], settings: { walletNumber: WALLET_NUMBER, productPrice: PRODUCT_PRICE } };
    }
  },
  write: (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }
};

(function syncDbSettings() {
  const data = db.read();
  data.settings = data.settings || {};
  data.settings.walletNumber = WALLET_NUMBER;
  data.settings.productPrice = PRODUCT_PRICE;
  data.settings.minPaymentAmount = MIN_PAYMENT_AMOUNT;
  db.write(data);
})();

function normalizeLast4(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

function amountAccepted(received) {
  const r = parseFloat(received);
  if (isNaN(r)) return false;
  return r + 0.001 >= MIN_PAYMENT_AMOUNT;
}

function textHasAcceptedAmount(text) {
  if (!text) return false;
  const priceStr = String(Math.round(PRODUCT_PRICE));
  const priceDec = PRODUCT_PRICE.toFixed(2);
  if (text.includes(priceStr) || text.includes(priceDec)) return true;
  const nums = text.match(/\d+(?:\.\d+)?/g) || [];
  return nums.some((n) => amountAccepted(parseFloat(n)));
}

function smsMatchesOrder(sms, order) {
  if (!sms || !order || sms.isLinked) return false;
  if (!amountAccepted(sms.amount)) return false;
  const smsLast4 = normalizeLast4(sms.senderLast4 || (sms.senderPhone || ''));
  const orderLast4 = normalizeLast4(order.phoneLast4);
  if (smsLast4.length !== 4 || orderLast4.length !== 4) return false;
  return smsLast4 === orderLast4;
}

function extractWebhookMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return body.message || body.text || body.body || body.content || body.sms || '';
}

function extractWebhookFrom(body) {
  if (!body || typeof body === 'string') return '';
  return body.from || body.sender || body.phone || '';
}

// Configure Multer for File Uploads (Screenshots)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'screenshot-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images are allowed (jpeg, jpg, png, gif, webp)'));
  }
});

// Helper: Normalize Arabic numbers (e.g., ١٥٠ -> 150)
function normalizeArabicNumbers(text) {
  if (!text) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return text.replace(/[٠-٩]/g, (w) => arabicDigits.indexOf(w).toString());
}

// Helper: Parse Vodafone Cash SMS with advanced multi-regex support
function parseVodafoneCashSMS(smsText) {
  const text = normalizeArabicNumbers(smsText);
  let amount = null;
  let senderPhone = null;
  let trxId = null;

  // 1. Regex for Amount (Looking for terms like "تم تحويل مبلغ", "تم استلام مبلغ", "تم إيداع", "مبلغ", followed by number, then EGP/ج.م/جنيه)
  // Supports formats like: 150 جنيه, 150.00 ج.م, 150 EGP
  const amountPatterns = [
    /تم\s+(?:تحويل|استلام|إيداع)\s+مبلغ\s*([\d\.]+)\s*(?:جنيه|ج\.م|EGP)/i,
    /مبلغ\s*([\d\.]+)\s*(?:جنيه|ج\.م|EGP)/i,
    /(?:received|credited)\s*(?:EGP|LE)?\s*([\d\.]+)/i,
    /([\d\.]+)\s*(?:جنيه|ج\.م|EGP)/
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      amount = parseFloat(match[1]);
      break;
    }
  }

  // 2. Regex for Sender Phone (11 digits, usually starting with 01)
  const phonePatterns = [
    /من\s+رقم\s*(01\d{9})/i,
    /من\s*(01\d{9})/i,
    /from\s*(01\d{9})/i,
    /(01\d{9})/
  ];

  for (const pattern of phonePatterns) {
    const match = text.match(pattern);
    if (match) {
      senderPhone = match[1];
      break;
    }
  }

  // 3. Regex for Transaction ID (Usually numbers, English letters/digits)
  const trxPatterns = [
    /رقم\s+العملية\s*:?\s*(\w+)/i,
    /رقم\s+عملية\s*:?\s*(\w+)/i,
    /Trx\.?\s*ID\s*:?\s*(\w+)/i,
    /Transaction\s*ID\s*:?\s*(\w+)/i
  ];

  for (const pattern of trxPatterns) {
    const match = text.match(pattern);
    if (match) {
      trxId = match[1];
      break;
    }
  }

  const senderLast4 = senderPhone ? senderPhone.slice(-4) : null;

  return { amount, senderPhone, senderLast4, trxId };
}

// -------------------------------------------------------------
// CORE WEBHOOK: SMS Receiver (Used by the Android Forwarder App)
// -------------------------------------------------------------
app.post('/webhook/sms', (req, res) => {
  const message = extractWebhookMessage(req.body);
  const from = extractWebhookFrom(req.body);

  if (!message) {
    return res.status(400).json({ success: false, error: 'Message content is empty' });
  }

  console.log(`[SMS Webhook Received] From: ${from || 'Unknown'}, Content: "${message.substring(0, 120)}"`);

  // Parse SMS text
  const parsed = parseVodafoneCashSMS(message);
  
  // We only log it as a transaction if we successfully extracted at least the amount
  if (!parsed.amount) {
    console.log('[SMS Warning] SMS received but amount could not be parsed automatically.');
  }

  const data = db.read();
  
  const newLog = {
    id: 'sms-' + Date.now() + '-' + Math.round(Math.random() * 1000),
    text: message,
    amount: parsed.amount,
    senderPhone: parsed.senderPhone,
    senderLast4: parsed.senderLast4,
    trxId: parsed.trxId,
    isLinked: false,
    orderId: null,
    createdAt: new Date().toISOString()
  };

  data.smsLogs.push(newLog);
  db.write(data);

  // Trigger matching logic immediately
  matchTransactions();

  res.status(200).json({ success: true, parsed: parsed });
});

// -------------------------------------------------------------
// CORE MATCHING ENGINE
// -------------------------------------------------------------
function matchTransactions() {
  const data = db.read();
  let updated = false;

  // Scan all orders waiting for SMS matching
  data.orders.forEach(order => {
    if (order.status === 'pending_sms') {
      // Find an unlinked SMS log that matches the amount AND last 4 digits
      const match = data.smsLogs.find(sms => smsMatchesOrder(sms, order));

      if (match) {
        console.log(`[Matching Engine] SUCCESSFUL MATCH! Order ${order.id} matched with SMS ${match.id}`);
        order.status = 'verified';
        order.smsMatchedId = match.id;
        order.senderPhone = match.senderPhone; // Capture full phone number from SMS
        order.trxId = match.trxId; // Capture transaction ID from SMS
        
        match.isLinked = true;
        match.orderId = order.id;
        updated = true;
      }
    }
  });

  if (updated) {
    db.write(data);
  }
}

// -------------------------------------------------------------
// CUSTOMER APIS
// -------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.status(200).json({
    success: true,
    price: PRODUCT_PRICE,
    minPaymentAmount: MIN_PAYMENT_AMOUNT,
    walletNumber: WALLET_NUMBER,
    currency: 'EGP'
  });
});

// 1. Submit Checkout
app.post('/api/checkout', upload.single('screenshot'), (req, res) => {
  try {
    const { phoneLast4, customerName, orderId } = req.body;

    if (!phoneLast4) {
      return res.status(400).json({ success: false, error: 'Amount and Last 4 digits are required' });
    }

    const cleanAmount = PRODUCT_PRICE;
    const cleanLast4 = normalizeLast4(phoneLast4.trim());
    if (cleanLast4.length !== 4) {
      return res.status(400).json({ success: false, error: 'Last 4 digits must be exactly 4 numbers' });
    }
    const screenshotPath = req.file ? `/uploads/${req.file.filename}` : null;

    const data = db.read();
    
    // Create new order record
    const newOrder = {
      id: 'order-' + Date.now() + '-' + Math.round(Math.random() * 1000),
      orderId: orderId || 'VC-' + Math.floor(100000 + Math.random() * 900000),
      customerName: (customerName || '').trim() || 'عميل',
      amount: cleanAmount,
      phoneLast4: cleanLast4,
      status: 'pending_sms', // default status
      screenshotUrl: screenshotPath,
      senderPhone: null,
      trxId: null,
      smsMatchedId: null,
      ocrConfidence: 0,
      ocrText: '',
      ocrStatus: screenshotPath ? 'pending' : 'none',
      downloadUsed: false,
      createdAt: new Date().toISOString()
    };

    data.orders.push(newOrder);
    db.write(data);

    const immediateMatch = data.smsLogs.find(sms => smsMatchesOrder(sms, newOrder));

    if (immediateMatch) {
      newOrder.status = 'verified';
      newOrder.smsMatchedId = immediateMatch.id;
      newOrder.senderPhone = immediateMatch.senderPhone;
      newOrder.trxId = immediateMatch.trxId;
      
      immediateMatch.isLinked = true;
      immediateMatch.orderId = newOrder.id;
      
      db.write(data);
      console.log(`[Checkout] Immediate Match found for Order ${newOrder.orderId}`);
    }

    // 2. Supplementary OCR (Asynchronous)
    if (screenshotPath) {
      const fullPath = path.join(__dirname, req.file.path);
      runBackgroundOCR(newOrder.id, fullPath, cleanAmount, cleanLast4);
    }

    res.status(200).json({
      success: true,
      message: newOrder.status === 'verified' 
        ? 'تم التحقق من الدفع وتأكيد طلبك بنجاح!' 
        : 'تم استلام طلبك وجاري التحقق من عملية التحويل...',
      order: newOrder
    });

  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error: ' + error.message });
  }
});

// 2. Check Order Status (Polled by checkout frontend)
app.get('/api/orders/:id/status', (req, res) => {
  const data = db.read();
  const order = data.orders.find(o => o.id === req.params.id || o.orderId === req.params.id);
  
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  res.status(200).json({
    success: true,
    status: order.status,
    ocrStatus: order.ocrStatus,
    amount: order.amount,
    orderId: order.orderId,
    customerName: order.customerName,
    ocrConfidence: order.ocrConfidence,
    downloadUsed: !!order.downloadUsed
  });
});

app.post('/api/orders/:id/consume', (req, res) => {
  const data = db.read();
  const order = data.orders.find(o => o.id === req.params.id || o.orderId === req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  if (order.status !== 'verified') {
    return res.status(403).json({ success: false, error: 'Order not verified' });
  }
  if (order.downloadUsed) {
    return res.status(403).json({ success: false, error: 'Download already used' });
  }

  order.downloadUsed = true;
  db.write(data);
  res.status(200).json({ success: true, message: 'Download consumed' });
});


// Asynchronous Tesseract OCR Engine Runner
async function runBackgroundOCR(orderId, imagePath, amount, last4) {
  console.log(`[OCR Start] Processing screenshot for Order ID: ${orderId}`);
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'ara+eng');
    const cleanText = normalizeArabicNumbers(text);
    
    console.log(`[OCR Extracted Text]: "${cleanText.substring(0, 150).replace(/\n/g, ' ')}..."`);

    const data = db.read();
    const order = data.orders.find(o => o.id === orderId);
    
    if (order) {
      order.ocrText = cleanText;
      order.ocrStatus = 'completed';

      // Advanced flexible scanning of the text
      let confidenceScore = 0;

      // Rule A: accepted amount range (>= MIN_PAYMENT_AMOUNT)
      if (textHasAcceptedAmount(cleanText)) {
        confidenceScore += 40;
      }

      // Rule B: Check if the last 4 digits are mentioned in the image
      if (cleanText.includes(last4)) {
        confidenceScore += 30; // Medium confidence for sender's digits
      }

      // Rule C: Keyword matching (Vodafone Cash specific terms)
      const keywords = ['Vodafone', 'فودافون', 'كاش', 'Cash', 'تم تحويل', 'عملية', 'نجاح', 'مبلغ', 'تحويل', 'EGP', 'ج.م'];
      let keywordMatches = 0;
      keywords.forEach(keyword => {
        if (cleanText.toLowerCase().includes(keyword.toLowerCase())) {
          keywordMatches++;
        }
      });

      if (keywordMatches >= 2) {
        confidenceScore += 30;
      } else if (keywordMatches === 1) {
        confidenceScore += 15;
      }

      order.ocrConfidence = confidenceScore;
      
      const hasAmount = textHasAcceptedAmount(cleanText);
      const hasLast4 = cleanText.includes(last4);
      if (order.status === 'pending_sms' && hasAmount && hasLast4 && confidenceScore >= 70) {
        console.log(`[OCR Override] amount+last4 matched (${confidenceScore}%) order ${orderId}`);
        order.status = 'verified';
        order.trxId = 'OCR-AUTO-' + Math.floor(100000 + Math.random() * 900000);
      }

      db.write(data);
      console.log(`[OCR Completed] Order ${orderId} confidence score: ${confidenceScore}%`);
      
      // Re-trigger matching in case it matches now
      matchTransactions();
    }
  } catch (error) {
    console.error(`[OCR Error] Failed to process image for order ${orderId}:`, error);
    const data = db.read();
    const order = data.orders.find(o => o.id === orderId);
    if (order) {
      order.ocrStatus = 'failed';
      db.write(data);
    }
  }
}

// -------------------------------------------------------------
// MERCHANT DASHBOARD APIS
// -------------------------------------------------------------

// Get Dashboard Statistics
app.get('/api/dashboard/stats', (req, res) => {
  const data = db.read();
  
  const totalOrders = data.orders.length;
  const verifiedOrders = data.orders.filter(o => o.status === 'verified').length;
  const pendingOrders = data.orders.filter(o => o.status === 'pending_sms').length;
  
  const totalRevenue = data.orders
    .filter(o => o.status === 'verified')
    .reduce((sum, o) => sum + o.amount, 0);

  const totalSms = data.smsLogs.length;
  const unlinkedSms = data.smsLogs.filter(s => !s.isLinked).length;

  res.status(200).json({
    success: true,
    stats: {
      totalOrders,
      verifiedOrders,
      pendingOrders,
      totalRevenue,
      totalSms,
      unlinkedSms,
      walletNumber: data.settings.walletNumber
    }
  });
});

// Update Wallet Number setting
app.post('/api/dashboard/settings', (req, res) => {
  const { walletNumber } = req.body;
  if (!walletNumber) {
    return res.status(400).json({ success: false, error: 'Wallet number is required' });
  }

  const data = db.read();
  data.settings.walletNumber = walletNumber;
  db.write(data);

  res.status(200).json({ success: true, message: 'Wallet number updated successfully' });
});

// Get all Orders
app.get('/api/dashboard/orders', (req, res) => {
  const data = db.read();
  // Return orders sorted by date (newest first)
  const sortedOrders = [...data.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.status(200).json({ success: true, orders: sortedOrders });
});

// Get all SMS Logs
app.get('/api/dashboard/sms', (req, res) => {
  const data = db.read();
  const sortedSms = [...data.smsLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.status(200).json({ success: true, sms: sortedSms });
});

// Manual Approve Order (Merchant Action)
app.post('/api/dashboard/orders/:id/approve', (req, res) => {
  const data = db.read();
  const order = data.orders.find(o => o.id === req.params.id || o.orderId === req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  order.status = 'verified';
  order.trxId = order.trxId || 'MANUAL-' + Math.floor(100000 + Math.random() * 900000);
  
  db.write(data);
  res.status(200).json({ success: true, message: 'Order manually approved and verified!' });
});

// Simulate SMS Webhook (Merchant Testing Tool)
app.post('/api/dashboard/simulate-sms', (req, res) => {
  const { amount, senderPhone, trxId } = req.body;

  if (!amount || !senderPhone) {
    return res.status(400).json({ success: false, error: 'Amount and Sender Phone are required' });
  }

  const trx = trxId || Math.floor(1000000000 + Math.random() * 9000000000).toString();
  
  // Format standard Vodafone Cash SMS in Arabic
  const smsMessage = `تم تحويل مبلغ ${parseFloat(amount).toFixed(2)} جنيه من رقم ${senderPhone} إلى محفظتك بنجاح. رقم العملية ${trx}.`;
  
  // Directly forward to the standard SMS webhook endpoint
  const data = db.read();
  const newLog = {
    id: 'sms-' + Date.now() + '-' + Math.round(Math.random() * 1000),
    text: smsMessage,
    amount: parseFloat(amount),
    senderPhone: senderPhone,
    senderLast4: senderPhone.slice(-4),
    trxId: trx,
    isLinked: false,
    orderId: null,
    createdAt: new Date().toISOString()
  };

  data.smsLogs.push(newLog);
  db.write(data);

  // Trigger matching logic immediately
  matchTransactions();

  res.status(200).json({ 
    success: true, 
    message: 'SMS simulation successful and processed!', 
    sms: newLog 
  });
});

// Serve frontend apps
app.get('/', (req, res) => {
  res.redirect('/edit-mode.html');
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Vodafone Cash Smart Gateway Running on Port ${PORT}`);
  console.log(`✏️  Edit Studio: http://localhost:${PORT}/edit-mode.html`);
  console.log(`💻 Admin Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`💰 Price: ${PRODUCT_PRICE} EGP (min ${MIN_PAYMENT_AMOUNT}) | Wallet: ${WALLET_NUMBER}`);
  console.log(`🛍️ Customer Checkout: http://localhost:${PORT}/checkout`);
  console.log(`📱 SMS Webhook Endpoint: http://localhost:${PORT}/webhook/sms`);
  console.log(`=======================================================`);
});

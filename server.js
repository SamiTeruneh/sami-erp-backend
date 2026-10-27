// server.js - COMPLETE WITH FORGOT PASSWORD FEATURE
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

// ============ EMAIL CONFIGURATION ============
// ⚠️ IMPORTANT: Configure these with your actual email credentials
// For Gmail: Enable 2FA, then create an App Password at https://myaccount.google.com/apppasswords
const EMAIL_CONFIG = {
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'samsonteruneh@gmail.com',    // ← CHANGE THIS
    pass: process.env.EMAIL_PASS || 'nwdtvusatxwcfphq'         // ← CHANGE THIS (App Password, not regular password!)
  }
};

let transporter = null;
let emailReady = false;

// Initialize email transporter
try {
  transporter = nodemailer.createTransport(EMAIL_CONFIG);
  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ Email service error:', error.message);
      console.log('⚠️  Password reset emails will NOT be sent.');
      console.log('📧 Configure EMAIL_USER and EMAIL_PASS at the top of server.js');
      emailReady = false;
    } else {
      console.log('✅ Email service ready');
      emailReady = true;
    }
  });
} catch (err) {
  console.error('❌ Failed to initialize email:', err.message);
}

// ============ DEFAULT DATABASE ============
const defaultDb = {
  users: [
    {
      id: 1,
      username: 'admin',
      password: 'admin123',
      firstName: 'Super',
      lastName: 'Admin',
      email: 'admin@sami.com',
      phone: null,
      active: true,
      roles: ['Super Admin']
    },
    {
      id: 2,
      username: 'cashier',
      password: 'cashier123',
      firstName: 'John',
      lastName: 'Cashier',
      email: 'cashier@sami.com',
      phone: '0912345678',
      active: true,
      roles: ['Cashier']
    }
  ],
  roles: [
    { id: 1, name: 'Super Admin' },
    { id: 2, name: 'Manager' },
    { id: 3, name: 'Cashier' },
    { id: 4, name: 'Inventory Officer' },
    { id: 5, name: 'Accountant' },
    { id: 6, name: 'Service Officer' }
  ],
  userRoles: [
    { id: 1, userId: 1, roleId: 1 },
    { id: 2, userId: 2, roleId: 3 }
  ],
  products: [
    { id: 1, sku: 'PRD-0001', barcode: '8901234567890', name: 'A4 Paper - 80gsm', sellingPrice: 450, costPrice: 350, stock: 50, reorderLevel: 10, active: true },
    { id: 2, sku: 'PRD-0002', barcode: '8901234567891', name: 'Ballpoint Pen - Blue', sellingPrice: 25, costPrice: 15, stock: 200, reorderLevel: 50, active: true },
    { id: 3, sku: 'PRD-0003', barcode: '8901234567892', name: 'Stapler - Heavy Duty', sellingPrice: 250, costPrice: 180, stock: 15, reorderLevel: 5, active: true }
  ],
  customers: [
    { id: 1, customerCode: 'CUST-001', name: 'John Doe', phone: '0912345678', email: 'john@email.com', balance: 0, creditLimit: 5000, active: true },
    { id: 2, customerCode: 'CUST-002', name: 'Jane Smith', phone: '0923456789', email: 'jane@email.com', balance: 2500, creditLimit: 10000, active: true }
  ],
  suppliers: [
    { id: 1, supplierCode: 'SUP-001', name: 'Paper Supply Co', phone: '0912345670', email: 'info@supply.com', active: true }
  ],
  expenses: [],
  sales: [],
  services: [],
  serviceTypes: [
    { id: 1, name: 'Photocopy', defaultPrice: 2, active: true },
    { id: 2, name: 'Color Printing', defaultPrice: 10, active: true },
    { id: 3, name: 'Lamination', defaultPrice: 50, active: true },
    { id: 4, name: 'Binding', defaultPrice: 100, active: true },
    { id: 5, name: 'Scanning', defaultPrice: 5, active: true },
    { id: 6, name: 'Typing', defaultPrice: 20, active: true },
    { id: 7, name: 'Graphic Design', defaultPrice: 200, active: true },
    { id: 8, name: 'Passport Photo', defaultPrice: 80, active: true },
    { id: 9, name: 'Other', defaultPrice: 0, active: true }
  ],
  tokens: {}
};

let db = JSON.parse(JSON.stringify(defaultDb));

// ============ PASSWORD RESET CODES STORAGE ============
// { userId: { code, expiresAt, email, attempts } }
const passwordResetCodes = {};

// ============ DATA PERSISTENCE ============
function saveData() {
  try {
    const dataToSave = {
      users: db.users,
      roles: db.roles,
      userRoles: db.userRoles,
      products: db.products,
      customers: db.customers,
      suppliers: db.suppliers,
      expenses: db.expenses,
      sales: db.sales,
      services: db.services,
      serviceTypes: db.serviceTypes
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    console.log('💾 Data saved');
  } catch (error) {
    console.error('❌ Save error:', error);
  }
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db = {
        ...defaultDb,
        ...saved,
        users: saved.users || defaultDb.users,
        roles: saved.roles || defaultDb.roles,
        userRoles: saved.userRoles || defaultDb.userRoles,
        products: saved.products || defaultDb.products,
        customers: saved.customers || defaultDb.customers,
        suppliers: saved.suppliers || defaultDb.suppliers,
        expenses: saved.expenses || defaultDb.expenses,
        sales: saved.sales || defaultDb.sales,
        services: saved.services || defaultDb.services,
        serviceTypes: saved.serviceTypes || defaultDb.serviceTypes,
        tokens: {}
      };
      console.log('📂 Data loaded successfully');
      return true;
    }
  } catch (error) {
    console.error('❌ Load error:', error);
  }
  return false;
}

loadData();
setInterval(saveData, 30000);

// ============ EMAIL FUNCTIONS ============
async function sendVerificationCode(toEmail, code, userName) {
  if (!transporter || !emailReady) {
    console.log('⚠️  Email not configured. Code would be sent to:', toEmail);
    console.log('🔑 CODE (for testing):', code);
    return { success: false, error: 'Email not configured', code };
  }

  const mailOptions = {
    from: `"SAMI ERP" <${EMAIL_CONFIG.auth.user}>`,
    to: toEmail,
    subject: '🔐 Password Reset Code - SAMI ERP',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f3f4f6; padding: 20px; margin: 0; }
          .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #3B82F6, #1E40AF); padding: 30px; text-align: center; color: white; }
          .header h1 { margin: 0; font-size: 28px; }
          .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
          .body { padding: 30px; }
          .greeting { font-size: 16px; color: #333; margin-bottom: 16px; }
          .code-box { background: #EFF6FF; border: 2px dashed #3B82F6; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
          .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1E40AF; font-family: 'Courier New', monospace; }
          .label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
          .info { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #92400E; margin: 20px 0; }
          .warning { background: #FEE2E2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #991B1B; margin: 20px 0; }
          .footer { background: #F9FAFB; padding: 20px; text-align: center; font-size: 12px; color: #6B7280; border-top: 1px solid #E5E7EB; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset</h1>
            <p>SAMI ERP Security</p>
          </div>
          <div class="body">
            <p class="greeting">Hello <strong>${userName}</strong>,</p>
            <p style="color: #4B5563; line-height: 1.6;">
              We received a request to reset your SAMI ERP password. Use the code below to verify your identity:
            </p>
            <div class="code-box">
              <div class="label">Your Verification Code</div>
              <div class="code">${code}</div>
            </div>
            <div class="info">
              ⏰ <strong>This code expires in 15 minutes.</strong>
            </div>
            <div class="warning">
              🛡️ <strong>Security Notice:</strong><br>
              If you didn't request this password reset, please ignore this email. Your account is safe.
            </div>
          </div>
          <div class="footer">
            <p style="margin: 0;">© 2024 SAMI ERP • Stationery Management System</p>
            <p style="margin: 8px 0 0; opacity: 0.7;">This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `SAMI ERP - Password Reset\n\nHello ${userName},\n\nYour password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, please ignore this email.\n\n© 2024 SAMI ERP`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('📧 Verification email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    return { success: false, error: error.message };
  }
}

// ============ CORS ============
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { callback(null, body ? JSON.parse(body) : {}); } 
    catch (e) { callback(e, null); }
  });
}

// ============ AUTH ============
function getUserById(id) {
  return db.users.find(u => u.id === id);
}

function getUserFromToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
    return getUserById(decoded.userId);
  } catch { 
    console.error('❌ Invalid token:', token);
    return null; 
  }
}

function generateToken(userId) {
  const payload = JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const base64 = Buffer.from(payload).toString('base64');
  const signature = crypto.createHash('sha256').update(base64 + 'secret-key-123').digest('hex');
  return base64 + '.' + signature;
}

function hasPermission(user, module, action) {
  if (!user) return false;
  if (user.roles && user.roles.includes('Super Admin')) return true;
  if (user.roles && user.roles.includes('Manager')) {
    const perms = {
      dashboard: ['view'], pos: ['view','create'], sales: ['view','create','edit'],
      products: ['view','create','edit'], customers: ['view','create','edit'],
      suppliers: ['view','create','edit'], purchases: ['view','create','edit','approve'],
      expenses: ['view','create','approve'], services: ['view','create','edit'],
      reports: ['view'], users: ['view', 'create', 'edit', 'delete'],
      settings: ['view', 'edit']
    };
    if (perms[module] && perms[module].includes(action)) return true;
  }
  if (user.roles && user.roles.includes('Cashier')) {
    const perms = {
      dashboard: ['view'], pos: ['view','create'], sales: ['view','create'],
      products: ['view'], customers: ['view','create'], expenses: ['view','create'],
      services: ['view','create','edit'], reports: ['view'],
      users: ['view'], settings: []
    };
    if (perms[module] && perms[module].includes(action)) return true;
  }
  return false;
}

function checkAuth(req, res, module, action, callback) {
  const auth = req.headers.authorization;
  if (!auth) {
    return sendJson(res, 401, { message: 'Authentication required' });
  }
  
  const token = auth.split(' ')[1];
  if (!token) {
    return sendJson(res, 401, { message: 'Invalid token' });
  }
  
  const user = getUserFromToken(token);
  if (!user) {
    return sendJson(res, 401, { message: 'User not found' });
  }
  
  const fullName = user.firstName + ' ' + user.lastName;
  console.log(`🔐 ${user.username} (${fullName}) - ID: ${user.id}`);
  console.log(`   Roles: ${user.roles ? user.roles.join(', ') : 'None'}`);
  
  if (!hasPermission(user, module, action)) {
    console.log(`   ❌ No permission for ${module}.${action}`);
    return sendJson(res, 403, { message: 'Insufficient permissions' });
  }
  
  console.log(`   ✅ Has permission for ${module}.${action}`);
  callback(user);
}

// ============ RECEIPT ============
function generateReceipt(sale) {
  const lines = [
    '=================================',
    '     SAMI STATIONARY',
    '     Addis Ababa, Ethiopia',
    '     Tel: +251-900-000-000',
    '=================================',
    `Invoice: ${sale.invoiceNumber}`,
    `Date: ${new Date(sale.saleDate).toLocaleDateString()}`,
    `Time: ${sale.saleTime}`,
    `Cashier: ${sale.cashierName || 'Unknown'}`,
    '---------------------------------',
    'Item          Qty  Price   Total',
    '---------------------------------',
  ];
  for (const item of sale.items) {
    const name = (item.productNameSnapshot || 'Product').substring(0, 12);
    lines.push(`${name.padEnd(12)} ${item.quantity.toString().padEnd(6)} ${item.unitPrice.toFixed(2).padEnd(8)} ${item.lineTotal.toFixed(2)}`);
  }
  lines.push('---------------------------------');
  lines.push(`Subtotal: ${sale.subtotal.toFixed(2)}`.padStart(30));
  if (sale.discount > 0) lines.push(`Discount: -${sale.discount.toFixed(2)}`.padStart(30));
  lines.push(`Total: ${sale.total.toFixed(2)}`.padStart(30));
  lines.push(`Paid: ${sale.amountPaid.toFixed(2)}`.padStart(30));
  const change = sale.amountPaid - sale.total;
  if (change >= 0) lines.push(`Change: ${change.toFixed(2)}`.padStart(30));
  else lines.push(`Balance: ${(-change).toFixed(2)}`.padStart(30));
  lines.push('---------------------------------');
  lines.push('     Thank you for shopping!');
  lines.push('=================================');
  return lines.join('\n');
}

// ============ CREATE SERVER ============
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  console.log(`📝 ${method} ${path}`);

  if (method === 'OPTIONS') {
    setCors(res);
    res.writeHead(200);
    res.end();
    return;
  }

  // ============ HEALTH ============
  if (path === '/api/v1/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', emailReady });
  }

  // ============ LOGIN ============
  if (path === '/api/v1/auth/login' && method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      const user = db.users.find(u => u.username === body.username);
      if (!user || user.password !== body.password) {
        return sendJson(res, 401, { message: 'Invalid credentials' });
      }
      
      if (!user.active) {
        return sendJson(res, 401, { message: 'Account is inactive. Contact administrator.' });
      }
      
      const token = generateToken(user.id);
      db.tokens[token] = user.id;
      
      const roleNames = db.userRoles.filter(ur => ur.userId === user.id)
        .map(ur => { const r = db.roles.find(r => r.id === ur.roleId); return r ? r.name : null; })
        .filter(Boolean);
      
      if (roleNames.length === 0 && user.roles) roleNames.push(...user.roles);
      
      console.log(`✅ Login successful: ${user.username}`);
      console.log(`   Roles: ${roleNames.join(', ')}`);
      
      sendJson(res, 200, {
        accessToken: token,
        refreshToken: 'refresh-' + token,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          roles: roleNames,
          permissions: ['*']
        }
      });
    });
    return;
  }

  // ============ REFRESH TOKEN ============
  if (path === '/api/v1/auth/refresh' && method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      const token = generateToken(1);
      sendJson(res, 200, {
        accessToken: token,
        refreshToken: 'refresh-' + token
      });
    });
    return;
  }

  // ============ LOGOUT ============
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    sendJson(res, 200, { message: 'Logged out successfully' });
    return;
  }

  // ============ CHANGE PASSWORD ============
  if (path === '/api/v1/auth/change-password' && method === 'POST') {
    const auth = req.headers.authorization;
    if (!auth) return sendJson(res, 401, { message: 'Authentication required' });
    
    const token = auth.split(' ')[1];
    if (!token) return sendJson(res, 401, { message: 'Invalid token' });
    
    const user = getUserFromToken(token);
    if (!user) return sendJson(res, 401, { message: 'User not found' });
    
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      console.log('🔑 Password change request from:', user.username);
      
      if (!body.currentPassword) {
        return sendJson(res, 400, { message: 'Current password is required' });
      }
      
      if (user.password !== body.currentPassword) {
        console.log('❌ Current password is incorrect');
        return sendJson(res, 400, { message: 'Current password is incorrect' });
      }
      
      if (!body.newPassword) {
        return sendJson(res, 400, { message: 'New password is required' });
      }
      
      if (body.newPassword.length < 6) {
        return sendJson(res, 400, { message: 'New password must be at least 6 characters' });
      }
      
      if (body.currentPassword === body.newPassword) {
        return sendJson(res, 400, { message: 'New password must be different from current password' });
      }
      
      user.password = body.newPassword;
      user.passwordHash = body.newPassword;
      user.updatedAt = new Date().toISOString();
      
      Object.keys(db.tokens).forEach(tokenKey => {
        if (db.tokens[tokenKey] === user.id) {
          delete db.tokens[tokenKey];
        }
      });
      
      console.log(`✅ Password changed successfully for: ${user.username}`);
      
      sendJson(res, 200, { 
        message: 'Password changed successfully',
        requireRelogin: true
      });
      saveData();
    });
    return;
  }

  // ============ FORGOT PASSWORD - REQUEST CODE ============
  if (path === '/api/v1/auth/forgot-password' && method === 'POST') {
    parseBody(req, async (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      const { username, email } = body;
      
      console.log('🔐 Password reset requested for:', username || email);
      
      if (!username && !email) {
        return sendJson(res, 400, { message: 'Username or email is required' });
      }
      
      // Find user by username OR email
      const user = db.users.find(u => 
        (username && u.username === username) || 
        (email && u.email && u.email.toLowerCase() === email.toLowerCase())
      );
      
      if (!user) {
        console.log('❌ User not found');
        return sendJson(res, 200, { 
          message: 'If an account exists, a reset code has been sent to the registered email.',
          success: true
        });
      }
      
      if (!user.active) {
        return sendJson(res, 400, { message: 'Account is inactive. Contact administrator.' });
      }
      
      // Only allow Super Admin / Manager
      if (!user.roles || (!user.roles.includes('Super Admin') && !user.roles.includes('Manager'))) {
        console.log('⚠️ User is not admin/manager');
        return sendJson(res, 403, { 
          message: 'Password reset is only available for administrators. Please contact your manager.',
          success: false
        });
      }
      
      if (!user.email) {
        return sendJson(res, 400, { 
          message: 'No email registered for this account. Please contact administrator.',
          success: false
        });
      }
      
      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 15 * 60 * 1000;
      
      passwordResetCodes[user.id] = {
        code,
        expiresAt,
        email: user.email,
        attempts: 0
      };
      
      console.log(`🔑 Reset code generated for ${user.username}: ${code}`);
      console.log(`   Sent to: ${user.email}`);
      console.log(`   Expires at: ${new Date(expiresAt).toLocaleTimeString()}`);
      
      const emailResult = await sendVerificationCode(
        user.email, 
        code, 
        `${user.firstName} ${user.lastName}`
      );
      
      const maskedEmail = user.email.replace(/(.{1})(.*)(@.*)/, '$1***$3');
      
      if (!emailResult.success) {
        console.error('❌ Email failed:', emailResult.error);
        
        // In development mode, still allow the flow (code visible in terminal)
        if (process.env.NODE_ENV !== 'production') {
          return sendJson(res, 200, { 
            message: `📧 Email not configured. Code printed in server terminal. (Dev mode)`,
            success: true,
            email: maskedEmail,
            devMode: true
          });
        }
        
        return sendJson(res, 500, { 
          message: 'Failed to send email. Please try again or contact support.',
          success: false
        });
      }
      
      sendJson(res, 200, { 
        message: `Verification code sent to ${maskedEmail}`,
        success: true,
        email: maskedEmail
      });
    });
    return;
  }

  // ============ FORGOT PASSWORD - VERIFY CODE ============
  if (path === '/api/v1/auth/verify-reset-code' && method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      const { username, email, code } = body;
      
      if (!code) {
        return sendJson(res, 400, { message: 'Verification code is required' });
      }
      
      const user = db.users.find(u => 
        (username && u.username === username) || 
        (email && u.email && u.email.toLowerCase() === email.toLowerCase())
      );
      
      if (!user) {
        return sendJson(res, 400, { message: 'Invalid verification code' });
      }
      
      const resetData = passwordResetCodes[user.id];
      
      if (!resetData) {
        return sendJson(res, 400, { message: 'No reset request found. Please request a new code.' });
      }
      
      if (Date.now() > resetData.expiresAt) {
        delete passwordResetCodes[user.id];
        return sendJson(res, 400, { message: 'Verification code has expired. Please request a new one.' });
      }
      
      if (resetData.attempts >= 5) {
        delete passwordResetCodes[user.id];
        return sendJson(res, 400, { message: 'Too many incorrect attempts. Please request a new code.' });
      }
      
      if (resetData.code !== code) {
        resetData.attempts++;
        console.log(`❌ Wrong code. Attempt ${resetData.attempts}/5`);
        return sendJson(res, 400, { 
          message: `Invalid verification code. ${5 - resetData.attempts} attempts remaining.` 
        });
      }
      
      console.log(`✅ Code verified for ${user.username}`);
      
      sendJson(res, 200, { 
        message: 'Code verified successfully',
        success: true,
        verified: true
      });
    });
    return;
  }

  // ============ FORGOT PASSWORD - RESET ============
  if (path === '/api/v1/auth/reset-password' && method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      const { username, email, code, newPassword } = body;
      
      if (!code || !newPassword) {
        return sendJson(res, 400, { message: 'Code and new password are required' });
      }
      
      if (newPassword.length < 6) {
        return sendJson(res, 400, { message: 'Password must be at least 6 characters' });
      }
      
      const user = db.users.find(u => 
        (username && u.username === username) || 
        (email && u.email && u.email.toLowerCase() === email.toLowerCase())
      );
      
      if (!user) {
        return sendJson(res, 400, { message: 'Invalid request' });
      }
      
      const resetData = passwordResetCodes[user.id];
      
      if (!resetData) {
        return sendJson(res, 400, { message: 'No reset request found. Please start over.' });
      }
      
      if (Date.now() > resetData.expiresAt) {
        delete passwordResetCodes[user.id];
        return sendJson(res, 400, { message: 'Code expired. Please request a new one.' });
      }
      
      if (resetData.code !== code) {
        return sendJson(res, 400, { message: 'Invalid verification code' });
      }
      
      user.password = newPassword;
      user.passwordHash = newPassword;
      user.updatedAt = new Date().toISOString();
      
      delete passwordResetCodes[user.id];
      
      Object.keys(db.tokens).forEach(tokenKey => {
        if (db.tokens[tokenKey] === user.id) {
          delete db.tokens[tokenKey];
        }
      });
      
      console.log(`✅ Password reset successfully for ${user.username}`);
      
      sendJson(res, 200, { 
        message: 'Password reset successfully! You can now login with your new password.',
        success: true
      });
      saveData();
    });
    return;
  }

  // ============ ROLES ============
  if (path === '/api/v1/roles' && method === 'GET') {
    sendJson(res, 200, db.roles);
    return;
  }

  // ============ USERS ============
  if (path === '/api/v1/users' && method === 'GET') {
    checkAuth(req, res, 'users', 'view', (user) => {
      const usersWithRoles = db.users.map(u => {
        const userRoles = db.userRoles ? db.userRoles.filter(ur => ur.userId === u.id) : [];
        let roleNames = userRoles.map(ur => {
          const role = db.roles.find(r => r.id === ur.roleId);
          return role ? role.name : null;
        }).filter(Boolean);
        
        if (roleNames.length === 0 && u.roles) {
          roleNames = u.roles;
        }
        
        return {
          id: u.id,
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: u.phone,
          active: u.active,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
          roles: roleNames,
          permissions: ['*']
        };
      });
      sendJson(res, 200, usersWithRoles);
    });
    return;
  }

  // ============ USERS - CREATE ============
  if (path === '/api/v1/users' && method === 'POST') {
    const auth = req.headers.authorization;
    if (!auth) return sendJson(res, 401, { message: 'Authentication required' });
    
    const token = auth.split(' ')[1];
    if (!token) return sendJson(res, 401, { message: 'Invalid token' });
    
    const currentUser = getUserFromToken(token);
    if (!currentUser) return sendJson(res, 401, { message: 'User not found' });
    
    const canCreate = currentUser.roles && (currentUser.roles.includes('Super Admin') || currentUser.roles.includes('Manager'));
    if (!canCreate) {
      return sendJson(res, 403, { message: 'You do not have permission to create users' });
    }
    
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      if (!body.username) return sendJson(res, 400, { message: 'Username is required' });
      if (!body.firstName || !body.lastName) return sendJson(res, 400, { message: 'First and last name are required' });
      if (!body.password) return sendJson(res, 400, { message: 'Password is required' });
      if (body.password.length < 6) return sendJson(res, 400, { message: 'Password must be at least 6 characters' });
      if (!body.roles || body.roles.length === 0) return sendJson(res, 400, { message: 'At least one role is required' });
      
      if (db.users.find(u => u.username === body.username)) {
        return sendJson(res, 400, { message: 'Username already exists' });
      }
      
      const newUser = {
        id: db.users.length + 1,
        username: body.username,
        email: body.email || null,
        password: body.password,
        passwordHash: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone || null,
        active: body.active !== false,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        companyId: 1,
        branchId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        roles: body.roles
      };
      
      db.users.push(newUser);
      
      if (body.roles && body.roles.length > 0) {
        if (!db.userRoles) db.userRoles = [];
        body.roles.forEach(roleName => {
          const role = db.roles.find(r => r.name === roleName);
          if (role) {
            db.userRoles.push({
              id: db.userRoles.length + 1,
              userId: newUser.id,
              roleId: role.id,
              createdAt: new Date().toISOString()
            });
          }
        });
      }
      
      const responseUser = {
        ...newUser,
        password: undefined,
        passwordHash: undefined,
      };
      
      sendJson(res, 201, responseUser);
      saveData();
    });
    return;
  }

  // ============ USERS - UPDATE ============
  if (path.match(/^\/api\/v1\/users\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    const auth = req.headers.authorization;
    if (!auth) return sendJson(res, 401, { message: 'Authentication required' });
    
    const token = auth.split(' ')[1];
    const currentUser = getUserFromToken(token);
    if (!currentUser) return sendJson(res, 401, { message: 'User not found' });
    
    const canUpdate = currentUser.roles && (currentUser.roles.includes('Super Admin') || currentUser.roles.includes('Manager'));
    if (!canUpdate) {
      return sendJson(res, 403, { message: 'You do not have permission to update users' });
    }
    
    parseBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
      
      const index = db.users.findIndex(u => u.id === id);
      if (index === -1) return sendJson(res, 404, { message: 'User not found' });
      
      db.users[index] = {
        ...db.users[index],
        email: body.email !== undefined ? body.email : db.users[index].email,
        firstName: body.firstName || db.users[index].firstName,
        lastName: body.lastName || db.users[index].lastName,
        phone: body.phone !== undefined ? body.phone : db.users[index].phone,
        active: body.active !== undefined ? body.active : db.users[index].active,
        roles: body.roles || db.users[index].roles,
        updatedAt: new Date().toISOString()
      };
      
      if (body.password) {
        db.users[index].password = body.password;
        db.users[index].passwordHash = body.password;
      }
      
      if (body.roles) {
        db.userRoles = db.userRoles.filter(ur => ur.userId !== id);
        body.roles.forEach(roleName => {
          const role = db.roles.find(r => r.name === roleName);
          if (role) {
            db.userRoles.push({
              id: db.userRoles.length + 1,
              userId: id,
              roleId: role.id,
              createdAt: new Date().toISOString()
            });
          }
        });
      }
      
      const responseUser = {
        ...db.users[index],
        password: undefined,
        passwordHash: undefined,
      };
      
      sendJson(res, 200, responseUser);
      saveData();
    });
    return;
  }

  // ============ PRODUCTS ============
  if (path === '/api/v1/products' && method === 'GET') {
    checkAuth(req, res, 'products', 'view', (user) => {
      sendJson(res, 200, db.products);
    });
    return;
  }

  if (path === '/api/v1/products/search' && method === 'GET') {
    checkAuth(req, res, 'products', 'view', (user) => {
      const q = parsedUrl.query.q || '';
      const products = db.products.filter(p => 
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        p.sku.toLowerCase().includes(q.toLowerCase()) ||
        (p.barcode && p.barcode.includes(q))
      );
      sendJson(res, 200, products);
    });
    return;
  }

  if (path.startsWith('/api/v1/products/barcode/') && method === 'GET') {
    checkAuth(req, res, 'products', 'view', (user) => {
      const barcode = path.split('/').pop();
      const product = db.products.find(p => p.barcode === barcode);
      if (product) {
        sendJson(res, 200, product);
      } else {
        sendJson(res, 404, { message: 'Product not found' });
      }
    });
    return;
  }

  if (path.match(/^\/api\/v1\/products\/\d+$/) && method === 'GET') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'products', 'view', (user) => {
      const product = db.products.find(p => p.id === id);
      if (product) {
        sendJson(res, 200, product);
      } else {
        sendJson(res, 404, { message: 'Product not found' });
      }
    });
    return;
  }

  if (path === '/api/v1/products' && method === 'POST') {
    checkAuth(req, res, 'products', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const newProduct = {
          id: db.products.length + 1,
          sku: body.sku || `PRD-${String(db.products.length + 1).padStart(4, '0')}`,
          barcode: body.barcode || '',
          name: body.name,
          description: body.description || '',
          brand: body.brand || '',
          category: body.category || '',
          unit: body.unit || 'Piece',
          sellingPrice: parseFloat(body.sellingPrice) || 0,
          costPrice: parseFloat(body.costPrice) || 0,
          stock: parseInt(body.stock) || 0,
          reorderLevel: parseInt(body.reorderLevel) || 0,
          reorderQuantity: parseInt(body.reorderQuantity) || 0,
          active: body.active !== false,
          createdAt: new Date().toISOString()
        };
        
        db.products.push(newProduct);
        sendJson(res, 201, newProduct);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/products\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    
    checkAuth(req, res, 'products', 'edit', (user) => {
      parseBody(req, (err, body) => {
        if (err) {
          return sendJson(res, 400, { message: 'Invalid JSON' });
        }
        
        const index = db.products.findIndex(p => p.id === id);
        if (index === -1) {
          return sendJson(res, 404, { message: 'Product not found' });
        }
        
        db.products[index] = {
          ...db.products[index],
          sku: body.sku || db.products[index].sku,
          barcode: body.barcode || db.products[index].barcode,
          name: body.name || db.products[index].name,
          description: body.description !== undefined ? body.description : db.products[index].description,
          brand: body.brand !== undefined ? body.brand : db.products[index].brand,
          category: body.category !== undefined ? body.category : db.products[index].category,
          unit: body.unit !== undefined ? body.unit : db.products[index].unit,
          sellingPrice: body.sellingPrice !== undefined ? parseFloat(body.sellingPrice) : db.products[index].sellingPrice,
          costPrice: body.costPrice !== undefined ? parseFloat(body.costPrice) : db.products[index].costPrice,
          stock: body.stock !== undefined ? parseInt(body.stock) : db.products[index].stock,
          reorderLevel: body.reorderLevel !== undefined ? parseInt(body.reorderLevel) : db.products[index].reorderLevel,
          reorderQuantity: body.reorderQuantity !== undefined ? parseInt(body.reorderQuantity) : db.products[index].reorderQuantity,
          active: body.active !== undefined ? body.active : db.products[index].active,
          updatedAt: new Date().toISOString()
        };
        
        sendJson(res, 200, db.products[index]);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/products\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'products', 'delete', (user) => {
      const index = db.products.findIndex(p => p.id === id);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Product not found' });
      }
      
      const deleted = db.products.splice(index, 1)[0];
      sendJson(res, 200, { message: 'Product deleted successfully', product: deleted });
      saveData();
    });
    return;
  }

  // ============ CUSTOMERS ============
  if (path === '/api/v1/customers' && method === 'GET') {
    checkAuth(req, res, 'customers', 'view', (user) => {
      sendJson(res, 200, db.customers);
    });
    return;
  }

  if (path === '/api/v1/customers' && method === 'POST') {
    checkAuth(req, res, 'customers', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        const newCustomer = {
          id: db.customers.length + 1,
          customerCode: `CUST-${String(db.customers.length + 1).padStart(3, '0')}`,
          ...body,
          balance: parseFloat(body.balance) || 0,
          creditLimit: parseFloat(body.creditLimit) || null,
          active: body.active !== false,
          totalPurchases: 0,
          createdAt: new Date().toISOString()
        };
        db.customers.push(newCustomer);
        sendJson(res, 201, newCustomer);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/customers\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'customers', 'edit', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const index = db.customers.findIndex(c => c.id === id);
        if (index === -1) return sendJson(res, 404, { message: 'Customer not found' });
        
        db.customers[index] = {
          ...db.customers[index],
          ...body,
          balance: body.balance !== undefined ? parseFloat(body.balance) : db.customers[index].balance,
          creditLimit: body.creditLimit !== undefined ? parseFloat(body.creditLimit) : db.customers[index].creditLimit,
          active: body.active !== undefined ? body.active : db.customers[index].active,
          updatedAt: new Date().toISOString()
        };
        
        sendJson(res, 200, db.customers[index]);
        saveData();
      });
    });
    return;
  }

  // ============ SUPPLIERS ============
  if (path === '/api/v1/suppliers' && method === 'GET') {
    checkAuth(req, res, 'suppliers', 'view', (user) => {
      sendJson(res, 200, db.suppliers);
    });
    return;
  }

  if (path.match(/^\/api\/v1\/suppliers\/\d+$/) && method === 'GET') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'suppliers', 'view', (user) => {
      const supplier = (db.suppliers || []).find(s => s.id === id);
      if (supplier) {
        sendJson(res, 200, supplier);
      } else {
        sendJson(res, 404, { message: 'Supplier not found' });
      }
    });
    return;
  }

  if (path === '/api/v1/suppliers' && method === 'POST') {
    checkAuth(req, res, 'suppliers', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        if (!body.name) {
          return sendJson(res, 400, { message: 'Supplier name is required' });
        }
        
        if (!db.suppliers) db.suppliers = [];
        
        const newSupplier = {
          id: db.suppliers.length > 0 ? Math.max(...db.suppliers.map(s => s.id)) + 1 : 1,
          supplierCode: body.supplierCode || `SUP-${String(db.suppliers.length + 1).padStart(3, '0')}`,
          name: body.name,
          contactPerson: body.contactPerson || '',
          phone: body.phone || '',
          email: body.email || '',
          address: body.address || '',
          city: body.city || '',
          country: body.country || 'Ethiopia',
          taxId: body.taxId || '',
          paymentTerms: body.paymentTerms || 'Cash',
          creditLimit: parseFloat(body.creditLimit) || 0,
          balance: parseFloat(body.balance) || 0,
          notes: body.notes || '',
          active: body.active !== false,
          createdAt: new Date().toISOString()
        };
        
        db.suppliers.push(newSupplier);
        sendJson(res, 201, newSupplier);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/suppliers\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    
    checkAuth(req, res, 'suppliers', 'edit', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        if (!db.suppliers) db.suppliers = [];
        
        const index = db.suppliers.findIndex(s => s.id === id);
        if (index === -1) {
          return sendJson(res, 404, { message: 'Supplier not found' });
        }
        
        db.suppliers[index] = {
          ...db.suppliers[index],
          name: body.name || db.suppliers[index].name,
          contactPerson: body.contactPerson !== undefined ? body.contactPerson : db.suppliers[index].contactPerson,
          phone: body.phone !== undefined ? body.phone : db.suppliers[index].phone,
          email: body.email !== undefined ? body.email : db.suppliers[index].email,
          address: body.address !== undefined ? body.address : db.suppliers[index].address,
          city: body.city !== undefined ? body.city : db.suppliers[index].city,
          country: body.country !== undefined ? body.country : db.suppliers[index].country,
          taxId: body.taxId !== undefined ? body.taxId : db.suppliers[index].taxId,
          paymentTerms: body.paymentTerms !== undefined ? body.paymentTerms : db.suppliers[index].paymentTerms,
          creditLimit: body.creditLimit !== undefined ? parseFloat(body.creditLimit) : db.suppliers[index].creditLimit,
          balance: body.balance !== undefined ? parseFloat(body.balance) : db.suppliers[index].balance,
          notes: body.notes !== undefined ? body.notes : db.suppliers[index].notes,
          active: body.active !== undefined ? body.active : db.suppliers[index].active,
          updatedAt: new Date().toISOString()
        };
        
        sendJson(res, 200, db.suppliers[index]);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/suppliers\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'suppliers', 'delete', (user) => {
      if (!db.suppliers) db.suppliers = [];
      
      const index = db.suppliers.findIndex(s => s.id === id);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Supplier not found' });
      }
      
      const deleted = db.suppliers.splice(index, 1)[0];
      sendJson(res, 200, { message: 'Supplier deleted successfully', supplier: deleted });
      saveData();
    });
    return;
  }

  // ============ SALES ============
  if (path === '/api/v1/sales' && method === 'GET') {
    checkAuth(req, res, 'sales', 'view', (user) => {
      sendJson(res, 200, db.sales);
    });
    return;
  }

  if (path === '/api/v1/sales' && method === 'POST') {
    checkAuth(req, res, 'sales', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const fullName = user.firstName + ' ' + user.lastName;
        const { items, customerId, paymentMethod, amountReceived, notes, discount } = body;
        
        if (!items || items.length === 0) {
          return sendJson(res, 400, { message: 'Sale must have at least one item' });
        }
        
        let subtotal = 0;
        const saleItems = [];
        
        for (const item of items) {
          const product = db.products.find(p => p.id === item.productId);
          if (!product) return sendJson(res, 404, { message: `Product ${item.productId} not found` });
          if (product.stock < item.quantity) {
            return sendJson(res, 400, { message: `Insufficient stock for ${product.name}` });
          }
          const lineTotal = item.quantity * item.unitPrice - (item.discount || 0);
          subtotal += lineTotal;
          saleItems.push({
            productId: product.id,
            productNameSnapshot: product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: product.costPrice || 0,
            discount: item.discount || 0,
            tax: item.tax || 0,
            lineTotal
          });
          product.stock -= item.quantity;
        }
        
        const discountAmount = discount || 0;
        const total = subtotal - discountAmount;
        const balanceDue = total - (amountReceived || 0);
        const customer = db.customers.find(c => c.id === customerId);
        
        const sale = {
          id: db.sales.length + 1,
          invoiceNumber: `INV-${new Date().getFullYear()}-${String(db.sales.length + 1).padStart(6, '0')}`,
          saleDate: new Date(),
          saleTime: new Date().toLocaleTimeString(),
          customerId: customerId || null,
          customerName: customer ? customer.name : null,
          cashierId: user.id,
          cashierName: fullName,
          cashierUsername: user.username,
          createdBy: user.id,
          createdByName: fullName,
          createdByUsername: user.username,
          status: balanceDue > 0 ? 'Credit' : 'Completed',
          subtotal,
          discount: discountAmount,
          tax: 0,
          total,
          amountPaid: amountReceived || 0,
          balanceDue: balanceDue > 0 ? balanceDue : 0,
          paymentStatus: balanceDue > 0 ? (amountReceived > 0 ? 'Partial' : 'Credit') : 'Paid',
          notes: notes || null,
          items: saleItems,
          payments: amountReceived > 0 ? [{ paymentMethod: paymentMethod || 'Cash', amount: amountReceived }] : [],
          createdAt: new Date().toISOString()
        };
        
        if (customer && balanceDue > 0) {
          customer.balance += balanceDue;
          customer.totalPurchases = (customer.totalPurchases || 0) + total;
        }
        
        db.sales.push(sale);
        sendJson(res, 201, {
          ...sale,
          receipt: generateReceipt(sale)
        });
        saveData();
      });
    });
    return;
  }

  // ============ SALES - DELETE (SUPER ADMIN ONLY) ============
  if (path.match(/^\/api\/v1\/sales\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop());
    console.log(`🗑️ DELETE /api/v1/sales/${id}`);
    
    checkAuth(req, res, 'sales', 'delete', (user) => {
      if (!user.roles.includes('Super Admin')) {
        console.log(`❌ User ${user.username} tried to delete sale - not Super Admin`);
        return sendJson(res, 403, { message: 'Only Super Admin can delete sales' });
      }
      
      const index = db.sales.findIndex(s => s.id === id);
      if (index === -1) {
        console.log(`❌ Sale ${id} not found`);
        return sendJson(res, 404, { message: 'Sale not found' });
      }
      
      const deletedSale = db.sales[index];
      
      if (deletedSale.items && Array.isArray(deletedSale.items)) {
        deletedSale.items.forEach(item => {
          const product = db.products.find(p => p.id === item.productId);
          if (product) {
            product.stock += item.quantity || 0;
          }
        });
      }
      
      if (deletedSale.customerId && deletedSale.balanceDue > 0) {
        const customer = db.customers.find(c => c.id === deletedSale.customerId);
        if (customer) {
          customer.balance -= deletedSale.balanceDue;
        }
      }
      
      db.sales.splice(index, 1);
      
      console.log(`✅ Sale deleted: ${deletedSale.invoiceNumber} by ${user.username}`);
      
      sendJson(res, 200, { 
        message: 'Sale deleted successfully',
        sale: deletedSale,
        stockRestored: true
      });
      saveData();
    });
    return;
  }

  // ============ SERVICES ============
  if (path === '/api/v1/services' && method === 'GET') {
    checkAuth(req, res, 'services', 'view', (user) => {
      sendJson(res, 200, db.services || []);
    });
    return;
  }

  if (path === '/api/v1/services' && method === 'POST') {
    console.log('📥 POST /api/v1/services - Creating service');
    checkAuth(req, res, 'services', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const fullName = user.firstName + ' ' + user.lastName;
        console.log(`🔧 SERVICE by: ${fullName} (${user.username}) - ID: ${user.id}`);
        console.log('   Body:', JSON.stringify(body, null, 2));
        
        if (!db.services) db.services = [];
        
        const unitPrice = parseFloat(body.unitPrice) || 0;
        const quantity = parseInt(body.quantity) || 1;
        const discount = parseFloat(body.discount) || 0;
        const tax = parseFloat(body.tax) || 0;
        const total = (unitPrice * quantity) - discount + tax;
        const amountPaid = parseFloat(body.amountPaid) || 0;
        const balance = total - amountPaid;
        
        const newService = {
          id: db.services.length + 1,
          jobNumber: `SRV-${new Date().getFullYear()}-${String(db.services.length + 1).padStart(4, '0')}`,
          customerId: body.customerId ? parseInt(body.customerId) : null,
          customerName: body.customerName || null,
          serviceTypeId: body.serviceTypeId ? parseInt(body.serviceTypeId) : null,
          serviceType: body.serviceType || '',
          description: body.description || '',
          quantity: quantity,
          unitPrice: unitPrice,
          discount: discount,
          tax: tax,
          total: total,
          amountPaid: amountPaid,
          balance: balance,
          receivedDate: body.receivedDate ? new Date(body.receivedDate).toISOString() : new Date().toISOString(),
          expectedDate: body.expectedDate || null,
          completedDate: null,
          priority: body.priority || 'Normal',
          status: body.status || 'Received',
          notes: body.notes || null,
          createdBy: user.id,
          createdByName: fullName,
          createdByUsername: user.username,
          createdAt: new Date().toISOString()
        };
        
        db.services.push(newService);
        console.log(`✅ Service created by ${fullName}: ${newService.jobNumber} (ETB ${newService.total})`);
        sendJson(res, 201, newService);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/services\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    console.log(`📝 PATCH /api/v1/services/${id}`);
    
    checkAuth(req, res, 'services', 'edit', (user) => {
      parseBody(req, (err, body) => {
        if (err) {
          return sendJson(res, 400, { message: 'Invalid JSON' });
        }
        
        const index = (db.services || []).findIndex(s => s.id === id);
        if (index === -1) {
          return sendJson(res, 404, { message: 'Service not found' });
        }
        
        const currentService = db.services[index];
        
        const unitPrice = body.unitPrice !== undefined ? parseFloat(body.unitPrice) : currentService.unitPrice;
        const quantity = body.quantity !== undefined ? parseInt(body.quantity) : currentService.quantity;
        const discount = body.discount !== undefined ? parseFloat(body.discount) : currentService.discount;
        const tax = body.tax !== undefined ? parseFloat(body.tax) : currentService.tax;
        const total = (unitPrice * quantity) - discount + tax;
        const amountPaid = body.amountPaid !== undefined ? parseFloat(body.amountPaid) : currentService.amountPaid;
        const balance = total - amountPaid;
        
        db.services[index] = {
          ...currentService,
          customerId: body.customerId !== undefined ? (body.customerId ? parseInt(body.customerId) : null) : currentService.customerId,
          customerName: body.customerName !== undefined ? body.customerName : currentService.customerName,
          serviceTypeId: body.serviceTypeId !== undefined ? (body.serviceTypeId ? parseInt(body.serviceTypeId) : null) : currentService.serviceTypeId,
          serviceType: body.serviceType !== undefined ? body.serviceType : currentService.serviceType,
          description: body.description !== undefined ? body.description : currentService.description,
          quantity: quantity,
          unitPrice: unitPrice,
          discount: discount,
          tax: tax,
          total: total,
          amountPaid: amountPaid,
          balance: balance,
          receivedDate: body.receivedDate || currentService.receivedDate,
          expectedDate: body.expectedDate !== undefined ? body.expectedDate : currentService.expectedDate,
          completedDate: body.completedDate !== undefined ? body.completedDate : currentService.completedDate,
          priority: body.priority || currentService.priority,
          status: body.status || currentService.status,
          notes: body.notes !== undefined ? body.notes : currentService.notes,
          updatedAt: new Date().toISOString()
        };
        
        console.log(`✅ Service updated: ${db.services[index].jobNumber}`);
        sendJson(res, 200, db.services[index]);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/services\/\d+$/) && method === 'DELETE') {
    checkAuth(req, res, 'services', 'delete', (user) => {
      const id = parseInt(path.split('/').pop());
      const index = (db.services || []).findIndex(s => s.id === id);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Service not found' });
      }
      
      const deleted = db.services.splice(index, 1)[0];
      console.log(`🗑️ Service deleted: ${deleted.jobNumber}`);
      sendJson(res, 200, { message: 'Service deleted successfully', service: deleted });
      saveData();
    });
    return;
  }

  // ============ SERVICE TYPES ============
  if (path === '/api/v1/services/types' && method === 'GET') {
    console.log('📋 GET /api/v1/services/types');
    checkAuth(req, res, 'services', 'view', (user) => {
      sendJson(res, 200, db.serviceTypes || []);
    });
    return;
  }

  if (path === '/api/v1/services/types' && method === 'POST') {
    console.log('📥 POST /api/v1/services/types - Creating type');
    checkAuth(req, res, 'services', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        if (!body.name) {
          return sendJson(res, 400, { message: 'Service type name is required' });
        }
        
        if (!db.serviceTypes) db.serviceTypes = [];
        
        const newType = {
          id: db.serviceTypes.length > 0 ? Math.max(...db.serviceTypes.map(t => t.id)) + 1 : 1,
          name: body.name,
          description: body.description || '',
          defaultPrice: parseFloat(body.defaultPrice) || 0,
          active: body.active !== false,
          createdAt: new Date().toISOString()
        };
        
        db.serviceTypes.push(newType);
        console.log(`✅ Service type created: ${newType.name}`);
        sendJson(res, 201, newType);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/services\/types\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    console.log(`📝 PATCH /api/v1/services/types/${id}`);
    
    checkAuth(req, res, 'services', 'edit', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        if (!db.serviceTypes) db.serviceTypes = [];
        
        const index = db.serviceTypes.findIndex(t => t.id === id);
        if (index === -1) {
          return sendJson(res, 404, { message: 'Service type not found' });
        }
        
        db.serviceTypes[index] = {
          ...db.serviceTypes[index],
          name: body.name || db.serviceTypes[index].name,
          description: body.description !== undefined ? body.description : db.serviceTypes[index].description,
          defaultPrice: body.defaultPrice !== undefined ? parseFloat(body.defaultPrice) : db.serviceTypes[index].defaultPrice,
          active: body.active !== undefined ? body.active : db.serviceTypes[index].active,
          updatedAt: new Date().toISOString()
        };
        
        console.log(`✅ Service type updated: ${db.serviceTypes[index].name}`);
        sendJson(res, 200, db.serviceTypes[index]);
        saveData();
      });
    });
    return;
  }

  if (path.match(/^\/api\/v1\/services\/types\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'services', 'delete', (user) => {
      if (!db.serviceTypes) db.serviceTypes = [];
      
      const index = db.serviceTypes.findIndex(t => t.id === id);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Service type not found' });
      }
      
      const deleted = db.serviceTypes.splice(index, 1)[0];
      console.log(`🗑️ Service type deleted: ${deleted.name}`);
      sendJson(res, 200, { message: 'Service type deleted successfully', serviceType: deleted });
      saveData();
    });
    return;
  }

  // ============ EXPENSES ============
  if (path === '/api/v1/expenses' && method === 'GET') {
    checkAuth(req, res, 'expenses', 'view', (user) => {
      sendJson(res, 200, db.expenses);
    });
    return;
  }

  if (path === '/api/v1/expenses' && method === 'POST') {
    checkAuth(req, res, 'expenses', 'create', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const fullName = user.firstName + ' ' + user.lastName;
        
        const newExpense = {
          id: db.expenses.length + 1,
          expenseNumber: `EXP-${new Date().getFullYear()}-${String(db.expenses.length + 1).padStart(4, '0')}`,
          ...body,
          amount: parseFloat(body.amount) || 0,
          tax: parseFloat(body.tax) || 0,
          total: (parseFloat(body.amount) || 0) + (parseFloat(body.tax) || 0),
          status: 'Pending',
          createdBy: user.id,
          createdByName: fullName,
          createdByUsername: user.username,
          createdAt: new Date().toISOString()
        };
        db.expenses.push(newExpense);
        sendJson(res, 201, newExpense);
        saveData();
      });
    });
    return;
  }

  // ============ EXPENSES - APPROVE/REJECT ============
  if (path.match(/^\/api\/v1\/expenses\/\d+\/approve$/) && method === 'PATCH') {
    const pathParts = path.split('/');
    const id = parseInt(pathParts[4]);
    console.log(`📝 PATCH /api/v1/expenses/${id}/approve`);
    
    if (isNaN(id)) {
      return sendJson(res, 400, { message: 'Invalid expense ID' });
    }
    
    checkAuth(req, res, 'expenses', 'approve', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const index = db.expenses.findIndex(e => e.id === id);
        if (index === -1) {
          return sendJson(res, 404, { message: 'Expense not found' });
        }
        
        const newStatus = body.status || 'Approved';
        
        db.expenses[index] = {
          ...db.expenses[index],
          status: newStatus,
          approvedBy: user.id,
          approvedByName: user.firstName + ' ' + user.lastName,
          approvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        console.log(`✅ Expense ${id} ${newStatus} by ${user.username}`);
        sendJson(res, 200, db.expenses[index]);
        saveData();
      });
    });
    return;
  }

  // ============ EXPENSES - UPDATE (PATCH) ============
  if (path.match(/^\/api\/v1\/expenses\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop());
    
    checkAuth(req, res, 'expenses', 'approve', (user) => {
      parseBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const index = db.expenses.findIndex(e => e.id === id);
        if (index === -1) {
          return sendJson(res, 404, { message: 'Expense not found' });
        }
        
        db.expenses[index] = {
          ...db.expenses[index],
          ...body,
          amount: body.amount !== undefined ? parseFloat(body.amount) : db.expenses[index].amount,
          tax: body.tax !== undefined ? parseFloat(body.tax) : db.expenses[index].tax,
          total: body.total !== undefined ? parseFloat(body.total) : 
                (body.amount !== undefined || body.tax !== undefined 
                  ? (parseFloat(body.amount) || db.expenses[index].amount) + (parseFloat(body.tax) || db.expenses[index].tax)
                  : db.expenses[index].total),
          status: body.status || db.expenses[index].status,
          updatedAt: new Date().toISOString()
        };
        
        if (body.status && (body.status === 'Approved' || body.status === 'Rejected')) {
          db.expenses[index].approvedBy = user.id;
          db.expenses[index].approvedByName = user.firstName + ' ' + user.lastName;
          db.expenses[index].approvedAt = new Date().toISOString();
        }
        
        sendJson(res, 200, db.expenses[index]);
        saveData();
      });
    });
    return;
  }

  // ============ EXPENSES - DELETE ============
  if (path.match(/^\/api\/v1\/expenses\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop());
    checkAuth(req, res, 'expenses', 'approve', (user) => {
      const index = db.expenses.findIndex(e => e.id === id);
      if (index === -1) {
        return sendJson(res, 404, { message: 'Expense not found' });
      }
      
      const deleted = db.expenses.splice(index, 1)[0];
      sendJson(res, 200, { message: 'Expense deleted successfully', expense: deleted });
      saveData();
    });
    return;
  }

    // ============ DASHBOARD ============
  if (path === '/api/v1/reports/dashboard' && method === 'GET') {
    checkAuth(req, res, 'dashboard', 'view', (user) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // ============ TODAY'S PRODUCT SALES ============
      const todaySales = db.sales.filter(s => {
        const saleDate = new Date(s.saleDate);
        return saleDate >= today && saleDate < tomorrow;
      });
      const totalTodayProductSales = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
      const todaySalesCount = todaySales.length;

      // ============ TODAY'S SERVICE REVENUE ============
      // Count services created/received today
      const todayServices = (db.services || []).filter(s => {
        const serviceDate = new Date(s.receivedDate || s.createdAt);
        return serviceDate >= today && serviceDate < tomorrow;
      });
      const totalTodayServiceRevenue = todayServices.reduce((sum, s) => sum + (s.total || 0), 0);
      const todayServicesCount = todayServices.length;
      const todayServicePaid = todayServices.reduce((sum, s) => sum + (s.amountPaid || 0), 0);

      // ============ COMBINED TODAY'S TOTAL ============
      const totalTodaySales = totalTodayProductSales + totalTodayServiceRevenue;
      const totalTodayTransactions = todaySalesCount + todayServicesCount;

      // Today's profit (product margin ~30% + service margin ~40%)
      const todayProductProfit = todaySales.reduce((sum, s) => sum + (s.total || 0) * 0.3, 0);
      const todayServiceProfit = todayServices.reduce((sum, s) => sum + (s.total || 0) * 0.4, 0);
      const todayProfit = todayProductProfit + todayServiceProfit;

      // ============ MONTHLY PRODUCT SALES ============
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthSales = db.sales.filter(s => {
        const saleDate = new Date(s.saleDate);
        return saleDate >= monthStart && saleDate < tomorrow;
      });
      const totalMonthProductSales = monthSales.reduce((sum, s) => sum + (s.total || 0), 0);
      const monthSalesCount = monthSales.length;

      // ============ MONTHLY SERVICE REVENUE ============
      const monthServices = (db.services || []).filter(s => {
        const serviceDate = new Date(s.receivedDate || s.createdAt);
        return serviceDate >= monthStart && serviceDate < tomorrow;
      });
      const totalMonthServiceRevenue = monthServices.reduce((sum, s) => sum + (s.total || 0), 0);
      const monthServicesCount = monthServices.length;

      // ============ COMBINED MONTHLY TOTAL ============
      const totalMonthSales = totalMonthProductSales + totalMonthServiceRevenue;
      const totalMonthTransactions = monthSalesCount + monthServicesCount;

      // Month profit
      const monthProductProfit = monthSales.reduce((sum, s) => sum + (s.total || 0) * 0.3, 0);
      const monthServiceProfit = monthServices.reduce((sum, s) => sum + (s.total || 0) * 0.4, 0);
      const monthProfit = monthProductProfit + monthServiceProfit;

      // ============ TODAY'S EXPENSES ============
      const todayExpenses = db.expenses.filter(e => {
        const expenseDate = new Date(e.expenseDate);
        return expenseDate >= today && expenseDate < tomorrow;
      });
      const totalTodayExpenses = todayExpenses.reduce((sum, e) => sum + (e.total || 0), 0);

      // ============ OUTSTANDING & INVENTORY ============
      const totalReceivables = db.customers.reduce((sum, c) => sum + (c.balance || 0), 0);
      const totalInventoryValue = db.products.reduce((sum, p) => sum + (p.stock * p.costPrice || 0), 0);
      const lowStock = db.products.filter(p => p.stock <= (p.reorderLevel || 0)).length;

      // ============ PENDING SERVICES ============
      const pendingServices = db.services ? db.services.filter(s => 
        s.status === 'Received' || 
        s.status === 'In Progress' || 
        s.status === 'Waiting for Customer'
      ).length : 0;

      // ============ SERVICE OUTSTANDING ============
      const serviceOutstanding = (db.services || []).reduce((sum, s) => sum + (s.balance || 0), 0);

      // Cash balance and payables (static for now)
      const cashBalance = 45000;
      const payables = 3200;

      console.log('📊 Dashboard Stats:');
      console.log(`   Today Product Sales: ETB ${totalTodayProductSales} (${todaySalesCount} transactions)`);
      console.log(`   Today Service Revenue: ETB ${totalTodayServiceRevenue} (${todayServicesCount} services)`);
      console.log(`   Today TOTAL: ETB ${totalTodaySales} (${totalTodayTransactions} transactions)`);
      console.log(`   Today Profit: ETB ${todayProfit.toFixed(2)}`);
      console.log(`   Today Expenses: ETB ${totalTodayExpenses}`);
      console.log(`   Month Product Sales: ETB ${totalMonthProductSales}`);
      console.log(`   Month Service Revenue: ETB ${totalMonthServiceRevenue}`);
      console.log(`   Month TOTAL: ETB ${totalMonthSales}`);
      console.log(`   Pending Services: ${pendingServices}`);

      sendJson(res, 200, {
        // Today
        todaySales: totalTodaySales,              // ✅ Now includes services!
        todayProductSales: totalTodayProductSales, // For reference
        todayServiceRevenue: totalTodayServiceRevenue, // For reference
        todayProfit: todayProfit,
        todayExpenses: totalTodayExpenses,
        todaySalesCount: totalTodayTransactions,  // ✅ Total transactions

        // Monthly
        monthSales: totalMonthSales,              // ✅ Now includes services!
        monthProductSales: totalMonthProductSales,
        monthServiceRevenue: totalMonthServiceRevenue,
        monthSalesCount: totalMonthTransactions,
        monthProfit: monthProfit,

        // Other stats
        cashBalance,
        receivables: totalReceivables + serviceOutstanding, // ✅ Include service balances
        payables,
        inventoryValue: totalInventoryValue,
        lowStock,
        pendingServices,
      });
    });
    return;
  }
  // ============ ADMIN REPORTS ============
  if (path === '/api/v1/reports/sales-by-cashier' && method === 'GET') {
    checkAuth(req, res, 'reports', 'view', (user) => {
      if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
        return sendJson(res, 403, { message: 'Insufficient permissions' });
      }
      
      const { startDate, endDate } = parsedUrl.query;
      let filtered = db.sales || [];
      
      if (startDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  filtered = filtered.filter(s => {
    const serviceDate = new Date(s.receivedDate || s.createdAt);
    return serviceDate >= start;
  });
}
if (endDate) {
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  filtered = filtered.filter(s => {
    const serviceDate = new Date(s.receivedDate || s.createdAt);
    return serviceDate <= end;
  });
}
      
      const cashierData = {};
      filtered.forEach(sale => {
        const name = sale.createdByName || sale.cashierName || 'Unknown';
        if (!cashierData[name]) {
          cashierData[name] = { 
            cashier: name, 
            totalSales: 0, 
            count: 0,
            username: sale.createdByUsername || sale.cashierUsername || 'unknown'
          };
        }
        cashierData[name].totalSales += sale.total || 0;
        cashierData[name].count += 1;
      });
      
      sendJson(res, 200, Object.values(cashierData));
    });
    return;
  }
  // ============ ADMIN REPORTS - DAILY SERVICES ============
  if (path === '/api/v1/reports/daily-services' && method === 'GET') {
    console.log('📊 GET /api/v1/reports/daily-services');
    checkAuth(req, res, 'reports', 'view', (user) => {
      if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
        return sendJson(res, 403, { message: 'Insufficient permissions' });
      }
      
      const { startDate, endDate } = parsedUrl.query;
      let filtered = db.services || [];
      
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter(s => new Date(s.receivedDate || s.createdAt) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59);
        filtered = filtered.filter(s => new Date(s.receivedDate || s.createdAt) <= end);
      }
      
      console.log(`📊 Daily Services: ${filtered.length} services found`);
      
      sendJson(res, 200, filtered.map(s => ({
        id: s.id,
        jobNumber: s.jobNumber,
        customerName: s.customerName || 'Walk-in',
        customerPhone: s.customerPhone || null,
        serviceType: s.serviceType || s.serviceTypeName || 'General',
        description: s.description || '',
        quantity: s.quantity || 1,
        unitPrice: s.unitPrice || 0,
        discount: s.discount || 0,
        tax: s.tax || 0,
        total: s.total || 0,
        amountPaid: s.amountPaid || 0,
        balance: s.balance || 0,
        status: s.status || 'Received',
        priority: s.priority || 'Normal',
        receivedDate: s.receivedDate || s.createdAt,
        expectedDate: s.expectedDate || null,
        completedDate: s.completedDate || null,
        notes: s.notes || null,
        createdBy: s.createdByName || s.createdByUsername || 'Unknown',
        createdByUsername: s.createdByUsername || 'unknown',
        createdAt: s.createdAt
      })));
    });
    return;
  }

  // ============ ADMIN REPORTS - SERVICES BY USER ============
  if (path === '/api/v1/reports/services-by-user' && method === 'GET') {
    console.log('📊 GET /api/v1/reports/services-by-user');
    checkAuth(req, res, 'reports', 'view', (user) => {
      if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
        return sendJson(res, 403, { message: 'Insufficient permissions' });
      }
      
      const { startDate, endDate } = parsedUrl.query;
      let filtered = db.services || [];
      
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter(s => new Date(s.receivedDate || s.createdAt) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59);
        filtered = filtered.filter(s => new Date(s.receivedDate || s.createdAt) <= end);
      }
      
      console.log(`📊 Services by User: ${filtered.length} services found`);
      
      const userData = {};
      filtered.forEach(service => {
        const name = service.createdByName || service.createdByUsername || 'Unknown';
        if (!userData[name]) {
          userData[name] = { 
            user: name, 
            username: service.createdByUsername || 'unknown',
            totalServices: 0, 
            count: 0,
            completed: 0,
            pending: 0
          };
        }
        userData[name].totalServices += service.total || 0;
        userData[name].count += 1;
        if (service.status === 'Completed' || service.status === 'Delivered') {
          userData[name].completed += 1;
        } else if (service.status !== 'Cancelled') {
          userData[name].pending += 1;
        }
      });
      
      sendJson(res, 200, Object.values(userData));
    });
    return;
  }
  if (path === '/api/v1/reports/services-by-user' && method === 'GET') {
    checkAuth(req, res, 'reports', 'view', (user) => {
      if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
        return sendJson(res, 403, { message: 'Insufficient permissions' });
      }
      
      const { startDate, endDate } = parsedUrl.query;
      let filtered = db.services || [];
      
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter(s => new Date(s.receivedDate) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59);
        filtered = filtered.filter(s => new Date(s.receivedDate) <= end);
      }
      
      const userData = {};
      filtered.forEach(service => {
        const name = service.createdByName || service.createdByUsername || 'Unknown';
        if (!userData[name]) {
          userData[name] = { 
            user: name, 
            totalServices: 0, 
            count: 0,
            username: service.createdByUsername || 'unknown'
          };
        }
        userData[name].totalServices += service.total || 0;
        userData[name].count += 1;
      });
      
      sendJson(res, 200, Object.values(userData));
    });
    return;
  }

  if (path === '/api/v1/reports/user-activity' && method === 'GET') {
    checkAuth(req, res, 'reports', 'view', (user) => {
      if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
        return sendJson(res, 403, { message: 'Insufficient permissions' });
      }
      
      const { startDate, endDate } = parsedUrl.query;
      
      let filteredSales = db.sales || [];
      let filteredServices = db.services || [];
      let filteredExpenses = db.expenses || [];
      
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filteredSales = filteredSales.filter(s => new Date(s.saleDate) >= start);
        filteredServices = filteredServices.filter(s => new Date(s.receivedDate) >= start);
        filteredExpenses = filteredExpenses.filter(e => new Date(e.expenseDate) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59);
        filteredSales = filteredSales.filter(s => new Date(s.saleDate) <= end);
        filteredServices = filteredServices.filter(s => new Date(s.receivedDate) <= end);
        filteredExpenses = filteredExpenses.filter(e => new Date(e.expenseDate) <= end);
      }
      
      const userActivity = db.users.map(u => {
        const fullName = u.firstName + ' ' + u.lastName;
        
        const userSales = filteredSales.filter(s => 
          s.createdByUsername === u.username || 
          s.cashierUsername === u.username ||
          s.createdByName === fullName ||
          s.cashierName === fullName
        );
        
        const userServices = filteredServices.filter(s => 
          s.createdByUsername === u.username ||
          s.createdByName === fullName
        );
        
        const userExpenses = filteredExpenses.filter(e => 
          e.createdByUsername === u.username ||
          e.createdByName === fullName
        );
        
        const allActivities = [
          ...userSales.map(s => ({ date: s.saleDate, type: 'sale' })),
          ...userServices.map(s => ({ date: s.receivedDate, type: 'service' })),
          ...userExpenses.map(e => ({ date: e.expenseDate, type: 'expense' }))
        ];
        
        allActivities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        return {
          userId: u.id,
          username: u.username,
          fullName: fullName,
          roles: u.roles || [],
          active: u.active,
          sales: {
            count: userSales.length,
            total: userSales.reduce((sum, s) => sum + (s.total || 0), 0)
          },
          services: {
            count: userServices.length,
            total: userServices.reduce((sum, s) => sum + (s.total || 0), 0)
          },
          expenses: {
            count: userExpenses.length,
            total: userExpenses.reduce((sum, e) => sum + (e.total || 0), 0)
          },
          lastActivity: allActivities.length > 0 ? allActivities[0].date : null,
          lastActivityType: allActivities.length > 0 ? allActivities[0].type : null
        };
      });
      
      sendJson(res, 200, userActivity);
    });
    return;
  }

  // ============ 404 ============
  console.log(`❌ Route not found: ${method} ${path}`);
  sendJson(res, 404, { message: 'Route not found' });
});

// ============ START ============
server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🚀 SAMI ERP BACKEND');
  console.log('='.repeat(50));
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🔑 admin/admin123 | cashier/cashier123`);
  console.log(`📦 Products: ${db.products.length}`);
  console.log(`👥 Customers: ${db.customers.length}`);
  console.log(`📋 Sales: ${db.sales.length}`);
  console.log(`🔧 Services: ${db.services ? db.services.length : 0}`);
  console.log(`👤 Users: ${db.users.length}`);
  console.log(`📋 Roles: ${db.roles.length}`);
  console.log(`📧 Email: ${emailReady ? '✅ Ready' : '❌ Not configured'}`);
  console.log('='.repeat(50));
  console.log('✅ Server ready!');
});

process.on('SIGINT', () => { saveData(); process.exit(); });
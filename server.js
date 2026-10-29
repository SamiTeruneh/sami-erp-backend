// server.js - SAMI ERP (PostgreSQL + Brevo Email) - Production Ready
require('dotenv').config();
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3001;

// ============ DATABASE CONNECTION ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('❌ Postgres pool error:', err.message);
});

async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    console.error('❌ DB Query Error:', err.message);
    throw err;
  }
}

// ============ EMAIL (Brevo HTTPS API) ============
let emailReady = !!(process.env.BREVO_API_KEY);
if (emailReady) console.log('✅ Brevo email configured');
else console.log('⚠️  BREVO_API_KEY not set');

// ============ PASSWORD RESET CODES ============
const passwordResetCodes = {};

async function sendVerificationCode(toEmail, code, userName) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    console.log('⚠️  Code (dev):', code);
    return { success: false, error: 'Email not configured', code };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'SAMI ERP', email: process.env.BREVO_SENDER_EMAIL || 'samsonteruneh@gmail.com' },
        to: [{ email: toEmail }],
        subject: '🔐 Password Reset Code - SAMI ERP',
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1E40AF;">SAMI ERP - Password Reset</h2>
            <p>Hello <strong>${userName}</strong>,</p>
            <p>Your code:</p>
            <div style="background: #EFF6FF; border: 2px dashed #3B82F6; padding: 24px; text-align: center; margin: 20px 0;">
              <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1E40AF; margin: 0; font-family: monospace;">${code}</p>
            </div>
            <p>Expires in <strong>15 minutes</strong>.</p>
          </div>
        `
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(err);
    }
    console.log('📧 Email sent:', toEmail);
    return { success: true };
  } catch (error) {
    console.error('❌ Brevo error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============ CORS ============
function setCors(res, origin) {
  // Allow your Firebase frontend and local development
  const allowedOrigins = [
    'https://sami-erp-system.web.app',
    'https://sami-erp-system.firebaseapp.com',
    'http://localhost:5173',
    'http://localhost:3000'
  ];

  // If the request has an origin that is allowed, echo it back
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Fallback for non-browser requests (like curl) or unexpected origins
    // Using '*' here is safe ONLY if credentials are not used for that request
    res.setHeader('Access-Control-Allow-Origin', '*'); 
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
}
function sendJson(res, status, data, origin) {
  setCors(res, origin);
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

// ============ AUTH HELPERS ============
async function getUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function getUserFromToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
    const user = await getUserById(decoded.userId);
    if (!user) return null;
    return {
      id: user.id, username: user.username, password: user.password,
      firstName: user.first_name, lastName: user.last_name,
      email: user.email, phone: user.phone, active: user.active,
      roles: user.roles || [],
    };
  } catch (err) { return null; }
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

async function checkAuth(req, res, module, action, callback) {
  const auth = req.headers.authorization;
  if (!auth) return sendJson(res, 401, { message: 'Authentication required' });
  
  const token = auth.split(' ')[1];
  if (!token) return sendJson(res, 401, { message: 'Invalid token' });
  
  const user = await getUserFromToken(token);
  if (!user) return sendJson(res, 401, { message: 'User not found' });
  
  if (!hasPermission(user, module, action)) {
    return sendJson(res, 403, { message: 'Insufficient permissions' });
  }
  
  await callback(user);
}

// ============ RECEIPT ============
function generateReceipt(sale) {
  const lines = [
    '=================================',
    '     SAMI STATIONARY',
    '     Addis Ababa, Ethiopia',
    '=================================',
    `Invoice: ${sale.invoiceNumber}`,
    `Date: ${new Date(sale.saleDate).toLocaleDateString()}`,
    `Time: ${sale.saleTime}`,
    `Cashier: ${sale.cashierName || 'Unknown'}`,
    '---------------------------------',
  ];
  for (const item of sale.items) {
    const name = (item.productNameSnapshot || 'Product').substring(0, 12);
    lines.push(`${name.padEnd(12)} ${item.quantity.toString().padEnd(6)} ${item.unitPrice.toFixed(2).padEnd(8)} ${item.lineTotal.toFixed(2)}`);
  }
  lines.push('---------------------------------');
  lines.push(`Total: ${sale.total.toFixed(2)}`.padStart(30));
  lines.push(`Paid: ${sale.amountPaid.toFixed(2)}`.padStart(30));
  lines.push('=================================');
  return lines.join('\n');
}

// ============ SERVER ============
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;
  const requestOrigin = req.headers.origin;
  console.log(`📝 ${method} ${path}`);

if (method === 'OPTIONS') {
  setCors(res, requestOrigin);
  res.writeHead(200);
  res.end();
  return;
}

  try {
    // ============ HEALTH ============
    if (path === '/api/v1/health' && method === 'GET') {
      try {
        await query('SELECT 1');
        return sendJson(res, 200, { status: 'ok', emailReady, database: 'connected' }, requestOrigin);
      } catch (err) {
        return sendJson(res, 503, { status: 'error', database: 'disconnected', message: err.message });
      }
    }

    // ============ LOGIN ============
    if (path === '/api/v1/auth/login' && method === 'POST') {
      parseBody(req, async (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        try {
          const result = await query('SELECT * FROM users WHERE username = $1', [body.username]);
          const user = result.rows[0];
          
          if (!user || user.password !== body.password) {
            return sendJson(res, 401, { message: 'Invalid credentials' });
          }
          
          if (!user.active) {
            return sendJson(res, 401, { message: 'Account inactive' });
          }
          
          const token = generateToken(user.id);
          await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
          
          sendJson(res, 200, {
            accessToken: token,
            refreshToken: 'refresh-' + token,
            user: {
              id: user.id, username: user.username,
              firstName: user.first_name, lastName: user.last_name,
              email: user.email, phone: user.phone,
              roles: user.roles || [], preferences: user.preferences || {},
              permissions: ['*']
            }
          });
        } catch (error) {
          sendJson(res, 500, { message: 'Login failed' });
        }
      });
      return;
    }

    // ============ REFRESH TOKEN ============
    if (path === '/api/v1/auth/refresh' && method === 'POST') {
      parseBody(req, (err) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        const token = generateToken(1);
        sendJson(res, 200, { accessToken: token, refreshToken: 'refresh-' + token });
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
      const user = await getUserFromToken(token);
      if (!user) return sendJson(res, 401, { message: 'User not found' });
      
      parseBody(req, async (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        if (!body.currentPassword) return sendJson(res, 400, { message: 'Current password required' });
        if (user.password !== body.currentPassword) return sendJson(res, 400, { message: 'Current password incorrect' });
        if (!body.newPassword || body.newPassword.length < 6) return sendJson(res, 400, { message: 'New password must be 6+ chars' });
        
        await query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [body.newPassword, user.id]);
        sendJson(res, 200, { message: 'Password changed', requireRelogin: true });
      });
      return;
    }

    // ============ FORGOT PASSWORD - REQUEST ============
    if (path === '/api/v1/auth/forgot-password' && method === 'POST') {
      parseBody(req, async (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const { username, email } = body;
        if (!username && !email) return sendJson(res, 400, { message: 'Username or email required' });
        
        try {
          const result = await query(
            'SELECT * FROM users WHERE username = $1 OR LOWER(email) = LOWER($2)',
            [username || '', email || '']
          );
          const user = result.rows[0];
          
          if (!user) return sendJson(res, 200, { message: 'If account exists, code sent.', success: true });
          if (!user.active) return sendJson(res, 400, { message: 'Account inactive' });
          
          const roles = user.roles || [];
          if (!roles.includes('Super Admin') && !roles.includes('Manager')) {
            return sendJson(res, 403, { message: 'Admin only' });
          }
          if (!user.email) return sendJson(res, 400, { message: 'No email' });
          
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          
          await query(
            `INSERT INTO password_reset_codes (user_id, code, expires_at, email, attempts)
             VALUES ($1, $2, NOW() + INTERVAL '15 minutes', $3, 0)
             ON CONFLICT (user_id) DO UPDATE SET code = $2, expires_at = NOW() + INTERVAL '15 minutes', attempts = 0`,
            [user.id, code, user.email]
          );
          
          const emailResult = await sendVerificationCode(user.email, code, `${user.first_name} ${user.last_name}`);
          const maskedEmail = user.email.replace(/(.{1})(.*)(@.*)/, '$1***$3');
          
          if (!emailResult.success) {
            return sendJson(res, 500, { message: 'Failed to send email' });
          }
          
          sendJson(res, 200, { message: `Code sent to ${maskedEmail}`, success: true });
        } catch (error) {
          sendJson(res, 500, { message: 'Failed' });
        }
      });
      return;
    }

    // ============ FORGOT PASSWORD - VERIFY ============
    if (path === '/api/v1/auth/verify-reset-code' && method === 'POST') {
      parseBody(req, async (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const { username, code } = body;
        if (!code) return sendJson(res, 400, { message: 'Code required' });
        
        try {
          const userResult = await query('SELECT * FROM users WHERE username = $1', [username]);
          const user = userResult.rows[0];
          if (!user) return sendJson(res, 400, { message: 'Invalid code' });
          
          const resetResult = await query('SELECT * FROM password_reset_codes WHERE user_id = $1', [user.id]);
          const reset = resetResult.rows[0];
          
          if (!reset) return sendJson(res, 400, { message: 'No reset request' });
          if (new Date(reset.expires_at) < new Date()) return sendJson(res, 400, { message: 'Expired' });
          if (reset.attempts >= 5) return sendJson(res, 400, { message: 'Too many attempts' });
          if (reset.code !== code) {
            await query('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = $1', [user.id]);
            return sendJson(res, 400, { message: 'Invalid code' });
          }
          
          sendJson(res, 200, { message: 'Verified', success: true });
        } catch (error) {
          sendJson(res, 500, { message: 'Failed' });
        }
      });
      return;
    }

    // ============ FORGOT PASSWORD - RESET ============
    if (path === '/api/v1/auth/reset-password' && method === 'POST') {
      parseBody(req, async (err, body) => {
        if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
        
        const { username, code, newPassword } = body;
        if (!code || !newPassword) return sendJson(res, 400, { message: 'Code and password required' });
        if (newPassword.length < 6) return sendJson(res, 400, { message: 'Too short' });
        
        try {
          const userResult = await query('SELECT * FROM users WHERE username = $1', [username]);
          const user = userResult.rows[0];
          if (!user) return sendJson(res, 400, { message: 'Invalid' });
          
          const resetResult = await query('SELECT * FROM password_reset_codes WHERE user_id = $1', [user.id]);
          const reset = resetResult.rows[0];
          
          if (!reset) return sendJson(res, 400, { message: 'No request' });
          if (new Date(reset.expires_at) < new Date()) return sendJson(res, 400, { message: 'Expired' });
          if (reset.code !== code) return sendJson(res, 400, { message: 'Invalid code' });
          
          await query('UPDATE users SET password = $1 WHERE id = $2', [newPassword, user.id]);
          await query('DELETE FROM password_reset_codes WHERE user_id = $1', [user.id]);
          
          sendJson(res, 200, { message: 'Password reset', success: true });
        } catch (error) {
          sendJson(res, 500, { message: 'Failed' });
        }
      });
      return;
    }

    // ============ ROLES ============
    if (path === '/api/v1/roles' && method === 'GET') {
      const result = await query('SELECT * FROM roles ORDER BY id');
      sendJson(res, 200, result.rows);
      return;
    }

    // ============ USERS ============
    if (path === '/api/v1/users' && method === 'GET') {
      await checkAuth(req, res, 'users', 'view', async () => {
        const result = await query('SELECT * FROM users ORDER BY id');
        sendJson(res, 200, result.rows.map(u => ({
          id: u.id, username: u.username,
          firstName: u.first_name, lastName: u.last_name,
          email: u.email, phone: u.phone, active: u.active,
          lastLoginAt: u.last_login_at, createdAt: u.created_at,
          roles: u.roles || [], permissions: ['*']
        })));
      });
      return;
    }

    if (path === '/api/v1/users' && method === 'POST') {
      await checkAuth(req, res, 'users', 'create', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          if (!body.username || !body.firstName || !body.lastName || !body.password) {
            return sendJson(res, 400, { message: 'Missing fields' });
          }
          if (body.password.length < 6) return sendJson(res, 400, { message: 'Password too short' });
          if (!body.roles || body.roles.length === 0) return sendJson(res, 400, { message: 'Role required' });
          
          const existing = await query('SELECT id FROM users WHERE username = $1', [body.username]);
          if (existing.rows.length > 0) return sendJson(res, 400, { message: 'Username exists' });
          
          const result = await query(
            `INSERT INTO users (username, password, first_name, last_name, email, phone, active, roles)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [body.username, body.password, body.firstName, body.lastName, body.email || null, body.phone || null, body.active !== false, body.roles]
          );
          
          const u = result.rows[0];
          sendJson(res, 201, {
            id: u.id, username: u.username, firstName: u.first_name, lastName: u.last_name,
            email: u.email, phone: u.phone, active: u.active, roles: u.roles
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/users\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'users', 'edit', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          if (body.email !== undefined) { fields.push(`email = $${idx++}`); values.push(body.email); }
          if (body.firstName) { fields.push(`first_name = $${idx++}`); values.push(body.firstName); }
          if (body.lastName) { fields.push(`last_name = $${idx++}`); values.push(body.lastName); }
          if (body.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(body.phone); }
          if (body.active !== undefined) { fields.push(`active = $${idx++}`); values.push(body.active); }
          if (body.roles) { fields.push(`roles = $${idx++}`); values.push(body.roles); }
          if (body.password) { fields.push(`password = $${idx++}`); values.push(body.password); }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          fields.push(`updated_at = NOW()`);
          values.push(id);
          
          const result = await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const u = result.rows[0];
          sendJson(res, 200, {
            id: u.id, username: u.username, firstName: u.first_name, lastName: u.last_name,
            email: u.email, phone: u.phone, active: u.active, roles: u.roles
          });
        });
      });
      return;
    }

    // ============ PRODUCTS ============
    if (path === '/api/v1/products' && method === 'GET') {
      await checkAuth(req, res, 'products', 'view', async () => {
        const result = await query('SELECT * FROM products ORDER BY id');
        sendJson(res, 200, result.rows.map(p => ({
          id: p.id, sku: p.sku, barcode: p.barcode, name: p.name,
          description: p.description, brand: p.brand, category: p.category, unit: p.unit,
          sellingPrice: parseFloat(p.selling_price), costPrice: parseFloat(p.cost_price),
          stock: p.stock, reorderLevel: p.reorder_level, reorderQuantity: p.reorder_quantity,
          active: p.active, createdAt: p.created_at
        })));
      });
      return;
    }

    if (path.match(/^\/api\/v1\/products\/\d+$/) && method === 'GET') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'products', 'view', async () => {
        const result = await query('SELECT * FROM products WHERE id = $1', [id]);
        if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
        const p = result.rows[0];
        sendJson(res, 200, {
          id: p.id, sku: p.sku, barcode: p.barcode, name: p.name,
          description: p.description, brand: p.brand, category: p.category, unit: p.unit,
          sellingPrice: parseFloat(p.selling_price), costPrice: parseFloat(p.cost_price),
          stock: p.stock, reorderLevel: p.reorder_level, reorderQuantity: p.reorder_quantity,
          active: p.active, createdAt: p.created_at
        });
      });
      return;
    }

    if (path === '/api/v1/products' && method === 'POST') {
      await checkAuth(req, res, 'products', 'create', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const result = await query(
            `INSERT INTO products (sku, barcode, name, description, brand, category, unit, selling_price, cost_price, stock, reorder_level, reorder_quantity, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [
              body.sku || `PRD-${Date.now()}`,
              body.barcode || '', body.name, body.description || '',
              body.brand || '', body.category || '', body.unit || 'Piece',
              parseFloat(body.sellingPrice) || 0, parseFloat(body.costPrice) || 0,
              parseInt(body.stock) || 0, parseInt(body.reorderLevel) || 0,
              parseInt(body.reorderQuantity) || 0, body.active !== false
            ]
          );
          const p = result.rows[0];
          sendJson(res, 201, {
            id: p.id, sku: p.sku, barcode: p.barcode, name: p.name,
            sellingPrice: parseFloat(p.selling_price), costPrice: parseFloat(p.cost_price),
            stock: p.stock, reorderLevel: p.reorder_level, active: p.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/products\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'products', 'edit', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          const map = {
            sku: 'sku', barcode: 'barcode', name: 'name', description: 'description',
            brand: 'brand', category: 'category', unit: 'unit',
            sellingPrice: 'selling_price', costPrice: 'cost_price',
            stock: 'stock', reorderLevel: 'reorder_level', reorderQuantity: 'reorder_quantity',
            active: 'active'
          };
          
          for (const [key, col] of Object.entries(map)) {
            if (body[key] !== undefined) { fields.push(`${col} = $${idx++}`); values.push(body[key]); }
          }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          fields.push('updated_at = NOW()');
          values.push(id);
          
          const result = await query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const p = result.rows[0];
          sendJson(res, 200, {
            id: p.id, sku: p.sku, name: p.name,
            sellingPrice: parseFloat(p.selling_price), costPrice: parseFloat(p.cost_price),
            stock: p.stock, reorderLevel: p.reorder_level, active: p.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/products\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'products', 'delete', async () => {
        const result = await query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
        sendJson(res, 200, { message: 'Deleted' });
      });
      return;
    }

    // ============ CUSTOMERS ============
    if (path === '/api/v1/customers' && method === 'GET') {
      await checkAuth(req, res, 'customers', 'view', async () => {
        const result = await query('SELECT * FROM customers ORDER BY id');
        sendJson(res, 200, result.rows.map(c => ({
          id: c.id, customerCode: c.customer_code, name: c.name,
          phone: c.phone, email: c.email, address: c.address,
          balance: parseFloat(c.balance), creditLimit: parseFloat(c.credit_limit),
          totalPurchases: parseFloat(c.total_purchases), active: c.active
        })));
      });
      return;
    }

    if (path === '/api/v1/customers' && method === 'POST') {
      await checkAuth(req, res, 'customers', 'create', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const codeResult = await query("SELECT COUNT(*) FROM customers");
          const count = parseInt(codeResult.rows[0].count) + 1;
          const customerCode = `CUST-${String(count).padStart(3, '0')}`;
          
          const result = await query(
            `INSERT INTO customers (customer_code, name, phone, email, address, balance, credit_limit, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [customerCode, body.name, body.phone || null, body.email || null,
             body.address || null, parseFloat(body.balance) || 0,
             parseFloat(body.creditLimit) || 0, body.active !== false]
          );
          
          const c = result.rows[0];
          sendJson(res, 201, {
            id: c.id, customerCode: c.customer_code, name: c.name,
            phone: c.phone, email: c.email, balance: parseFloat(c.balance),
            creditLimit: parseFloat(c.credit_limit), active: c.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/customers\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'customers', 'edit', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          const map = {
            name: 'name', phone: 'phone', email: 'email', address: 'address',
            balance: 'balance', creditLimit: 'credit_limit', active: 'active'
          };
          
          for (const [key, col] of Object.entries(map)) {
            if (body[key] !== undefined) { fields.push(`${col} = $${idx++}`); values.push(body[key]); }
          }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          fields.push('updated_at = NOW()');
          values.push(id);
          
          const result = await query(`UPDATE customers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const c = result.rows[0];
          sendJson(res, 200, {
            id: c.id, customerCode: c.customer_code, name: c.name,
            phone: c.phone, email: c.email, balance: parseFloat(c.balance),
            creditLimit: parseFloat(c.credit_limit), active: c.active
          });
        });
      });
      return;
    }

    // ============ SUPPLIERS ============
    if (path === '/api/v1/suppliers' && method === 'GET') {
      await checkAuth(req, res, 'suppliers', 'view', async () => {
        const result = await query('SELECT * FROM suppliers ORDER BY id');
        sendJson(res, 200, result.rows.map(s => ({
          id: s.id, supplierCode: s.supplier_code, name: s.name,
          contactPerson: s.contact_person, phone: s.phone, email: s.email,
          address: s.address, city: s.city, country: s.country,
          taxId: s.tax_id, paymentTerms: s.payment_terms,
          creditLimit: parseFloat(s.credit_limit), balance: parseFloat(s.balance),
          notes: s.notes, active: s.active
        })));
      });
      return;
    }

    if (path === '/api/v1/suppliers' && method === 'POST') {
      await checkAuth(req, res, 'suppliers', 'create', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          if (!body.name) return sendJson(res, 400, { message: 'Name required' });
          
          const codeResult = await query("SELECT COUNT(*) FROM suppliers");
          const count = parseInt(codeResult.rows[0].count) + 1;
          const supplierCode = `SUP-${String(count).padStart(3, '0')}`;
          
          const result = await query(
            `INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, city, country, tax_id, payment_terms, credit_limit, balance, notes, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [supplierCode, body.name, body.contactPerson || null, body.phone || null,
             body.email || null, body.address || null, body.city || null,
             body.country || 'Ethiopia', body.taxId || null, body.paymentTerms || 'Cash',
             parseFloat(body.creditLimit) || 0, parseFloat(body.balance) || 0,
             body.notes || null, body.active !== false]
          );
          
          const s = result.rows[0];
          sendJson(res, 201, {
            id: s.id, supplierCode: s.supplier_code, name: s.name,
            contactPerson: s.contact_person, phone: s.phone, email: s.email,
            balance: parseFloat(s.balance), active: s.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/suppliers\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'suppliers', 'edit', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          const map = {
            name: 'name', contactPerson: 'contact_person', phone: 'phone', email: 'email',
            address: 'address', city: 'city', country: 'country', taxId: 'tax_id',
            paymentTerms: 'payment_terms', creditLimit: 'credit_limit',
            balance: 'balance', notes: 'notes', active: 'active'
          };
          
          for (const [key, col] of Object.entries(map)) {
            if (body[key] !== undefined) { fields.push(`${col} = $${idx++}`); values.push(body[key]); }
          }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          fields.push('updated_at = NOW()');
          values.push(id);
          
          const result = await query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const s = result.rows[0];
          sendJson(res, 200, {
            id: s.id, supplierCode: s.supplier_code, name: s.name,
            contactPerson: s.contact_person, phone: s.phone, email: s.email,
            balance: parseFloat(s.balance), active: s.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/suppliers\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'suppliers', 'delete', async () => {
        const result = await query('DELETE FROM suppliers WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
        sendJson(res, 200, { message: 'Deleted' });
      });
      return;
    }

    // ============ SALES ============
    if (path === '/api/v1/sales' && method === 'GET') {
      await checkAuth(req, res, 'sales', 'view', async () => {
        const result = await query('SELECT * FROM sales ORDER BY id DESC');
        sendJson(res, 200, result.rows.map(s => ({
          id: s.id, invoiceNumber: s.invoice_number, saleDate: s.sale_date,
          saleTime: s.sale_time, customerId: s.customer_id, customerName: s.customer_name,
          cashierId: s.cashier_id, cashierName: s.cashier_name,
          cashierUsername: s.cashier_username, createdByName: s.created_by_name,
          createdByUsername: s.created_by_username, status: s.status,
          subtotal: parseFloat(s.subtotal), discount: parseFloat(s.discount),
          tax: parseFloat(s.tax), total: parseFloat(s.total),
          amountPaid: parseFloat(s.amount_paid), balanceDue: parseFloat(s.balance_due),
          paymentStatus: s.payment_status, notes: s.notes,
          items: s.items || [], payments: s.payments || [], createdAt: s.created_at
        })));
      });
      return;
    }

    if (path === '/api/v1/sales' && method === 'POST') {
      await checkAuth(req, res, 'sales', 'create', async (user) => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const { items, customerId, paymentMethod, amountReceived, notes, discount } = body;
          if (!items || items.length === 0) return sendJson(res, 400, { message: 'No items' });
          
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            
            let subtotal = 0;
            const saleItems = [];
            
            for (const item of items) {
              const prodResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
              const product = prodResult.rows[0];
              if (!product) {
                await client.query('ROLLBACK');
                return sendJson(res, 404, { message: `Product ${item.productId} not found` });
              }
              if (product.stock < item.quantity) {
                await client.query('ROLLBACK');
                return sendJson(res, 400, { message: `Insufficient stock: ${product.name}` });
              }
              
              const lineTotal = item.quantity * item.unitPrice - (item.discount || 0);
              subtotal += lineTotal;
              saleItems.push({
                productId: product.id, productNameSnapshot: product.name,
                quantity: item.quantity, unitPrice: item.unitPrice,
                unitCost: parseFloat(product.cost_price),
                discount: item.discount || 0, tax: item.tax || 0, lineTotal
              });
              
              await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.productId]);
            }
            
            const discountAmount = discount || 0;
            const total = subtotal - discountAmount;
            const balanceDue = total - (amountReceived || 0);
            
            let customerName = null;
            if (customerId) {
  const custResult = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  if (custResult.rows[0]) {
    const customer = custResult.rows[0];
    customerName = customer.name;
    
    if (balanceDue > 0) {
      const currentBalance = parseFloat(customer.balance) || 0;
      const creditLimit = parseFloat(customer.credit_limit) || 0;
      const newBalance = currentBalance + balanceDue;
      
      // ✅ Check credit limit (only if credit limit is set and > 0)
      if (creditLimit > 0 && newBalance > creditLimit) {
        await client.query('ROLLBACK');
        return sendJson(res, 400, { 
          message: `Credit limit exceeded. ${customer.name} has ETB ${currentBalance.toFixed(2)} outstanding with a limit of ETB ${creditLimit.toFixed(2)}. This sale would bring balance to ETB ${newBalance.toFixed(2)}.`,
          currentBalance,
          creditLimit,
          attemptedBalance: newBalance,
          exceededBy: newBalance - creditLimit
        }, origin);
      }
      
      // ✅ Update balance
      await client.query(
        'UPDATE customers SET balance = balance + $1 WHERE id = $2', 
        [balanceDue, customerId]
      );
    }
  }
}
            const fullName = `${user.firstName} ${user.lastName}`;
            const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            
            const saleResult = await client.query(
              `INSERT INTO sales (invoice_number, sale_date, sale_time, customer_id, customer_name,
                cashier_id, cashier_name, cashier_username, created_by, created_by_name, created_by_username,
                status, subtotal, discount, tax, total, amount_paid, balance_due, payment_status, notes, items, payments)
               VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
              [
                invoiceNumber, new Date().toLocaleTimeString(),
                customerId || null, customerName,
                user.id, fullName, user.username,
                user.id, fullName, user.username,
                balanceDue > 0 ? 'Credit' : 'Completed',
                subtotal, discountAmount, 0, total, amountReceived || 0, balanceDue > 0 ? balanceDue : 0,
                balanceDue > 0 ? (amountReceived > 0 ? 'Partial' : 'Credit') : 'Paid',
                notes || null, JSON.stringify(saleItems),
                JSON.stringify(amountReceived > 0 ? [{ paymentMethod: paymentMethod || 'Cash', amount: amountReceived }] : [])
              ]
            );
            
            await client.query('COMMIT');
            
            const s = saleResult.rows[0];
            const sale = {
              id: s.id, invoiceNumber: s.invoice_number, saleDate: s.sale_date, saleTime: s.sale_time,
              customerId: s.customer_id, customerName: s.customer_name,
              cashierName: s.cashier_name, status: s.status,
              subtotal: parseFloat(s.subtotal), discount: parseFloat(s.discount),
              total: parseFloat(s.total), amountPaid: parseFloat(s.amount_paid),
              balanceDue: parseFloat(s.balance_due), paymentStatus: s.payment_status,
              items: s.items || []
            };
            
            sendJson(res, 201, { ...sale, receipt: generateReceipt(sale) });
          } catch (error) {
            await client.query('ROLLBACK');
            sendJson(res, 500, { message: 'Failed to create sale' });
          } finally {
            client.release();
          }
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/sales\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'sales', 'delete', async (user) => {
        if (!user.roles.includes('Super Admin')) {
          return sendJson(res, 403, { message: 'Super Admin only' });
        }
        
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          
          const saleResult = await client.query('SELECT * FROM sales WHERE id = $1', [id]);
          const sale = saleResult.rows[0];
          if (!sale) {
            await client.query('ROLLBACK');
            return sendJson(res, 404, { message: 'Not found' });
          }
          
          const items = sale.items || [];
          for (const item of items) {
            await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.productId]);
          }
          
          if (sale.customer_id && sale.balance_due > 0) {
            await client.query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [sale.balance_due, sale.customer_id]);
          }
          
          await client.query('DELETE FROM sales WHERE id = $1', [id]);
          await client.query('COMMIT');
          
          sendJson(res, 200, { message: 'Sale deleted', stockRestored: true });
        } catch (error) {
          await client.query('ROLLBACK');
          sendJson(res, 500, { message: 'Failed to delete' });
        } finally {
          client.release();
        }
      });
      return;
    }

    // ============ SERVICES ============
    if (path === '/api/v1/services' && method === 'GET') {
      await checkAuth(req, res, 'services', 'view', async () => {
        const result = await query('SELECT * FROM services ORDER BY id DESC');
        sendJson(res, 200, result.rows.map(s => ({
          id: s.id, jobNumber: s.job_number, customerId: s.customer_id,
          customerName: s.customer_name, customerPhone: s.customer_phone,
          serviceTypeId: s.service_type_id, serviceType: s.service_type,
          description: s.description, quantity: s.quantity,
          unitPrice: parseFloat(s.unit_price), discount: parseFloat(s.discount),
          tax: parseFloat(s.tax), total: parseFloat(s.total),
          amountPaid: parseFloat(s.amount_paid), balance: parseFloat(s.balance),
          receivedDate: s.received_date, expectedDate: s.expected_date,
          completedDate: s.completed_date, priority: s.priority, status: s.status,
          notes: s.notes, createdBy: s.created_by,
          createdByName: s.created_by_name, createdByUsername: s.created_by_username,
          createdAt: s.created_at
        })));
      });
      return;
    }

    if (path === '/api/v1/services' && method === 'POST') {
      await checkAuth(req, res, 'services', 'create', async (user) => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const unitPrice = parseFloat(body.unitPrice) || 0;
          const quantity = parseInt(body.quantity) || 1;
          const discount = parseFloat(body.discount) || 0;
          const tax = parseFloat(body.tax) || 0;
          const total = (unitPrice * quantity) - discount + tax;
          const amountPaid = parseFloat(body.amountPaid) || 0;
          const balance = total - amountPaid;
          
          const countResult = await query('SELECT COUNT(*) FROM services');
          const count = parseInt(countResult.rows[0].count) + 1;
          const jobNumber = `SRV-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;
          
          const fullName = `${user.firstName} ${user.lastName}`;
          
          const result = await query(
            `INSERT INTO services (job_number, customer_id, customer_name, customer_phone,
              service_type_id, service_type, description, quantity, unit_price, discount, tax,
              total, amount_paid, balance, received_date, expected_date, priority, status, notes,
              created_by, created_by_name, created_by_username)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
            [
              jobNumber,
              body.customerId ? parseInt(body.customerId) : null,
              body.customerName || null, body.customerPhone || null,
              body.serviceTypeId ? parseInt(body.serviceTypeId) : null,
              body.serviceType || '', body.description || '',
              quantity, unitPrice, discount, tax, total, amountPaid, balance,
              body.receivedDate ? new Date(body.receivedDate).toISOString() : new Date().toISOString(),
              body.expectedDate || null, body.priority || 'Normal',
              body.status || 'Received', body.notes || null,
              user.id, fullName, user.username
            ]
          );
          
          const s = result.rows[0];
          sendJson(res, 201, {
            id: s.id, jobNumber: s.job_number, serviceType: s.service_type,
            total: parseFloat(s.total), status: s.status,
            receivedDate: s.received_date, createdAt: s.created_at
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/services\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'services', 'edit', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          const map = {
            customerId: 'customer_id', customerName: 'customer_name', customerPhone: 'customer_phone',
            serviceTypeId: 'service_type_id', serviceType: 'service_type', description: 'description',
            quantity: 'quantity', unitPrice: 'unit_price', discount: 'discount', tax: 'tax',
            total: 'total', amountPaid: 'amount_paid', balance: 'balance',
            receivedDate: 'received_date', expectedDate: 'expected_date', completedDate: 'completed_date',
            priority: 'priority', status: 'status', notes: 'notes'
          };
          
          for (const [key, col] of Object.entries(map)) {
            if (body[key] !== undefined) { fields.push(`${col} = $${idx++}`); values.push(body[key]); }
          }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          fields.push('updated_at = NOW()');
          values.push(id);
          
          const result = await query(`UPDATE services SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const s = result.rows[0];
          sendJson(res, 200, {
            id: s.id, jobNumber: s.job_number, status: s.status,
            total: parseFloat(s.total), amountPaid: parseFloat(s.amount_paid)
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/services\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'services', 'delete', async () => {
        const result = await query('DELETE FROM services WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
        sendJson(res, 200, { message: 'Deleted' });
      });
      return;
    }

    // ============ SERVICE TYPES ============
    if (path === '/api/v1/services/types' && method === 'GET') {
      await checkAuth(req, res, 'services', 'view', async () => {
        const result = await query('SELECT * FROM service_types ORDER BY id');
        sendJson(res, 200, result.rows.map(t => ({
          id: t.id, name: t.name, description: t.description,
          defaultPrice: parseFloat(t.default_price), active: t.active
        })));
      });
      return;
    }

    if (path === '/api/v1/services/types' && method === 'POST') {
      await checkAuth(req, res, 'services', 'create', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          if (!body.name) return sendJson(res, 400, { message: 'Name required' });
          
          const result = await query(
            'INSERT INTO service_types (name, description, default_price, active) VALUES ($1,$2,$3,$4) RETURNING *',
            [body.name, body.description || '', parseFloat(body.defaultPrice) || 0, body.active !== false]
          );
          const t = result.rows[0];
          sendJson(res, 201, {
            id: t.id, name: t.name, description: t.description,
            defaultPrice: parseFloat(t.default_price), active: t.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/services\/types\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'services', 'edit', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          if (body.name !== undefined) { fields.push(`name = $${idx++}`); values.push(body.name); }
          if (body.description !== undefined) { fields.push(`description = $${idx++}`); values.push(body.description); }
          if (body.defaultPrice !== undefined) { fields.push(`default_price = $${idx++}`); values.push(body.defaultPrice); }
          if (body.active !== undefined) { fields.push(`active = $${idx++}`); values.push(body.active); }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          values.push(id);
          
          const result = await query(`UPDATE service_types SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const t = result.rows[0];
          sendJson(res, 200, {
            id: t.id, name: t.name, description: t.description,
            defaultPrice: parseFloat(t.default_price), active: t.active
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/services\/types\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'services', 'delete', async () => {
        const result = await query('DELETE FROM service_types WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
        sendJson(res, 200, { message: 'Deleted' });
      });
      return;
    }

    // ============ EXPENSES ============
    if (path === '/api/v1/expenses' && method === 'GET') {
      await checkAuth(req, res, 'expenses', 'view', async () => {
        const result = await query('SELECT * FROM expenses ORDER BY id DESC');
        sendJson(res, 200, result.rows.map(e => ({
          id: e.id, expenseNumber: e.expense_number, description: e.description,
          category: e.category, amount: parseFloat(e.amount), tax: parseFloat(e.tax),
          total: parseFloat(e.total), expenseDate: e.expense_date,
          paymentMethod: e.payment_method, status: e.status, notes: e.notes,
          createdBy: e.created_by, createdByName: e.created_by_name,
          createdByUsername: e.created_by_username,
          approvedBy: e.approved_by, approvedByName: e.approved_by_name,
          approvedAt: e.approved_at, createdAt: e.created_at
        })));
      });
      return;
    }

    if (path === '/api/v1/expenses' && method === 'POST') {
      await checkAuth(req, res, 'expenses', 'create', async (user) => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const countResult = await query('SELECT COUNT(*) FROM expenses');
          const count = parseInt(countResult.rows[0].count) + 1;
          const expenseNumber = `EXP-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;
          
          const amount = parseFloat(body.amount) || 0;
          const tax = parseFloat(body.tax) || 0;
          const total = amount + tax;
          const fullName = `${user.firstName} ${user.lastName}`;
          
          const result = await query(
            `INSERT INTO expenses (expense_number, description, category, amount, tax, total,
              expense_date, payment_method, status, notes, created_by, created_by_name, created_by_username)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [
              expenseNumber, body.description, body.category || 'Other',
              amount, tax, total, body.expenseDate || new Date().toISOString().split('T')[0],
              body.paymentMethod || 'Cash', 'Pending', body.notes || null,
              user.id, fullName, user.username
            ]
          );
          
          const e = result.rows[0];
          sendJson(res, 201, {
            id: e.id, expenseNumber: e.expense_number, description: e.description,
            amount: parseFloat(e.amount), total: parseFloat(e.total), status: e.status
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/expenses\/\d+\/approve$/) && method === 'PATCH') {
      const pathParts = path.split('/');
      const id = parseInt(pathParts[4]);
      
      await checkAuth(req, res, 'expenses', 'approve', async (user) => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const status = body.status || 'Approved';
          const fullName = `${user.firstName} ${user.lastName}`;
          
          const result = await query(
            `UPDATE expenses SET status = $1, approved_by = $2, approved_by_name = $3, approved_at = NOW(), updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [status, user.id, fullName, id]
          );
          
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const e = result.rows[0];
          sendJson(res, 200, {
            id: e.id, expenseNumber: e.expense_number, status: e.status,
            approvedByName: e.approved_by_name, approvedAt: e.approved_at
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/expenses\/\d+$/) && method === 'PATCH') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'expenses', 'approve', async () => {
        parseBody(req, async (err, body) => {
          if (err) return sendJson(res, 400, { message: 'Invalid JSON' });
          
          const fields = [];
          const values = [];
          let idx = 1;
          
          const map = {
            description: 'description', category: 'category', amount: 'amount',
            tax: 'tax', total: 'total', expenseDate: 'expense_date',
            paymentMethod: 'payment_method', status: 'status', notes: 'notes'
          };
          
          for (const [key, col] of Object.entries(map)) {
            if (body[key] !== undefined) { fields.push(`${col} = $${idx++}`); values.push(body[key]); }
          }
          
          if (fields.length === 0) return sendJson(res, 400, { message: 'No fields' });
          fields.push('updated_at = NOW()');
          values.push(id);
          
          const result = await query(`UPDATE expenses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
          if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
          
          const e = result.rows[0];
          sendJson(res, 200, {
            id: e.id, expenseNumber: e.expense_number, description: e.description,
            amount: parseFloat(e.amount), status: e.status
          });
        });
      });
      return;
    }

    if (path.match(/^\/api\/v1\/expenses\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await checkAuth(req, res, 'expenses', 'approve', async () => {
        const result = await query('DELETE FROM expenses WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return sendJson(res, 404, { message: 'Not found' });
        sendJson(res, 200, { message: 'Deleted' });
      });
      return;
    }

    // ============ DASHBOARD ============
    if (path === '/api/v1/reports/dashboard' && method === 'GET') {
      await checkAuth(req, res, 'dashboard', 'view', async () => {
        const todayResult = await query(`
          SELECT COALESCE(SUM(total), 0) as total_sales, COUNT(*) as count
          FROM sales WHERE sale_date >= CURRENT_DATE AND sale_date < CURRENT_DATE + INTERVAL '1 day'
        `);
        const todaySales = parseFloat(todayResult.rows[0].total_sales);
        const todaySalesCount = parseInt(todayResult.rows[0].count);

        const todayServicesResult = await query(`
          SELECT COALESCE(SUM(total), 0) as total_revenue, COUNT(*) as count
          FROM services WHERE received_date >= CURRENT_DATE AND received_date < CURRENT_DATE + INTERVAL '1 day'
        `);
        const todayServiceRevenue = parseFloat(todayServicesResult.rows[0].total_revenue);
        const todayServicesCount = parseInt(todayServicesResult.rows[0].count);

        const monthResult = await query(`
          SELECT COALESCE(SUM(total), 0) as total_sales, COUNT(*) as count
          FROM sales WHERE sale_date >= DATE_TRUNC('month', CURRENT_DATE)
        `);
        const monthSales = parseFloat(monthResult.rows[0].total_sales);
        const monthSalesCount = parseInt(monthResult.rows[0].count);

        const monthServicesResult = await query(`
          SELECT COALESCE(SUM(total), 0) as total_revenue, COUNT(*) as count
          FROM services WHERE received_date >= DATE_TRUNC('month', CURRENT_DATE)
        `);
        const monthServiceRevenue = parseFloat(monthServicesResult.rows[0].total_revenue);
        const monthServicesCount = parseInt(monthServicesResult.rows[0].count);

        const expensesResult = await query(`
          SELECT COALESCE(SUM(total), 0) as total
          FROM expenses WHERE expense_date >= CURRENT_DATE AND expense_date < CURRENT_DATE + INTERVAL '1 day'
        `);
        const todayExpenses = parseFloat(expensesResult.rows[0].total);

        const receivablesResult = await query('SELECT COALESCE(SUM(balance), 0) as total FROM customers');
        const receivables = parseFloat(receivablesResult.rows[0].total);

        const servicesOutstandingResult = await query('SELECT COALESCE(SUM(balance), 0) as total FROM services');
        const serviceOutstanding = parseFloat(servicesOutstandingResult.rows[0].total);

        const inventoryResult = await query('SELECT COALESCE(SUM(stock * cost_price), 0) as total FROM products');
        const inventoryValue = parseFloat(inventoryResult.rows[0].total);

        const lowStockResult = await query('SELECT COUNT(*) FROM products WHERE stock <= reorder_level');
        const lowStock = parseInt(lowStockResult.rows[0].count);

        const pendingServicesResult = await query(
          `SELECT COUNT(*) FROM services WHERE status IN ('Received', 'In Progress', 'Waiting for Customer')`
        );
        const pendingServices = parseInt(pendingServicesResult.rows[0].count);

        const totalTodaySales = todaySales + todayServiceRevenue;
        const totalTodayTransactions = todaySalesCount + todayServicesCount;
        const totalMonthSales = monthSales + monthServiceRevenue;
        const totalMonthTransactions = monthSalesCount + monthServicesCount;

        const todayProfit = (todaySales * 0.3) + (todayServiceRevenue * 0.4);
        const monthProfit = (monthSales * 0.3) + (monthServiceRevenue * 0.4);

        sendJson(res, 200, {
          todaySales: totalTodaySales,
          todayProductSales: todaySales,
          todayServiceRevenue: todayServiceRevenue,
          todayProfit: todayProfit,
          todayExpenses: todayExpenses,
          todaySalesCount: totalTodayTransactions,
          monthSales: totalMonthSales,
          monthProductSales: monthSales,
          monthServiceRevenue: monthServiceRevenue,
          monthSalesCount: totalMonthTransactions,
          monthProfit: monthProfit,
          cashBalance: 45000,
          receivables: receivables + serviceOutstanding,
          payables: 3200,
          inventoryValue: inventoryValue,
          lowStock: lowStock,
          pendingServices: pendingServices,
        });
      });
      return;
    }

    // ============ ADMIN REPORTS ============
    if (path === '/api/v1/reports/sales-by-cashier' && method === 'GET') {
      await checkAuth(req, res, 'reports', 'view', async (user) => {
        if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
          return sendJson(res, 403, { message: 'Insufficient permissions' });
        }
        
        const { startDate, endDate } = parsedUrl.query;
        let sql = 'SELECT * FROM sales WHERE 1=1';
        const params = [];
        
        if (startDate) { params.push(startDate); sql += ` AND sale_date >= $${params.length}`; }
        if (endDate) { params.push(endDate); sql += ` AND sale_date <= $${params.length}`; }
        
        const result = await query(sql, params);
        const cashierData = {};
        
        result.rows.forEach(sale => {
          const name = sale.created_by_name || sale.cashier_name || 'Unknown';
          if (!cashierData[name]) {
            cashierData[name] = { cashier: name, totalSales: 0, count: 0, username: sale.created_by_username || 'unknown' };
          }
          cashierData[name].totalSales += parseFloat(sale.total);
          cashierData[name].count += 1;
        });
        
        sendJson(res, 200, Object.values(cashierData));
      });
      return;
    }

    if (path === '/api/v1/reports/daily-services' && method === 'GET') {
      await checkAuth(req, res, 'reports', 'view', async (user) => {
        if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
          return sendJson(res, 403, { message: 'Insufficient permissions' });
        }
        
        const { startDate, endDate } = parsedUrl.query;
        let sql = 'SELECT * FROM services WHERE 1=1';
        const params = [];
        
        if (startDate) { params.push(startDate); sql += ` AND received_date >= $${params.length}`; }
        if (endDate) { params.push(endDate); sql += ` AND received_date <= $${params.length}`; }
        
        const result = await query(sql, params);
        sendJson(res, 200, result.rows.map(s => ({
          id: s.id, jobNumber: s.job_number, customerName: s.customer_name || 'Walk-in',
          customerPhone: s.customer_phone, serviceType: s.service_type,
          description: s.description, quantity: s.quantity,
          unitPrice: parseFloat(s.unit_price), discount: parseFloat(s.discount),
          tax: parseFloat(s.tax), total: parseFloat(s.total),
          amountPaid: parseFloat(s.amount_paid), balance: parseFloat(s.balance),
          status: s.status, priority: s.priority,
          receivedDate: s.received_date, expectedDate: s.expected_date,
          completedDate: s.completed_date, notes: s.notes,
          createdBy: s.created_by_name || s.created_by_username || 'Unknown',
          createdByUsername: s.created_by_username, createdAt: s.created_at
        })));
      });
      return;
    }

    if (path === '/api/v1/reports/services-by-user' && method === 'GET') {
      await checkAuth(req, res, 'reports', 'view', async (user) => {
        if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
          return sendJson(res, 403, { message: 'Insufficient permissions' });
        }
        
        const { startDate, endDate } = parsedUrl.query;
        let sql = 'SELECT * FROM services WHERE 1=1';
        const params = [];
        
        if (startDate) { params.push(startDate); sql += ` AND received_date >= $${params.length}`; }
        if (endDate) { params.push(endDate); sql += ` AND received_date <= $${params.length}`; }
        
        const result = await query(sql, params);
        const userData = {};
        
        result.rows.forEach(service => {
          const name = service.created_by_name || service.created_by_username || 'Unknown';
          if (!userData[name]) {
            userData[name] = { user: name, username: service.created_by_username || 'unknown', totalServices: 0, count: 0, completed: 0, pending: 0 };
          }
          userData[name].totalServices += parseFloat(service.total);
          userData[name].count += 1;
          if (service.status === 'Completed' || service.status === 'Delivered') userData[name].completed += 1;
          else if (service.status !== 'Cancelled') userData[name].pending += 1;
        });
        
        sendJson(res, 200, Object.values(userData));
      });
      return;
    }

    if (path === '/api/v1/reports/user-activity' && method === 'GET') {
      await checkAuth(req, res, 'reports', 'view', async (user) => {
        if (!user.roles.includes('Super Admin') && !user.roles.includes('Manager')) {
          return sendJson(res, 403, { message: 'Insufficient permissions' });
        }
        
        const usersResult = await query('SELECT * FROM users');
        const salesResult = await query('SELECT * FROM sales');
        const servicesResult = await query('SELECT * FROM services');
        const expensesResult = await query('SELECT * FROM expenses');
        
        const activity = usersResult.rows.map(u => {
          const fullName = `${u.first_name} ${u.last_name}`;
          const userSales = salesResult.rows.filter(s => 
            s.created_by_username === u.username || s.cashier_username === u.username ||
            s.created_by_name === fullName || s.cashier_name === fullName
          );
          const userServices = servicesResult.rows.filter(s => 
            s.created_by_username === u.username || s.created_by_name === fullName
          );
          const userExpenses = expensesResult.rows.filter(e => 
            e.created_by_username === u.username || e.created_by_name === fullName
          );
          
          return {
            userId: u.id, username: u.username, fullName,
            roles: u.roles || [], active: u.active,
            sales: { count: userSales.length, total: userSales.reduce((sum, s) => sum + parseFloat(s.total), 0) },
            services: { count: userServices.length, total: userServices.reduce((sum, s) => sum + parseFloat(s.total), 0) },
            expenses: { count: userExpenses.length, total: userExpenses.reduce((sum, e) => sum + parseFloat(e.total), 0) },
            lastActivity: null, lastActivityType: null
          };
        });
        
        sendJson(res, 200, activity);
      });
      return;
    }

    // ============ 404 ============
    console.log(`❌ Route not found: ${method} ${path}`);
    sendJson(res, 404, { message: 'Route not found' });

  } catch (error) {
    console.error('❌ Unhandled error:', error);
    sendJson(res, 500, { message: 'Internal server error' });
  }
});

// ============ START ============
server.listen(PORT, '0.0.0.0', async () => {
  console.log('='.repeat(50));
  console.log('🚀 SAMI ERP BACKEND (PostgreSQL + Brevo)');
  console.log('='.repeat(50));
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🔑 admin/admin123 | cashier/cashier123`);
  console.log(`📧 Email: ${emailReady ? '✅ Brevo Ready' : '❌ BREVO_API_KEY not set'}`);
  
  try {
    const result = await query('SELECT COUNT(*) FROM users');
    console.log(`🗄️  Database: ✅ Connected (${result.rows[0].count} users)`);
  } catch (err) {
    console.log(`🗄️  Database: ❌ ${err.message}`);
  }
  
  console.log('='.repeat(50));
  console.log('✅ Server ready!');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await pool.end();
  process.exit();
});
// ============ CUSTOMER STATEMENT ============
if (path.match(/^\/api\/v1\/customers\/\d+\/statement$/) && method === 'GET') {
  const id = parseInt(path.split('/')[3]);
  
  await checkAuth(req, res, 'customers', 'view', async () => {
    try {
      // Get customer
      const custResult = await query('SELECT * FROM customers WHERE id = $1', [id]);
      if (custResult.rows.length === 0) {
        return sendJson(res, 404, { message: 'Customer not found' }, origin);
      }
      const customer = custResult.rows[0];
      
      // Get credit sales
      const salesResult = await query(
        `SELECT * FROM sales 
         WHERE customer_id = $1 AND balance_due > 0
         ORDER BY sale_date DESC`,
        [id]
      );
      
      // Calculate totals
      const totalCredit = salesResult.rows.reduce((sum, s) => sum + parseFloat(s.balance_due), 0);
      const totalSales = salesResult.rows.reduce((sum, s) => sum + parseFloat(s.total), 0);
      const totalPaid = salesResult.rows.reduce((sum, s) => sum + parseFloat(s.amount_paid), 0);
      
      sendJson(res, 200, {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          balance: parseFloat(customer.balance),
          creditLimit: parseFloat(customer.credit_limit),
        },
        summary: {
          totalSales,
          totalPaid,
          totalOutstanding: totalCredit,
          availableCredit: parseFloat(customer.credit_limit) - parseFloat(customer.balance),
          transactionsCount: salesResult.rows.length,
        },
        transactions: salesResult.rows.map(s => ({
          id: s.id,
          invoiceNumber: s.invoice_number,
          saleDate: s.sale_date,
          saleTime: s.sale_time,
          total: parseFloat(s.total),
          amountPaid: parseFloat(s.amount_paid),
          balanceDue: parseFloat(s.balance_due),
          paymentStatus: s.payment_status,
          items: s.items || [],
        }))
      }, origin);
    } catch (error) {
      console.error('❌ Statement error:', error);
      sendJson(res, 500, { message: 'Failed to load statement' }, origin);
    }
  });
  return;
};
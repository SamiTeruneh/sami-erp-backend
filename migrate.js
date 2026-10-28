// migrate.js - Migrate data.json to PostgreSQL
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ⚠️ REPLACE THE LINE BELOW WITH YOUR NEON CONNECTION STRING
const CONNECTION_STRING = 'postgresql://neondb_owner:npg_X87HyPjtoTKV@ep-wispy-smoke-b5j0wytn.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const DATA_FILE = path.join(__dirname, 'data.json');

async function migrate() {
  console.log('🚀 Starting migration...');
  console.log('📂 data.json path:', DATA_FILE);
  
  if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ data.json not found');
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log('📊 Data to migrate:');
  console.log('   Users:', data.users?.length || 0);
  console.log('   Products:', data.products?.length || 0);
  console.log('   Customers:', data.customers?.length || 0);
  console.log('   Suppliers:', data.suppliers?.length || 0);
  console.log('   Sales:', data.sales?.length || 0);
  console.log('   Services:', data.services?.length || 0);
  console.log('   Expenses:', data.expenses?.length || 0);
  console.log('   Service Types:', data.serviceTypes?.length || 0);
  
  if (CONNECTION_STRING === 'PASTE_YOUR_NEON_URL_HERE' || CONNECTION_STRING.includes('YOUR_PASSWORD')) {
    console.error('\n❌ Please edit migrate.js and replace CONNECTION_STRING with your real Neon URL');
    process.exit(1);
  }
  
  console.log('\n🔌 Connecting to Postgres...');
  const client = new Client({
    connectionString: CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();
  console.log('✅ Connected\n');
  
  try {
    // USERS
    for (const u of data.users || []) {
      try {
        await client.query(
          `INSERT INTO users (id, username, password, first_name, last_name, email, phone, active, roles, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (username) DO NOTHING`,
          [u.id, u.username, u.password, u.firstName, u.lastName, u.email, u.phone, u.active !== false, u.roles, u.createdAt || new Date()]
        );
      } catch (e) { console.warn('   ⚠️ User', u.username, ':', e.message); }
    }
    console.log('✅ Users:', data.users?.length || 0);
    
    // PRODUCTS
    for (const p of data.products || []) {
      try {
        await client.query(
          `INSERT INTO products (id, sku, barcode, name, description, brand, category, unit, selling_price, cost_price, stock, reorder_level, reorder_quantity, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (sku) DO NOTHING`,
          [p.id, p.sku, p.barcode || '', p.name, p.description || '', p.brand || '', p.category || '', p.unit || 'Piece', p.sellingPrice || 0, p.costPrice || 0, p.stock || 0, p.reorderLevel || 0, p.reorderQuantity || 0, p.active !== false]
        );
      } catch (e) { console.warn('   ⚠️ Product', p.sku, ':', e.message); }
    }
    console.log('✅ Products:', data.products?.length || 0);
    
    // CUSTOMERS
    for (const c of data.customers || []) {
      try {
        await client.query(
          `INSERT INTO customers (id, customer_code, name, phone, email, address, balance, credit_limit, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (customer_code) DO NOTHING`,
          [c.id, c.customerCode || `CUST-${String(c.id).padStart(3,'0')}`, c.name, c.phone, c.email, c.address, c.balance || 0, c.creditLimit || 0, c.active !== false]
        );
      } catch (e) { console.warn('   ⚠️ Customer', c.name, ':', e.message); }
    }
    console.log('✅ Customers:', data.customers?.length || 0);
    
    // SUPPLIERS
    for (const s of data.suppliers || []) {
      try {
        await client.query(
          `INSERT INTO suppliers (id, supplier_code, name, contact_person, phone, email, address, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (supplier_code) DO NOTHING`,
          [s.id, s.supplierCode || `SUP-${String(s.id).padStart(3,'0')}`, s.name, s.contactPerson, s.phone, s.email, s.address, s.active !== false]
        );
      } catch (e) { console.warn('   ⚠️ Supplier', s.name, ':', e.message); }
    }
    console.log('✅ Suppliers:', data.suppliers?.length || 0);
    
    // SERVICE TYPES
    for (const st of data.serviceTypes || []) {
      try {
        await client.query(
          `INSERT INTO service_types (id, name, description, default_price, active)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [st.id, st.name, st.description || '', st.defaultPrice || 0, st.active !== false]
        );
      } catch (e) { console.warn('   ⚠️ ServiceType', st.name, ':', e.message); }
    }
    console.log('✅ Service Types:', data.serviceTypes?.length || 0);
    
    // Verify
    const counts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM customers) as customers
    `);
    console.log('\n📊 Verified DB counts:', counts.rows[0]);
    console.log('\n🎉 MIGRATION COMPLETE!');
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

migrate().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
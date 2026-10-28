-- schema.sql - SAMI ERP Database Schema

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  active BOOLEAN DEFAULT true,
  roles TEXT[] DEFAULT ARRAY['Cashier'],
  preferences JSONB DEFAULT '{}'::jsonb,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Roles (reference table)
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT
);

-- User-Role mapping
CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(50) UNIQUE NOT NULL,
  barcode VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  brand VARCHAR(100),
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'Piece',
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER DEFAULT 0,
  reorder_quantity INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  customer_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  balance DECIMAL(12,2) DEFAULT 0,
  credit_limit DECIMAL(12,2) DEFAULT 0,
  total_purchases DECIMAL(12,2) DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  supplier_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Ethiopia',
  tax_id VARCHAR(50),
  payment_terms VARCHAR(50) DEFAULT 'Cash',
  credit_limit DECIMAL(12,2) DEFAULT 0,
  balance DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  sale_date TIMESTAMP NOT NULL DEFAULT NOW(),
  sale_time VARCHAR(20),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cashier_name VARCHAR(255),
  cashier_username VARCHAR(50),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(255),
  created_by_username VARCHAR(50),
  status VARCHAR(20) DEFAULT 'Completed',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount DECIMAL(12,2) DEFAULT 0,
  tax DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(12,2) DEFAULT 0,
  balance_due DECIMAL(12,2) DEFAULT 0,
  payment_status VARCHAR(20) DEFAULT 'Paid',
  notes TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  payments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

-- Services
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  job_number VARCHAR(50) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  service_type_id INTEGER,
  service_type VARCHAR(100),
  description TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(12,2) DEFAULT 0,
  discount DECIMAL(12,2) DEFAULT 0,
  tax DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) DEFAULT 0,
  amount_paid DECIMAL(12,2) DEFAULT 0,
  balance DECIMAL(12,2) DEFAULT 0,
  received_date TIMESTAMP DEFAULT NOW(),
  expected_date TIMESTAMP,
  completed_date TIMESTAMP,
  priority VARCHAR(20) DEFAULT 'Normal',
  status VARCHAR(30) DEFAULT 'Received',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(255),
  created_by_username VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_date ON services(received_date);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);

-- Service Types
CREATE TABLE IF NOT EXISTS service_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  default_price DECIMAL(12,2) DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  expense_number VARCHAR(50) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100),
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  expense_date DATE,
  payment_method VARCHAR(50) DEFAULT 'Cash',
  status VARCHAR(20) DEFAULT 'Pending',
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(255),
  created_by_username VARCHAR(50),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name VARCHAR(255),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);

-- Password reset codes
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  email VARCHAR(255),
  attempts INTEGER DEFAULT 0
);

-- Seed default roles
INSERT INTO roles (name, description) VALUES
  ('Super Admin', 'Full system access'),
  ('Manager', 'Manage most operations'),
  ('Cashier', 'POS and basic operations'),
  ('Inventory Officer', 'Products and stock'),
  ('Accountant', 'Finance and reports'),
  ('Service Officer', 'Service jobs')
ON CONFLICT (name) DO NOTHING;
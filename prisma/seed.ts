import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Create Company
  const company = await prisma.company.create({
    data: {
      name: 'Sami Stationary',
      legalName: 'Sami Stationary PLC',
      phone: '+251-900-000-000',
      email: 'info@sami.com',
      address: 'Addis Ababa, Ethiopia',
      currencyCode: 'ETB',
      timezone: 'Africa/Addis_Ababa',
    },
  });
  console.log('✅ Company created');

  // Create Branch
  const branch = await prisma.branch.create({
    data: {
      companyId: company.id,
      code: 'HEADOFFICE',
      name: 'Head Office',
      address: 'Addis Ababa, Ethiopia',
    },
  });
  console.log('✅ Branch created');

  // Create Categories
  const paper = await prisma.category.create({
    data: { companyId: company.id, name: 'Paper Products', description: 'All paper products' },
  });
  const writing = await prisma.category.create({
    data: { companyId: company.id, name: 'Writing Instruments', description: 'Pens, pencils, markers' },
  });
  const office = await prisma.category.create({
    data: { companyId: company.id, name: 'Office Supplies', description: 'General office supplies' },
  });
  console.log('✅ Categories created');

  // Create Units
  const piece = await prisma.unit.create({ data: { name: 'Piece', symbol: 'pc' } });
  const box = await prisma.unit.create({ data: { name: 'Box', symbol: 'box' } });
  const ream = await prisma.unit.create({ data: { name: 'Ream', symbol: 'rm' } });
  console.log('✅ Units created');

  // Create Products
  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: paper.id,
      unitId: ream.id,
      sku: 'A4-001',
      barcode: '8901234567890',
      name: 'A4 Paper - 80gsm',
      description: 'Premium A4 printing paper, 80gsm, 500 sheets',
      costPrice: 350,
      sellingPrice: 450,
      reorderLevel: 10,
      reorderQty: 20,
      trackStock: true,
      active: true,
    },
  });
  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: writing.id,
      unitId: piece.id,
      sku: 'PEN-001',
      barcode: '8901234567891',
      name: 'Ballpoint Pen - Blue',
      description: 'Standard ballpoint pen, blue ink',
      costPrice: 15,
      sellingPrice: 25,
      reorderLevel: 50,
      reorderQty: 100,
      trackStock: true,
      active: true,
    },
  });
  await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: office.id,
      unitId: piece.id,
      sku: 'STP-001',
      barcode: '8901234567892',
      name: 'Stapler - Heavy Duty',
      description: 'Heavy duty stapler for office use',
      costPrice: 180,
      sellingPrice: 250,
      reorderLevel: 5,
      reorderQty: 10,
      trackStock: true,
      active: true,
    },
  });
  console.log('✅ Products created');

  // Create Permissions
  const modules = ['dashboard', 'pos', 'sales', 'products', 'inventory', 
    'customers', 'suppliers', 'purchases', 'expenses', 'services',
    'reports', 'users', 'settings', 'audit'];
  const actions = ['view', 'create', 'edit', 'delete', 'approve', 'adjust'];

  const permissions = [];
  for (const module of modules) {
    for (const action of actions) {
      const permission = await prisma.permission.create({
        data: {
          module,
          action,
          description: `${action} ${module}`,
        },
      });
      permissions.push(permission);
    }
  }
  console.log('✅ Permissions created');

  // Create Roles
  const roleNames = ['Super Admin', 'Manager', 'Cashier', 'Inventory Officer', 'Accountant'];
  const roles = [];
  for (const roleName of roleNames) {
    const role = await prisma.role.create({
      data: {
        companyId: company.id,
        name: roleName,
        description: `${roleName} role`,
      },
    });
    roles.push(role);
  }
  console.log('✅ Roles created');

  // Assign all permissions to Super Admin
  const superAdminRole = roles[0];
  for (const permission of permissions) {
    await prisma.rolePermission.create({
      data: {
        roleId: superAdminRole.id,
        permissionId: permission.id,
      },
    });
  }
  console.log('✅ Permissions assigned to Super Admin');

  // Create Super Admin User
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      username: 'admin',
      email: 'admin@sami.com',
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      phone: '+251-900-000-001',
      roles: {
        create: {
          roleId: superAdminRole.id,
        },
      },
    },
  });
  console.log('✅ Super Admin user created');

  console.log('🎉 Seed completed successfully!');
  console.log('📝 Login with: admin / admin123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
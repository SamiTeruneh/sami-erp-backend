import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { SalesModule } from './modules/sales/sales.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ServicesModule } from './modules/services/services.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PrismaModule } from './common/prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    SalesModule,
    InventoryModule,
    PurchasesModule,
    CustomersModule,
    SuppliersModule,
    ExpensesModule,
    ServicesModule,
    ReportsModule,
    AuditModule,
    SettingsModule,
  ],
})
export class AppModule {}
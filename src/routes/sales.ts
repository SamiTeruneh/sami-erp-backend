import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Create sale
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { items, customerId, paymentMethod, amountReceived, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Sale must have at least one item' });
    }

    // Calculate totals
    let subtotal = 0;
    const saleItems = [];

    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: {
          id: item.productId,
          companyId: req.user.companyId,
        },
        include: {
          inventory: {
            include: {
              warehouse: true,
            },
          },
        },
      });

      if (!product) {
        return res.status(404).json({ message: `Product ${item.productId} not found` });
      }

      const stock = product.inventory.reduce((sum: number, inv: any) => sum + inv.quantityOnHand, 0);
      if (stock < item.quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${product.name}. Available: ${stock}` 
        });
      }

      const lineTotal = item.quantity * item.unitPrice - (item.discount || 0);
      subtotal += lineTotal;

      saleItems.push({
        productId: product.id,
        productNameSnapshot: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: product.costPrice,
        discount: item.discount || 0,
        tax: item.tax || 0,
        lineTotal,
      });
    }

    const total = subtotal;
    const balanceDue = total - (amountReceived || 0);

    // Generate invoice number
    const invoiceCount = await prisma.sale.count({
      where: { companyId: req.user.companyId },
    });
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(6, '0')}`;

    // Create sale in transaction
    const sale = await prisma.$transaction(async (tx) => {
      // Create sale
      const newSale = await tx.sale.create({
        data: {
          companyId: req.user.companyId,
          branchId: req.user.branchId || 'temp',
          warehouseId: 'temp',
          customerId: customerId || null,
          cashierId: req.user.id,
          invoiceNumber,
          saleDate: new Date(),
          saleTime: new Date().toLocaleTimeString(),
          status: balanceDue > 0 ? 'Credit' : 'Completed',
          subtotal,
          discount: 0,
          tax: 0,
          total,
          amountPaid: amountReceived || 0,
          balanceDue: balanceDue > 0 ? balanceDue : 0,
          paymentStatus: balanceDue > 0 ? (amountReceived > 0 ? 'Partial' : 'Credit') : 'Paid',
          notes: notes || null,
          items: {
            create: saleItems,
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      // Create payment if amount received
      if (amountReceived && amountReceived > 0) {
        await tx.payment.create({
          data: {
            saleId: newSale.id,
            customerId: customerId || null,
            paymentMethod: paymentMethod || 'Cash',
            amount: amountReceived,
            paymentDate: new Date(),
            receivedBy: req.user.id,
          },
        });
      }

      // Update inventory
      for (const item of saleItems) {
        // Get inventory balance
        const inventory = await tx.inventoryBalance.findFirst({
          where: {
            productId: item.productId,
            warehouseId: 'temp',
          },
        });

        if (inventory) {
          await tx.inventoryBalance.update({
            where: { id: inventory.id },
            data: {
              quantityOnHand: { decrement: item.quantity },
              quantityAvailable: { decrement: item.quantity },
            },
          });

          // Create inventory transaction
          await tx.inventoryTransaction.create({
            data: {
              warehouseId: 'temp',
              productId: item.productId,
              transactionType: 'SALE',
              referenceType: 'SALE',
              referenceId: newSale.id,
              quantity: -item.quantity,
              unitCost: item.unitCost,
              balanceAfter: inventory.quantityOnHand - item.quantity,
              createdBy: req.user.id,
            },
          });
        }
      }

      return newSale;
    });

    res.status(201).json({
      ...sale,
      receipt: generateReceipt(sale, amountReceived),
    });
  } catch (error) {
    console.error('Create sale error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get sales
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, status } = req.query;
    
    const where: any = {
      companyId: req.user.companyId,
    };

    if (startDate) {
      where.saleDate = { gte: new Date(startDate as string) };
    }
    if (endDate) {
      where.saleDate = { ...where.saleDate, lte: new Date(endDate as string) };
    }
    if (status) {
      where.status = status as string;
    }

    const sales = await prisma.sale.findMany({
      where,
      include: {
        customer: true,
        cashier: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        payments: true,
      },
      orderBy: { saleDate: 'desc' },
    });

    res.json(sales);
  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Generate receipt
function generateReceipt(sale: any, amountReceived: number): string {
  const lines = [
    '=================================',
    '     SAMI STATIONARY',
    '     Addis Ababa, Ethiopia',
    '     Tel: +251-900-000-000',
    '=================================',
    `Invoice: ${sale.invoiceNumber}`,
    `Date: ${new Date(sale.saleDate).toLocaleDateString()}`,
    `Time: ${sale.saleTime}`,
    `Cashier: ${sale.cashier?.firstName || ''} ${sale.cashier?.lastName || ''}`,
    '---------------------------------',
    'Item          Qty  Price   Total',
    '---------------------------------',
  ];

  for (const item of sale.items) {
    lines.push(
      `${item.productNameSnapshot.substring(0, 12).padEnd(12)} ` +
      `${item.quantity.toString().padEnd(6)} ` +
      `${item.unitPrice.toFixed(2).padEnd(8)} ` +
      `${item.lineTotal.toFixed(2)}`
    );
  }

  lines.push('---------------------------------');
  lines.push(`Subtotal: ${sale.subtotal.toFixed(2)}`.padStart(30));
  lines.push(`Total: ${sale.total.toFixed(2)}`.padStart(30));
  lines.push(`Paid: ${(amountReceived || 0).toFixed(2)}`.padStart(30));
  const change = (amountReceived || 0) - sale.total;
  if (change >= 0) {
    lines.push(`Change: ${change.toFixed(2)}`.padStart(30));
  } else {
    lines.push(`Balance: ${(-change).toFixed(2)}`.padStart(30));
  }
  lines.push('---------------------------------');
  lines.push('     Thank you for shopping!');
  lines.push('=================================');
  lines.push('');

  return lines.join('\n');
}

export default router;
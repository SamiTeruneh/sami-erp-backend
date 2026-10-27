import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get all customers
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { q, active } = req.query;
    
    const where: any = {
      companyId: req.user.companyId,
    };

    if (q) {
      where.OR = [
        { name: { contains: q as string, mode: 'insensitive' } },
        { customerCode: { contains: q as string, mode: 'insensitive' } },
        { phone: { contains: q as string, mode: 'insensitive' } },
      ];
    }

    if (active !== undefined) {
      where.active = active === 'true';
    }

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Calculate balances
    const customersWithBalance = await Promise.all(
      customers.map(async (customer) => {
        const sales = await prisma.sale.aggregate({
          where: {
            customerId: customer.id,
            status: { notIn: ['Voided', 'Returned'] },
          },
          _sum: { total: true },
        });

        const payments = await prisma.payment.aggregate({
          where: {
            customerId: customer.id,
          },
          _sum: { amount: true },
        });

        const totalSales = sales._sum.total || 0;
        const totalPayments = payments._sum.amount || 0;
        const balance = totalSales - totalPayments;

        return {
          ...customer,
          balance,
          totalPurchases: totalSales,
        };
      })
    );

    res.json(customersWithBalance);
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create customer
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const customerData = req.body;
    
    const customer = await prisma.customer.create({
      data: {
        ...customerData,
        companyId: req.user.companyId,
        customerCode: customerData.customerCode || `CUST-${Date.now()}`,
      },
    });

    res.status(201).json(customer);
  } catch (error: any) {
    console.error('Create customer error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Customer code already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update customer
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customerData = req.body;
    
    const customer = await prisma.customer.update({
      where: {
        id,
        companyId: req.user.companyId,
      },
      data: customerData,
    });

    res.json(customer);
  } catch (error: any) {
    console.error('Update customer error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get all products
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { q, category, active } = req.query;
    
    const where: any = {
      companyId: req.user.companyId,
    };

    if (q) {
      where.OR = [
        { name: { contains: q as string, mode: 'insensitive' } },
        { sku: { contains: q as string, mode: 'insensitive' } },
        { barcode: { contains: q as string, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.categoryId = category as string;
    }

    if (active !== undefined) {
      where.active = active === 'true';
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        category: true,
        unit: true,
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Add stock from inventory
    const productsWithStock = products.map(product => ({
      ...product,
      stock: product.inventory.reduce((sum: number, inv: any) => sum + inv.quantityOnHand, 0),
      inventory: undefined,
    }));

    res.json(productsWithStock);
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Search products
router.get('/search', async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!q || (q as string).length < 2) {
      return res.json([]);
    }

    const products = await prisma.product.findMany({
      where: {
        companyId: req.user.companyId,
        active: true,
        OR: [
          { name: { contains: q as string, mode: 'insensitive' } },
          { sku: { contains: q as string, mode: 'insensitive' } },
          { barcode: { contains: q as string, mode: 'insensitive' } },
        ],
      },
      include: {
        category: true,
        unit: true,
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
      take: 20,
    });

    const productsWithStock = products.map(product => ({
      ...product,
      stock: product.inventory.reduce((sum: number, inv: any) => sum + inv.quantityOnHand, 0),
      inventory: undefined,
    }));

    res.json(productsWithStock);
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get product by barcode
router.get('/barcode/:barcode', async (req: AuthRequest, res: Response) => {
  try {
    const { barcode } = req.params;
    
    const product = await prisma.product.findUnique({
      where: { barcode },
      include: {
        category: true,
        unit: true,
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const productWithStock = {
      ...product,
      stock: product.inventory.reduce((sum: number, inv: any) => sum + inv.quantityOnHand, 0),
      inventory: undefined,
    };

    res.json(productWithStock);
  } catch (error) {
    console.error('Get product by barcode error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get single product
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const product = await prisma.product.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        category: true,
        unit: true,
        prices: true,
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const productWithStock = {
      ...product,
      stock: product.inventory.reduce((sum: number, inv: any) => sum + inv.quantityOnHand, 0),
      inventory: undefined,
    };

    res.json(productWithStock);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create product
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const productData = req.body;
    
    const product = await prisma.product.create({
      data: {
        ...productData,
        companyId: req.user.companyId,
      },
      include: {
        category: true,
        unit: true,
      },
    });

    res.status(201).json(product);
  } catch (error: any) {
    console.error('Create product error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'SKU or Barcode already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update product
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const productData = req.body;
    
    const product = await prisma.product.update({
      where: {
        id,
        companyId: req.user.companyId,
      },
      data: productData,
      include: {
        category: true,
        unit: true,
      },
    });

    res.json(product);
  } catch (error: any) {
    console.error('Update product error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'SKU or Barcode already exists' });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
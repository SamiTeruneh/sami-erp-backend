import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          lockedUntil: user.failedLoginAttempts + 1 >= 5
            ? new Date(Date.now() + 30 * 60 * 1000)
            : undefined,
        },
      });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Reset failed attempts
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const payload = { sub: user.id, username: user.username };
    const accessToken = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    const refreshToken = crypto.randomBytes(32).toString('hex');

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const permissions = user.roles.flatMap((r: any) =>
      r.role.permissions.map((p: any) => `${p.permission.module}.${p.permission.action}`)
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        roles: user.roles.map((r: any) => r.role.name),
        permissions: [...new Set(permissions)],
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Refresh token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required' });
    }

    const sessions = await prisma.session.findMany({
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
      include: {
        user: true,
      },
    });

    let validSession = null;
    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        validSession = session;
        break;
      }
    }

    if (!validSession) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const payload = { sub: validSession.user.id, username: validSession.user.username };
    const newAccessToken = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    const newRefreshToken = crypto.randomBytes(32).toString('hex');

    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    await prisma.session.update({
      where: { id: validSession.id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required' });
    }

    const sessions = await prisma.session.findMany({
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
    });

    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        await prisma.session.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        break;
      }
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
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
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is locked. Please try again later.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          lockedUntil: user.failedLoginAttempts + 1 >= 5 
            ? new Date(Date.now() + 30 * 60 * 1000) 
            : undefined,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const payload = { sub: user.id, username: user.username };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = randomBytes(32).toString('hex');

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const permissions = user.roles.flatMap(r => 
      r.role.permissions.map(p => `${p.permission.module}.${p.permission.action}`)
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        roles: user.roles.map(r => r.role.name),
        permissions: [...new Set(permissions)],
      },
    };
  }

  async refreshToken(refreshToken: string) {
    const sessions = await this.prisma.session.findMany({
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
      throw new UnauthorizedException('Invalid refresh token');
    }

    const payload = { sub: validSession.user.id, username: validSession.user.username };
    const newAccessToken = this.jwtService.sign(payload);
    const newRefreshToken = randomBytes(32).toString('hex');

    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    await this.prisma.session.update({
      where: { id: validSession.id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    const sessions = await this.prisma.session.findMany({
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
    });

    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        await this.prisma.session.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        return { message: 'Logged out successfully' };
      }
    }

    return { message: 'Logged out successfully' };
  }
}
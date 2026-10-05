import { prisma } from '../db/prisma.js';
import { CryptoService } from '../security/crypto.service.js';
import { BadRequestError, UnauthorizedError, ConflictError } from '../core/errors.js';
import type { SetupAdminRequest, LoginRequest, AuthUser, UserDto } from '@bills-master/shared-types';

export class AuthService {
  public static async isConfigured(): Promise<boolean> {
    const count = await prisma.user.count();
    return count > 0;
  }

  public static async setupInitialAdmin(data: SetupAdminRequest): Promise<UserDto> {
    const isConfigured = await this.isConfigured();
    if (isConfigured) {
      throw new ConflictError('W systemie istnieje już skonfigurowane konto administratora');
    }

    if (!data.email || !data.password || !data.name) {
      throw new BadRequestError('Adres e-mail, imię i hasło są wymagane');
    }

    if (data.password.length < 8) {
      throw new BadRequestError('Hasło musi mieć co najmniej 8 znaków');
    }

    const passwordHash = await CryptoService.hashPassword(data.password);

    const admin = await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        name: data.name.trim(),
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      isActive: admin.isActive,
      theme: (admin.theme as 'dark' | 'light') || 'dark',
      createdAt: admin.createdAt.toISOString(),
      updatedAt: admin.updatedAt.toISOString(),
    };
  }

  public static async login(credentials: LoginRequest): Promise<AuthUser> {
    if (!credentials.email || !credentials.password) {
      throw new BadRequestError('Adres e-mail i hasło są wymagane');
    }

    const user = await prisma.user.findUnique({
      where: { email: credentials.email.toLowerCase().trim() },
      include: {
        groups: {
          include: {
            group: {
              select: { id: true, name: true, description: true },
            },
          },
          orderBy: {
            group: { name: 'asc' },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('Nieprawidłowy adres e-mail lub hasło');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Konto zostało zablokowane. Skontaktuj się z administratorem systemu.');
    }

    const isValid = await CryptoService.verifyPassword(credentials.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Nieprawidłowy adres e-mail lub hasło');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      theme: (user.theme as 'dark' | 'light') || 'dark',
      groups: user.groups.map((g) => ({
        id: g.group.id,
        name: g.group.name,
        description: g.group.description,
      })),
    };
  }

  public static async getUserById(id: string): Promise<UserDto | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        groups: {
          include: {
            group: {
              select: { id: true, name: true, description: true },
            },
          },
          orderBy: {
            group: { name: 'asc' },
          },
        },
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      theme: (user.theme as 'dark' | 'light') || 'dark',
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      groups: user.groups.map((g) => ({
        id: g.group.id,
        name: g.group.name,
        description: g.group.description,
      })),
    };
  }

  public static async updateUserTheme(id: string, theme: 'dark' | 'light'): Promise<{ theme: 'dark' | 'light' }> {
    const user = await prisma.user.update({
      where: { id },
      data: { theme },
      select: { theme: true },
    });
    return { theme: (user.theme as 'dark' | 'light') || 'dark' };
  }
}

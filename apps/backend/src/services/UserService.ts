import { prisma } from '../db/prisma.js';
import { CryptoService } from '../security/crypto.service.js';
import { BadRequestError, ConflictError, NotFoundError } from '../core/errors.js';
import type { CreateUserRequest, UpdateUserRequest, UserDto } from '@bills-master/shared-types';

export class UserService {
  public static async listUsers(): Promise<UserDto[]> {
    const users = await prisma.user.findMany({
      include: {
        groups: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      theme: (u.theme as 'dark' | 'light') || 'dark',
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      groups: u.groups.map((g) => ({
        id: g.group.id,
        name: g.group.name,
      })),
    }));
  }

  public static async getUserById(id: string): Promise<UserDto | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        groups: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
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
      })),
    };
  }

  public static async createUser(data: CreateUserRequest): Promise<UserDto> {
    if (!data.email || !data.password || !data.name) {
      throw new BadRequestError('Imię, adres e-mail i hasło są wymagane');
    }

    if (data.password.length < 8) {
      throw new BadRequestError('Hasło musi mieć co najmniej 8 znaków');
    }

    // Strictly enforce: There is just one admin account
    if (data.role === 'ADMIN') {
      throw new BadRequestError('Nie można utworzyć kolejnego konta administratora. W systemie dozwolony jest tylko jeden administrator.');
    }

    const existing = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictError('Użytkownik z tym adresem e-mail już istnieje');
    }

    const passwordHash = await CryptoService.hashPassword(data.password);
    const groupIds = Array.isArray(data.groupIds) ? Array.from(new Set(data.groupIds)) : [];

    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        name: data.name.trim(),
        passwordHash,
        role: 'USER', // Always USER
        isActive: true,
        groups: {
          create: groupIds.map((groupId) => ({
            group: { connect: { id: groupId } },
          })),
        },
      },
      include: {
        groups: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

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
      })),
    };
  }

  public static async updateUser(id: string, data: UpdateUserRequest): Promise<UserDto> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('Nie znaleziono użytkownika');
    }

    // Protection for admin account
    if (user.role === 'ADMIN') {
      if (data.isActive === false) {
        throw new BadRequestError('Konto administratora nie może zostać zablokowane');
      }
    }

    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.isActive !== undefined && user.role !== 'ADMIN') {
      updateData.isActive = data.isActive;
    }
    if (data.email !== undefined) {
      const email = data.email.toLowerCase().trim();
      if (email !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new ConflictError('Ten adres e-mail jest już zajęty');
        updateData.email = email;
      }
    }
    if (data.password) {
      if (data.password.length < 8) {
        throw new BadRequestError('Hasło musi mieć co najmniej 8 znaków');
      }
      updateData.passwordHash = await CryptoService.hashPassword(data.password);
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx.user.update({
          where: { id },
          data: updateData,
        });
      }

      if (data.groupIds !== undefined && user.role !== 'ADMIN') {
        const uniqueGroupIds = Array.from(new Set(data.groupIds));
        await tx.userGroup.deleteMany({ where: { userId: id } });
        if (uniqueGroupIds.length > 0) {
          await tx.userGroup.createMany({
            data: uniqueGroupIds.map((groupId) => ({
              userId: id,
              groupId,
            })),
          });
        }
      }
    });

    const updated = await this.getUserById(id);
    if (!updated) {
      throw new NotFoundError('Nie znaleziono użytkownika');
    }
    return updated;
  }

  public static async deleteUser(id: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('Nie znaleziono użytkownika');
    
    // There is just one admin account - it cannot be deleted
    if (user.role === 'ADMIN') {
      throw new BadRequestError('Konto administratora nie może zostać usunięte');
    }

    await prisma.user.delete({ where: { id } });
  }
}

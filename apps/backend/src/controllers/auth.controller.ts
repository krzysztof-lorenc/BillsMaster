import type { FastifyPluginAsync } from 'fastify';
import { AuthService } from '../services/AuthService.js';
import { SyncService } from '../services/SyncService.js';
import type { SetupAdminRequest, LoginRequest, UpdateThemeRequest } from '@bills-master/shared-types';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Check whether the application needs initial setup
  fastify.get('/status', async (_request, reply) => {
    const isConfigured = await AuthService.isConfigured();
    return reply.send({ isConfigured, version: '1.0.0' });
  });

  // Setup initial admin (only allowed if database has zero users)
  fastify.post<{ Body: SetupAdminRequest }>('/setup-admin', async (request, reply) => {
    const user = await AuthService.setupInitialAdmin(request.body);

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return reply.status(201).send({ user, token });
  });

  // Standard login
  fastify.post<{ Body: LoginRequest }>('/login', async (request, reply) => {
    const user = await AuthService.login(request.body);

    const token = fastify.jwt.sign(user);

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return reply.send({ user, token });
  });

  // Logout
  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ success: true });
  });

  // Current authenticated user info
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const user = await AuthService.getUserById(request.user.id);
      if (!user) {
        return reply.status(401).send({ message: 'Nie znaleziono użytkownika' });
      }
      return reply.send({ user });
    },
  });

  // Update user theme preference
  fastify.patch<{ Body: UpdateThemeRequest }>('/theme', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { theme } = request.body || {};
      if (!theme || (theme !== 'dark' && theme !== 'light')) {
        return reply.status(400).send({ message: 'Nieprawidłowy motyw. Dozwolone: dark, light' });
      }
      const result = await AuthService.updateUserTheme(request.user.id, theme);
      return reply.send({ success: true, theme: result.theme });
    },
  });
};

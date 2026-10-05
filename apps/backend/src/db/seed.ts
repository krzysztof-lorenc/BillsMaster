import crypto from 'node:crypto';
import { prisma } from './prisma.js';
import { logger } from '../core/logger.js';
import { CryptoService } from '../security/crypto.service.js';

export async function seedProviders() {
  // 1. Initial provider plugins (only create if missing, never overwrite existing)
  const initialProviders = [
    {
      id: 'tauron',
      name: 'Tauron',
      category: 'ELECTRICITY',
      loginUrl: 'https://logowanie.tauron.pl',
      isEnabled: true,
      iconUrl: '/providers/tauron.svg',
    },
    {
      id: 'myorlen',
      name: 'myORLEN',
      category: 'GAS',
      loginUrl: 'https://ebok.myorlen.pl/',
      isEnabled: true,
      iconUrl: '/providers/myorlen.svg',
    },
    {
      id: 'netia',
      name: 'Netia',
      category: 'INTERNET',
      loginUrl: 'https://www.netiaonline.pl/',
      isEnabled: true,
      iconUrl: '/providers/netia.svg',
    },
    {
      id: 'aqua',
      name: 'AQUA Bielsko-Biała',
      category: 'WATER',
      loginUrl: 'https://ebok.aqua.com.pl/ords/r/ebok/e/logowanie',
      isEnabled: true,
      iconUrl: '/providers/aqua.svg',
    },
    {
      id: 'eurolan',
      name: 'Euro-lan',
      category: 'INTERNET',
      loginUrl: 'https://bok.euro-lan.pl/',
      isEnabled: true,
      iconUrl: '/providers/eurolan.svg',
    },
    {
      id: 'ekartoteka',
      name: 'e-kartoteka',
      category: 'HOUSING',
      loginUrl: 'https://www.e-kartoteka.pl/#/login',
      isEnabled: true,
      iconUrl: '/providers/ekartoteka.svg',
    },
    {
      id: 'mail-script',
      name: 'Poczta (Google Apps Script)',
      category: 'OTHER',
      loginUrl: 'https://script.google.com',
      isEnabled: true,
      iconUrl: '/providers/mail.svg',
    },
  ];

  // Remove deprecated/removed and demo/test providers if present
  const providersToRemove = ['play', 'canalplus'];
  if (process.env.NODE_ENV !== 'test') {
    providersToRemove.push('mock-provider', 'test-retention-provider');
  }

  await prisma.provider.deleteMany({
    where: { id: { in: providersToRemove } },
  });

  if (process.env.NODE_ENV === 'test') {
    initialProviders.push({
      id: 'mock-provider',
      name: 'Demo Mock Portal (Dev & Testing)',
      category: 'ELECTRICITY',
      loginUrl: 'mock://demo-portal',
      isEnabled: true,
      iconUrl: '/providers/mock.svg',
    });
  }

  for (const provider of initialProviders) {
    await prisma.provider.upsert({
      where: { id: provider.id },
      create: provider,
      update: {
        name: provider.name,
        category: provider.category,
        loginUrl: provider.loginUrl,
        iconUrl: provider.iconUrl,
        isEnabled: provider.isEnabled,
      },
    });
  }

  // 2. Ensure default MailScriptConfig exists
  const publicBaseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
  const defaultIngestUrl = `${publicBaseUrl.replace(/\/$/, '')}/api/mail-script/ingest`;

  const existingMailConfig = await prisma.mailScriptConfig.findUnique({ where: { id: 'default' } });
  if (!existingMailConfig) {
    const token = 'bm_sec_' + crypto.randomBytes(16).toString('hex');
    await prisma.mailScriptConfig.create({
      data: {
        id: 'default',
        endpointUrl: defaultIngestUrl,
        secretToken: token,
      },
    });
    logger.info('📧 Created default MailScriptConfig');
  } else if (existingMailConfig.endpointUrl.includes('custom-domain.local')) {
    await prisma.mailScriptConfig.update({
      where: { id: 'default' },
      data: {
        endpointUrl: defaultIngestUrl,
      },
    });
  }

  // 3. Ensure default administrator account exists (Single admin account)
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!existingAdmin) {
    const adminHash = await CryptoService.hashPassword('AdminSuperPassword2026!');
    await prisma.user.create({
      data: {
        email: 'admin@billsmaster.local',
        name: 'Chief Admin',
        passwordHash: adminHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    logger.info('👤 Created default administrator account: admin@billsmaster.local');
  }

  logger.info('✅ Database seed & integrity check complete');
}

// Run directly if invoked as script
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedProviders()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      logger.error('Error seeding providers:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

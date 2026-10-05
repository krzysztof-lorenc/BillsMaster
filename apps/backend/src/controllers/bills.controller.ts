import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import { BillService } from '../services/BillService.js';
import { ForbiddenError } from '../core/errors.js';
import type { BillFilterQuery, UpdateBillPaymentStatusRequest } from '@bills-master/shared-types';

export const billsRoutes: FastifyPluginAsync = async (fastify) => {
  // Enforce authentication & disallow ADMIN from viewing bills
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
    if (request.user.role === 'ADMIN') {
      throw new ForbiddenError('Konta administratora nie mają dostępu do rachunków');
    }
  });

  // Get bills list
  fastify.get<{ Querystring: BillFilterQuery }>('/bills', async (request, reply) => {
    const bills = await BillService.getBills(request.user.id, request.query);
    return reply.send({ bills });
  });

  // Get dashboard summary statistics
  fastify.get<{ Querystring: { groupId?: string } }>('/bills/summary', async (request, reply) => {
    const summary = await BillService.getSummary(request.user.id, request.query?.groupId);
    return reply.send({ summary });
  });

  // Download PDF invoice
  fastify.get<{ Params: { id: string } }>('/bills/:id/pdf', async (request, reply) => {
    const { filePath, fileName } = await BillService.getBillPdf(request.user.id, request.params.id);

    // Sanitize fileName to prevent invalid characters in HTTP header (RFC 6266 / Node.js ERR_INVALID_CHAR)
    const sanitizedFileName = (fileName || `Invoice_${request.params.id}.pdf`)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/["\\]/g, '')
      .trim();

    const asciiFileName = sanitizedFileName.replace(/[^\x20-\x7E]/g, '_');
    const encodedFileName = encodeURIComponent(sanitizedFileName);

    reply.header('Content-Type', 'application/pdf');
    reply.header(
      'Content-Disposition',
      `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`
    );

    const stream = fs.createReadStream(filePath);
    return reply.send(stream);
  });

  // Update bill payment status (for mail script invoices)
  fastify.patch<{ Params: { id: string }; Body: UpdateBillPaymentStatusRequest }>(
    '/bills/:id/payment-status',
    async (request, reply) => {
      const bill = await BillService.updateBillPaymentStatus(
        request.user.id,
        request.params.id,
        request.body || {}
      );
      return reply.send({ bill });
    }
  );
};

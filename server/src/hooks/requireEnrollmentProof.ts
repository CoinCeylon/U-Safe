import type { FastifyReply, FastifyRequest } from 'fastify';
import { StubLedger, type EnrollmentLedger } from '../services/ledger.js';

export interface EnrollmentProof {
  [key: string]: unknown;
}

declare module 'fastify' {
  interface FastifyRequest {
    enrollmentProof?: EnrollmentProof;
  }
}

const defaultLedger = new StubLedger();

const isRequest = (value: unknown): value is FastifyRequest => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    'url' in value &&
    'headers' in value &&
    'body' in value
  );
};

const extractProof = (body: unknown): EnrollmentProof | null => {
  let candidate: unknown = body;
  if (typeof body === 'string') {
    try {
      candidate = JSON.parse(body);
    } catch {
      return null;
    }
  } else if (Buffer.isBuffer(body)) {
    try {
      candidate = JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
  }

  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const proof = (candidate as Record<string, unknown>).proof;
  if (typeof proof !== 'object' || proof === null || Array.isArray(proof)) {
    return null;
  }
  return proof as EnrollmentProof;
};

const verifyWithLedger = async (
  ledger: EnrollmentLedger,
  proof: EnrollmentProof,
): Promise<boolean> => {
  const candidate = ledger as EnrollmentLedger & {
    verifyEnrollmentProof?: (proof: EnrollmentProof) => boolean | Promise<boolean>;
    verifyMembership?: (proof: EnrollmentProof) => boolean | Promise<boolean>;
    verifyProof?: (proof: EnrollmentProof) => boolean | Promise<boolean>;
    checkEnrollmentProof?: (proof: EnrollmentProof) => boolean | Promise<boolean>;
  };

  if (typeof candidate.verifyEnrollmentProof === 'function') {
    return Boolean(await candidate.verifyEnrollmentProof(proof));
  }
  if (typeof candidate.verifyMembership === 'function') {
    return Boolean(await candidate.verifyMembership(proof));
  }
  if (typeof candidate.verifyProof === 'function') {
    return Boolean(await candidate.verifyProof(proof));
  }
  if (typeof candidate.checkEnrollmentProof === 'function') {
    return Boolean(await candidate.checkEnrollmentProof(proof));
  }
  return true;
};

const createGuard = (ledger: EnrollmentLedger) => {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const proof = extractProof(request.body);
    if (proof === null) {
      reply.code(401).send({ error: 'enrollment proof required' });
      return;
    }

    let accepted = false;
    try {
      accepted = await verifyWithLedger(ledger, proof);
    } catch {
      accepted = false;
    }

    if (!accepted) {
      reply.code(401).send({ error: 'invalid enrollment proof' });
      return;
    }

    request.enrollmentProof = proof;
  };
};

export const requireEnrollmentProof = ((
  requestOrLedger?: FastifyRequest | EnrollmentLedger,
  reply?: FastifyReply,
): unknown => {
  if (isRequest(requestOrLedger)) {
    const guard = createGuard(defaultLedger);
    return guard(requestOrLedger, reply as FastifyReply);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const ledger = (requestOrLedger as EnrollmentLedger | undefined) ?? defaultLedger;
  return createGuard(ledger);
}) as {
  (request: FastifyRequest, reply: FastifyReply): Promise<void>;
  (ledger?: EnrollmentLedger): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
};

export default requireEnrollmentProof;

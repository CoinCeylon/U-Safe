import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCommunityKey } from '@usafe/crypto';
import { buildSealedEnvelope } from '../lib/sealedEnvelope';
import {
  loadOpenComplaintTexts,
  rememberComplaintText,
} from './complaint-text';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M059 duplicate-suggestion corpus', () => {
  it('decrypts open complaints with the community key when text is not cached', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
    });

    const communityKey = generateCommunityKey();
    const sealed = await buildSealedEnvelope(
      { description: 'Senior students shouted at first years in the hostel.' },
      communityKey,
      { kind: 'community' },
    );
    const complaints = [
      {
        id: 'c-1',
        category: 'verbal',
        status: 'not_started',
        ownerRole: 'university',
        supportCount: 2,
        payloadHash: sealed.blobHash,
      },
    ];

    const fetchImpl = ((input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith('/api/complaints?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ complaints }), { status: 200 }),
        );
      }
      if (url === `/api/blobs/${sealed.blobHash}`) {
        return Promise.resolve(
          new Response(sealed.bytes as unknown as BodyInit, { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
        }),
      );
    }) as typeof fetch;

    const texts = await loadOpenComplaintTexts('uni-1', {
      communityKey,
      fetchImpl,
    });

    expect(texts).toEqual([
      {
        id: 'c-1',
        category: 'verbal',
        status: 'not_started',
        ownerRole: 'university',
        supportCount: 2,
        payloadHash: sealed.blobHash,
        text: 'Senior students shouted at first years in the hostel.',
      },
    ]);
  });

  it('uses cached text even without a community key', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
    });
    rememberComplaintText('uni-1', 'c-1', 'A cached description of the incident.');

    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            complaints: [
              {
                id: 'c-1',
                category: 'verbal',
                status: 'not_started',
                ownerRole: 'university',
                supportCount: 1,
                payloadHash: 'aa'.repeat(32),
              },
            ],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;

    const texts = await loadOpenComplaintTexts('uni-1', { fetchImpl });
    expect(texts[0]?.text).toBe('A cached description of the incident.');
  });
});

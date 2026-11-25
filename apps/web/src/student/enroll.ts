// Enrollment API client (M052).
//
// Calls the server OTP and enrollment endpoints:
//   POST /api/otp/request   {email}             -> {ok: true}
//   POST /api/otp/verify    {email, code}       -> {ticket, universityId}
//   POST /api/enroll        {ticket, commitment}-> {leafIndex, path, root, communityKeyWrapped}
//
// Commitment is a 64-char lowercase hex string (32 bytes), matching the
// server's enrollSchema. Enrollment errors surface as friendly messages.

import { SecureStore, IndexedDbStorage } from '@usafe/crypto';
import { getStudentSecret } from './unlock';
import { rememberUniversity } from './session';

export interface OtpTicket {
  ticket: string;
  universityId: string;
}

export interface EnrollResult {
  leafIndex: number;
  path: string[];
  root: string;
  communityKeyWrapped: string;
}

async function requestJson<T>(input: string, body?: unknown): Promise<T> {
  const init: RequestInit = {};
  if (body !== undefined) {
    init.method = 'POST';
    init.headers = {'Content-Type': 'application/json'};
    init.body = JSON.stringify(body);
  }
  const res = await fetch(input, init);
  let payload: {error?: string};
  try {
    payload = (await res.json()) as {error?: string};
  } catch {
    payload = {};
  }
  if (!res.ok) {
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
  return payload as T;
}

export async function requestOtp(email: string): Promise<void> {
  await requestJson<void>('/api/otp/request', {email});
}

export async function verifyOtp(
  email: string,
  code: string,
): Promise<OtpTicket> {
  const result = await requestJson<{
    ticket?: string;
    universityId?: string;
    ok?: boolean;
  }>('/api/otp/verify', {email, code});
  if (!result.ticket || !result.universityId) {
    throw new Error('Invalid code or expired code. Please try again.');
  }
  return {ticket: result.ticket, universityId: result.universityId};
}

export async function enroll(
  ticket: string,
  commitmentHex: string,
): Promise<EnrollResult> {
  return requestJson<EnrollResult>('/api/enroll', {
    ticket,
    commitment: commitmentHex.toLowerCase(),
  });
}

/**
 * Persist the enrolment result in SecureStore, encrypted with a key derived
 * from the student secret. Survives a page reload (IndexedDB backend) but the
 * secret itself is never stored; it is re-derived on unlock.
 */
export async function saveEnrollment(
  universityId: string,
  leafIndex: number,
  communityKeyWrapped: string,
): Promise<void> {
  const secret = getStudentSecret();
  if (secret === null) {
    throw new Error('Student secret is not unlocked');
  }
  const store = new SecureStore(secret, new IndexedDbStorage('usafe', 'enrollment'));
  const value = JSON.stringify({
    universityId,
    leafIndex,
    communityKey: communityKeyWrapped,
  });
  await store.put('enrollment', value);
  // The university id is not sensitive. Keeping it for the session lets a
  // reloaded portal ask the wallet to re-derive the secret and open the feed.
  rememberUniversity(universityId);
}

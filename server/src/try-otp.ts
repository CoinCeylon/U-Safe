import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const collectArgs = (): string[] => process.argv.slice(2).filter((value) => value !== 'bash');

const [emailArg] = collectArgs();
const email = emailArg ?? 'student1@mrt.ac.lk';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const mailboxDir = resolve(process.env.INIT_CWD ?? process.cwd(), 'server', '.dev-mailbox');

const requestOtp = async (): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(`OTP request failed: ${response.status}`);
  }
};

const latestMailboxFile = (): string => {
  const files = readdirSync(mailboxDir)
    .map((name) => ({ name, mtime: statSync(join(mailboxDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) {
    throw new Error(`No mailbox file found in ${mailboxDir}`);
  }
  return join(mailboxDir, files[0]!.name);
};

const extractCode = (content: string): string => {
  const match = content.match(/\b(\d{6})\b/);
  if (match === null) {
    throw new Error('Could not find a 6-digit code in the mailbox file');
  }
  return match[1]!;
};

const verifyOtp = async (code: string): Promise<{ ticket?: string; universityId?: string }> => {
  const response = await fetch(`${baseUrl}/api/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const body = (await response.json()) as { ticket?: string; universityId?: string; ok?: boolean };
  if (!response.ok || body.ticket === undefined) {
    throw new Error(`OTP verify failed: ${JSON.stringify(body)}`);
  }
  return body;
};

const main = async (): Promise<void> => {
  await requestOtp();
  console.log('Requested OTP.');
  console.log(`Read the code from the newest file in: ${mailboxDir}`);

  // Give the dev mailbox a moment to be written.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

  const file = latestMailboxFile();
  const code = extractCode(readFileSync(file, 'utf8'));
  console.log(`Using code ${code} from ${file}`);

  const result = await verifyOtp(code);
  console.log('Enrollment ticket issued:');
  console.log(JSON.stringify(result, null, 2));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

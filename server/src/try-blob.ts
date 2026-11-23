import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const collectArgs = (): string[] => process.argv.slice(2).filter((value) => value !== 'bash');
const [fileArg] = collectArgs();
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const main = async (): Promise<void> => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usafe-blob-'));
  try {
    const sourcePath = fileArg === undefined
      ? join(tempDir, 'input.bin')
      : resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);
    if (fileArg === undefined) {
      writeFileSync(sourcePath, `U-Safe blob test ${Date.now()}\n`, 'utf8');
    }

    const original = readFileSync(sourcePath);
    const hash = sha256(original);

    const uploadResponse = await fetch(`${baseUrl}/api/blobs?hash=${hash}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: original,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
    }

    const downloadResponse = await fetch(`${baseUrl}/api/blobs/${hash}`);
    if (!downloadResponse.ok) {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());

    if (!original.equals(downloaded)) {
      throw new Error('Downloaded bytes do not match uploaded bytes');
    }

    console.log(`Uploaded and downloaded blob successfully.`);
    console.log(`hash: ${hash}`);
    console.log(`size: ${original.length} bytes`);
    console.log(`source: ${sourcePath}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

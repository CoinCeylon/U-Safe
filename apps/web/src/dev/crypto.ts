import '../styles/app.css';
import {
  bucketCount,
  decryptFile,
  encryptFile,
  generateCommunityKey,
  generateRoleKeyPair,
  hashFile,
  openPayload,
  parseEncryptedChunks,
  sealPayload,
  serializeEncryptedChunks,
  stripImage,
  unwrapAesKeyBytes,
  wrapAesKeyBytes,
} from '@usafe/crypto';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

// Top-level error banner so JS failures are visible instead of a blank page.
const errorBanner = document.createElement('div');
errorBanner.className =
  'fixed top-0 left-0 right-0 bg-red-500 text-white p-3 z-50 hidden';
const errorMsg = document.createElement('div');
errorMsg.className = 'text-sm font-mono break-all';
errorBanner.append(errorMsg);
root.append(errorBanner);

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorBanner.classList.remove('hidden');
  console.error(msg);
}

try {
  // Page container: centred column with breathing room around every step.
  const container = document.createElement('div');
  container.className = 'max-w-4xl mx-auto p-4 md:p-6 space-y-4';

  const pageTitle = document.createElement('h1');
  pageTitle.className = 'text-2xl font-bold text-slate-900';
  pageTitle.textContent = 'U-Safe Crypto Playground';

  const pageSubtitle = document.createElement('p');
  pageSubtitle.className = 'text-sm text-slate-500 mt-1 mb-2';
  pageSubtitle.textContent =
    'Local-only test harness for the client crypto library. Nothing leaves this browser.';

  container.append(pageTitle, pageSubtitle);

  const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '*/*';
fileInput.className =
  'block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100';

const fileInfo = document.createElement('div');
fileInfo.className = 'text-sm text-slate-500 mt-2';

function step(title: string, content: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className =
    'p-4 md:p-5 border border-slate-200 border-l-4 border-l-blue-500 bg-white shadow-sm rounded-lg';
  const h = document.createElement('h3');
  h.className = 'text-lg font-semibold text-slate-800 mb-3';
  h.textContent = title;
  el.append(h, content);
  return el;
}

const status = (text: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info'): HTMLElement => {
  const s = document.createElement('div');
  s.className = `text-sm font-medium py-1 px-2 rounded inline-block mt-3 ${toneColors(tone)}`;
  s.textContent = text;
  return s;
};

function toneColors(tone: string): string {
  switch (tone) {
    case 'success':
      return 'bg-green-100 text-green-800';
    case 'warning':
      return 'bg-amber-100 text-amber-800';
    case 'danger':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-blue-100 text-blue-800';
  }
}

const resultBox = (label: string, initialValue: string): HTMLElement => {
  const box = document.createElement('div');
  box.className = 'mt-4 p-3 bg-slate-50 rounded border border-slate-200 text-sm font-mono break-all';
  const lb = document.createElement('div');
  lb.className = 'text-xs text-slate-500 mb-1';
  lb.textContent = label;
  const val = document.createElement('div');
  val.textContent = initialValue;
  val.title = initialValue;
  box.append(lb, val);
  return box;
};

const btn = (label: string, onClick: () => void | Promise<void>): HTMLButtonElement => {
  const b = document.createElement('button');
  b.className =
    'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none transition';
  b.textContent = label;
  b.onclick = async (): Promise<void> => {
    // Without this catch a failed WebCrypto call rejects silently and the
    // button looks like it did nothing at all.
    try {
      await onClick();
    } catch (err) {
      showError(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return b;
};

const fileHashBox = resultBox('SHA-256 of file', '—');
const encryptedHashBox = resultBox('SHA-256 of encrypted bytes', '—');
const wrappedKeyBox = resultBox('Wrapped AES key (hex)', '—');

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('encrypted data must have an even number of hex characters');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const value = Number.parseInt(clean.slice(i, i + 2), 16);
    if (Number.isNaN(value)) {
      throw new Error('encrypted data is not valid hex');
    }
    bytes[i / 2] = value;
  }
  return bytes;
};

// Editable ciphertext box (Human Test 2, step 4): editing one character here
// must make decryption fail.
const ciphertextBox = document.createElement('textarea');
ciphertextBox.className =
  'mt-4 h-32 w-full rounded border border-slate-300 p-2 font-mono text-xs break-all';
ciphertextBox.setAttribute(
  'aria-label',
  'Serialized encrypted data (hex). Edit one character to test tamper detection.',
);
ciphertextBox.placeholder = 'Encrypted data appears here after you press Encrypt.';

let strippedFile: File | null = null;
let aesKeyRaw: Uint8Array | null = null;
let totalBytes = 0;
let wrappedKey: Uint8Array | null = null;
let privateKey: CryptoKey | null = null;

// ---------- Step 1: Choose file ----------
const chooseHeading = document.createElement('h3');
chooseHeading.className = 'text-lg font-semibold text-slate-800 mb-3';
chooseHeading.textContent = '1. Choose a file';
const chooseStep = document.createElement('div');
chooseStep.className =
  'p-4 md:p-5 border border-slate-200 border-l-4 border-l-green-500 bg-white shadow-sm rounded-lg';
chooseStep.append(chooseHeading, fileInput, fileInfo);
container.append(chooseStep);

fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  fileInfo.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · ${file.type || 'application/octet-stream'}`;
  strippedFile = null;
  aesKeyRaw = null;
  wrappedKey = null;
  privateKey = null;
  fileHashBox.querySelector('div:last-child')!.textContent = '—';
  encryptedHashBox.querySelector('div:last-child')!.textContent = '—';
  wrappedKeyBox.querySelector('div:last-child')!.textContent = '—';
  ciphertextBox.value = '';
};

// ---------- Step 2: Strip ----------
const strippedDownloadBox = document.createElement('div');
strippedDownloadBox.className = 'mt-4';
const stripBtn = btn('Strip metadata', async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    alert('Choose a file first');
    return;
  }
  const res = await stripImage(file);
  strippedFile = res.file;
  const msg = res.stripped
    ? `Metadata stripped (${(res.file.size / 1024).toFixed(1)} KB)`
    : `Not stripped (${res.file.type || 'unknown type'} or canvas unavailable)`;
  stripStatus.textContent = msg;
  stripStatus.className = `text-sm font-medium py-1 px-2 rounded inline-block ${res.stripped ? toneColors('success') : toneColors('info')}`;
  const hash = await hashFile(res.file);
  fileHashBox.querySelector('div:last-child')!.textContent = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Offer the stripped file for download so the human can verify metadata
  // removal with an EXIF reader.
  strippedDownloadBox.innerHTML = '';
  if (res.stripped) {
    const url = URL.createObjectURL(res.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.file.name;
    a.textContent = `Download stripped file (${res.file.name})`;
    a.className = 'text-sm text-blue-600 hover:underline';
    strippedDownloadBox.append(a);
  }
});
const stripStatus = status('Not yet stripped');
const stripStep = step('2. Strip metadata', stripBtn);
stripStep.append(stripStatus, strippedDownloadBox);

// ---------- Step 3: Encrypt ----------
const encryptBtn = btn('Encrypt file', async () => {
  const file = strippedFile ?? fileInput.files?.[0];
  if (!file) {
    alert('Choose a file first');
    return;
  }
  const result = await encryptFile(file);
  aesKeyRaw = result.key;
  totalBytes = result.totalBytes;
  encryptStatus.textContent = `Encrypted ${result.chunks.length} chunk(s), ${(result.totalBytes / 1024).toFixed(1)} KB total`;
  encryptStatus.className = 'text-sm font-medium py-1 px-2 rounded inline-block bg-green-100 text-green-800';

  // Hash the *encrypted* bytes, exactly as the submission pipeline does for
  // the evidence identifier (M019), and put the same bytes in the editable box.
  const serialized = serializeEncryptedChunks(result.chunks);
  const encryptedFile = new File(
    [serialized as unknown as BlobPart],
    `${file.name}.enc`,
  );
  const hash = await hashFile(encryptedFile);
  encryptedHashBox.querySelector('div:last-child')!.textContent = toHex(hash);
  ciphertextBox.value = toHex(serialized);
});
const encryptStatus = status('Not yet encrypted');
const encryptStep = step('3. Encrypt (AES-256-GCM, 1 MB chunks)', encryptBtn);
encryptStep.append(
  encryptStatus,
  encryptedHashBox,
  ciphertextBox,
  (() => {
    const hint = document.createElement('p');
    hint.className = 'mt-2 text-xs text-slate-500';
    hint.textContent =
      'The encrypted data is editable. Change one character to test that tampering is detected.';
    return hint;
  })(),
);

// ---------- Step 4: Wrap key ----------
const wrapBtn = btn('Wrap key with RSA-OAEP', async () => {
  if (!aesKeyRaw) {
    alert('Encrypt a file first');
    return;
  }
  const { publicKey, privateKey: priv } = await generateRoleKeyPair();
  privateKey = priv;
  wrappedKey = await wrapAesKeyBytes(aesKeyRaw, publicKey);
  wrapStatus.textContent = 'Key wrapped (RSA-OAEP 2048)';
  wrapStatus.className = 'text-sm font-medium py-1 px-2 rounded inline-block bg-green-100 text-green-800';
  wrappedKeyBox.querySelector('div:last-child')!.textContent = Array.from(wrappedKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
});
const wrapStatus = status('Key not yet wrapped');
const wrapStep = step('4. Wrap AES key (RSA-OAEP 2048)', wrapBtn);
wrapStep.append(wrapStatus, wrappedKeyBox);

// ---------- Step 5: Decrypt ----------
const decryptBtn = btn('Unwrap & decrypt', async () => {
  if (!wrappedKey || !privateKey || aesKeyRaw === null) {
    alert('Wrap a key first');
    return;
  }
  // Decrypt from the editable box, so Human Test 2 step 4 can tamper with the
  // ciphertext and see an error.
  const edited = ciphertextBox.value.trim();
  if (edited === '') {
    alert('Encrypt a file first');
    return;
  }
  const editedChunks = parseEncryptedChunks(fromHex(edited));
  const rawAesKey = await unwrapAesKeyBytes(wrappedKey, privateKey);
  const decrypted = await decryptFile(
    editedChunks,
    rawAesKey,
    totalBytes,
  );
  decryptStatus.textContent = `Decrypted ${(decrypted.length / 1024).toFixed(1)} KB`;
  decryptStatus.className = 'text-sm font-medium py-1 px-2 rounded inline-block bg-green-100 text-green-800';

  const blob = new Blob([decrypted as unknown as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (fileInput.files?.[0]?.name || 'decrypted.bin') + '.dec';
  a.textContent = 'Download decrypted file';
  a.className = 'text-sm text-blue-600 hover:underline';
  downloadBox.innerHTML = '';
  downloadBox.append(a);

  const file = strippedFile ?? fileInput.files?.[0];
  if (file) {
    const originalHash = await hashFile(file);
    const decFile = new File([decrypted as unknown as BlobPart], 'decrypted', { type: file.type });
    const decHash = await hashFile(decFile);
    const match = originalHash.every((b, i) => b === decHash[i]);
    const val = integrityBox.querySelector('div:last-child')!;
    val.textContent = match
      ? 'Integrity verified — decrypted bytes match original'
      : 'Integrity MISMATCH';
    val.className = match ? 'text-green-700 font-medium' : 'text-red-700 font-medium';
  }
});
const decryptStatus = status('Not yet decrypted');
const decryptStep = step('5. Unwrap & decrypt', decryptBtn);
decryptStep.append(decryptStatus);
const downloadBox = document.createElement('div');
downloadBox.className = 'mt-4';
decryptStep.append(downloadBox);

const integrityBox = resultBox('Integrity check', '—');
decryptStep.append(integrityBox);

// ---------- Step 6: Community key + seal payload ----------
const sealBtn = btn('Seal demo payload (community key)', async () => {
  const communityKey = generateCommunityKey();
  const sealed = await sealPayload(
    { description: 'demo complaint text', accusedDetails: 'none', evidenceManifest: [] },
    communityKey,
  );
  sealStatus.textContent = `Payload sealed, hash: ${Array.from(sealed.payloadHash).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  sealStatus.className = 'text-sm font-medium py-1 px-2 rounded inline-block bg-green-100 text-green-800';
  const opened = await openPayload(sealed, communityKey);
  sealResult.textContent = JSON.stringify(opened);
});
const sealStatus = status('Payload not yet sealed');
const sealResult = document.createElement('div');
sealResult.className = 'mt-4 p-3 bg-slate-50 rounded border border-slate-200 text-sm font-mono break-all';
sealResult.textContent = '—';
const sealStep = step('6. Bonus: seal/unseal payload (community key)', sealBtn);
sealStep.append(sealStatus, sealResult);

// ---------- BucketCount demo ----------
const bucketBtn = btn('Run bucketCount edge cases', () => {
  const cases = [0, 1, 4, 5].map((c) => `${c}→${bucketCount(c, 5)}`).join(', ');
  bucketResult.textContent = `bucketCount(c,5): ${cases}`;
});
const bucketResult = document.createElement('div');
bucketResult.className = 'mt-4 text-sm text-slate-600';
bucketResult.textContent = '—';
const bucketStep = step('7. Bonus: bucketCount (small-group protection)', bucketBtn);
bucketStep.append(bucketResult);

container.append(
  stripStep,
  encryptStep,
  wrapStep,
  decryptStep,
  sealStep,
  bucketStep,
);

root.append(container);
} catch (err) {
  showError(err instanceof Error ? err.message : String(err));
}

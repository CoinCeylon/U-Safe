import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_FILES, MAX_EVIDENCE_FILE_BYTES } from '@usafe/shared';
import {
  evidenceKind,
  isExecutable,
  needsMetadataWarning,
  prepareEvidenceFile,
  validateEvidenceFiles,
} from './evidence';

function file(name: string, type = '', size = 12): File {
  const result = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  if (size > 16) {
    Object.defineProperty(result, 'size', { value: size });
  }
  return result;
}

describe('evidence validation (M058)', () => {
  it('rejects an .exe file with a clear message', () => {
    const result = validateEvidenceFiles([file('payload.exe', 'application/octet-stream')]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/executable/i);
  });

  it('rejects an oversized file with the 25 MB limit', () => {
    const result = validateEvidenceFiles([
      file('large.png', 'image/png', MAX_EVIDENCE_FILE_BYTES + 1),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/25 MB/);
  });

  it('accepts a file at exactly the size limit', () => {
    const result = validateEvidenceFiles([
      file('ok.png', 'image/png', MAX_EVIDENCE_FILE_BYTES),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('accepts images, videos, audio, PDF and documents', () => {
    const files = [
      file('photo.jpg', 'image/jpeg'),
      file('clip.mp4', 'video/mp4'),
      file('note.mp3', 'audio/mpeg'),
      file('statement.pdf', 'application/pdf'),
      file('letter.docx', ''),
    ];
    const result = validateEvidenceFiles(files);
    expect(result.accepted).toHaveLength(files.length);
    expect(result.rejected).toHaveLength(0);
  });

  it('enforces the maximum number of files, including already added ones', () => {
    const files = Array.from({ length: MAX_EVIDENCE_FILES + 1 }, (_, i) =>
      file(`photo-${i}.png`, 'image/png'),
    );
    const result = validateEvidenceFiles(files, 0);
    expect(result.accepted).toHaveLength(MAX_EVIDENCE_FILES);
    expect(result.rejected[0]?.reason).toMatch(/Maximum 5 files/);

    const withExisting = validateEvidenceFiles([file('another.png', 'image/png')], 5);
    expect(withExisting.accepted).toHaveLength(0);
  });

  it('rejects unsupported types', () => {
    const result = validateEvidenceFiles([file('archive.zip', 'application/zip')]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/Unsupported type/);
  });

  it('classifies by extension when the browser gives no MIME type', () => {
    expect(evidenceKind(file('scan.pdf', ''))).toBe('pdf');
    expect(evidenceKind(file('notes.txt', ''))).toBe('document');
    expect(isExecutable(file('setup.EXE', ''))).toBe(true);
  });

  it('warns about metadata only for files that cannot be stripped', () => {
    expect(needsMetadataWarning(file('clip.mp4', 'video/mp4'))).toBe(true);
    expect(needsMetadataWarning(file('letter.doc', ''))).toBe(true);
    expect(needsMetadataWarning(file('photo.png', 'image/png'))).toBe(false);
  });

  it('keeps an image unchanged when it cannot be stripped', async () => {
    const original = file('photo.png', 'image/png');
    const result = await prepareEvidenceFile(original);
    expect(result.file).toBe(original);
    expect(result.stripped).toBe(false);
  });

  it('leaves non-image files untouched', async () => {
    const original = file('notes.txt', 'text/plain');
    const result = await prepareEvidenceFile(original);
    expect(result.file).toBe(original);
    expect(result.stripped).toBe(false);
  });
});

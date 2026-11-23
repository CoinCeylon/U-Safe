import { describe, it, expect } from 'vitest';
import {
  hasExifSegment,
  hasGpsExif,
  stripExifFromJpegBytes,
  stripImage,
} from './strip';

// Builds a minimal valid JPEG with an APP1 EXIF segment.
// Optionally includes a GPS IFD pointer (tag 0x8825) in IFD0.
function buildJpegWithExif(options: { gps?: boolean } = {}): Uint8Array {
  const encoder = new TextEncoder();
  const exifPrefix = encoder.encode('Exif\0\0');

  // TIFF header: little-endian "II", magic 42, IFD0 offset = 8 (right after header).
  const tiffHeader = new Uint8Array([
    0x49, 0x49, // II (little endian)
    0x2a, 0x00, // magic 42
    0x08, 0x00, 0x00, 0x00, // IFD0 offset = 8
  ]);

  // IFD0 entries. Each entry: tag(2) + type(2) + count(4) + value(4).
  // We include one ordinary tag and optionally the GPS pointer tag 0x8825.
  const ordinaryTag = new Uint8Array([
    0x0f, 0x01, // tag: Make (0x010f), little-endian
    0x03, 0x00, // type: SHORT
    0x01, 0x00, 0x00, 0x00, // count: 1
    0x01, 0x00, 0x00, 0x00, // value: 1
  ]);

  const gpsPointerTag = new Uint8Array([
    0x25, 0x88, // tag: GPS IFD pointer (0x8825), little-endian
    0x04, 0x00, // type: LONG
    0x01, 0x00, 0x00, 0x00, // count: 1
    0x2a, 0x00, 0x00, 0x00, // value: offset to GPS IFD (dummy)
  ]);

  const entryCount = options.gps ? 2 : 1;
  const ifd0 = new Uint8Array(2 + entryCount * 12 + 4);
  // entry count
  ifd0[0] = entryCount & 0xff;
  ifd0[1] = (entryCount >> 8) & 0xff;
  let pos = 2;
  ifd0.set(ordinaryTag, pos);
  pos += 12;
  if (options.gps) {
    ifd0.set(gpsPointerTag, pos);
    pos += 12;
  }
  // next IFD offset = 0 (no more IFDs)
  ifd0[pos] = 0;
  ifd0[pos + 1] = 0;
  ifd0[pos + 2] = 0;
  ifd0[pos + 3] = 0;

  const exifBody = new Uint8Array(
    exifPrefix.length + tiffHeader.length + ifd0.length,
  );
  exifBody.set(exifPrefix, 0);
  exifBody.set(tiffHeader, exifPrefix.length);
  exifBody.set(ifd0, exifPrefix.length + tiffHeader.length);

  // APP1 segment: marker FF E1 + length (2 bytes, includes length itself) + exifBody
  const app1Segment = new Uint8Array(2 + 2 + exifBody.length);
  app1Segment[0] = 0xff;
  app1Segment[1] = 0xe1;
  const app1Length = 2 + exifBody.length;
  app1Segment[2] = (app1Length >> 8) & 0xff;
  app1Segment[3] = app1Length & 0xff;
  app1Segment.set(exifBody, 4);

  // SOI + APP1 + EOI
  const jpeg = new Uint8Array(2 + app1Segment.length + 2);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8; // SOI
  jpeg.set(app1Segment, 2);
  jpeg[jpeg.length - 2] = 0xff;
  jpeg[jpeg.length - 1] = 0xd9; // EOI

  return jpeg;
}

// Builds a minimal JPEG without any EXIF segment.
function buildJpegWithoutExif(): Uint8Array {
  const jpeg = new Uint8Array(4);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8; // SOI
  jpeg[2] = 0xff;
  jpeg[3] = 0xd9; // EOI
  return jpeg;
}

function fileFromBytes(bytes: Uint8Array, type: string, name = 'test.bin'): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

describe('hasExifSegment', () => {
  it('returns true for a JPEG with an EXIF segment', () => {
    const jpeg = buildJpegWithExif();
    expect(hasExifSegment(jpeg)).toBe(true);
  });

  it('returns false for a JPEG without EXIF', () => {
    const jpeg = buildJpegWithoutExif();
    expect(hasExifSegment(jpeg)).toBe(false);
  });

  it('returns false for non-JPEG data', () => {
    expect(hasExifSegment(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(hasExifSegment(new Uint8Array(0))).toBe(false);
  });
});

describe('hasGpsExif', () => {
  it('returns true for a JPEG with GPS EXIF pointer', () => {
    const jpeg = buildJpegWithExif({ gps: true });
    expect(hasGpsExif(jpeg)).toBe(true);
  });

  it('returns false for a JPEG with EXIF but no GPS', () => {
    const jpeg = buildJpegWithExif({ gps: false });
    expect(hasGpsExif(jpeg)).toBe(false);
  });

  it('returns false for a JPEG without EXIF', () => {
    const jpeg = buildJpegWithoutExif();
    expect(hasGpsExif(jpeg)).toBe(false);
  });
});

describe('stripExifFromJpegBytes', () => {
  it('removes EXIF segment from a JPEG', () => {
    const jpeg = buildJpegWithExif();
    const stripped = stripExifFromJpegBytes(jpeg);
    expect(hasExifSegment(stripped)).toBe(false);
    expect(hasGpsExif(stripped)).toBe(false);
  });

  it('keeps SOI and EOI markers', () => {
    const jpeg = buildJpegWithExif();
    const stripped = stripExifFromJpegBytes(jpeg);
    expect(stripped[0]!).toBe(0xff);
    expect(stripped[1]!).toBe(0xd8);
    expect(stripped[stripped.length - 2]!).toBe(0xff);
    expect(stripped[stripped.length - 1]!).toBe(0xd9);
  });

  it('returns input unchanged when no EXIF present', () => {
    const jpeg = buildJpegWithoutExif();
    const stripped = stripExifFromJpegBytes(jpeg);
    expect(stripped).toEqual(jpeg);
  });
});

describe('stripImage', () => {
  it('returns stripped:false for a non-image file', async () => {
    const file = fileFromBytes(
      new Uint8Array([1, 2, 3]),
      'application/pdf',
      'doc.pdf',
    );
    const result = await stripImage(file);
    expect(result.stripped).toBe(false);
    expect(result.file).toBe(file);
  });

  it('returns stripped:false for an image when canvas is unavailable', async () => {
    const jpeg = buildJpegWithExif();
    const file = fileFromBytes(jpeg, 'image/jpeg', 'photo.jpg');
    const result = await stripImage(file);
    // No OffscreenCanvas in this environment, so cannot strip.
    expect(result.stripped).toBe(false);
    expect(result.file).toBe(file);
  });

  it('returns stripped:false for a PNG when canvas is unavailable', async () => {
    const file = fileFromBytes(
      new Uint8Array([1, 2, 3]),
      'image/png',
      'img.png',
    );
    const result = await stripImage(file);
    expect(result.stripped).toBe(false);
  });
});

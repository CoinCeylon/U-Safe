// Image metadata stripping. Re-encodes JPEG, PNG and WebP images on a canvas
// to strip EXIF and other metadata. For non-image types returns the file
// unchanged with stripped:false so the UI can warn the user.
//
// In environments without a canvas/Image API (e.g. Node), images also return
// stripped:false since re-encoding is not possible.

export interface StripImageResult {
  file: File;
  stripped: boolean;
}

// MIME types that support canvas re-encoding and therefore EXIF stripping.
const STRIPPABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// JPEG marker constants.
const JPEG_SOI = 0xffd8; // Start of Image
const JPEG_APP1 = 0xffe1; // Application segment 1 (holds EXIF)

// Checks whether a JPEG byte array contains an EXIF segment (APP1 with
// "Exif\0\0" prefix).
export function hasExifSegment(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  const soi = (bytes[0]! << 8) | bytes[1]!;
  if (soi !== JPEG_SOI) {
    return false;
  }

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (marker === 0xffd9) {
      break;
    }
    if ((marker & 0xff00) !== 0xff00) {
      break;
    }
    if (marker === JPEG_APP1) {
      const segmentStart = offset + 4;
      if (
        segmentStart + 4 <= bytes.length &&
        bytes[segmentStart]! === 0x45 &&
        bytes[segmentStart + 1]! === 0x78 &&
        bytes[segmentStart + 2]! === 0x69 &&
        bytes[segmentStart + 3]! === 0x66
      ) {
        return true;
      }
    }
    if (marker >= 0xffd0 && marker <= 0xffd9) {
      offset += 2;
    } else {
      const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      offset += 2 + segmentLength;
    }
  }
  return false;
}

// Checks whether a JPEG byte array contains GPS EXIF data.
export function hasGpsExif(bytes: Uint8Array): boolean {
  if (!hasExifSegment(bytes)) {
    return false;
  }

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (marker === 0xffd9 || (marker & 0xff00) !== 0xff00) {
      break;
    }
    // Compute segment length for markers that carry a length field.
    const segmentLength =
      marker >= 0xffd0 && marker <= 0xffd9
        ? 0
        : (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker === JPEG_APP1) {
      const segmentStart = offset + 4;
      if (
        segmentStart + 16 <= bytes.length &&
        bytes[segmentStart]! === 0x45 &&
        bytes[segmentStart + 1]! === 0x78 &&
        bytes[segmentStart + 2]! === 0x69 &&
        bytes[segmentStart + 3]! === 0x66
      ) {
        const tiffStart = segmentStart + 6;
        const ifd0Offset =
          bytes[tiffStart + 4]! |
          (bytes[tiffStart + 5]! << 8) |
          (bytes[tiffStart + 6]! << 16) |
          (bytes[tiffStart + 7]! << 24);
        const gpsTagId = 0x8825;
        if (tiffStart + ifd0Offset + 5 < bytes.length) {
          const entryCount =
            bytes[tiffStart + ifd0Offset]! |
            (bytes[tiffStart + ifd0Offset + 1]! << 8);
          const entryStart = tiffStart + ifd0Offset + 2;
          for (let i = 0; i < entryCount; i += 1) {
            const entryOffset = entryStart + i * 12;
            if (entryOffset + 1 >= bytes.length) {
              break;
            }
            const tagId = bytes[entryOffset]! | (bytes[entryOffset + 1]! << 8);
            if (tagId === gpsTagId) {
              return true;
            }
          }
        }
      }
    }
    if (marker >= 0xffd0 && marker <= 0xffd9) {
      offset += 2;
    } else {
      offset += 2 + segmentLength;
    }
  }
  return false;
}

// Removes the EXIF (APP1 with "Exif\0\0") segment from a JPEG byte array,
// returning a new byte array without EXIF data. If no EXIF segment exists,
// returns the input unchanged.
export function stripExifFromJpegBytes(bytes: Uint8Array): Uint8Array {
  if (!hasExifSegment(bytes)) {
    return new Uint8Array(bytes);
  }

  const result: Uint8Array[] = [];
  let offset = 0;
  result.push(bytes.subarray(0, 2));
  offset = 2;

  while (offset + 4 <= bytes.length) {
    const marker = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (marker === 0xffd9 || (marker & 0xff00) !== 0xff00) {
      result.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }
    const segmentLength =
      marker >= 0xffd0 && marker <= 0xffd9
        ? 0
        : (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker === JPEG_APP1) {
      const segmentStart = offset + 4;
      const isExif =
        segmentStart + 4 <= bytes.length &&
        bytes[segmentStart]! === 0x45 &&
        bytes[segmentStart + 1]! === 0x78 &&
        bytes[segmentStart + 2]! === 0x69 &&
        bytes[segmentStart + 3]! === 0x66;
      if (isExif) {
        const nextOffset = offset + 2 + segmentLength;
        if (nextOffset >= bytes.length) {
          result.push(bytes.subarray(offset));
          break;
        }
        offset = nextOffset;
        continue;
      }
    }
    const segmentBytes = 2 + segmentLength;
    result.push(bytes.subarray(offset, offset + segmentBytes));
    offset += segmentBytes;
  }

  // Add any remaining bytes (e.g. EOI marker) that were not processed.
  if (offset < bytes.length) {
    result.push(bytes.subarray(offset));
  }

  const total = result.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let written = 0;
  for (const part of result) {
    out.set(part, written);
    written += part.length;
  }
  return out;
}

// Whether a canvas/Image-based stripping path is available in this
// environment.
function hasCanvasSupport(): boolean {
  return (
    typeof createImageBitmap === 'function' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

// Strips metadata from an image file by re-encoding it on a canvas.
//
// For JPEG, PNG and WebP images with canvas support, returns a new File with
// metadata removed and stripped:true. For all other types, or when canvas is
// unavailable, returns the original file with stripped:false.
export async function stripImage(file: File): Promise<StripImageResult> {
  if (!STRIPPABLE_IMAGE_TYPES.includes(file.type)) {
    return { file, stripped: false };
  }

  if (!hasCanvasSupport()) {
    return { file, stripped: false };
  }

  const imageBitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(
    imageBitmap.width,
    imageBitmap.height,
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { file, stripped: false };
  }
  ctx.drawImage(imageBitmap, 0, 0);

  const blob = await canvas.convertToBlob({
    type: file.type,
    quality: 0.92,
  });
  if (!blob) {
    return { file, stripped: false };
  }

  const strippedFile = new File([blob], file.name, { type: file.type });
  return { file: strippedFile, stripped: true };
}

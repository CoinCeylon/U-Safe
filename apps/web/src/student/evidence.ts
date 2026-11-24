// Evidence rules for the file-complaint form (M058).
//
// The checks live here, away from the DOM, so the limits can be tested without
// a browser. `stripImage` is from @usafe/crypto: it re-encodes JPEG/PNG/WebP on
// a canvas to remove metadata. Anything else cannot be stripped in the browser,
// so the form asks the student to acknowledge that before submitting.
//
// Privacy: this module only inspects names, MIME types and sizes. It never
// reads file contents or sends a file anywhere.

import { MAX_EVIDENCE_FILES, MAX_EVIDENCE_FILE_BYTES } from '@usafe/shared';
import { stripImage } from '@usafe/crypto';

export type EvidenceKind = 'image' | 'video' | 'audio' | 'pdf' | 'document';

export interface EvidenceRejection {
  name: string;
  reason: string;
}

export interface EvidenceValidation {
  accepted: File[];
  rejected: EvidenceRejection[];
}

export interface PreparedEvidence {
  file: File;
  stripped: boolean;
}

const EXECUTABLE_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.app', '.dmg',
  '.jar', '.sh', '.bin', '.ps1', '.vbs', '.deb', '.rpm',
];
const EXECUTABLE_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-sh',
  'application/x-dosexec',
];

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
const DOCUMENT_EXTENSIONS = ['.doc', '.docx', '.odt', '.rtf', '.txt', '.csv'];

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

function hasAnyExtension(fileName: string, extensions: string[]): boolean {
  const extension = extensionOf(fileName);
  return extensions.includes(extension);
}

/** True for files that can run code. These are never accepted. */
export function isExecutable(file: File): boolean {
  const mime = file.type.toLowerCase();
  return (
    hasAnyExtension(file.name, EXECUTABLE_EXTENSIONS) ||
    EXECUTABLE_MIME_TYPES.includes(mime)
  );
}

/** Classifies an allowed file, or returns null when its type is unsupported. */
export function evidenceKind(file: File): EvidenceKind | null {
  const mime = file.type.toLowerCase();
  const extension = extensionOf(file.name);

  if (mime.startsWith('image/') || hasAnyExtension(file.name, IMAGE_EXTENSIONS)) {
    return 'image';
  }
  if (mime.startsWith('video/') || hasAnyExtension(file.name, VIDEO_EXTENSIONS)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || hasAnyExtension(file.name, AUDIO_EXTENSIONS)) {
    return 'audio';
  }
  if (mime === 'application/pdf' || extension === '.pdf') {
    return 'pdf';
  }
  if (
    hasAnyExtension(file.name, DOCUMENT_EXTENSIONS) ||
    mime.startsWith('text/') ||
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/vnd.oasis.opendocument.text'
  ) {
    return 'document';
  }
  return null;
}

/**
 * Checks a batch of chosen files against the M058 limits.
 * `existingCount` is the number of files already added to the form.
 */
export function validateEvidenceFiles(
  files: Iterable<File>,
  existingCount = 0,
): EvidenceValidation {
  const accepted: File[] = [];
  const rejected: EvidenceRejection[] = [];

  for (const file of files) {
    if (isExecutable(file)) {
      rejected.push({
        name: file.name,
        reason: 'Executable files cannot be attached.',
      });
      continue;
    }
    if (file.size > MAX_EVIDENCE_FILE_BYTES) {
      rejected.push({
        name: file.name,
        reason:
          `Too large. Maximum size is ` +
          `${Math.round(MAX_EVIDENCE_FILE_BYTES / (1024 * 1024))} MB.`,
      });
      continue;
    }
    if (evidenceKind(file) === null) {
      rejected.push({
        name: file.name,
        reason: 'Unsupported type. Use an image, video, audio, PDF or document.',
      });
      continue;
    }
    if (existingCount + accepted.length >= MAX_EVIDENCE_FILES) {
      rejected.push({
        name: file.name,
        reason: `Maximum ${MAX_EVIDENCE_FILES} files allowed.`,
      });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

/** Only canvas-re-encoded images have their metadata removed. */
export function needsMetadataWarning(file: File): boolean {
  return evidenceKind(file) !== 'image';
}

/** Strips metadata from images; leaves other files untouched. */
export async function prepareEvidenceFile(file: File): Promise<PreparedEvidence> {
  if (evidenceKind(file) !== 'image') {
    return { file, stripped: false };
  }
  try {
    const result = await stripImage(file);
    return { file: result.file, stripped: result.stripped };
  } catch {
    // A corrupt or unreadable image cannot be re-encoded. Keep the original
    // file and let the form warn that metadata could not be removed.
    return { file, stripped: false };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} bytes`;
}

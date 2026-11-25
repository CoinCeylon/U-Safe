// Credential refresh (M053).
//
// `refreshCredential(universityId)` downloads the public list of commitments
// from `GET /api/universities/:id/leaves`, locates the student's own
// commitment locally, builds the Merkle path locally, and caches it. The
// student's leaf index is never sent to the server.
//
// The credential is refreshed automatically when the university's Merkle root
// changes (see `watchRoots`), so a student who enrolled before other students
// joined can still build a valid membership proof and support complaints.
//
// Imports:
//   @usafe/crypto -> Sha256Adapter, computeZeroNodes, MerkleTree, MERKLE_TREE_DEPTH
//   ./unlock      -> getCommitment, isUnlocked

import {
  Sha256Adapter,
  computeZeroNodes,
  MerkleTree,
  MERKLE_TREE_DEPTH,
} from '@usafe/crypto';
import { getCommitment, isUnlocked } from './unlock';

export interface CachedCredential {
  universityId: string;
  leafIndex: number;
  proof: string[]; // hex-encoded sibling hashes, leaf to root
  root: string; // hex-encoded Merkle root
}

const adapter = new Sha256Adapter();
let zeroNodesPromise: Promise<Uint8Array[]> | null = null;
let credential: CachedCredential | null = null;

async function getZeroNodes(): Promise<Uint8Array[]> {
  if (!zeroNodesPromise) {
    zeroNodesPromise = computeZeroNodes(MERKLE_TREE_DEPTH, adapter);
  }
  return zeroNodesPromise;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex: odd length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Core logic (testable without the network or wallet)
// ---------------------------------------------------------------------------

/**
 * Builds a cached credential from a commitment and a public list of leaf
 * commitments. The commitment is located in the list by value, the Merkle
 * tree is built locally, and the membership path is produced.
 */
export async function computeCredential(
  universityId: string,
  commitment: Uint8Array,
  leavesHex: string[],
): Promise<CachedCredential> {
  const commitmentHex = bytesToHex(commitment);
  const leaves = leavesHex.map(hexToBytes);

  const leafIndex = leaves.findIndex((leaf) => bytesToHex(leaf) === commitmentHex);
  if (leafIndex < 0) {
    throw new Error('Own commitment not found in university leaves');
  }

  const zeroNodes = await getZeroNodes();
  const tree = new MerkleTree(MERKLE_TREE_DEPTH, adapter, zeroNodes);
  for (const leaf of leaves) {
    await tree.insert(leaf);
  }
  const proof = tree.proof(leafIndex);
  const root = tree.getRoot();

  const cached: CachedCredential = {
    universityId,
    leafIndex,
    proof: proof.map((p) => bytesToHex(p)),
    root: bytesToHex(root),
  };
  credential = cached;
  return cached;
}

/**
 * Returns the currently cached credential, or null if none has been built.
 */
export function getCachedCredential(): CachedCredential | null {
  return credential;
}

/**
 * Clears the cached credential.
 */
export function clearCredential(): void {
  credential = null;
}

// ---------------------------------------------------------------------------
// Network + wallet entry point
// ---------------------------------------------------------------------------

/**
 * Refreshes the student's enrolment credential for the given university.
 *
 * Requires the student to be unlocked (secret in memory). Downloads the public
 * leaf list, locates the own commitment locally, builds the Merkle path, and
 * caches it. The leaf index is never transmitted to the server.
 */
export async function refreshCredential(
  universityId: string,
): Promise<CachedCredential> {
  if (!isUnlocked()) {
    throw new Error('Student secret is not unlocked');
  }
  const commitment = await getCommitment();
  if (commitment === null) {
    throw new Error('Could not compute commitment');
  }

  const res = await fetch(`/api/universities/${encodeURIComponent(universityId)}/leaves`);
  if (!res.ok) {
    throw new Error(`Failed to fetch leaves: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {commitments?: string[]};
  if (!data.commitments) {
    throw new Error('University returned no leaves');
  }

  return computeCredential(universityId, commitment, data.commitments);
}

// ---------------------------------------------------------------------------
// Automatic refresh when the root changes
// ---------------------------------------------------------------------------

let watchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts polling the university's roots endpoint and re-refreshes the
 * credential whenever the current root changes. Returns a stop function.
 */
export function watchRoots(
  universityId: string,
  pollMs = 5000,
): () => void {
  if (watchTimer !== null) {
    clearInterval(watchTimer);
  }

  let lastRoot: string | null = credential?.root ?? null;

  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/universities/${encodeURIComponent(universityId)}/roots`,
      );
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as {currentRoot?: string};
      if (data.currentRoot && data.currentRoot !== lastRoot) {
        lastRoot = data.currentRoot;
        // Re-derive the path against the new root.
        if (credential !== null) {
          void refreshCredential(universityId);
        }
      }
    } catch {
      // Ignore transient failures; the next tick retries.
    }
  };

  watchTimer = setInterval(() => void tick(), pollMs);
  return () => {
    if (watchTimer !== null) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  };
}

/**
 * Stops any running root watcher.
 */
export function stopWatchingRoots(): void {
  if (watchTimer !== null) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

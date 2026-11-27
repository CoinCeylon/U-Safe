import { hash } from './hash';
import type { MembershipProof } from '@usafe/shared';
import { DOMAIN_TAG_COMMITMENT } from './nullifier';
import {
  MERKLE_TREE_DEPTH,
  computeZeroNodes,
  MerkleTree,
} from './merkle';
import { Sha256Adapter } from './hash';

// Context string format for mock membership proofs.
//   - "file|<yearMonth>|<slot>"   for filing a complaint (slot 0 or 1)
//   - "support|<complaintId>"     for supporting a complaint
// The context determines which nullifier is derived from the public
// commitment. The student secret itself never enters the proof.
export type MockProofContext = string;

// Domain tag for the mock-mode nullifier. Unlike the production nullifier
// tags, this one is derived from the **public** commitment rather than the
// secret, so the server can recompute it and prove that the nullifier is
// bound to the claimed commitment and context (M038).
export const DOMAIN_TAG_MOCK_NULLIFIER = 'mock-nullifier';

// Serialised payload carried in MembershipProof.data so the server can
// re-verify the Merkle path and the nullifier binding without knowing the
// student secret. The leaf index is deliberately *not* included: the server
// looks it up from the public leaf list, so a student never sends their leaf
// position (M053).
export interface MockProofData {
  commitment: string; // hex-encoded commitment leaf
  path: string[]; // hex-encoded sibling hashes from leaf to root
  context: MockProofContext; // original context string used to derive the nullifier
}

const encoder = new TextEncoder();

/**
 * Derives the mock-mode nullifier from a public commitment and a proof
 * context. Domain separation keeps filing and support nullifiers distinct
 * even though the same commitment is used.
 */
export async function mockNullifier(
  commitmentBytes: Uint8Array,
  context: MockProofContext,
): Promise<Uint8Array> {
  return hash(DOMAIN_TAG_MOCK_NULLIFIER, commitmentBytes, encoder.encode(context));
}

/**
 * Client-side mock membership proof. Builds a `MembershipProof` with
 * `kind: 'mock'` that a student attaches to a filing or support action.
 *
 * Steps:
 * 1. Derive the commitment from the student secret (`hash('commitment', secret)`).
 * 2. Sanity-check that the commitment matches `leaves[leafIndex]`.
 * 3. Derive the nullifier from the public commitment + context.
 * 4. Rebuild the Merkle tree from the public `leaves` list and compute the
 *    root and the membership path for `leafIndex`.
 * 5. Serialise commitment, path and context into `data`.
 *
 * `universityId` is left empty here; the caller (portal) fills it in before
 * sending the proof to the server, since `proveMembershipMock` only sees the
 * public leaf list, not the university it belongs to.
 */
export async function proveMembershipMock(
  secret: Uint8Array,
  leaves: string[],
  leafIndex: number,
  context: MockProofContext,
): Promise<MembershipProof> {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error('leaf index out of range');
  }
  assertContext(context);

  // 1. Derive commitment from the student secret.
  const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
  const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

  // 2. Sanity check: the secret must correspond to the commitment at leafIndex.
  if (leaves[leafIndex] !== commitmentHex) {
    throw new Error('secret does not match commitment at leaf index');
  }

  // 3. Derive the nullifier from the public commitment + context.
  const nullifier = await mockNullifier(commitmentBytes, context);

  // 4. Rebuild the Merkle tree from all public leaves and get root + path.
  const zeroNodes = await computeZeroNodes(
    MERKLE_TREE_DEPTH,
    new Sha256Adapter(),
  );
  const tree = new MerkleTree(
    MERKLE_TREE_DEPTH,
    new Sha256Adapter(),
    zeroNodes,
  );
  for (const hex of leaves) {
    await tree.insert(Buffer.from(hex, 'hex'));
  }
  const path = tree.proof(leafIndex);
  const root = tree.root();

  // 5. Serialise everything the server needs to re-verify, except the secret
  //    and the leaf index.
  const data: MockProofData = {
    commitment: commitmentHex,
    path: path.map((sibling) => Buffer.from(sibling).toString('hex')),
    context,
  };

  return {
    universityId: '', // filled in by the caller before sending to the server
    root: Buffer.from(root).toString('hex'),
    nullifier: Buffer.from(nullifier).toString('hex'),
    kind: 'mock',
    data: JSON.stringify(data),
  };
}

/** Validates the supported mock proof contexts. */
export function assertContext(context: MockProofContext): void {
  const parts = context.split('|');
  const action = parts[0];
  if (action === 'file') {
    const slot = Number(parts[2]);
    if (parts.length !== 3 || (slot !== 0 && slot !== 1)) {
      throw new Error('filing slot must be 0 or 1');
    }
    return;
  }
  if (action === 'support') {
    if (parts.length !== 2 || parts[1] === undefined || parts[1] === '') {
      throw new Error('support context must be support|<complaintId>');
    }
    return;
  }
  throw new Error(`unknown proof context action: ${action}`);
}

function timingSafeEqualHex(leftHex: string, rightHex: string): boolean {
  if (leftHex.length !== rightHex.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < leftHex.length; i += 1) {
    diff |= leftHex.charCodeAt(i) ^ rightHex.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Server-side mock membership proof verification.
 *
 * Checks:
 * 1. `proof.root` is within the provided grace-window roots.
 * 2. `proof.data` parses and carries a supported context.
 * 3. The Merkle path has exactly `MERKLE_TREE_DEPTH` siblings and recomputes
 *    to `proof.root` for the claimed commitment at `leafIndex`.
 * 4. `proof.nullifier` equals the nullifier derived from the **public
 *    commitment + context**, so a client cannot claim an arbitrary nullifier.
 * 5. The nullifier has not already been used.
 *
 * `leafIndex` is resolved by the caller from the public leaf table (the
 * client never sends it, per M053). If it is omitted or out of range, the
 * proof is rejected.
 *
 * Does NOT persist anything from the proof except the nullifier (the caller
 * records the nullifier in `ml_nullifiers` after a successful verification).
 *
 * Returns true when the proof is valid, false otherwise.
 */
export async function verifyMembershipMock(
  proof: MembershipProof,
  options: {
    roots: string[]; // current root + grace-window roots (from getRoots)
    usedNullifiers: Set<string>; // nullifiers already seen (from ml_nullifiers)
    leafIndex?: number; // resolved from the public leaf list by the caller
  },
): Promise<boolean> {
  const { roots, usedNullifiers, leafIndex } = options;

  // 1. Root must be within the grace window.
  if (!roots.includes(proof.root)) {
    return false;
  }

  let data: MockProofData;
  try {
    data = JSON.parse(proof.data) as MockProofData;
  } catch {
    return false;
  }
  if (
    typeof data.commitment !== 'string' ||
    !/^[0-9a-fA-F]{64}$/.test(data.commitment) ||
    !Array.isArray(data.path) ||
    typeof data.context !== 'string'
  ) {
    return false;
  }
  try {
    assertContext(data.context);
  } catch {
    return false;
  }

  // 2. The caller must have found the commitment in the university's leaves.
  if (leafIndex === undefined || leafIndex < 0) {
    return false;
  }

  // 3. Merkle path must be valid for the claimed commitment and root. The
  //    fixed-depth check inside verify rejects an empty/fabricated path.
  const pathValid = await MerkleTree.verify(
    Buffer.from(data.commitment, 'hex'),
    data.path.map((p) => Buffer.from(p, 'hex')),
    leafIndex,
    Buffer.from(proof.root, 'hex'),
    new Sha256Adapter(),
    MERKLE_TREE_DEPTH,
  );
  if (!pathValid) {
    return false;
  }

  // 4. Nullifier must be bound to this commitment and context.
  const expectedNullifier = Buffer.from(
    await mockNullifier(Buffer.from(data.commitment, 'hex'), data.context),
  ).toString('hex');
  if (!timingSafeEqualHex(expectedNullifier, proof.nullifier)) {
    return false;
  }

  // 5. Nullifier must not have been used before.
  if (usedNullifiers.has(proof.nullifier)) {
    return false;
  }

  return true;
}

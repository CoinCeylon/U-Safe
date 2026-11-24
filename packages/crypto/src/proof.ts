import { hash } from './hash';
import type { MembershipProof } from '@usafe/shared';
import {
  DOMAIN_TAG_COMMITMENT,
  DOMAIN_TAG_FILING_NULLIFIER,
  DOMAIN_TAG_SUPPORT_NULLIFIER,
} from './nullifier';
import {
  MERKLE_TREE_DEPTH,
  computeZeroNodes,
  MerkleTree,
} from './merkle';
import { Sha256Adapter } from './hash';

// Context string format for mock membership proofs.
//   - "file|<yearMonth>|<slot>"   for filing a complaint (slot 0 or 1)
//   - "support|<complaintId>"     for supporting a complaint
// The context determines which nullifier is derived from the student secret.
export type MockProofContext = string;

// Serialised payload carried in MembershipProof.data so the server can
// re-verify the Merkle path and the nullifier binding without knowing the
// student secret.
export interface MockProofData {
  commitment: string; // hex-encoded commitment leaf
  path: string[]; // hex-encoded sibling hashes from leaf to root
  leafIndex: number; // position of the commitment in the tree
  context: MockProofContext; // original context string used to derive the nullifier
}

/**
 * Client-side mock membership proof. Builds a `MembershipProof` with
 * `kind: 'mock'` that a student attaches to a filing or support action.
 *
 * Steps:
 * 1. Derive the commitment from the student secret (`hash('commitment', secret)`).
 * 2. Sanity-check that the commitment matches `leaves[leafIndex]`.
 * 3. Derive the nullifier from `secret` + `context`:
 *    - "file\|<yearMonth>\|<slot>"  -> filingNullifier(secret, yearMonth, slot)
 *    - "support\|<complaintId>"     -> supportNullifier(secret, complaintId)
 * 4. Rebuild the Merkle tree from the public `leaves` list and compute the
 *    root and the membership path for `leafIndex`.
 * 5. Serialise commitment, path, leafIndex and context into `data`.
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

  // 1. Derive commitment from the student secret.
  const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
  const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

  // 2. Sanity check: the secret must correspond to the commitment at leafIndex.
  if (leaves[leafIndex] !== commitmentHex) {
    throw new Error('secret does not match commitment at leaf index');
  }

  // 3. Derive the nullifier from secret + context.
  const nullifierHex = await deriveNullifier(secret, context);

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
  const root = tree.getRoot();

  // 5. Serialise everything the server needs to re-verify, except the secret.
  const data: MockProofData = {
    commitment: commitmentHex,
    path: path.map((sibling) => Buffer.from(sibling).toString('hex')),
    leafIndex,
    context,
  };

  return {
    universityId: '', // filled in by the caller before sending to the server
    root: Buffer.from(root).toString('hex'),
    nullifier: nullifierHex,
    kind: 'mock',
    data: JSON.stringify(data),
  };
}

/**
 * Derive the nullifier for a mock proof context.
 *
 * - "file\|<yearMonth>\|<slot>"      -> filing nullifier
 * - "support\|<complaintId>"         -> support nullifier
 */
async function deriveNullifier(
  secret: Uint8Array,
  context: MockProofContext,
): Promise<string> {
  const encoder = new TextEncoder();
  const parts = context.split('|');
  const action = parts[0];

  let nullifier: Uint8Array;
  if (action === 'file') {
    const yearMonth = parts[1];
    const slot = Number(parts[2]);
    if (slot !== 0 && slot !== 1) {
      throw new Error('filing slot must be 0 or 1');
    }
    nullifier = await hash(
      DOMAIN_TAG_FILING_NULLIFIER,
      secret,
      encoder.encode(yearMonth),
      encoder.encode(String(slot)),
    );
  } else if (action === 'support') {
    const complaintId = parts[1];
    nullifier = await hash(
      DOMAIN_TAG_SUPPORT_NULLIFIER,
      secret,
      encoder.encode(complaintId),
    );
  } else {
    throw new Error(`unknown proof context action: ${action}`);
  }

  return Buffer.from(nullifier).toString('hex');
}

/**
 * Server-side mock membership proof verification.
 *
 * Checks:
 * 1. `proof.root` is within the provided grace-window roots.
 * 2. The Merkle path in `proof.data` is valid for the claimed commitment,
 *    recomputing to `proof.root`.
 * 3. `proof.nullifier` has not already been used (uniqueness).
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
  },
): Promise<boolean> {
  const { roots, usedNullifiers } = options;

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

  // 2. Merkle path must be valid for the claimed commitment and root.
  const pathValid = await MerkleTree.verify(
    Buffer.from(data.commitment, 'hex'),
    data.path.map((p) => Buffer.from(p, 'hex')),
    data.leafIndex,
    Buffer.from(proof.root, 'hex'),
    new Sha256Adapter(),
  );
  if (!pathValid) {
    return false;
  }

  // 3. Nullifier must not have been used before.
  if (usedNullifiers.has(proof.nullifier)) {
    return false;
  }

  return true;
}

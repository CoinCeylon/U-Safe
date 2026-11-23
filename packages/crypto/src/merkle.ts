// Domain tag for inner node hashing in the Merkle tree. Distinct from any
// leaf domain tag so an inner node hash can never be confused with a leaf
// hash (domain separation).
export const DOMAIN_TAG_MERKLE_INNER = 'merkle-inner';

// Number of bytes in a SHA-256 digest.
const DIGEST_SIZE = 32;

// Depth of the U-Safe Merkle tree (fixed by the product spec, section 0.6).
export const MERKLE_TREE_DEPTH = 20;

// Precomputes the zero node for every depth from 0 to `depth`.
// zeroNodes[d] is the root of a perfect subtree of depth `d` whose leaves are
// all 32 zero bytes. Depth 0 is just 32 zero bytes (a zero leaf).
// Used as the default sibling for subtrees that have never received a leaf.
export async function computeZeroNodes(
  depth: number,
  hashAdapter: {
    hash(domainTag: string, ...parts: Uint8Array[]): Promise<Uint8Array>;
  },
): Promise<Uint8Array[]> {
  const zeroNodes: Uint8Array[] = [];
  let current = new Uint8Array(DIGEST_SIZE) as unknown as Uint8Array;
  zeroNodes.push(current);

  for (let d = 1; d <= depth; d += 1) {
    current = await hashAdapter.hash(
      DOMAIN_TAG_MERKLE_INNER,
      current,
      current,
    );
    zeroNodes.push(current);
  }
  return zeroNodes;
}

// A fixed-depth incremental Merkle tree. Leaves are appended in order. The
// tree keeps the running root and can produce a membership proof for any
// inserted leaf. Insert and proof are O(depth).
export class MerkleTree {
  private readonly depth: number;
  private readonly hashAdapter: {
    hash(domainTag: string, ...parts: Uint8Array[]): Promise<Uint8Array>;
  };
  private readonly zeroNodes: Uint8Array[];
  // nodes[level][index] holds the hash at `level` (0 = leaf level) and
  // position `index`. Levels are lazily grown as leaves are inserted.
  private nodes: Uint8Array[][];
  private leafCount: number;

  constructor(
    depth: number,
    hashAdapter: {
      hash(domainTag: string, ...parts: Uint8Array[]): Promise<Uint8Array>;
    },
    zeroNodes: Uint8Array[],
  ) {
    this.depth = depth;
    this.hashAdapter = hashAdapter;
    this.zeroNodes = zeroNodes;
    // Level 0 starts empty; other levels start empty too (filled on insert).
    this.nodes = [];
    for (let level = 0; level <= depth; level += 1) {
      this.nodes[level] = [];
    }
    this.leafCount = 0;
  }

  // Returns the current Merkle root (hash at the top level, position 0).
  getRoot(): Uint8Array {
    const root = this.nodes[this.depth]![0];
    if (!root) {
      return new Uint8Array(this.zeroNodes[this.depth]!);
    }
    return new Uint8Array(root);
  }

  // Returns the number of leaves inserted so far.
  getLeafCount(): number {
    return this.leafCount;
  }

  // Returns the zero node for a given depth (subtree with no leaves yet).
  private zeroNodeAt(level: number): Uint8Array {
    return new Uint8Array(this.zeroNodes[level]!);
  }

  // Returns the stored node at (level, index), or the zero node if none has
  // been computed yet.
  private nodeAt(level: number, index: number): Uint8Array {
    const stored = this.nodes[level]![index];
    if (stored !== undefined) {
      return new Uint8Array(stored);
    }
    return this.zeroNodeAt(level);
  }

  // Inserts a leaf and returns its index. O(depth).
  async insert(leaf: Uint8Array): Promise<number> {
    const index = this.leafCount;
    this.leafCount += 1;

    const leafBytes = new Uint8Array(leaf);
    this.nodes[0]![index] = leafBytes;

    let currentHash: Uint8Array = leafBytes;
    let currentIndex = index;

    for (let level = 0; level < this.depth; level += 1) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = currentIndex ^ 1;
      const sibling = this.nodeAt(level, siblingIndex);
      const left = isLeft ? currentHash : sibling;
      const right = isLeft ? sibling : currentHash;

      const parent = await this.hashAdapter.hash(
        DOMAIN_TAG_MERKLE_INNER,
        left,
        right,
      );

      const parentIndex = Math.floor(currentIndex / 2);
      this.nodes[level + 1]![parentIndex] = parent;

      currentHash = parent;
      currentIndex = parentIndex;
    }

    return index;
  }

  // Returns the Merkle membership proof for the leaf at `index`. The proof is
  // the list of sibling hashes from level 0 up to the level below the root.
  proof(index: number): Uint8Array[] {
    if (index < 0 || index >= this.leafCount) {
      throw new Error('leaf index out of range');
    }

    const siblings: Uint8Array[] = [];
    let currentIndex = index;
    for (let level = 0; level < this.depth; level += 1) {
      const siblingIndex = currentIndex ^ 1;
      siblings.push(this.nodeAt(level, siblingIndex));
      currentIndex = Math.floor(currentIndex / 2);
    }

    return siblings;
  }

  // Verifies a membership proof: recomputes the root from `leaf`, `proof` and
  // `index`, and compares it to `root`. Static so it can be used without a
  // tree instance. Returns true if the recomputed root matches `root`.
  static async verify(
    leaf: Uint8Array,
    proof: Uint8Array[],
    index: number,
    root: Uint8Array,
    hashAdapter: {
      hash(domainTag: string, ...parts: Uint8Array[]): Promise<Uint8Array>;
    },
  ): Promise<boolean> {
    let current: Uint8Array = new Uint8Array(leaf);
    let currentIndex = index;
    for (let level = 0; level < proof.length; level += 1) {
      const siblingRaw = proof[level]!;
      const sibling = new Uint8Array(siblingRaw.length);
      sibling.set(siblingRaw);
      const isLeft = currentIndex % 2 === 0;
      const left = isLeft ? current : sibling;
      const right = isLeft ? sibling : current;
      current = await hashAdapter.hash(
        DOMAIN_TAG_MERKLE_INNER,
        left,
        right,
      );
      currentIndex = Math.floor(currentIndex / 2);
    }

    const rootBytes = new Uint8Array(root);
    if (current.length !== rootBytes.length) {
      return false;
    }
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] !== rootBytes[i]) {
        return false;
      }
    }
    return true;
  }
}

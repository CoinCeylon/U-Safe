import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_DUPLICATE_SUGGESTIONS,
  SIMILARITY_THRESHOLD,
  findSimilarComplaints,
  tokenizeDescription,
  tokenOverlapScore,
} from './similar';
import {
  clearComplaintTexts,
  loadComplaintTexts,
  rememberComplaintText,
  selectOpenComplaintTexts,
  type OpenComplaintMeta,
} from './complaint-text';

const RAGGING_TEXT =
  'A group of senior students keeps shouting insults at first years near the hostel every evening.';

describe('duplicate suggestions (M059)', () => {
  it('tokenizes lowercase words and drops punctuation and stopwords', () => {
    const tokens = tokenizeDescription('The Senior, students! are SHOUTING...');
    expect(tokens.has('senior')).toBe(true);
    expect(tokens.has('students')).toBe(true);
    expect(tokens.has('shouting')).toBe(true);
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('are')).toBe(false);
    expect(tokens.size).toBe(3);
  });

  it('scores identical descriptions as a perfect overlap', () => {
    const a = tokenizeDescription(RAGGING_TEXT);
    expect(tokenOverlapScore(a, tokenizeDescription(RAGGING_TEXT))).toBe(1);
  });

  it('gives unrelated descriptions a score below the threshold', () => {
    const other = tokenizeDescription(
      'Someone keeps stealing bicycles from the faculty parking lot at night.',
    );
    expect(tokenOverlapScore(tokenizeDescription(RAGGING_TEXT), other)).toBeLessThanOrEqual(
      SIMILARITY_THRESHOLD,
    );
  });

  it('keeps an empty token set from ever matching', () => {
    expect(tokenOverlapScore(new Set(), tokenizeDescription(RAGGING_TEXT))).toBe(0);
    expect(tokenOverlapScore(tokenizeDescription(RAGGING_TEXT), new Set())).toBe(0);
  });

  it('surfaces a close paraphrase of an existing complaint', () => {
    const corpus = [
      {
        id: 'c-1',
        text:
          'Senior students keep shouting insults at first years near the hostel every evening.',
      },
    ];
    const similar = findSimilarComplaints(RAGGING_TEXT, corpus);
    expect(similar).toHaveLength(1);
    expect(similar[0]?.id).toBe('c-1');
    expect(similar[0]?.score).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });

  it('does not surface unrelated complaints', () => {
    const corpus = [
      {
        id: 'c-2',
        text: 'The library closes too early during examination weeks.',
      },
    ];
    expect(findSimilarComplaints(RAGGING_TEXT, corpus)).toHaveLength(0);
  });

  it('requires the score to be strictly above the threshold', () => {
    // Two of four union tokens are shared: exactly the threshold, not above.
    const corpus = [
      { id: 'c-3', text: 'alpha senior shouting' },
    ];
    expect(findSimilarComplaints('senior shouting beta', corpus)).toHaveLength(0);
  });

  it('ignores case and punctuation when comparing', () => {
    const corpus = [
      { id: 'c-4', text: 'Senior students! SHOUTING... insults!' },
    ];
    expect(findSimilarComplaints('senior students shouting insults', corpus)).toHaveLength(1);
  });

  it('does not let shared stopwords create a match on their own', () => {
    const corpus = [
      { id: 'c-5', text: 'The group was in the hostel with the others.' },
    ];
    expect(findSimilarComplaints('I am in the library with my friends.', corpus)).toHaveLength(0);
  });

  it('returns at most three suggestions, most similar first', () => {
    const corpus = [
      { id: 'c-far', text: 'Completely unrelated topic about parking bicycles at night.' },
      { id: 'c-mid', text: 'Senior students shouting insults at first years near the hostel.' },
      { id: 'c-near', text: RAGGING_TEXT },
      { id: 'c-tie', text: 'A group of senior students keeps shouting insults at first years near the hostel every evening.' },
      { id: 'c-also', text: 'Senior students shout insults at first years by the hostel in the evening.' },
    ];
    const similar = findSimilarComplaints(RAGGING_TEXT, corpus);
    expect(similar.length).toBeLessThanOrEqual(MAX_DUPLICATE_SUGGESTIONS);
    expect(similar[0]?.id).toBe('c-near');
    expect(similar.map((entry) => entry.id)).not.toContain('c-far');
    expect(similar.length).toBe(MAX_DUPLICATE_SUGGESTIONS);
  });

  it('breaks score ties by complaint id for a stable order', () => {
    const corpus = [
      { id: 'c-b', text: RAGGING_TEXT },
      { id: 'c-a', text: RAGGING_TEXT },
    ];
    const similar = findSimilarComplaints(RAGGING_TEXT, corpus);
    expect(similar.map((entry) => entry.id)).toEqual(['c-a', 'c-b']);
  });

  it('skips empty descriptions in the corpus and an empty query', () => {
    const corpus = [
      { id: 'c-blank', text: '   ' },
      { id: 'c-real', text: RAGGING_TEXT },
    ];
    expect(findSimilarComplaints(RAGGING_TEXT, corpus)).toHaveLength(1);
    expect(findSimilarComplaints('   ', corpus)).toHaveLength(0);
    expect(findSimilarComplaints(RAGGING_TEXT, [])).toHaveLength(0);
  });
});

describe('open complaint text selection (M059)', () => {
  // The token-overlap engine is pure; only these cache tests touch
  // localStorage, which Node does not provide, so a minimal stub stands in.
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const complaints: OpenComplaintMeta[] = [
    {
      id: 'c-open',
      category: 'verbal',
      status: 'not_started',
      ownerRole: 'university',
      supportCount: 2,
    },
    {
      id: 'c-pending',
      category: 'physical',
      status: 'pending_investigation',
      ownerRole: 'university',
      supportCount: 0,
    },
    {
      id: 'c-finished',
      category: 'verbal',
      status: 'finished',
      ownerRole: 'university',
      supportCount: 9,
    },
    {
      id: 'c-ugc',
      category: 'sexual',
      status: 'not_started',
      ownerRole: 'ugc',
      supportCount: 0,
    },
  ];

  it('keeps open community complaints and drops finished or UGC-owned ones', () => {
    const texts = [
      { id: 'c-open', text: RAGGING_TEXT },
      { id: 'c-pending', text: 'Another open complaint text.' },
      { id: 'c-finished', text: 'Closed complaint text.' },
      { id: 'c-ugc', text: 'Restricted complaint text.' },
    ];
    const selected = selectOpenComplaintTexts(complaints, texts);
    expect(selected.map((entry) => entry.id)).toEqual(['c-open', 'c-pending']);
    expect(selected[0]?.text).toBe(RAGGING_TEXT);
  });

  it('drops complaints without cached text', () => {
    const selected = selectOpenComplaintTexts(complaints, [
      { id: 'c-open', text: RAGGING_TEXT },
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(['c-open']);
  });

  it('round-trips remembered texts through localStorage', () => {
    const universityId = 'test-university';
    rememberComplaintText(universityId, 'c-9', RAGGING_TEXT);
    expect(loadComplaintTexts(universityId)).toEqual([
      { id: 'c-9', text: RAGGING_TEXT },
    ]);
    clearComplaintTexts(universityId);
    expect(loadComplaintTexts(universityId)).toEqual([]);
  });

  it('ignores an empty description instead of caching blank text', () => {
    const universityId = 'test-university-blank';
    rememberComplaintText(universityId, 'c-10', '   ');
    expect(loadComplaintTexts(universityId)).toEqual([]);
    clearComplaintTexts(universityId);
  });
});

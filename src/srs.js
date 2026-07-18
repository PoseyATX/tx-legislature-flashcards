/**
 * Anki-style SuperMemo SM-2 spaced repetition for legislator cards.
 *
 * Card fields:
 *   ease      — ease factor (default 2.5, min 1.3)
 *   interval  — days until next review once graduated
 *   reps      — consecutive successful reviews in review state
 *   lapses    — times failed after leaving learning
 *   due       — epoch ms when card is next due
 *   state     — 'new' | 'learning' | 'review' | 'relearning'
 *   step      — learning/relearning step index
 *   last      — last review epoch ms
 *   introducedAt — when first shown (counts toward daily new limit)
 */

export const STORAGE_KEY = "tx-leg-flashcards-srs-v2";
export const STATS_KEY = "tx-leg-flashcards-stats-v2";

/**
 * Learning steps in minutes (long-term SRS only).
 * In-session order is owned by the app (round-robin / min spacing),
 * not by zero-minute steps — those caused the same face every few cards.
 */
export const LEARNING_STEPS_MIN = [10, 60];
/** Relearning after a lapse. */
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_INTERVAL_DAYS = 1;
export const EASY_INTERVAL_DAYS = 4;
export const STARTING_EASE = 2.5;
export const MIN_EASE = 1.3;
export const EASY_BONUS = 1.3;
export const HARD_INTERVAL_FACTOR = 1.2;
/** Full 89th Legislature is fair game in one day of study. */
export const NEW_CARDS_PER_DAY = 180;

/** Always 4-way multiple choice for scoring. */
export const MC_CHOICE_COUNT = 4;

/**
 * Roster unlock by Capitol level (from XP).
 * Level 1: 30 faces · each level +20 · cap 180.
 */
export const ROSTER_BASE = 30;
export const ROSTER_PER_LEVEL = 20;

/**
 * @param {number} xp
 * @returns {number} 1-based study level
 */
export function studyLevelFromXP(xp) {
  return 1 + Math.floor(Math.max(0, Number(xp) || 0) / 100);
}

/**
 * How many legislators are unlocked at this study level.
 * @param {number} level
 * @param {number} total
 */
export function unlockedRosterSize(level, total) {
  const n = ROSTER_BASE + (Math.max(1, level) - 1) * ROSTER_PER_LEVEL;
  return Math.min(total, Math.max(ROSTER_BASE, n));
}

/**
 * @typedef {'new'|'learning'|'review'|'relearning'} CardState
 *
 * @typedef {object} SrsCard
 * @property {string} id
 * @property {number} ease
 * @property {number} interval
 * @property {number} reps
 * @property {number} lapses
 * @property {number} due
 * @property {CardState} state
 * @property {number} step
 * @property {number} last
 * @property {number} introducedAt
 */

/**
 * @returns {SrsCard}
 */
export function createNewCard(id, now = Date.now()) {
  return {
    id,
    ease: STARTING_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: now,
    state: "new",
    step: 0,
    last: 0,
    introducedAt: 0,
  };
}

/**
 * @param {Partial<SrsCard> & { id: string }} raw
 * @returns {SrsCard}
 */
export function normalizeCard(raw) {
  const base = createNewCard(raw.id);
  const state = raw.state;
  const valid =
    state === "new" ||
    state === "learning" ||
    state === "review" ||
    state === "relearning"
      ? state
      : "new";
  return {
    ...base,
    ...raw,
    ease: Math.max(MIN_EASE, Number(raw.ease) || STARTING_EASE),
    interval: Math.max(0, Number(raw.interval) || 0),
    reps: Math.max(0, Number(raw.reps) || 0),
    lapses: Math.max(0, Number(raw.lapses) || 0),
    due: Number(raw.due) || base.due,
    state: valid,
    step: Math.max(0, Number(raw.step) || 0),
    last: Number(raw.last) || 0,
    introducedAt: Number(raw.introducedAt) || 0,
  };
}

/**
 * Mastery tier (0 = weakest, 4 = strongest) drives input difficulty.
 * @param {SrsCard} card
 * @returns {0|1|2|3|4}
 */
export function masteryLevel(card) {
  if (card.state === "new") return 0;
  if (card.state === "learning" || card.state === "relearning") return 0;
  if (card.reps <= 1 || card.interval < 3) return 1;
  if (card.interval < 7) return 2;
  if (card.interval < 21) return 3;
  return 4;
}

export function masteryLabel(level) {
  return (
    {
      0: "Learning",
      1: "Young",
      2: "Familiar",
      3: "Strong",
      4: "Mastered",
    }[level] || "Learning"
  );
}

/**
 * Input configuration — always 4-choice MC for honest scoring.
 * @param {SrsCard} card
 */
export function inputConfigForCard(card) {
  const level = masteryLevel(card);
  return {
    level,
    type: "mc",
    choiceCount: MC_CHOICE_COUNT,
    prompt: "photo-to-name",
    showDistrictHint: level === 0,
    gradeOnCorrect: 3,
    gradeOnWrong: 1,
  };
}

function minutesToMs(m) {
  return m * 60 * 1000;
}

function daysToMs(d) {
  return d * 24 * 60 * 60 * 1000;
}

/**
 * SM-2 ease update (SuperMemo 2).
 * EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
 * @param {number} ease
 * @param {2|3|4} quality
 */
export function sm2EaseUpdate(ease, quality) {
  const q = quality;
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  return Math.max(MIN_EASE, ease + delta);
}

/**
 * Clone card without structuredClone (works in older engines / Node tests).
 * @param {SrsCard} card
 * @returns {SrsCard}
 */
function cloneCard(card) {
  return normalizeCard({ ...card });
}

/**
 * Preview next interval (ms from now) if graded with quality.
 * Quality: 1=Again, 2=Hard, 3=Good, 4=Easy
 * @param {SrsCard} card
 * @param {1|2|3|4} quality
 * @param {number} now
 */
export function previewIntervalMs(card, quality, now = Date.now()) {
  const next = applyGrade(card, quality, now);
  return Math.max(0, next.due - now);
}

/**
 * Apply Anki-style SM-2 grade and return updated card.
 * Quality: 1=Again, 2=Hard, 3=Good, 4=Easy
 *
 * @param {SrsCard} card
 * @param {1|2|3|4} quality
 * @param {number} now
 * @returns {SrsCard}
 */
export function applyGrade(card, quality, now = Date.now()) {
  const c = cloneCard(card);
  c.last = now;

  if (c.state === "new") {
    c.state = "learning";
    c.step = 0;
    c.introducedAt = c.introducedAt || now;
  }

  // ——— Again ———
  if (quality === 1) {
    if (c.state === "review") {
      c.lapses += 1;
      c.reps = 0;
      c.ease = Math.max(MIN_EASE, c.ease - 0.2);
      c.state = "relearning";
      c.step = 0;
      c.interval = 0;
      c.due = now + minutesToMs(RELEARNING_STEPS_MIN[0]);
      return c;
    }
    c.reps = 0;
    c.step = 0;
    c.state = c.state === "relearning" ? "relearning" : "learning";
    c.due = now + minutesToMs(LEARNING_STEPS_MIN[0]);
    return c;
  }

  // ——— Learning / relearning ———
  if (c.state === "learning" || c.state === "relearning") {
    const steps = c.state === "relearning" ? RELEARNING_STEPS_MIN : LEARNING_STEPS_MIN;

    if (quality === 2) {
      // Hard: repeat current step
      const stepMin = steps[Math.min(c.step, steps.length - 1)];
      c.due = now + minutesToMs(stepMin);
      return c;
    }

    if (quality === 4) {
      return graduate(c, now, true);
    }

    // Good: next step or graduate
    if (c.step + 1 >= steps.length) {
      return graduate(c, now, false);
    }
    c.step += 1;
    c.due = now + minutesToMs(steps[c.step]);
    return c;
  }

  // ——— Review (graduated) ———
  if (quality === 2) {
    c.ease = sm2EaseUpdate(c.ease, 2);
    c.interval = Math.max(1, Math.round(Math.max(c.interval, 1) * HARD_INTERVAL_FACTOR));
    c.reps += 1;
    c.due = now + daysToMs(c.interval);
    return c;
  }

  if (quality === 3) {
    c.ease = sm2EaseUpdate(c.ease, 3);
    if (c.reps === 0) c.interval = GRADUATING_INTERVAL_DAYS;
    else if (c.reps === 1) c.interval = Math.max(6, Math.round(c.interval * c.ease));
    else c.interval = Math.max(1, Math.round(c.interval * c.ease));
    c.reps += 1;
    c.due = now + daysToMs(c.interval);
    return c;
  }

  // Easy
  c.ease = sm2EaseUpdate(c.ease, 4);
  if (c.reps === 0) c.interval = EASY_INTERVAL_DAYS;
  else c.interval = Math.max(1, Math.round(c.interval * c.ease * EASY_BONUS));
  c.reps += 1;
  c.due = now + daysToMs(c.interval);
  return c;
}

/**
 * @param {SrsCard} c
 * @param {number} now
 * @param {boolean} easy
 */
function graduate(c, now, easy) {
  c.state = "review";
  c.step = 0;
  c.reps = 1;
  c.interval = easy ? EASY_INTERVAL_DAYS : GRADUATING_INTERVAL_DAYS;
  if (easy) c.ease = sm2EaseUpdate(c.ease, 4);
  c.due = now + daysToMs(c.interval);
  return c;
}

/**
 * @param {number} ms
 */
export function formatInterval(ms) {
  if (ms < 60_000) return "<1m";
  if (ms < 3_600_000) {
    const m = Math.round(ms / 60_000);
    return `${m}m`;
  }
  if (ms < daysToMs(1.5)) {
    const h = Math.round(ms / 3_600_000);
    return `${h}h`;
  }
  const d = Math.round(ms / daysToMs(1));
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/**
 * @param {number} ts
 */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Stable introduction order: House by district, then Senate by district, then name.
 * @param {{ id: string, chamber: string, district: number, name: string }} a
 * @param {{ id: string, chamber: string, district: number, name: string }} b
 */
export function memberOrder(a, b) {
  const ca = a.chamber === "House" ? 0 : 1;
  const cb = b.chamber === "House" ? 0 : 1;
  if (ca !== cb) return ca - cb;
  if (a.district !== b.district) return a.district - b.district;
  return a.name.localeCompare(b.name);
}

/**
 * @typedef {object} SrsStore
 * @property {Record<string, SrsCard>} cards
 * @property {string} newDay
 * @property {number} newIntroducedToday
 */

/** @returns {SrsStore} */
export function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    /** @type {Record<string, SrsCard>} */
    const cards = {};
    for (const [id, c] of Object.entries(parsed.cards || {})) {
      cards[id] = normalizeCard({ .../** @type {object} */ (c), id });
    }
    return {
      cards,
      newDay: parsed.newDay || dayKey(),
      newIntroducedToday: Number(parsed.newIntroducedToday) || 0,
    };
  } catch {
    return { cards: {}, newDay: dayKey(), newIntroducedToday: 0 };
  }
}

/** @param {SrsStore} store */
export function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/**
 * @param {SrsStore} store
 * @param {{ id: string }[]} members
 */
export function ensureCards(store, members) {
  const now = Date.now();
  for (const m of members) {
    if (!store.cards[m.id]) {
      store.cards[m.id] = createNewCard(m.id, now);
    }
  }
}

/**
 * Minimum gap between two shows of the same face = full unlocked roster
 * minus one (true round-robin: see everyone once before any repeat).
 * @param {number} poolSize
 */
export function minSessionSpacing(poolSize) {
  if (poolSize <= 1) return 0;
  return poolSize - 1;
}

/**
 * Build one full pass of the unlocked roster with no internal duplicates.
 * First pass: fixed House/Senate order (new faces in stable order).
 * Later passes: least-recently-seen / most-lapsed first, still unique per pass.
 *
 * @param {SrsStore} store
 * @param {{ id: string, chamber: string, district: number, name: string }[]} members
 * @param {number} passIndex  0 = first run through roster
 * @param {number} [now]
 * @returns {string[]} member ids, each at most once
 */
export function buildSessionPass(store, members, passIndex = 0, now = Date.now()) {
  if (!members.length) return [];

  if (passIndex === 0) {
    // Stable introduction order — no randomness, no duplicates
    return [...members].sort(memberOrder).map((m) => m.id);
  }

  // Later passes: unique set ordered by need (weak / due / stale)
  return [...members]
    .map((m) => {
      const c = store.cards[m.id] || createNewCard(m.id, now);
      return { m, c };
    })
    .sort((a, b) => {
      const aDue = a.c.due <= now ? 0 : 1;
      const bDue = b.c.due <= now ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      if (a.c.lapses !== b.c.lapses) return b.c.lapses - a.c.lapses;
      if (a.c.last !== b.c.last) return a.c.last - b.c.last;
      if (a.c.ease !== b.c.ease) return a.c.ease - b.c.ease;
      return memberOrder(a.m, b.m);
    })
    .map(({ m }) => m.id);
}

/**
 * Pick next face from a session pass cursor.
 * Refills a full unique pass when exhausted — never injects mid-pass duplicates.
 *
 * @param {SrsStore} store
 * @param {{ id: string, chamber: string, district: number, name: string }[]} members
 * @param {{ pass: string[], index: number, passNumber: number }} cursor
 * @param {number} [now]
 * @returns {{ member: typeof members[0] | null, cursor: typeof cursor }}
 */
export function takeNextFromPass(store, members, cursor, now = Date.now()) {
  const list = Array.isArray(members) ? members : [];
  const byId = new Map(list.map((m) => [m.id, m]));

  const safe = cursor && typeof cursor === "object" ? cursor : {};
  let pass = Array.isArray(safe.pass) ? safe.pass : [];
  let index = Number.isFinite(safe.index) ? safe.index : 0;
  let passNumber = Number.isFinite(safe.passNumber) ? safe.passNumber : 0;

  if (!pass.length || index >= pass.length) {
    pass = buildSessionPass(store, list, passNumber, now);
    index = 0;
    // Avoid starting a new pass on the same id we just finished with
    if (pass.length > 1 && Array.isArray(safe.pass) && safe.pass.length) {
      const last = safe.pass[safe.pass.length - 1];
      if (pass[0] === last) {
        pass = pass.slice(1).concat(pass[0]);
      }
    }
  }

  if (!pass.length) {
    return {
      member: null,
      cursor: { pass: [], index: 0, passNumber },
    };
  }

  const id = pass[index];
  index += 1;
  const nextPassNumber = index >= pass.length ? passNumber + 1 : passNumber;

  return {
    member: byId.get(id) || null,
    cursor: { pass, index, passNumber: nextPassNumber },
  };
}

/**
 * @deprecated Prefer takeNextFromPass. Thin wrapper for older callers.
 * @param {SrsStore} store
 * @param {{ id: string, chamber: string, district: number, name: string }[]} members
 * @param {string[]} recentIds
 * @param {number} [now]
 */
export function pickNextMember(store, members, recentIds = [], now = Date.now()) {
  // Reconstruct a pass that excludes recentIds already shown this pass
  const seen = new Set(recentIds);
  const remaining = members.filter((m) => !seen.has(m.id));
  if (remaining.length) {
    const pass = buildSessionPass(store, remaining, recentIds.length === 0 ? 0 : 1, now);
    const id = pass[0];
    return members.find((m) => m.id === id) || remaining[0];
  }
  // Full cycle complete — start a fresh unique pass
  const pass = buildSessionPass(store, members, 1, now);
  const last = recentIds[recentIds.length - 1];
  const ordered = pass[0] === last && pass.length > 1 ? pass.slice(1).concat(pass[0]) : pass;
  return members.find((m) => m.id === ordered[0]) || members[0] || null;
}

/**
 * Stats snapshot for HUD (not used for ordering).
 * @param {SrsStore} store
 * @param {{ id: string }[]} members
 * @param {number} [now]
 */
export function queueStats(store, members, now = Date.now()) {
  let learningDue = 0;
  let reviewDue = 0;
  let newTotal = 0;
  let mature = 0;

  for (const m of members) {
    const c = store.cards[m.id];
    if (!c || c.state === "new") {
      newTotal += 1;
      continue;
    }
    if (c.state === "review" && c.interval >= 21) mature += 1;
    if (c.due > now) continue;
    if (c.state === "learning" || c.state === "relearning") learningDue += 1;
    else reviewDue += 1;
  }

  return {
    learningDue,
    reviewDue,
    newAvailable: newTotal,
    newRemainingToday: Math.max(0, NEW_CARDS_PER_DAY - (store.newIntroducedToday || 0)),
    newTotal,
    mature,
    total: members.length,
    unlocked: members.length,
  };
}

/**
 * @deprecated Prefer pickNextMember for live play. Kept for harnesses.
 */
export function buildQueue(store, members, now = Date.now(), opts = {}) {
  const excludeId = opts.excludeId || null;
  const recent = excludeId ? [excludeId] : [];
  const next = pickNextMember(store, members, recent, now);
  const stats = queueStats(store, members, now);
  return {
    queue: next ? [next.id] : [],
    practice: false,
    counts: stats,
  };
}

/**
 * @param {SrsStore} store
 * @param {SrsCard} card
 * @param {number} now
 */
export function markIntroduced(store, card, now = Date.now()) {
  const today = dayKey(now);
  if (store.newDay !== today) {
    store.newDay = today;
    store.newIntroducedToday = 0;
  }
  if (!card.introducedAt) {
    store.newIntroducedToday += 1;
    card.introducedAt = now;
  }
}

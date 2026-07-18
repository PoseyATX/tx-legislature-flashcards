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

/** Learning steps in minutes (Anki-like: 1m, 10m). */
export const LEARNING_STEPS_MIN = [1, 10];
/** Relearning steps after a lapse. */
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_INTERVAL_DAYS = 1;
export const EASY_INTERVAL_DAYS = 4;
export const STARTING_EASE = 2.5;
export const MIN_EASE = 1.3;
export const EASY_BONUS = 1.3;
export const HARD_INTERVAL_FACTOR = 1.2;
/** Max brand-new cards introduced per calendar day (local). */
export const NEW_CARDS_PER_DAY = 20;

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
 * Input configuration for a card based on mastery.
 * Harder recall as the card matures.
 * @param {SrsCard} card
 */
export function inputConfigForCard(card) {
  const level = masteryLevel(card);
  switch (level) {
    case 0:
      return {
        level,
        type: "mc",
        choiceCount: 2,
        prompt: "photo-to-name",
        showDistrictHint: true,
        gradeOnCorrect: 3,
        gradeOnWrong: 1,
      };
    case 1:
      return {
        level,
        type: "mc",
        choiceCount: 4,
        prompt: "photo-to-name",
        showDistrictHint: false,
        gradeOnCorrect: 3,
        gradeOnWrong: 1,
      };
    case 2:
      return {
        level,
        type: "mc",
        choiceCount: 6,
        prompt: "photo-to-name",
        showDistrictHint: false,
        gradeOnCorrect: 3,
        gradeOnWrong: 1,
      };
    case 3:
      return {
        level,
        type: "type-last",
        choiceCount: 0,
        prompt: "photo-to-name",
        showDistrictHint: false,
        gradeOnCorrect: 4,
        gradeOnWrong: 1,
      };
    case 4:
    default:
      return {
        level,
        type: "type-full",
        choiceCount: 0,
        prompt: "photo-to-name",
        showDistrictHint: false,
        gradeOnCorrect: 4,
        gradeOnWrong: 1,
      };
  }
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
 * Study queue — deterministic, never random card selection.
 * Priority:
 *   1. Due learning / relearning (earliest due first)
 *   2. Due review (most overdue first)
 *   3. New cards in fixed member order, limited by NEW_CARDS_PER_DAY
 *
 * @param {SrsStore} store
 * @param {{ id: string, chamber: string, district: number, name: string }[]} members
 * @param {number} now
 */
export function buildQueue(store, members, now = Date.now()) {
  const today = dayKey(now);
  if (store.newDay !== today) {
    store.newDay = today;
    store.newIntroducedToday = 0;
  }

  /** @type {SrsCard[]} */
  const learning = [];
  /** @type {SrsCard[]} */
  const review = [];
  /** @type {typeof members} */
  const fresh = [];

  for (const m of members) {
    const card = store.cards[m.id] || createNewCard(m.id, now);
    if (card.state === "new") {
      fresh.push(m);
      continue;
    }
    if (card.due > now) continue;
    if (card.state === "learning" || card.state === "relearning") learning.push(card);
    else review.push(card);
  }

  learning.sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  review.sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  fresh.sort(memberOrder);

  /** @type {string[]} */
  const queue = [];
  for (const c of learning) queue.push(c.id);
  for (const c of review) queue.push(c.id);

  const newSlots = Math.max(0, NEW_CARDS_PER_DAY - store.newIntroducedToday);
  for (const m of fresh.slice(0, newSlots)) {
    queue.push(m.id);
  }

  return {
    queue,
    counts: {
      learningDue: learning.length,
      reviewDue: review.length,
      newAvailable: Math.min(fresh.length, newSlots),
      newRemainingToday: newSlots,
      newTotal: fresh.length,
      mature: members.filter((m) => {
        const c = store.cards[m.id];
        return c && c.state === "review" && c.interval >= 21;
      }).length,
      total: members.length,
    },
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

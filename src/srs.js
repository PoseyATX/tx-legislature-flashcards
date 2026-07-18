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
 * Sort within a chamber by district, then name.
 * @param {{ id: string, chamber: string, district: number, name: string }} a
 * @param {{ id: string, chamber: string, district: number, name: string }} b
 */
export function memberOrder(a, b) {
  if (a.district !== b.district) return a.district - b.district;
  return a.name.localeCompare(b.name);
}

/**
 * Unlock / deal order: interleave House and Senate so the early roster
 * is not 30 House members before any Senator appears.
 * Pattern: H1, S1, H2, S2, … then remaining House after S31.
 *
 * @param {{ id: string, chamber: string, district: number, name: string }[]} members
 */
export function buildUnlockOrder(members) {
  const house = members
    .filter((m) => m.chamber === "House")
    .sort(memberOrder);
  const senate = members
    .filter((m) => m.chamber === "Senate")
    .sort(memberOrder);
  const out = [];
  let hi = 0;
  let si = 0;
  while (hi < house.length || si < senate.length) {
    if (hi < house.length) out.push(house[hi++]);
    if (si < senate.length) out.push(senate[si++]);
  }
  // Anyone with unexpected chamber tags
  const seen = new Set(out.map((m) => m.id));
  for (const m of members) {
    if (!seen.has(m.id)) out.push(m);
  }
  return out;
}

/** Fisher–Yates shuffle (copy). */
export function shuffleCopy(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @typedef {object} SrsStore
 * @property {Record<string, SrsCard>} cards
 * @property {string} newDay
 * @property {number} newIntroducedToday
 * @property {string[]} knownIds  faces answered correctly — retired as prompts
 * @property {number} rosterFloor  min unlock size (grows when a level is cleared)
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
    const knownIds = Array.isArray(parsed.knownIds)
      ? parsed.knownIds.filter((x) => typeof x === "string")
      : [];
    return {
      cards,
      newDay: parsed.newDay || dayKey(),
      newIntroducedToday: Number(parsed.newIntroducedToday) || 0,
      knownIds,
      rosterFloor: Math.max(ROSTER_BASE, Number(parsed.rosterFloor) || ROSTER_BASE),
    };
  } catch {
    return {
      cards: {},
      newDay: dayKey(),
      newIntroducedToday: 0,
      knownIds: [],
      rosterFloor: ROSTER_BASE,
    };
  }
}

/** @param {SrsStore} store */
export function saveStore(store) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      cards: store.cards,
      newDay: store.newDay,
      newIntroducedToday: store.newIntroducedToday,
      knownIds: store.knownIds || [],
      rosterFloor: store.rosterFloor || ROSTER_BASE,
    })
  );
}

/** @param {SrsStore} store */
export function knownSet(store) {
  return new Set(store.knownIds || []);
}

/**
 * Mark a face as known — it will not be shown as a prompt again
 * until the player resets progress. Names may still appear as distractors.
 * @param {SrsStore} store
 * @param {string} id
 * @returns {boolean} true if newly marked
 */
export function markKnown(store, id) {
  if (!store.knownIds) store.knownIds = [];
  if (store.knownIds.includes(id)) return false;
  store.knownIds.push(id);
  return true;
}

/**
 * Faces still to learn within an unlocked roster.
 * @param {SrsStore} store
 * @param {{ id: string }[]} unlocked
 */
export function unknownMembers(store, unlocked) {
  const known = knownSet(store);
  return unlocked.filter((m) => !known.has(m.id));
}

/**
 * If every unlocked face is known, raise the roster floor so new faces unlock.
 * @param {SrsStore} store
 * @param {number} unlockedCount
 * @param {number} totalMembers
 * @returns {{ expanded: boolean, newFloor: number }}
 */
export function maybeExpandRoster(store, unlockedCount, totalMembers) {
  const floor = Math.max(ROSTER_BASE, store.rosterFloor || ROSTER_BASE);
  if (unlockedCount >= totalMembers) {
    return { expanded: false, newFloor: floor };
  }
  const next = Math.min(totalMembers, unlockedCount + ROSTER_PER_LEVEL);
  if (next > unlockedCount) {
    store.rosterFloor = Math.max(floor, next);
    return { expanded: true, newFloor: store.rosterFloor };
  }
  return { expanded: false, newFloor: floor };
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

  // Always shuffle the active learning set so play is not district-order.
  // Uniqueness is preserved (one of each id per pass).
  return shuffleCopy(members).map((m) => m.id);
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

  // Drop ids no longer in the active learning set (e.g. just marked known)
  if (pass.length) {
    const filtered = [];
    for (let i = 0; i < pass.length; i += 1) {
      if (byId.has(pass[i])) filtered.push(pass[i]);
      else if (i < index) index -= 1; // account for removed prior entries
    }
    pass = filtered;
    if (index < 0) index = 0;
  }

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

  // Skip any stale ids (defensive)
  while (index < pass.length && !byId.has(pass[index])) index += 1;

  if (index >= pass.length || !pass.length) {
    // Rebuild once more from current list
    pass = buildSessionPass(store, list, passNumber + (pass.length ? 1 : 0), now);
    index = 0;
    passNumber = pass.length ? passNumber + 1 : passNumber;
  }

  if (!pass.length || !byId.has(pass[index])) {
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
 * Clear learning progress (known faces + roster floor). Keeps gamification XP.
 * @param {SrsStore} store
 */
export function resetLearningProgress(store) {
  store.knownIds = [];
  store.rosterFloor = ROSTER_BASE;
  store.newIntroducedToday = 0;
  store.cards = {};
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

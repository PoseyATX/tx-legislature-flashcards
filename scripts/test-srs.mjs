/**
 * Lightweight SM-2 / queue assertions (no browser).
 */
import {
  createNewCard,
  applyGrade,
  masteryLevel,
  inputConfigForCard,
  buildQueue,
  ensureCards,
  memberOrder,
  MC_CHOICE_COUNT,
  studyLevelFromXP,
  unlockedRosterSize,
  LEARNING_STEPS_MIN,
} from "../src/srs.js";

const now = Date.UTC(2026, 6, 18, 12, 0, 0);
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  }
}

assert(MC_CHOICE_COUNT === 4, "MC is always 4");
assert(LEARNING_STEPS_MIN.every((m) => m === 0), "learning steps are in-session (0m)");

let c = createNewCard("H-1", now);
c = applyGrade(c, 3, now);
assert(c.state === "learning", "first Good stays in learning");
assert(c.due <= now, "first Good re-queues immediately");
c = applyGrade(c, 3, c.due);
assert(c.state === "review" && c.interval === 1, "second Good graduates at 1d");

const afterGood = applyGrade(c, 3, c.due);
assert(afterGood.interval >= 6, "review Good multiplies interval");

const failedCard = applyGrade(afterGood, 1, afterGood.due);
assert(failedCard.state === "relearning", "Again on review → relearning");
assert(failedCard.due <= afterGood.due + 1000, "relearn due immediately");

// Always 4-choice MC config
for (const interval of [0, 1, 5, 10, 30]) {
  const card = createNewCard("t", now);
  if (interval > 0) {
    card.state = "review";
    card.reps = 3;
    card.interval = interval;
  }
  const cfg = inputConfigForCard(card);
  assert(cfg.type === "mc" && cfg.choiceCount === 4, `config always 4 MC @ ivl ${interval}`);
}

assert(studyLevelFromXP(0) === 1, "xp0 level1");
assert(studyLevelFromXP(100) === 2, "xp100 level2");
assert(unlockedRosterSize(1, 180) === 30, "L1 unlocks 30");
assert(unlockedRosterSize(2, 180) === 50, "L2 unlocks 50");
assert(unlockedRosterSize(20, 180) === 180, "high level caps at 180");

const members = [
  { id: "S-2", chamber: "Senate", district: 2, name: "B" },
  { id: "H-2", chamber: "House", district: 2, name: "A2" },
  { id: "H-1", chamber: "House", district: 1, name: "A1" },
  { id: "L-1", chamber: "House", district: 50, name: "Learning" },
];
const store = { cards: {}, newDay: "", newIntroducedToday: 0 };
ensureCards(store, members);
// All new → queue has new cards
const { queue: q1 } = buildQueue(store, members, now);
assert(q1.length === 4, "all new cards available");

// Graduate all → practice mode still fills queue
for (const m of members) {
  let card = store.cards[m.id];
  card = applyGrade(card, 3, now);
  card = applyGrade(card, 3, card.due);
  // push far into future
  card.due = now + 7 * 86400000;
  store.cards[m.id] = card;
}
const built = buildQueue(store, members, now);
assert(built.practice === true, "practice when nothing due");
assert(built.queue.length === 4, "practice still has full roster");

assert(
  [...members].sort(memberOrder).map((m) => m.id).join() === "H-1,H-2,L-1,S-2",
  "memberOrder house/district"
);

if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("OK — SRS tests passed");

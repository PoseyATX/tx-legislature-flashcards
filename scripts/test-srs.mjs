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
} from "../src/srs.js";

const now = Date.UTC(2026, 6, 18, 12, 0, 0);
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  }
}

let c = createNewCard("H-1", now);
c = applyGrade(c, 3, now);
assert(c.state === "learning" && c.step === 1, "first Good advances learning step");
c = applyGrade(c, 3, c.due);
assert(c.state === "review" && c.interval === 1, "second Good graduates at 1d");

const afterGood = applyGrade(c, 3, c.due);
assert(afterGood.interval >= 6, "review Good multiplies interval");

const failedCard = applyGrade(afterGood, 1, afterGood.due);
assert(failedCard.state === "relearning", "Again on review → relearning");
assert(failedCard.ease < afterGood.ease, "Again lowers ease");

let easy = applyGrade(createNewCard("H-2", now), 4, now);
assert(easy.state === "review" && easy.interval === 4, "Easy graduates at 4d");

const ladder = [0, 1, 5, 10, 30].map((interval, i) => {
  const card = createNewCard("t", now);
  if (i === 0) return inputConfigForCard(card);
  card.state = "review";
  card.reps = 3;
  card.interval = interval;
  return inputConfigForCard(card);
});
assert(ladder[0].choiceCount === 2, "learning: 2-choice");
assert(ladder[1].choiceCount === 4, "young: 4-choice");
assert(ladder[2].choiceCount === 6, "familiar: 6-choice");
assert(ladder[3].type === "type-last", "strong: type last");
assert(ladder[4].type === "type-full", "mastered: type full");
assert(masteryLevel({ state: "review", reps: 5, interval: 30, ease: 2.5, id: "x", lapses: 0, due: 0, step: 0, last: 0, introducedAt: 0 }) === 4, "mature mastery");

const members = [
  { id: "S-2", chamber: "Senate", district: 2, name: "B" },
  { id: "H-2", chamber: "House", district: 2, name: "A2" },
  { id: "H-1", chamber: "House", district: 1, name: "A1" },
  { id: "L-1", chamber: "House", district: 50, name: "Learning" },
];
const store = { cards: {}, newDay: "", newIntroducedToday: 0 };
ensureCards(store, members);
store.cards["L-1"] = applyGrade(store.cards["L-1"], 3, now - 1000);
store.cards["L-1"].due = now - 1000;
const { queue } = buildQueue(store, members, now);
assert(queue[0] === "L-1", "learning before new");
assert(queue.slice(1).join() === "H-1,H-2,S-2", "new cards fixed order");
assert(
  [...members].sort(memberOrder).map((m) => m.id).join() === "H-1,H-2,L-1,S-2",
  "memberOrder house/district"
);

if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("OK — SRS tests passed");

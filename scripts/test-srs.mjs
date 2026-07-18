/**
 * Learning mechanics: correct → face retired as prompt; round-robin unknowns.
 */
import {
  createNewCard,
  inputConfigForCard,
  buildSessionPass,
  takeNextFromPass,
  ensureCards,
  markKnown,
  knownSet,
  unknownMembers,
  maybeExpandRoster,
  loadStore,
  MC_CHOICE_COUNT,
  ROSTER_BASE,
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

const members = Array.from({ length: 20 }, (_, i) => ({
  id: `H-${i}`,
  chamber: "House",
  district: i + 1,
  name: `Member ${i}`,
}));

const store = {
  cards: {},
  newDay: "",
  newIntroducedToday: 0,
  knownIds: [],
  rosterFloor: ROSTER_BASE,
};
ensureCards(store, members);

// Mark half known — they must not appear as prompts
for (let i = 0; i < 10; i += 1) markKnown(store, `H-${i}`);
assert(knownSet(store).size === 10, "10 known");

const learning = unknownMembers(store, members);
assert(learning.length === 10, "10 still to learn");
assert(learning.every((m) => Number(m.id.split("-")[1]) >= 10), "only unknown faces");

// Pass over learning only — never emits known ids
let cursor = { pass: [], index: 0, passNumber: 0 };
const seen = [];
for (let t = 0; t < 10; t += 1) {
  const { member, cursor: next } = takeNextFromPass(store, learning, cursor, now);
  assert(member, `turn ${t}`);
  assert(!knownSet(store).has(member.id), `known face not prompted: ${member.id}`);
  seen.push(member.id);
  cursor = next;
}
assert(new Set(seen).size === 10, "full unknown pass unique");

// After all known, expand roster floor
const small = members.slice(0, 30);
// pretend 30 unlocked all known
const store2 = {
  cards: {},
  newDay: "",
  newIntroducedToday: 0,
  knownIds: small.map((m) => m.id),
  rosterFloor: 30,
};
const exp = maybeExpandRoster(store2, 30, 180);
assert(exp.expanded && exp.newFloor === 50, `expand 30→50 got ${exp.newFloor}`);

const cfg = inputConfigForCard(createNewCard("x", now));
assert(cfg.choiceCount === 4, "4 choices");

if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("OK — known faces retired as prompts; names can still foil");

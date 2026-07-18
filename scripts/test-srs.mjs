/**
 * Mechanical tests for learning retirement + pass integrity.
 */
import {
  createNewCard,
  inputConfigForCard,
  takeNextFromPass,
  ensureCards,
  markKnown,
  knownSet,
  unknownMembers,
  maybeExpandRoster,
  resetLearningProgress,
  MC_CHOICE_COUNT,
  ROSTER_BASE,
  applyGrade,
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

function freshStore() {
  return {
    cards: {},
    newDay: "",
    newIntroducedToday: 0,
    knownIds: [],
    rosterFloor: ROSTER_BASE,
  };
}

// Pre-known half
const store = freshStore();
ensureCards(store, members);
for (let i = 0; i < 10; i += 1) markKnown(store, `H-${i}`);
assert(knownSet(store).size === 10, "10 known");
let learning = unknownMembers(store, members);
assert(learning.length === 10, "10 to learn");

// Deal entire unknown set — unique, never a known id
let cursor = { pass: [], index: 0, passNumber: 0 };
const seen = [];
for (let t = 0; t < 10; t += 1) {
  learning = unknownMembers(store, members);
  // Exclude already-seen this loop from... no, we don't mark known here
  const { member, cursor: next } = takeNextFromPass(store, learning, cursor, now + t * 10);
  assert(member, `turn ${t}`);
  assert(!knownSet(store).has(member.id), `prompt not known: ${member.id}`);
  assert(!seen.includes(member.id), `no dup in pass: ${member.id}`);
  seen.push(member.id);
  cursor = next;
}
assert(seen.length === 10 && new Set(seen).size === 10, "full unique unknown pass");

// Mid-session markKnown + filter: remaining pass skips retired faces
const store2 = freshStore();
ensureCards(store2, members);
cursor = { pass: members.map((m) => m.id), index: 0, passNumber: 0 };
// Simulate having just finished H-0 and marked known; pass index at 1 with H-0 still in array
markKnown(store2, "H-0");
cursor.index = 1;
const still = unknownMembers(store2, members);
const r = takeNextFromPass(store2, still, cursor, now);
assert(r.member, "gets next after filter");
assert(r.member.id !== "H-0", "does not re-deal known");
assert(!knownSet(store2).has(r.member.id), "next is unknown");

// Mark current known, prune pass like main.js, take next
markKnown(store2, r.member.id);
r.cursor.pass = r.cursor.pass.filter((id) => id !== r.member.id);
const still2 = unknownMembers(store2, members);
const r2 = takeNextFromPass(store2, still2, r.cursor, now);
assert(r2.member && r2.member.id !== r.member.id, "after prune, different face");
assert(!knownSet(store2).has(r2.member.id), "still unknown");

// Roster expand
const store3 = freshStore();
store3.rosterFloor = 30;
const exp = maybeExpandRoster(store3, 30, 180);
assert(exp.expanded && exp.newFloor === 50, `expand → ${exp.newFloor}`);

resetLearningProgress(store3);
assert(store3.knownIds.length === 0 && store3.rosterFloor === ROSTER_BASE, "reset ok");

// applyGrade smoke
let c = createNewCard("x", now);
c = applyGrade(c, 3, now);
c = applyGrade(c, 1, now + 1);
assert(c.state, "grade ok");

assert(inputConfigForCard(createNewCard("y", now)).choiceCount === 4, "4 MC");

// 20 unique before any second appearance
const store4 = freshStore();
ensureCards(store4, members);
cursor = { pass: [], index: 0, passNumber: 0 };
const ids = [];
for (let t = 0; t < 20; t += 1) {
  const learning4 = unknownMembers(store4, members);
  const { member, cursor: next } = takeNextFromPass(store4, learning4, cursor, now);
  assert(member, `pass ${t}`);
  ids.push(member.id);
  cursor = next;
}
assert(new Set(ids).size === 20, "20 unique first pass");

if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("OK — clean mechanical pass");

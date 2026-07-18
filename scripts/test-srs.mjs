/**
 * Round-robin session pass: no face twice until full unlocked roster seen.
 */
import {
  createNewCard,
  applyGrade,
  inputConfigForCard,
  buildSessionPass,
  takeNextFromPass,
  minSessionSpacing,
  ensureCards,
  memberOrder,
  MC_CHOICE_COUNT,
  studyLevelFromXP,
  unlockedRosterSize,
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
assert(minSessionSpacing(30) === 29, "gap is full roster - 1");

const members = Array.from({ length: 20 }, (_, i) => ({
  id: `H-${i}`,
  chamber: "House",
  district: i + 1,
  name: `Member ${i}`,
}));
const store = { cards: {}, newDay: "", newIntroducedToday: 0 };
ensureCards(store, members);

// First pass: all unique, fixed order
const pass0 = buildSessionPass(store, members, 0, now);
assert(pass0.length === 20, "pass length 20");
assert(new Set(pass0).size === 20, "pass0 no internal dups");
assert(pass0[0] === "H-0" && pass0[19] === "H-19", "stable order first pass");

// Simulate 60 takes via cursor — within each pass, no dups
let cursor = { pass: [], index: 0, passNumber: 0 };
const seenInPass = new Set();
let currentPassNum = 0;

for (let turn = 0; turn < 60; turn += 1) {
  const { member, cursor: next } = takeNextFromPass(store, members, cursor, now + turn * 1000);
  assert(member, `turn ${turn} has member`);
  if (!member) break;

  if (next.passNumber !== currentPassNum && next.index === 1) {
    // just started a new pass (index already advanced to 1)
    seenInPass.clear();
    currentPassNum = next.passNumber;
  }
  // While still on same pass array, no id twice
  if (next.passNumber === cursor.passNumber || next.index > 1) {
    // check uniqueness of remaining pass slice was unique at build
  }
  assert(!seenInPass.has(member.id), `turn ${turn}: ${member.id} already in this pass`);
  seenInPass.add(member.id);

  // When pass completes, clear for next
  if (next.index >= next.pass.length) {
    seenInPass.clear();
    currentPassNum = next.passNumber;
  }

  cursor = next;

  let c = store.cards[member.id];
  c = applyGrade(c, 3, now + turn * 1000);
  store.cards[member.id] = c;
}

// Counts over 60 turns on 20 faces: exactly 3 each
const counts = {};
cursor = { pass: [], index: 0, passNumber: 0 };
for (let turn = 0; turn < 60; turn += 1) {
  const { member, cursor: next } = takeNextFromPass(store, members, cursor, now);
  counts[member.id] = (counts[member.id] || 0) + 1;
  cursor = next;
}
const vals = Object.values(counts);
assert(vals.every((v) => v === 3), `exactly 3 each after 60: ${JSON.stringify(counts)}`);

const cfg = inputConfigForCard(createNewCard("x", now));
assert(cfg.choiceCount === 4 && cfg.type === "mc", "always 4 MC");
assert(studyLevelFromXP(0) === 1, "xp0 level1");
assert(unlockedRosterSize(1, 180) === 30, "L1 unlocks 30");
assert(memberOrder(members[1], members[0]) > 0, "memberOrder");

if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("OK — no face repeats until full roster pass completes");

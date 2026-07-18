/**
 * Who's Who — Texas Legislature
 * 4-way multiple-choice flash cards + roster unlock levels + continuous drill.
 */

import {
  applyGrade,
  ensureCards,
  knownSet,
  loadStore,
  markIntroduced,
  markKnown,
  maybeExpandRoster,
  MC_CHOICE_COUNT,
  memberOrder,
  normalizeCard,
  queueStats,
  saveStore,
  studyLevelFromXP,
  takeNextFromPass,
  unknownMembers,
  unlockedRosterSize,
} from "./srs.js";

import {
  closeLeaderboard,
  ensureLeaderboardRoot,
  loadGameState,
  onCorrectAnswer,
  onWrongAnswer,
  renderHUD,
  renderLeaderboard,
} from "./gamification.js";

/** @typedef {{ id: string, name: string, nameSort?: string, chamber: 'House'|'Senate', district: number, photo: string, url: string, party: string|null }} Member */

/** Official House headshots are 125×175 → 5:7. */
const PHOTO_RATIO = "5 / 7";
const FLY_MS = 280;
const AFTER_ANSWER_MS = 720;

const state = {
  members: /** @type {Member[]} */ ([]),
  /** Unlocked subset for the current study level */
  pool: /** @type {Member[]} */ ([]),
  store: loadStore(),
  /** Round-robin cursor: one unique pass through the unlocked roster at a time. */
  passCursor: {
    pass: /** @type {string[]} */ ([]),
    index: 0,
    passNumber: 0,
  },
  counts: {
    learningDue: 0,
    reviewDue: 0,
    newAvailable: 0,
    newTotal: 0,
    mature: 0,
    unlocked: 0,
  },
  studyLevel: 1,
  current: /** @type {Member|null} */ (null),
  currentSrs: /** @type {import('./srs.js').SrsCard|null} */ (null),
  choiceCount: MC_CHOICE_COUNT,
  choices: /** @type {Member[]} */ ([]),
  answered: false,
  selectedId: /** @type {string|null} */ (null),
  lastCorrect: false,
  animating: false,
  sessionAnswered: 0,
};

const $ = (id) => document.getElementById(id);

const els = {
  stage: $("stage"),
  left: $("stat-left"),
  hudXp: $("hud-xp"),
  hudStreak: $("hud-streak"),
  hudCombo: $("hud-combo"),
  hudRank: $("hud-rank"),
  leaderboardBtn: $("btn-leaderboard"),
};

function persist() {
  saveStore(state.store);
}

function paintHUD() {
  renderHUD(
    {
      xp: els.hudXp,
      streak: els.hudStreak,
      combo: els.hudCombo,
      rank: els.hudRank,
    },
    loadGameState()
  );
}

function updateChrome() {
  if (els.left) {
    const known = knownSet(state.store).size;
    const unlocked = state.counts?.unlocked ?? state.pool?.length ?? 0;
    const left = Math.max(0, unlocked - known);
    // e.g. "12 left · 18 known"
    els.left.textContent =
      state.members?.length > 0 ? `${left} left · ${known}✓` : "—";
  }

  paintHUD();
}

function chamberLabel(m) {
  return m.chamber === "House" ? "Rep." : "Sen.";
}

function metaLine(m) {
  const party = m.party ? ` · ${m.party}` : "";
  return `${m.chamber} · District ${m.district}${party}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Distractors: any legislator name is fair game (including ones already known).
 * Prompt faces never reuse known cards — only the name list may.
 */
function pickDistractors(n, excludeId) {
  const source =
    state.members.length >= n + 1 ? state.members : state.pool;
  const filtered = source.filter((m) => m.id !== excludeId);
  return shuffle(filtered).slice(0, n);
}

/**
 * Unlocked roster size = max(XP level unlock, roster floor after clearing levels).
 */
function currentUnlockCount() {
  const game = loadGameState();
  state.studyLevel = studyLevelFromXP(game.xp);
  const fromXp = unlockedRosterSize(state.studyLevel, state.members.length);
  const floor = Math.max(30, state.store.rosterFloor || 30);
  return Math.min(state.members.length, Math.max(fromXp, floor));
}

/**
 * @returns {Member[]} faces not yet answered correctly (still to learn)
 */
function learningPool() {
  const n = currentUnlockCount();
  state.pool = state.members.slice(0, n);
  state.counts.unlocked = n;
  return unknownMembers(state.store, state.pool);
}

function refreshStats() {
  ensureCards(state.store, state.members);
  const learning = learningPool();
  const stats = queueStats(state.store, learning, Date.now());
  const known = knownSet(state.store).size;
  state.counts = {
    learningDue: stats.learningDue,
    reviewDue: stats.reviewDue,
    newAvailable: learning.length,
    newTotal: learning.length,
    mature: known,
    unlocked: state.pool.length,
  };
  updateChrome();
}

function nextCard() {
  refreshStats();

  if (state.members.length < 4) {
    els.stage.innerHTML = `<div class="error">Need at least four members for 4-choice quiz.</div>`;
    return;
  }

  let learning = learningPool();

  // Cleared this unlock band → open more faces (level progression)
  let guard = 0;
  while (learning.length === 0 && state.pool.length < state.members.length && guard < 12) {
    guard += 1;
    const { expanded, newFloor } = maybeExpandRoster(
      state.store,
      state.pool.length,
      state.members.length
    );
    persist();
    if (!expanded) break;
    showLevelUp(
      Math.max(1, Math.ceil((newFloor - 30) / 20) + 1),
      newFloor
    );
    // Reset pass so new faces deal in order
    state.passCursor = { pass: [], index: 0, passNumber: 0 };
    learning = learningPool();
  }

  if (learning.length === 0) {
    renderAllKnown();
    return;
  }

  // Pass only over unlearned faces — never re-prompt a known face
  const { member, cursor } = takeNextFromPass(
    state.store,
    learning,
    state.passCursor,
    Date.now()
  );
  state.passCursor = cursor;

  if (!member) {
    // Pass exhausted of unknowns (shouldn't happen often) — rebuild
    state.passCursor = { pass: [], index: 0, passNumber: 0 };
    const retry = takeNextFromPass(state.store, learning, state.passCursor, Date.now());
    state.passCursor = retry.cursor;
    if (!retry.member) {
      renderAllKnown();
      return;
    }
    showMember(retry.member, true);
    return;
  }

  showMember(member, true);
}

/**
 * @param {Member} member
 * @param {boolean} dropIn
 */
function showMember(member, dropIn) {
  let srs = normalizeCard(state.store.cards[member.id] || { id: member.id });
  markIntroduced(state.store, srs, Date.now());
  state.store.cards[member.id] = srs;
  persist();

  state.current = member;
  state.currentSrs = srs;
  state.answered = false;
  state.selectedId = null;
  state.lastCorrect = false;
  state.animating = false;

  state.choiceCount = MC_CHOICE_COUNT;
  const distractors = pickDistractors(MC_CHOICE_COUNT - 1, member.id);
  state.choices = shuffle([member, ...distractors]);

  refreshStats();
  state.current = member;
  state.currentSrs = srs;
  renderCard(dropIn);
  updateChrome();
}

/**
 * @param {1|2|3|4} quality
 * @param {'left'|'right'} dir
 */
async function advanceAfterGrade(quality, dir) {
  if (!state.current || !state.currentSrs) return;
  state.animating = true;

  const stack = $("stack");
  if (stack) {
    stack.classList.add(dir === "right" ? "fly-right" : "fly-left");
    await sleep(FLY_MS);
  }

  const updated = applyGrade(state.currentSrs, quality, Date.now());
  state.store.cards[state.current.id] = updated;
  state.sessionAnswered += 1;
  persist();

  state.animating = false;
  nextCard();
}

/**
 * Score a multiple-choice pick (required — no skip).
 * @param {string} memberId
 */
async function onChoose(memberId) {
  if (state.answered || state.animating || !state.current || !state.currentSrs) return;
  if (!memberId) return;

  state.answered = true;
  state.selectedId = memberId;
  const correct = memberId === state.current.id;
  state.lastCorrect = correct;

  const stack = $("stack");
  const card = $("card");

  document.querySelectorAll(".choice").forEach((btn) => {
    const id = btn.getAttribute("data-id");
    btn.setAttribute("disabled", "true");
    if (id === state.current.id) btn.classList.add("correct");
    else if (id === memberId && !correct) btn.classList.add("wrong");
  });

  const fb = $("answer-feedback");
  if (fb) {
    fb.className = `answer-feedback ${correct ? "ok" : "bad"}`;
    fb.textContent = correct
      ? `✓ ${chamberLabel(state.current)} ${state.current.name}`
      : `✗ ${chamberLabel(state.current)} ${state.current.name}`;
  }

  const reveal = $("photo-reveal");
  if (reveal) {
    reveal.hidden = false;
    reveal.innerHTML = `
      <p class="reveal-name">${escapeHtml(chamberLabel(state.current))} ${escapeHtml(state.current.name)}</p>
      <p class="reveal-meta">${escapeHtml(metaLine(state.current))}</p>
    `;
  }

  if (correct) {
    // Retire this face as a prompt for the rest of progress (names still OK as foils)
    markKnown(state.store, state.current.id);
    persist();
    onCorrectAnswer({ host: stack, card: card || stack });
  } else {
    onWrongAnswer({ card: card || stack });
  }

  paintHUD();
  updateChrome();

  await sleep(AFTER_ANSWER_MS);
  const quality = /** @type {1|2|3|4} */ (correct ? 3 : 1);
  await advanceAfterGrade(quality, correct ? "right" : "left");
}

function showLevelUp(level, unlocked) {
  const host = $("stack") || els.stage;
  if (!host) return;
  const el = document.createElement("div");
  el.className = "level-toast";
  el.textContent = `LEVEL ${level} · ${unlocked} faces unlocked`;
  host.appendChild(el);
  void el.offsetWidth;
  el.classList.add("is-on");
  setTimeout(() => el.remove(), 1400);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- render ---------------- */

function renderChoices() {
  return state.choices
    .map((m, i) => {
      let cls = "choice";
      if (state.answered) {
        if (m.id === state.current.id) cls += " correct";
        else if (m.id === state.selectedId) cls += " wrong";
      }
      return `
        <button type="button" class="${cls}" data-id="${escapeHtml(m.id)}" ${state.answered ? "disabled" : ""}>
          <span class="choice-key">${i + 1}</span>
          <span class="choice-text">
            <span class="choice-name">${escapeHtml(m.name)}</span>
            <span class="choice-meta">${escapeHtml(metaLine(m))}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

/**
 * @param {boolean} dropIn
 */
function renderCard(dropIn) {
  const m = state.current;
  const srs = state.currentSrs;
  if (!m || !srs) return;

  els.stage.innerHTML = `
    <div class="stack${dropIn ? " drop-in" : ""}" id="stack">
      <article class="card card-quiz" id="card">
        <header class="card-head">
          <span class="badge">${unknownMembers(state.store, state.pool).length} to learn · ${knownSet(state.store).size} known</span>
          <span class="badge badge-muted">4 choices · correct = retired</span>
        </header>

        <div class="portrait-block">
          <div class="portrait-frame" style="aspect-ratio: ${PHOTO_RATIO}">
            <img
              src="${escapeHtml(m.photo)}"
              alt="Legislator portrait"
              width="125"
              height="175"
              draggable="false"
              referrerpolicy="no-referrer"
              decoding="async"
            />
          </div>
          <div class="photo-reveal" id="photo-reveal" hidden></div>
        </div>

        <p class="answer-feedback" id="answer-feedback" aria-live="polite"></p>

        <div class="choices" role="group" aria-label="Name choices">
          ${renderChoices()}
        </div>
      </article>
    </div>
  `;

  els.stage.querySelectorAll(".choice").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onChoose(btn.getAttribute("data-id") || "");
    });
  });
}

function renderAllKnown() {
  const game = loadGameState();
  const known = knownSet(state.store).size;
  const total = state.members.length;
  const done = known >= total;

  els.stage.innerHTML = `
    <div class="empty">
      <div>
        <h2>${done ? "Roster clear" : "Band clear"}</h2>
        <p class="empty-rank">${escapeHtml(game.rankTitle || "")} · ${game.xp.toLocaleString()} XP</p>
        <p>
          ${
            done
              ? `You've correctly ID'd all <strong>${total}</strong> members. Names can still show as wrong answers if you reset.`
              : `You've locked in this unlock band (<strong>${known}</strong> known). Opening more faces…`
          }
        </p>
        <div class="empty-actions">
          ${
            !done
              ? `<button type="button" class="dock-btn know empty-btn" id="btn-keep">
                   <span class="dock-label">Continue</span>
                 </button>`
              : ""
          }
          <button type="button" class="dock-btn flip empty-btn" id="btn-lb-done">
            <span class="dock-label">Leaderboard</span>
          </button>
          <a
            class="dock-btn kofi-btn empty-btn"
            href="https://ko-fi.com/poseyatx"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="dock-label">☕ buy me a ko-fi</span>
          </a>
        </div>
      </div>
    </div>
  `;

  $("btn-keep")?.addEventListener("click", () => nextCard());
  $("btn-lb-done")?.addEventListener("click", () => {
    renderLeaderboard(ensureLeaderboardRoot(), loadGameState());
  });

  // If not fully done, auto-expand and continue after a beat
  if (!done) {
    setTimeout(() => nextCard(), 900);
  }

  paintHUD();
}

function wireChrome() {
  els.leaderboardBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    renderLeaderboard(ensureLeaderboardRoot(), loadGameState());
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeLeaderboard();
      return;
    }
    if (state.animating || !state.current || state.answered) return;

    const num = Number(e.key);
    if (num >= 1 && num <= state.choices.length) {
      e.preventDefault();
      onChoose(state.choices[num - 1].id);
      return;
    }
    if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      renderLeaderboard(ensureLeaderboardRoot(), loadGameState());
    }
  });
}

async function init() {
  ensureLeaderboardRoot();
  wireChrome();

  try {
    // Resolve relative to this module so Pages subpaths always work
    const url = new URL("../data/members.json", import.meta.url);
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load members (${res.status})`);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : data?.members;
    if (!Array.isArray(raw)) throw new Error("members.json missing members array");

    state.members = raw
      .filter((m) => m && m.name && m.photo)
      .sort(memberOrder);

    if (state.members.length < 4) {
      throw new Error(`Need at least 4 members (got ${state.members.length})`);
    }

    ensureCards(state.store, state.members);
    persist();
    rebuildUnlockedPool();
    paintHUD();
    nextCard();
  } catch (err) {
    console.error(err);
    if (els.stage) {
      els.stage.innerHTML = `<div class="error">Could not load members.<br><small>${escapeHtml(err.message || String(err))}</small></div>`;
    }
  }
}

init();

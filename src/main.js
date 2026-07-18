/**
 * Who's Who — Texas Legislature
 * 4-way multiple-choice flash cards + roster unlock levels + continuous drill.
 */

import {
  applyGrade,
  ensureCards,
  loadStore,
  markIntroduced,
  MC_CHOICE_COUNT,
  memberOrder,
  minSessionSpacing,
  normalizeCard,
  queueStats,
  saveStore,
  studyLevelFromXP,
  takeNextFromPass,
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
  const left = state.queue.length;
  if (els.left) {
    els.left.textContent =
      state.pool.length > 0
        ? `L${state.studyLevel} · ${state.counts.unlocked}/${state.members.length}`
        : "—";
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
 * Distractors from the full unlocked pool (or all members if pool tiny).
 */
function pickDistractors(n, excludeId) {
  const source =
    state.pool.length >= n + 1
      ? state.pool
      : state.members;
  const filtered = source.filter((m) => m.id !== excludeId);
  return shuffle(filtered).slice(0, n);
}

function rebuildUnlockedPool() {
  const game = loadGameState();
  const prevLevel = state.studyLevel;
  state.studyLevel = studyLevelFromXP(game.xp);
  const n = unlockedRosterSize(state.studyLevel, state.members.length);
  // Fixed order unlock: House by district, then Senate
  state.pool = state.members.slice(0, n);
  state.counts.unlocked = n;
  // New faces unlocked mid-session → rebuild the current pass so they appear
  // before we start repeating anyone
  if (state.studyLevel > prevLevel) {
    state.passCursor = { pass: [], index: 0, passNumber: state.passCursor.passNumber };
  }
}

function refreshStats() {
  rebuildUnlockedPool();
  ensureCards(state.store, state.members);
  const stats = queueStats(state.store, state.pool, Date.now());
  state.counts = {
    learningDue: stats.learningDue,
    reviewDue: stats.reviewDue,
    newAvailable: stats.newAvailable,
    newTotal: stats.newTotal,
    mature: stats.mature,
    unlocked: state.pool.length,
  };
  updateChrome();
}

function nextCard() {
  refreshStats();

  if (state.pool.length < 4) {
    els.stage.innerHTML = `<div class="error">Need at least four members for 4-choice quiz.</div>`;
    return;
  }

  const { member, cursor } = takeNextFromPass(
    state.store,
    state.pool,
    state.passCursor,
    Date.now()
  );
  state.passCursor = cursor;

  if (!member) {
    renderDone();
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

  const prevLevel = state.studyLevel;
  if (correct) {
    onCorrectAnswer({ host: stack, card: card || stack });
  } else {
    onWrongAnswer({ card: card || stack });
  }

  // Level-up toast if roster expanded
  rebuildUnlockedPool();
  if (state.studyLevel > prevLevel) {
    showLevelUp(state.studyLevel, state.counts.unlocked);
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

  const mastery = masteryLabel(
    // lightweight: reuse stored fields
    srs.state === "new" || srs.state === "learning" || srs.state === "relearning"
      ? 0
      : srs.interval >= 21
        ? 4
        : srs.interval >= 7
          ? 3
          : srs.interval >= 3
            ? 2
            : 1
  );

  els.stage.innerHTML = `
    <div class="stack${dropIn ? " drop-in" : ""}" id="stack">
      <article class="card card-quiz" id="card">
        <header class="card-head">
          <span class="badge">Study L${state.studyLevel} · ${state.counts.unlocked} faces</span>
          <span class="badge badge-muted">4 choices · no repeats till full pass</span>
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

function renderDone() {
  // Should rarely hit — practice mode keeps the queue full.
  const game = loadGameState();
  els.stage.innerHTML = `
    <div class="empty">
      <div>
        <h2>Session pause</h2>
        <p class="empty-rank">${escapeHtml(game.rankTitle || "")} · ${game.xp.toLocaleString()} XP</p>
        <p>Study level <strong>${state.studyLevel}</strong> · <strong>${state.counts.unlocked}</strong> / ${state.members.length} faces unlocked.</p>
        <p>Earn XP to unlock more of the Legislature. Keep drilling the faces you have.</p>
        <div class="empty-actions">
          <button type="button" class="dock-btn know empty-btn" id="btn-keep">
            <span class="dock-label">Keep drilling</span>
          </button>
          <button type="button" class="dock-btn flip empty-btn" id="btn-lb-done">
            <span class="dock-label">Leaderboard</span>
          </button>
          <a
            class="dock-btn kofi-btn empty-btn"
            href="https://ko-fi.com/poseyatx"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="dock-label">☕ Ko-fi</span>
          </a>
        </div>
      </div>
    </div>
  `;

  $("btn-keep")?.addEventListener("click", () => {
    nextCard();
  });
  $("btn-lb-done")?.addEventListener("click", () => {
    renderLeaderboard(ensureLeaderboardRoot(), loadGameState());
  });

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
  paintHUD();

  try {
    const res = await fetch("data/members.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load members (${res.status})`);
    const data = await res.json();
    state.members = (data.members || [])
      .filter((m) => m?.name && m?.photo)
      .sort(memberOrder);

    if (state.members.length < 4) throw new Error("Need at least 4 members");

    ensureCards(state.store, state.members);
    persist();
    rebuildUnlockedPool();
    nextCard();
  } catch (err) {
    console.error(err);
    els.stage.innerHTML = `<div class="error">Could not load members.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

init();

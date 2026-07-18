/**
 * Who's Who — Texas Legislature
 * Photo (5:7 official headshot ratio) + multiple-choice scoring + SRS + XP.
 */

import {
  applyGrade,
  buildQueue,
  ensureCards,
  formatInterval,
  inputConfigForCard,
  loadStore,
  masteryLabel,
  markIntroduced,
  memberOrder,
  normalizeCard,
  saveStore,
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

/** Official House headshots are 125×175 → 5:7. Use that as the standard frame. */
const PHOTO_RATIO = "5 / 7";
const FLY_MS = 280;
const AFTER_ANSWER_MS = 720;

const state = {
  members: /** @type {Member[]} */ ([]),
  pool: /** @type {Member[]} */ ([]),
  store: loadStore(),
  queue: /** @type {string[]} */ ([]),
  counts: { learningDue: 0, reviewDue: 0, newAvailable: 0, newTotal: 0, mature: 0 },
  current: /** @type {Member|null} */ (null),
  currentSrs: /** @type {import('./srs.js').SrsCard|null} */ (null),
  /** Always multiple-choice for scoring (2–4 options by mastery). */
  choiceCount: 4,
  choices: /** @type {Member[]} */ ([]),
  answered: false,
  selectedId: /** @type {string|null} */ (null),
  lastCorrect: false,
  animating: false,
};

const $ = (id) => document.getElementById(id);

const els = {
  stage: $("stage"),
  left: $("stat-left"),
  coach: $("coach"),
  skip: $("btn-skip"),
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

function setDockEnabled(on) {
  if (els.skip) els.skip.disabled = !on || state.answered || state.animating;
}

function updateChrome() {
  const due = state.counts.learningDue + state.counts.reviewDue;
  const left = due + state.counts.newAvailable;
  if (els.left) els.left.textContent = left > 0 ? `${left} left` : "Done";

  if (els.coach) {
    els.coach.textContent = state.answered
      ? state.lastCorrect
        ? "Nice — next card loading…"
        : "Noted — you'll see them again soon"
      : "Pick the name that matches the face";
  }

  setDockEnabled(Boolean(state.current) && !state.animating);
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

function pickDistractors(n, excludeId) {
  const filtered = state.pool.filter((m) => m.id !== excludeId);
  return shuffle(filtered).slice(0, n);
}

/**
 * MC only — cap at 4 for mobile. Mastery still scales difficulty.
 * @param {import('./srs.js').SrsCard} srs
 */
function mcChoiceCount(srs) {
  const cfg = inputConfigForCard(srs);
  // Force multiple-choice path even if SRS config says type-in
  if (cfg.level <= 0) return 2;
  if (cfg.level === 1) return 3;
  return 4;
}

function refreshPoolAndQueue() {
  state.pool = [...state.members].sort(memberOrder);
  ensureCards(state.store, state.pool);
  const built = buildQueue(state.store, state.pool, Date.now());
  state.queue = built.queue;
  state.counts = {
    learningDue: built.counts.learningDue,
    reviewDue: built.counts.reviewDue,
    newAvailable: built.counts.newAvailable,
    newTotal: built.counts.newTotal,
    mature: built.counts.mature,
  };
  updateChrome();
}

function nextCard() {
  refreshPoolAndQueue();

  if (state.pool.length < 2) {
    els.stage.innerHTML = `<div class="error">Need at least two members for multiple choice.</div>`;
    setDockEnabled(false);
    return;
  }

  if (state.queue.length === 0) {
    renderDone();
    return;
  }

  const id = state.queue[0];
  const member = state.pool.find((m) => m.id === id);
  if (!member) {
    delete state.store.cards[id];
    persist();
    nextCard();
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

  const n = Math.min(mcChoiceCount(srs), state.pool.length);
  state.choiceCount = n;
  const distractors = pickDistractors(n - 1, member.id);
  state.choices = shuffle([member, ...distractors]);

  refreshPoolAndQueue();
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
  setDockEnabled(false);

  const stack = $("stack");
  if (stack) {
    stack.classList.add(dir === "right" ? "fly-right" : "fly-left");
    await sleep(FLY_MS);
  }

  const updated = applyGrade(state.currentSrs, quality, Date.now());
  state.store.cards[state.current.id] = updated;
  persist();

  state.animating = false;
  nextCard();
}

/**
 * Score a multiple-choice pick (or skip as wrong).
 * @param {string|null} memberId  null = skip / give up
 */
async function onChoose(memberId) {
  if (state.answered || state.animating || !state.current || !state.currentSrs) return;

  state.answered = true;
  state.selectedId = memberId;
  const correct = memberId != null && memberId === state.current.id;
  state.lastCorrect = correct;

  const stack = $("stack");
  const card = $("card");

  // Paint choice states
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

  // Reveal name under photo without full-card flip
  const reveal = $("photo-reveal");
  if (reveal) {
    reveal.hidden = false;
    reveal.innerHTML = `
      <p class="reveal-name">${escapeHtml(chamberLabel(state.current))} ${escapeHtml(state.current.name)}</p>
      <p class="reveal-meta">${escapeHtml(metaLine(state.current))}</p>
    `;
  }

  if (correct) {
    onCorrectAnswer({ host: stack, card: card || stack });
  } else {
    onWrongAnswer({ card: card || stack, button: memberId ? null : els.skip });
  }
  paintHUD();
  updateChrome();

  await sleep(AFTER_ANSWER_MS);
  const quality = /** @type {1|2|3|4} */ (correct ? 3 : 1);
  await advanceAfterGrade(quality, correct ? "right" : "left");
}

function skipCard() {
  onChoose(null);
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

  const level = masteryLabel(
    inputConfigForCard(srs).level
  );

  els.stage.innerHTML = `
    <div class="stack${dropIn ? " drop-in" : ""}" id="stack">
      <article class="card card-quiz" id="card">
        <header class="card-head">
          <span class="badge">${escapeHtml(level)} · ${state.choiceCount} choices</span>
          <span class="badge badge-muted">Who is this?</span>
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
      onChoose(btn.getAttribute("data-id"));
    });
  });
}

function renderDone() {
  if (els.skip) els.skip.disabled = true;

  const game = loadGameState();
  const upcoming = state.pool
    .map((m) => state.store.cards[m.id])
    .filter((c) => c && c.state !== "new" && c.due > Date.now())
    .sort((a, b) => a.due - b.due);
  const nextIn = upcoming[0] ? formatInterval(upcoming[0].due - Date.now()) : null;
  const nextNew = state.pool.find((m) => {
    const c = state.store.cards[m.id];
    return !c || c.state === "new";
  });

  els.stage.innerHTML = `
    <div class="empty">
      <div>
        <h2>You're caught up</h2>
        <p class="empty-rank">${escapeHtml(game.rankTitle || "")} · ${game.xp.toLocaleString()} XP</p>
        <p>${
          nextIn
            ? `Next review in about <strong>${escapeHtml(nextIn)}</strong>.`
            : "No reviews waiting right now."
        }</p>
        <div class="empty-actions">
          <button type="button" class="dock-btn know empty-btn" id="btn-lb-done">
            <span class="dock-label">Leaderboard</span>
          </button>
          ${
            nextNew
              ? `<button type="button" class="dock-btn flip empty-btn" id="btn-more">
                   <span class="dock-label">Study more</span>
                 </button>`
              : ""
          }
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

  $("btn-more")?.addEventListener("click", () => {
    if (nextNew) showMember(nextNew, true);
  });
  $("btn-lb-done")?.addEventListener("click", () => {
    renderLeaderboard(ensureLeaderboardRoot(), loadGameState());
  });

  if (els.coach) els.coach.textContent = "Come back later — missed faces return first.";
  paintHUD();
}

/* ---------------- chrome ---------------- */

function wireChrome() {
  els.skip?.addEventListener("click", (e) => {
    e.preventDefault();
    skipCard();
  });

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
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      skipCard();
    } else if (e.key === "l" || e.key === "L") {
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

    if (state.members.length < 2) throw new Error("Empty member list");

    ensureCards(state.store, state.members);
    persist();
    nextCard();
  } catch (err) {
    console.error(err);
    setDockEnabled(false);
    els.stage.innerHTML = `<div class="error">Could not load members.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

init();

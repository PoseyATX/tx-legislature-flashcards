/**
 * Texas Legislature Flash Cards
 * SM-2 spaced repetition + native-style 3D flip + swipe gestures
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
  previewIntervalMs,
  saveStore,
  STATS_KEY,
} from "./srs.js";

/** @typedef {{ id: string, name: string, nameSort?: string, chamber: 'House'|'Senate', district: number, photo: string, url: string, party: string|null }} Member */

const SWIPE_THRESHOLD_PX = 72;
const SWIPE_MAX_ROTATE = 12;
const FLY_MS = 320;

const state = {
  members: /** @type {Member[]} */ ([]),
  pool: /** @type {Member[]} */ ([]),
  store: loadStore(),
  queue: /** @type {string[]} */ ([]),
  counts: {
    learningDue: 0,
    reviewDue: 0,
    newAvailable: 0,
    newRemainingToday: 0,
    newTotal: 0,
    mature: 0,
    total: 0,
  },
  current: /** @type {Member|null} */ (null),
  currentSrs: /** @type {import('./srs.js').SrsCard|null} */ (null),
  inputConfig: /** @type {ReturnType<typeof inputConfigForCard>|null} */ (null),
  choices: /** @type {Member[]} */ ([]),
  chamber: "all",
  flipped: false,
  answered: false,
  selectedId: /** @type {string|null} */ (null),
  lastResult: /** @type {null | { correct: boolean, quality: 1|2|3|4, typed?: string }} */ (null),
  animating: false,
  stats: loadSessionStats(),
};

/** Touch / pointer drag state for swipe */
const gesture = {
  active: false,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  pointerId: /** @type {number|null} */ (null),
  /** @type {HTMLElement|null} */
  target: null,
};

const els = {
  stage: document.getElementById("stage"),
  due: document.getElementById("stat-due"),
  learning: document.getElementById("stat-learning"),
  newCards: document.getElementById("stat-new"),
  mature: document.getElementById("stat-mature"),
  dataMeta: document.getElementById("data-meta"),
  reset: document.getElementById("btn-reset"),
  footerHint: document.getElementById("footer-hint"),
};

function loadSessionStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw);
    return {
      reviews: Number(p.reviews) || 0,
      correct: Number(p.correct) || 0,
      wrong: Number(p.wrong) || 0,
      streak: Number(p.streak) || 0,
      bestStreak: Number(p.bestStreak) || 0,
    };
  } catch {
    return { reviews: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0 };
  }
}

function saveSessionStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(state.stats));
}

function persistSrs() {
  saveStore(state.store);
}

function rebuildPool() {
  if (state.chamber === "all") {
    state.pool = [...state.members].sort(memberOrder);
  } else {
    state.pool = state.members.filter((m) => m.chamber === state.chamber).sort(memberOrder);
  }
}

function refreshQueue() {
  rebuildPool();
  ensureCards(state.store, state.pool);
  const built = buildQueue(state.store, state.pool, Date.now());
  state.queue = built.queue;
  state.counts = built.counts;
  updateScoreboard();
}

function updateScoreboard() {
  const due = state.counts.learningDue + state.counts.reviewDue;
  els.due.textContent = String(due);
  els.learning.textContent = String(state.counts.learningDue);
  els.newCards.textContent = String(state.counts.newAvailable);
  els.mature.textContent = String(state.counts.mature);
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

function chamberLabel(member) {
  return member.chamber === "House" ? "Rep." : "Sen.";
}

function memberMeta(member) {
  const bits = [`${member.chamber} District ${member.district}`];
  if (member.party) bits.push(member.party);
  return bits.join(" · ");
}

function lastNameOf(member) {
  if (member.nameSort && member.nameSort.includes(",")) {
    return member.nameSort.split(",")[0].trim();
  }
  const parts = member.name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function firstNamesOf(member) {
  if (member.nameSort && member.nameSort.includes(",")) {
    return member.nameSort.split(",").slice(1).join(",").trim();
  }
  const parts = member.name.trim().split(/\s+/);
  return parts.slice(0, -1).join(" ");
}

function normalizeAnswer(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} typed
 * @param {Member} member
 * @param {'type-last'|'type-full'} mode
 */
function gradeTypedAnswer(typed, member, mode) {
  const t = normalizeAnswer(typed);
  if (!t) return false;
  const full = normalizeAnswer(member.name);
  const last = normalizeAnswer(lastNameOf(member));
  const first = normalizeAnswer(firstNamesOf(member));
  if (mode === "type-last") {
    return t === last || t === full || t.endsWith(` ${last}`) || t.startsWith(`${last} `);
  }
  if (t === full) return true;
  if (first && (t === `${first} ${last}` || t === `${last} ${first}`)) return true;
  const tokens = t.split(" ");
  if (tokens.length >= 2 && tokens[tokens.length - 1] === last) {
    if (first && tokens[0] === first.split(" ")[0]) return true;
  }
  return false;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inputTypeLabel(config) {
  if (config.type === "mc") return `${config.choiceCount}-choice`;
  if (config.type === "type-last") return "Type last name";
  if (config.type === "type-full") return "Type full name";
  return "Recall";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------------------------------------------------------------
   SRS session flow
   -------------------------------------------------------------------------- */

function nextRound() {
  refreshQueue();

  if (state.pool.length < 2) {
    els.stage.innerHTML = `<div class="error">Not enough members in this chamber filter.</div>`;
    return;
  }

  if (state.queue.length === 0) {
    renderCaughtUp();
    return;
  }

  const id = state.queue[0];
  const member = state.pool.find((m) => m.id === id) || state.members.find((m) => m.id === id);
  if (!member) {
    delete state.store.cards[id];
    persistSrs();
    nextRound();
    return;
  }

  presentMember(member, { dropIn: true });
}

/**
 * @param {Member} member
 * @param {{ dropIn?: boolean }} [opts]
 */
function presentMember(member, opts = {}) {
  let srs = normalizeCard(state.store.cards[member.id] || { id: member.id });
  markIntroduced(state.store, srs, Date.now());
  state.store.cards[member.id] = srs;
  persistSrs();

  const config = inputConfigForCard(srs);
  state.current = member;
  state.currentSrs = srs;
  state.inputConfig = config;
  state.flipped = false;
  state.answered = false;
  state.selectedId = null;
  state.lastResult = null;
  state.animating = false;

  if (config.type === "mc") {
    const n = Math.min(config.choiceCount, state.pool.length);
    const distractors = pickDistractors(n - 1, member.id);
    state.choices = shuffle([member, ...distractors]);
  } else {
    state.choices = [];
  }

  refreshQueueCountsOnly();
  renderRound({ dropIn: Boolean(opts.dropIn) });
}

function refreshQueueCountsOnly() {
  rebuildPool();
  ensureCards(state.store, state.pool);
  const built = buildQueue(state.store, state.pool, Date.now());
  state.counts = built.counts;
  updateScoreboard();
}

/**
 * Apply SM-2 grade after swipe / button. Animates card off-screen first.
 * @param {1|2|3|4} quality
 * @param {'left'|'right'} direction
 */
async function commitGradeAnimated(quality, direction) {
  if (!state.current || !state.currentSrs || state.animating) return;
  state.animating = true;

  const stack = document.getElementById("card-stack");
  if (stack) {
    stack.classList.remove("is-dragging", "show-got-it", "show-missed");
    stack.style.transform = "";
    stack.classList.add(direction === "right" ? "fly-right" : "fly-left");
    await wait(FLY_MS);
  }

  const now = Date.now();
  const updated = applyGrade(state.currentSrs, quality, now);
  state.store.cards[state.current.id] = updated;
  state.currentSrs = updated;
  persistSrs();

  state.stats.reviews += 1;
  if (quality === 1) {
    state.stats.wrong += 1;
    state.stats.streak = 0;
  } else {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
  }
  saveSessionStats();

  state.animating = false;
  nextRound();
}

/** Swipe right / Got it → Good (or the quality from a correct MC/type answer). */
function gradeGotIt() {
  const quality = /** @type {1|2|3|4} */ (
    state.lastResult?.correct ? state.lastResult.quality : 3
  );
  commitGradeAnimated(quality, "right");
}

/** Swipe left / Missed → Again */
function gradeMissed() {
  commitGradeAnimated(1, "left");
}

function flipCard() {
  if (state.animating) return;
  state.flipped = !state.flipped;
  const card = document.getElementById("flip-card");
  if (card) {
    card.classList.toggle("is-flipped", state.flipped);
  }
  updateFooterHint();
  // Sync optional aria / grade strip visibility without full re-render
  const gradeStrip = document.getElementById("grade-strip");
  if (gradeStrip) {
    gradeStrip.hidden = !state.flipped;
  }
  const frontActions = document.getElementById("front-actions");
  if (frontActions) {
    // keep flip button usable
  }
}

function updateFooterHint() {
  if (!els.footerHint) return;
  if (state.flipped) {
    els.footerHint.innerHTML =
      "Swipe <strong>← Missed</strong> · <strong>Got it →</strong> · or use buttons";
  } else {
    els.footerHint.innerHTML =
      "Tap <strong>Flip</strong> · swipe after reveal · mastery sets quiz type";
  }
}

/* --------------------------------------------------------------------------
   Answer handlers (mastery input on front)
   -------------------------------------------------------------------------- */

function onMcAnswer(memberId) {
  if (state.answered || !state.current || !state.inputConfig || state.animating) return;
  state.answered = true;
  state.selectedId = memberId;

  const correct = memberId === state.current.id;
  const quality = /** @type {1|2|3|4} */ (
    correct ? state.inputConfig.gradeOnCorrect : state.inputConfig.gradeOnWrong
  );
  state.lastResult = { correct, quality };

  // Paint MC result, then flip to definition
  document.querySelectorAll(".choice").forEach((btn) => {
    const id = btn.getAttribute("data-id");
    btn.setAttribute("disabled", "true");
    if (id === state.current.id) btn.classList.add("correct");
    else if (id === memberId && !correct) btn.classList.add("wrong");
  });

  const fb = document.getElementById("front-feedback");
  if (fb) {
    fb.className = `feedback ${correct ? "ok" : "bad"}`;
    fb.textContent = correct ? "Correct — flip or swipe Got it →" : "Missed — flip or swipe ←";
  }

  // Auto-flip to back so user can confirm + swipe
  if (!state.flipped) {
    setTimeout(() => {
      state.flipped = true;
      document.getElementById("flip-card")?.classList.add("is-flipped");
      const gradeStrip = document.getElementById("grade-strip");
      if (gradeStrip) gradeStrip.hidden = false;
      updateFooterHint();
    }, 280);
  }
}

function onTypeSubmit(typed) {
  if (state.answered || !state.current || !state.inputConfig || state.animating) return;
  state.answered = true;

  const mode = state.inputConfig.type === "type-last" ? "type-last" : "type-full";
  const correct = gradeTypedAnswer(typed, state.current, mode);
  const quality = /** @type {1|2|3|4} */ (
    correct ? state.inputConfig.gradeOnCorrect : state.inputConfig.gradeOnWrong
  );
  state.lastResult = { correct, quality, typed };

  const fb = document.getElementById("front-feedback");
  if (fb) {
    fb.className = `feedback ${correct ? "ok" : "bad"}`;
    fb.textContent = correct ? "Correct — flip or swipe Got it →" : "Missed — flip or swipe ←";
  }

  const input = document.getElementById("type-input");
  if (input) input.setAttribute("disabled", "true");

  if (!state.flipped) {
    setTimeout(() => {
      state.flipped = true;
      document.getElementById("flip-card")?.classList.add("is-flipped");
      const gradeStrip = document.getElementById("grade-strip");
      if (gradeStrip) gradeStrip.hidden = false;
      updateFooterHint();
    }, 280);
  }
}

/* --------------------------------------------------------------------------
   Touch / pointer swipe
   -------------------------------------------------------------------------- */

function isInteractiveTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  return Boolean(
    el.closest("button, a, input, textarea, select, label, .quiz-panel, .grade-mini")
  );
}

function bindCardGestures(stack) {
  // Pointer Events cover modern mobile + desktop. Fall back to touch* for older WebViews.
  if ("PointerEvent" in window) {
    stack.addEventListener("pointerdown", onPointerDown);
    stack.addEventListener("pointermove", onPointerMove);
    stack.addEventListener("pointerup", onPointerUp);
    stack.addEventListener("pointercancel", onPointerUp);
    return;
  }

  stack.addEventListener("touchstart", onTouchStart, { passive: true });
  stack.addEventListener("touchmove", onTouchMove, { passive: false });
  stack.addEventListener("touchend", onTouchEnd);
  stack.addEventListener("touchcancel", onTouchEnd);
}

function onPointerDown(e) {
  if (state.animating || e.button === 2) return;
  if (isInteractiveTarget(e.target)) return;
  const stack = document.getElementById("card-stack");
  if (!stack) return;

  gesture.active = true;
  gesture.pointerId = e.pointerId;
  gesture.startX = e.clientX;
  gesture.startY = e.clientY;
  gesture.dx = 0;
  gesture.dy = 0;
  gesture.target = stack;
  stack.classList.add("is-dragging");
  try {
    stack.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function onPointerMove(e) {
  if (!gesture.active || e.pointerId !== gesture.pointerId || !gesture.target) return;
  gesture.dx = e.clientX - gesture.startX;
  gesture.dy = e.clientY - gesture.startY;

  // Only track mostly-horizontal drags
  if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) return;
  if (Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35) return;

  e.preventDefault();
  applyDragVisual(gesture.target, gesture.dx);
}

function onPointerUp(e) {
  if (!gesture.active || (gesture.pointerId != null && e.pointerId !== gesture.pointerId)) return;
  finishGesture();
}

function onTouchStart(e) {
  if (state.animating || !e.changedTouches?.length) return;
  if (isInteractiveTarget(e.target)) return;
  const t = e.changedTouches[0];
  const stack = document.getElementById("card-stack");
  if (!stack) return;
  // If pointer events already handling, skip duplicate
  if (window.PointerEvent && gesture.active) return;

  gesture.active = true;
  gesture.pointerId = null;
  gesture.startX = t.clientX;
  gesture.startY = t.clientY;
  gesture.dx = 0;
  gesture.dy = 0;
  gesture.target = stack;
  stack.classList.add("is-dragging");
}

function onTouchMove(e) {
  if (!gesture.active || !gesture.target || !e.touches?.length) return;
  if (window.PointerEvent && gesture.pointerId != null) return;

  const t = e.touches[0];
  gesture.dx = t.clientX - gesture.startX;
  gesture.dy = t.clientY - gesture.startY;

  if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) return;
  if (Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35) return;

  e.preventDefault(); // keep page from scrolling while swiping card
  applyDragVisual(gesture.target, gesture.dx);
}

function onTouchEnd() {
  if (!gesture.active) return;
  if (window.PointerEvent && gesture.pointerId != null) return;
  finishGesture();
}

/**
 * @param {HTMLElement} stack
 * @param {number} dx
 */
function applyDragVisual(stack, dx) {
  const rot = Math.max(-SWIPE_MAX_ROTATE, Math.min(SWIPE_MAX_ROTATE, dx / 18));
  stack.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
  stack.classList.toggle("show-got-it", dx > SWIPE_THRESHOLD_PX * 0.55);
  stack.classList.toggle("show-missed", dx < -SWIPE_THRESHOLD_PX * 0.55);
}

function finishGesture() {
  const stack = gesture.target;
  const dx = gesture.dx;
  gesture.active = false;
  gesture.pointerId = null;
  gesture.target = null;

  if (!stack) return;
  stack.classList.remove("is-dragging", "show-got-it", "show-missed");

  if (dx >= SWIPE_THRESHOLD_PX) {
    gradeGotIt();
    return;
  }
  if (dx <= -SWIPE_THRESHOLD_PX) {
    gradeMissed();
    return;
  }

  // Snap back
  stack.style.transition = `transform 0.22s ease`;
  stack.style.transform = "";
  setTimeout(() => {
    if (stack) stack.style.transition = "";
  }, 220);
}

/* --------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */

function renderChoices(config) {
  if (config.type === "type-last" || config.type === "type-full") {
    const placeholder =
      config.type === "type-last" ? "Last name" : "Full name (e.g. Jane Smith)";
    const disabled = state.answered ? "disabled" : "";
    return `
      <form class="type-form" id="type-form" autocomplete="off">
        <label class="sr-only" for="type-input">Answer</label>
        <input
          id="type-input"
          class="type-input"
          type="text"
          name="answer"
          ${disabled}
          placeholder="${escapeHtml(placeholder)}"
          autocapitalize="words"
          spellcheck="false"
          autocomplete="off"
          enterkeyhint="done"
        />
        <button type="submit" class="btn primary" ${disabled}>Check</button>
      </form>
    `;
  }

  return `
    <div class="choices">
      ${state.choices
        .map((m, i) => {
          let cls = "choice";
          if (state.answered) {
            if (m.id === state.current.id) cls += " correct";
            else if (m.id === state.selectedId) cls += " wrong";
          }
          return `
            <button type="button" class="${cls}" data-id="${escapeHtml(m.id)}" ${state.answered ? "disabled" : ""}>
              <span class="key">${i + 1}</span>
              <span class="choice-body">
                <div class="choice-title">${escapeHtml(m.name)}</div>
                <div class="choice-meta">${escapeHtml(memberMeta(m))}</div>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderGradeStrip() {
  const card = state.currentSrs;
  if (!card) return "";
  const now = Date.now();
  const suggested = state.lastResult?.quality ?? 3;
  const grades = [
    { q: 1, label: "Again", cls: "grade-again" },
    { q: 2, label: "Hard", cls: "grade-hard" },
    { q: 3, label: "Good", cls: "grade-good" },
    { q: 4, label: "Easy", cls: "grade-easy" },
  ];

  return `
    <div class="grade-mini" id="grade-strip" ${state.flipped ? "" : "hidden"}>
      ${grades
        .map((g) => {
          const ms = previewIntervalMs(card, /** @type {1|2|3|4} */ (g.q), now);
          const active = g.q === suggested ? " suggested" : "";
          return `
            <button type="button" class="grade-btn ${g.cls}${active}" data-quality="${g.q}">
              <span class="grade-label">${g.label}</span>
              <span class="grade-interval">${formatInterval(ms)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

/**
 * @param {{ dropIn?: boolean }} [opts]
 */
function renderRound(opts = {}) {
  const member = state.current;
  const config = state.inputConfig;
  if (!member || !config) return;

  const badge = `${masteryLabel(config.level)} · ${inputTypeLabel(config)}`;
  const hint = config.showDistrictHint
    ? `<p class="prompt-hint">${escapeHtml(member.chamber)} · District ${member.district}</p>`
    : `<p class="prompt-hint">Who is this?</p>`;

  const srs = state.currentSrs;
  const srsLine = srs
    ? `${srs.state} · ivl ${srs.interval || 0}d · ef ${srs.ease.toFixed(2)}`
    : "";

  const question =
    config.type === "type-last"
      ? "Type their last name"
      : config.type === "type-full"
        ? "Type their full name"
        : "Select the correct name";

  els.stage.innerHTML = `
    <div class="card-stack${opts.dropIn ? " drop-in" : ""}" id="card-stack">
      <div class="swipe-hint missed" aria-hidden="true">Missed</div>
      <div class="swipe-hint got-it" aria-hidden="true">Got it</div>

      <div class="flip-scene">
        <div class="flip-card${state.flipped ? " is-flipped" : ""}" id="flip-card">
          <!-- FRONT: prompt / quiz -->
          <div class="flip-face front">
            <div class="face-body">
              <span class="prompt-badge">${escapeHtml(badge)}</span>
              <div class="photo-frame">
                <img src="${escapeHtml(member.photo)}" alt="Legislator portrait" draggable="false" referrerpolicy="no-referrer" />
              </div>
              ${hint}
              <div class="quiz-panel">
                <p class="question">${escapeHtml(question)}</p>
                ${renderChoices(config)}
                <p class="feedback" id="front-feedback"></p>
              </div>
            </div>
            <div class="face-actions" id="front-actions">
              <button type="button" class="btn grow primary" id="btn-flip">Flip</button>
            </div>
          </div>

          <!-- BACK: definition / answer -->
          <div class="flip-face back">
            <div class="face-body">
              <span class="prompt-badge">Answer</span>
              <div class="photo-frame large">
                <img src="${escapeHtml(member.photo)}" alt="" draggable="false" referrerpolicy="no-referrer" />
              </div>
              <h2 class="face-title">${escapeHtml(chamberLabel(member))} ${escapeHtml(member.name)}</h2>
              <p class="face-meta">${escapeHtml(memberMeta(member))}</p>
              <p class="srs-line">${escapeHtml(srsLine)}</p>
              <p class="face-sub"><a href="${escapeHtml(member.url)}" target="_blank" rel="noopener">Official page ↗</a></p>
            </div>
            ${renderGradeStrip()}
            <div class="face-actions">
              <button type="button" class="btn missed grow" id="btn-missed">← Missed</button>
              <button type="button" class="btn" id="btn-flip-back">Flip</button>
              <button type="button" class="btn got-it grow" id="btn-got-it">Got it →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  updateFooterHint();
  wireRoundHandlers();
}

function wireRoundHandlers() {
  const stack = document.getElementById("card-stack");
  if (stack) bindCardGestures(stack);

  document.getElementById("btn-flip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.flipped) flipCard();
  });
  document.getElementById("btn-flip-back")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.flipped) flipCard();
  });
  document.getElementById("btn-got-it")?.addEventListener("click", (e) => {
    e.stopPropagation();
    gradeGotIt();
  });
  document.getElementById("btn-missed")?.addEventListener("click", (e) => {
    e.stopPropagation();
    gradeMissed();
  });

  els.stage.querySelectorAll(".choice").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onMcAnswer(btn.getAttribute("data-id"));
    });
  });

  const form = document.getElementById("type-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById("type-input");
      onTypeSubmit(input ? /** @type {HTMLInputElement} */ (input).value : "");
    });
  }

  els.stage.querySelectorAll("[data-quality]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const q = Number(btn.getAttribute("data-quality"));
      if (q >= 1 && q <= 4) {
        const dir = q === 1 ? "left" : "right";
        commitGradeAnimated(/** @type {1|2|3|4} */ (q), dir);
      }
    });
  });
}

function renderCaughtUp() {
  const nextNew = state.pool.find((m) => {
    const c = state.store.cards[m.id];
    return !c || c.state === "new";
  });
  const upcoming = state.pool
    .map((m) => state.store.cards[m.id])
    .filter((c) => c && c.state !== "new" && c.due > Date.now())
    .sort((a, b) => a.due - b.due);
  const nextDue = upcoming[0];
  const nextDueIn = nextDue ? formatInterval(nextDue.due - Date.now()) : "—";

  els.stage.innerHTML = `
    <div class="caught-up">
      <h2>You're caught up</h2>
      <p>No cards due right now. Weak cards return on short steps; mastered ones stay out longer.</p>
      <ul class="caught-up-stats">
        <li><strong>${state.counts.mature}</strong> mature</li>
        <li><strong>${state.counts.newTotal}</strong> not introduced</li>
        <li><strong>${state.counts.newRemainingToday}</strong> new slots today</li>
        <li>Next review in <strong>${escapeHtml(nextDueIn)}</strong></li>
      </ul>
      <div class="face-actions" style="border:0;background:transparent;padding:0">
        ${
          state.counts.newRemainingToday > 0 && nextNew
            ? `<button type="button" class="btn primary grow" id="btn-study-ahead-new">Study next new</button>`
            : ""
        }
        ${
          upcoming.length
            ? `<button type="button" class="btn grow" id="btn-study-ahead-review">Study ahead</button>`
            : ""
        }
      </div>
    </div>
  `;

  document.getElementById("btn-study-ahead-new")?.addEventListener("click", () => {
    if (nextNew) presentMember(nextNew, { dropIn: true });
  });
  document.getElementById("btn-study-ahead-review")?.addEventListener("click", () => {
    const m = nextDue && state.pool.find((x) => x.id === nextDue.id);
    if (m) presentMember(m, { dropIn: true });
  });
}

/* --------------------------------------------------------------------------
   Global chrome
   -------------------------------------------------------------------------- */

function wireControls() {
  document.querySelectorAll("[data-chamber]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-chamber]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chamber = btn.getAttribute("data-chamber") || "all";
      nextRound();
    });
  });

  els.reset.addEventListener("click", () => {
    if (!confirm("Reset all spaced-repetition progress? Every card returns to New.")) return;
    state.store = { cards: {}, newDay: "", newIntroducedToday: 0 };
    persistSrs();
    state.stats = { reviews: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0 };
    saveSessionStats();
    nextRound();
  });

  window.addEventListener("keydown", (e) => {
    const tag = e.target && /** @type {HTMLElement} */ (e.target).tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA";
    if (typing || state.animating) return;

    if (e.key === " " || e.key === "f" || e.key === "F") {
      e.preventDefault();
      flipCard();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      gradeGotIt();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      gradeMissed();
      return;
    }

    if (state.flipped) {
      const map = { 1: 1, 2: 2, 3: 3, 4: 4, a: 1, A: 1, h: 2, H: 2, g: 3, G: 3, e: 4, E: 4 };
      if (map[e.key]) {
        e.preventDefault();
        const q = /** @type {1|2|3|4} */ (map[e.key]);
        commitGradeAnimated(q, q === 1 ? "left" : "right");
        return;
      }
    }

    if (!state.answered && !state.flipped && state.inputConfig?.type === "mc") {
      const num = Number(e.key);
      if (num >= 1 && num <= state.choices.length) {
        e.preventDefault();
        onMcAnswer(state.choices[num - 1].id);
      }
    }
  });
}

async function init() {
  wireControls();

  try {
    const res = await fetch("data/members.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load members.json (${res.status})`);
    const data = await res.json();
    state.members = (data.members || [])
      .filter((m) => m && m.name && m.photo)
      .sort(memberOrder);

    const meta = data.meta || {};
    if (els.dataMeta) {
      els.dataMeta.textContent = `${meta.totalCount ?? state.members.length} members · SM-2 · ${meta.scrapedAt ?? ""}`;
    }

    if (state.members.length < 2) throw new Error("Member dataset incomplete.");

    ensureCards(state.store, state.members);
    persistSrs();
    nextRound();
  } catch (err) {
    console.error(err);
    els.stage.innerHTML = `<div class="error">Could not load member data.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

init();

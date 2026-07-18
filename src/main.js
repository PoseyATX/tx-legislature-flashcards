/**
 * Texas Legislature Flash Cards — SM-2 spaced repetition study session.
 */

import {
  applyGrade,
  buildQueue,
  ensureCards,
  formatInterval,
  inputConfigForCard,
  loadStore,
  masteryLabel,
  masteryLevel,
  markIntroduced,
  memberOrder,
  normalizeCard,
  previewIntervalMs,
  saveStore,
  STATS_KEY,
} from "./srs.js";

/** @typedef {{ id: string, name: string, chamber: 'House'|'Senate', district: number, photo: string, url: string, party: string|null }} Member */

const state = {
  members: /** @type {Member[]} */ ([]),
  pool: /** @type {Member[]} */ ([]),
  store: loadStore(),
  queue: /** @type {string[]} */ ([]),
  queueIndex: 0,
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
  answered: false,
  revealed: false,
  lastResult: /** @type {null | { correct: boolean, quality: 1|2|3|4, typed?: string }} */ (null),
  stats: loadSessionStats(),
};

const els = {
  stage: document.getElementById("stage"),
  due: document.getElementById("stat-due"),
  learning: document.getElementById("stat-learning"),
  newCards: document.getElementById("stat-new"),
  mature: document.getElementById("stat-mature"),
  dataMeta: document.getElementById("data-meta"),
  reset: document.getElementById("btn-reset"),
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
  state.queueIndex = 0;
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

/** Distractors only — choice order may shuffle; card selection never does. */
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
  // Prefer "Last, First" sort key if present as Last first
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
    if (t === last) return true;
    // accept full name too
    if (t === full) return true;
    // "First Last" with correct last
    if (t.endsWith(` ${last}`) || t.startsWith(`${last} `)) return true;
    return false;
  }

  // type-full: full name or First Last order
  if (t === full) return true;
  if (first && t === `${first} ${last}`) return true;
  if (first && t === `${last} ${first}`) return true;
  // tolerate missing middle initials: last name + first token match
  const tokens = t.split(" ");
  if (tokens.length >= 2 && tokens[tokens.length - 1] === last) {
    if (first && tokens[0] === first.split(" ")[0]) return true;
  }
  return false;
}

function nextRound() {
  refreshQueue();

  if (state.pool.length < 2) {
    els.stage.innerHTML = `<div class="error">Not enough members in this chamber filter to study.</div>`;
    return;
  }

  if (state.queue.length === 0) {
    renderCaughtUp();
    return;
  }

  const id = state.queue[0];
  const member = state.pool.find((m) => m.id === id) || state.members.find((m) => m.id === id);
  if (!member) {
    // stale id
    delete state.store.cards[id];
    persistSrs();
    nextRound();
    return;
  }

  let srs = normalizeCard(state.store.cards[member.id] || { id: member.id });
  markIntroduced(state.store, srs, Date.now());
  state.store.cards[member.id] = srs;
  persistSrs();

  const config = inputConfigForCard(srs);
  state.current = member;
  state.currentSrs = srs;
  state.inputConfig = config;
  state.answered = false;
  state.revealed = false;
  state.lastResult = null;

  if (config.type === "mc") {
    const n = Math.min(config.choiceCount, state.pool.length);
    const distractors = pickDistractors(n - 1, member.id);
    state.choices = shuffle([member, ...distractors]);
  } else {
    state.choices = [];
  }

  renderRound();
}

/**
 * @param {1|2|3|4} quality
 */
function commitGrade(quality) {
  if (!state.current || !state.currentSrs) return;

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

  nextRound();
}

function onMcAnswer(memberId) {
  if (state.answered || !state.current || !state.inputConfig) return;
  state.answered = true;
  state.revealed = true;

  const correct = memberId === state.current.id;
  const quality = /** @type {1|2|3|4} */ (
    correct ? state.inputConfig.gradeOnCorrect : state.inputConfig.gradeOnWrong
  );
  state.lastResult = { correct, quality };
  renderRound({ selectedId: memberId, wasCorrect: correct });
}

function onTypeSubmit(typed) {
  if (state.answered || !state.current || !state.inputConfig) return;
  state.answered = true;
  state.revealed = true;

  const mode = state.inputConfig.type === "type-last" ? "type-last" : "type-full";
  const correct = gradeTypedAnswer(typed, state.current, mode);
  const quality = /** @type {1|2|3|4} */ (
    correct ? state.inputConfig.gradeOnCorrect : state.inputConfig.gradeOnWrong
  );
  state.lastResult = { correct, quality, typed };
  renderRound({ selectedId: null, wasCorrect: correct });
}

function revealAnswer() {
  if (!state.current || !state.inputConfig) return;
  if (!state.answered) {
    state.answered = true;
    state.lastResult = { correct: false, quality: 1 };
  }
  state.revealed = true;
  renderRound({ selectedId: null, wasCorrect: false, revealedOnly: true });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPrompt(member, config) {
  const level = config.level;
  const badge = `${masteryLabel(level)} · ${inputTypeLabel(config)}`;

  let hint = "";
  if (config.showDistrictHint) {
    hint = `<p class="prompt-hint">${escapeHtml(member.chamber)} · District ${member.district}</p>`;
  }

  return `
    <div class="prompt-pane">
      <span class="prompt-badge">${escapeHtml(badge)}</span>
      <div class="photo-frame">
        <img src="${escapeHtml(member.photo)}" alt="Official portrait of a Texas legislator" loading="eager" referrerpolicy="no-referrer" />
      </div>
      ${hint}
    </div>
  `;
}

function inputTypeLabel(config) {
  if (config.type === "mc") return `${config.choiceCount}-choice`;
  if (config.type === "type-last") return "Type last name";
  if (config.type === "type-full") return "Type full name";
  return "Recall";
}

function questionText(config) {
  if (config.type === "type-last") return "Type their last name:";
  if (config.type === "type-full") return "Type their full name:";
  return "Select the correct name:";
}

function renderChoices(selectedId, config) {
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
            else if (m.id === selectedId) cls += " wrong";
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

/**
 * Anki-style grade buttons with interval previews.
 * @param {1|2|3|4} suggested
 */
function renderGradeButtons(suggested) {
  const card = state.currentSrs;
  if (!card) return "";

  const now = Date.now();
  const grades = [
    { q: 1, label: "Again", cls: "grade-again" },
    { q: 2, label: "Hard", cls: "grade-hard" },
    { q: 3, label: "Good", cls: "grade-good" },
    { q: 4, label: "Easy", cls: "grade-easy" },
  ];

  return `
    <div class="grade-panel" role="group" aria-label="Spaced repetition grade">
      <p class="grade-hint">How well did you know this? Suggested: <strong>${grades.find((g) => g.q === suggested)?.label || "Good"}</strong></p>
      <div class="grade-buttons">
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
    </div>
  `;
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
      <p>No cards are due right now in this chamber filter. Spaced repetition pushed known cards further out so weak ones get priority when they return.</p>
      <ul class="caught-up-stats">
        <li><strong>${state.counts.mature}</strong> mature (21d+ interval)</li>
        <li><strong>${state.counts.newTotal}</strong> not yet introduced</li>
        <li><strong>${state.counts.newRemainingToday}</strong> new card slots left today</li>
        <li>Next review in <strong>${escapeHtml(nextDueIn)}</strong></li>
      </ul>
      <div class="actions">
        ${
          state.counts.newRemainingToday > 0 && nextNew
            ? `<button type="button" class="btn primary" id="btn-study-ahead-new">Study next new card</button>`
            : ""
        }
        ${
          upcoming.length
            ? `<button type="button" class="btn" id="btn-study-ahead-review">Study ahead (next due)</button>`
            : ""
        }
      </div>
      <p class="caught-up-note">New cards introduce in fixed order (House by district, then Senate). Wrong answers re-enter short learning steps (1m → 10m); mastered cards jump days ahead.</p>
    </div>
  `;

  const newBtn = document.getElementById("btn-study-ahead-new");
  if (newBtn && nextNew) {
    newBtn.addEventListener("click", () => {
      // Force-queue the next new card without counting extra if already counted
      state.queue = [nextNew.id];
      state.queueIndex = 0;
      // Temporarily treat as available
      const srs = normalizeCard(state.store.cards[nextNew.id] || { id: nextNew.id });
      state.store.cards[nextNew.id] = srs;
      // Bypass empty queue by calling internal present
      presentMember(nextNew);
    });
  }

  const reviewBtn = document.getElementById("btn-study-ahead-review");
  if (reviewBtn && nextDue) {
    reviewBtn.addEventListener("click", () => {
      const m = state.pool.find((x) => x.id === nextDue.id);
      if (m) presentMember(m);
    });
  }
}

function presentMember(member) {
  let srs = normalizeCard(state.store.cards[member.id] || { id: member.id });
  markIntroduced(state.store, srs, Date.now());
  state.store.cards[member.id] = srs;
  persistSrs();

  const config = inputConfigForCard(srs);
  state.current = member;
  state.currentSrs = srs;
  state.inputConfig = config;
  state.answered = false;
  state.revealed = false;
  state.lastResult = null;

  if (config.type === "mc") {
    const n = Math.min(config.choiceCount, state.pool.length);
    const distractors = pickDistractors(n - 1, member.id);
    state.choices = shuffle([member, ...distractors]);
  } else {
    state.choices = [];
  }

  refreshQueueCountsOnly();
  renderRound();
}

function refreshQueueCountsOnly() {
  rebuildPool();
  ensureCards(state.store, state.pool);
  const built = buildQueue(state.store, state.pool, Date.now());
  state.counts = built.counts;
  updateScoreboard();
}

/**
 * @param {{ selectedId?: string|null, wasCorrect?: boolean, revealedOnly?: boolean }} [opts]
 */
function renderRound(opts = {}) {
  const member = state.current;
  const config = state.inputConfig;
  if (!member || !config) return;

  const suggested = state.lastResult?.quality ?? 3;

  const feedback =
    state.answered && !opts.revealedOnly
      ? opts.wasCorrect
        ? `<div class="feedback ok">Correct — grade to schedule the next review.</div>`
        : `<div class="feedback bad">Not quite — this card will return soon (Again).</div>`
      : state.revealed
        ? `<div class="feedback">Answer shown — grade this card to continue.</div>`
        : `<div class="feedback"></div>`;

  const srs = state.currentSrs;
  const srsLine = srs
    ? `Interval ${srs.interval || 0}d · Ease ${srs.ease.toFixed(2)} · ${srs.state} · reps ${srs.reps}`
    : "";

  const reveal = `
    <div class="reveal ${state.revealed ? "show" : ""}">
      <img class="reveal-photo" src="${escapeHtml(member.photo)}" alt="" referrerpolicy="no-referrer" />
      <div class="reveal-copy">
        <h3>${escapeHtml(chamberLabel(member))} ${escapeHtml(member.name)}</h3>
        <p>${escapeHtml(memberMeta(member))}</p>
        <p class="srs-line">${escapeHtml(srsLine)}</p>
        <p><a href="${escapeHtml(member.url)}" target="_blank" rel="noopener">Official member page ↗</a></p>
      </div>
    </div>
  `;

  els.stage.innerHTML = `
    <article class="card" aria-live="polite">
      ${renderPrompt(member, config)}
      <div class="answer-pane">
        <p class="question">${questionText(config)}</p>
        ${renderChoices(opts.selectedId ?? null, config)}
        ${feedback}
        ${reveal}
        ${
          state.answered
            ? renderGradeButtons(/** @type {1|2|3|4} */ (suggested))
            : `<div class="actions">
                <button type="button" class="btn" id="btn-reveal">Reveal / Again</button>
              </div>`
        }
      </div>
    </article>
  `;

  els.stage.querySelectorAll(".choice").forEach((btn) => {
    btn.addEventListener("click", () => onMcAnswer(btn.getAttribute("data-id")));
  });

  const form = document.getElementById("type-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("type-input");
      onTypeSubmit(input ? input.value : "");
    });
    const input = document.getElementById("type-input");
    if (input && !state.answered) {
      queueMicrotask(() => input.focus());
    }
  }

  const revealBtn = document.getElementById("btn-reveal");
  if (revealBtn) revealBtn.addEventListener("click", revealAnswer);

  els.stage.querySelectorAll("[data-quality]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = Number(btn.getAttribute("data-quality"));
      if (q >= 1 && q <= 4) commitGrade(/** @type {1|2|3|4} */ (q));
    });
  });
}

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
    if (
      !confirm(
        "Reset all spaced-repetition progress and session stats? Every card returns to New."
      )
    ) {
      return;
    }
    state.store = { cards: {}, newDay: "", newIntroducedToday: 0 };
    persistSrs();
    state.stats = { reviews: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0 };
    saveSessionStats();
    nextRound();
  });

  window.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA";

    if (!typing && state.answered) {
      if (e.key === "Enter") {
        e.preventDefault();
        const suggested = /** @type {1|2|3|4} */ (state.lastResult?.quality ?? 3);
        commitGrade(suggested);
        return;
      }
      const map = { 1: 1, 2: 2, 3: 3, 4: 4 };
      if (map[e.key]) {
        e.preventDefault();
        commitGrade(/** @type {1|2|3|4} */ (map[e.key]));
        return;
      }
      // shortcuts A H G E
      const letter = {
        a: 1,
        A: 1,
        h: 2,
        H: 2,
        g: 3,
        G: 3,
        e: 4,
        E: 4,
      };
      if (letter[e.key]) {
        e.preventDefault();
        commitGrade(/** @type {1|2|3|4} */ (letter[e.key]));
        return;
      }
    }

    if (typing) return;

    if (e.key === " " && !state.answered) {
      e.preventDefault();
      revealAnswer();
      return;
    }

    if (!state.answered && state.inputConfig?.type === "mc") {
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
    els.dataMeta.textContent = `${meta.totalCount ?? state.members.length} members · SM-2 SRS · scraped ${meta.scrapedAt ?? "unknown"}`;

    if (state.members.length < 2) {
      throw new Error("Member dataset is empty or incomplete.");
    }

    ensureCards(state.store, state.members);
    persistSrs();
    nextRound();
  } catch (err) {
    console.error(err);
    els.stage.innerHTML = `<div class="error">Could not load member data.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

init();

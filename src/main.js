/**
 * Texas Legislature Flash Cards
 * Educational quiz using official House & Senate member directories.
 */

const STORAGE_KEY = "tx-leg-flashcards-stats-v1";

/** @typedef {{ id: string, name: string, chamber: 'House'|'Senate', district: number, photo: string, url: string, party: string|null }} Member */

const state = {
  members: /** @type {Member[]} */ ([]),
  pool: /** @type {Member[]} */ ([]),
  current: /** @type {Member|null} */ (null),
  choices: /** @type {Member[]} */ ([]),
  chamber: "all",
  mode: "photo-to-name",
  choiceCount: 4,
  answered: false,
  revealed: false,
  stats: loadStats(),
};

const els = {
  stage: document.getElementById("stage"),
  loading: document.getElementById("loading"),
  score: document.getElementById("stat-score"),
  streak: document.getElementById("stat-streak"),
  best: document.getElementById("stat-best"),
  seen: document.getElementById("stat-seen"),
  dataMeta: document.getElementById("data-meta"),
  reset: document.getElementById("btn-reset"),
};

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    return {
      correct: Number(parsed.correct) || 0,
      wrong: Number(parsed.wrong) || 0,
      streak: Number(parsed.streak) || 0,
      bestStreak: Number(parsed.bestStreak) || 0,
      seen: Number(parsed.seen) || 0,
    };
  } catch {
    return { correct: 0, wrong: 0, streak: 0, bestStreak: 0, seen: 0 };
  }
}

function saveStats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stats));
}

function updateScoreboard() {
  const { correct, wrong, streak, bestStreak, seen } = state.stats;
  els.score.textContent = String(correct - wrong);
  els.streak.textContent = String(streak);
  els.best.textContent = String(bestStreak);
  els.seen.textContent = String(seen);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN(arr, n, excludeId) {
  const filtered = arr.filter((m) => m.id !== excludeId);
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

function rebuildPool() {
  if (state.chamber === "all") {
    state.pool = [...state.members];
  } else {
    state.pool = state.members.filter((m) => m.chamber === state.chamber);
  }
}

function nextRound() {
  rebuildPool();
  if (state.pool.length < 2) {
    els.stage.innerHTML = `<div class="error">Not enough members in this chamber filter to run a quiz.</div>`;
    return;
  }

  const target = shuffle(state.pool)[0];
  const distractorCount = Math.min(state.choiceCount - 1, state.pool.length - 1);
  const distractors = pickN(state.pool, distractorCount, target.id);
  state.current = target;
  state.choices = shuffle([target, ...distractors]);
  state.answered = false;
  state.revealed = false;
  state.stats.seen += 1;
  saveStats();
  updateScoreboard();
  renderRound();
}

function onAnswer(memberId) {
  if (state.answered || !state.current) return;
  state.answered = true;
  state.revealed = true;

  const correct = memberId === state.current.id;
  if (correct) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
  } else {
    state.stats.wrong += 1;
    state.stats.streak = 0;
  }
  saveStats();
  updateScoreboard();
  renderRound({ selectedId: memberId, wasCorrect: correct });
}

function revealAnswer() {
  if (!state.current) return;
  if (!state.answered) {
    state.answered = true;
    state.stats.wrong += 1;
    state.stats.streak = 0;
    saveStats();
    updateScoreboard();
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

function renderPrompt(member) {
  if (state.mode === "photo-to-name") {
    return `
      <div class="prompt-pane">
        <span class="prompt-badge">Who is this?</span>
        <div class="photo-frame">
          <img src="${escapeHtml(member.photo)}" alt="Official portrait of a Texas legislator" loading="eager" referrerpolicy="no-referrer" />
        </div>
      </div>
    `;
  }

  if (state.mode === "name-to-photo") {
    return `
      <div class="prompt-pane">
        <span class="prompt-badge">Find their photo</span>
        <div class="name-prompt">
          <p class="big-name">${escapeHtml(chamberLabel(member))} ${escapeHtml(member.name)}</p>
          <p class="sub">${escapeHtml(member.chamber)} · District ${member.district}</p>
        </div>
      </div>
    `;
  }

  // district mode
  return `
    <div class="prompt-pane">
      <span class="prompt-badge">Who represents…</span>
      <div class="district-prompt">
        <span class="chamber-tag">${escapeHtml(member.chamber)}</span>
        <p class="district-num">${member.district}</p>
        <p class="district-label">District</p>
      </div>
    </div>
  `;
}

function renderChoices(selectedId) {
  if (state.mode === "name-to-photo") {
    return `
      <div class="choices photo-grid">
        ${state.choices
          .map((m, i) => {
            let cls = "choice photo-choice";
            if (state.answered) {
              if (m.id === state.current.id) cls += " correct";
              else if (m.id === selectedId) cls += " wrong";
            }
            return `
              <button type="button" class="${cls}" data-id="${escapeHtml(m.id)}" ${state.answered ? "disabled" : ""}>
                <img src="${escapeHtml(m.photo)}" alt="Choice ${i + 1}" loading="lazy" referrerpolicy="no-referrer" />
                <span class="key">${i + 1}</span>
                ${state.answered || state.revealed ? `<div class="choice-title">${escapeHtml(m.name)}</div>` : ""}
              </button>
            `;
          })
          .join("")}
      </div>
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

function questionText() {
  if (state.mode === "photo-to-name") return "Select the correct name:";
  if (state.mode === "name-to-photo") return "Select the correct photo:";
  return "Select the member for this district:";
}

/**
 * @param {{ selectedId?: string|null, wasCorrect?: boolean, revealedOnly?: boolean }} [opts]
 */
function renderRound(opts = {}) {
  const member = state.current;
  if (!member) return;

  const feedback =
    state.answered && !opts.revealedOnly
      ? opts.wasCorrect
        ? `<div class="feedback ok">Correct!</div>`
        : `<div class="feedback bad">Not quite — highlighted in green.</div>`
      : state.revealed
        ? `<div class="feedback">Answer revealed.</div>`
        : `<div class="feedback"></div>`;

  const reveal = `
    <div class="reveal ${state.revealed ? "show" : ""}">
      <img class="reveal-photo" src="${escapeHtml(member.photo)}" alt="" referrerpolicy="no-referrer" />
      <div class="reveal-copy">
        <h3>${escapeHtml(chamberLabel(member))} ${escapeHtml(member.name)}</h3>
        <p>${escapeHtml(memberMeta(member))}</p>
        <p><a href="${escapeHtml(member.url)}" target="_blank" rel="noopener">Official member page ↗</a></p>
      </div>
    </div>
  `;

  els.stage.innerHTML = `
    <article class="card" aria-live="polite">
      ${renderPrompt(member)}
      <div class="answer-pane">
        <p class="question">${questionText()}</p>
        ${renderChoices(opts.selectedId ?? null)}
        ${feedback}
        ${reveal}
        <div class="actions">
          ${
            state.answered
              ? `<button type="button" class="btn primary" id="btn-next">Next card</button>`
              : `<button type="button" class="btn" id="btn-reveal">Reveal answer</button>
                 <button type="button" class="btn" id="btn-skip">Skip</button>`
          }
        </div>
      </div>
    </article>
  `;

  els.stage.querySelectorAll(".choice").forEach((btn) => {
    btn.addEventListener("click", () => onAnswer(btn.getAttribute("data-id")));
  });

  const next = document.getElementById("btn-next");
  if (next) next.addEventListener("click", nextRound);

  const revealBtn = document.getElementById("btn-reveal");
  if (revealBtn) revealBtn.addEventListener("click", revealAnswer);

  const skip = document.getElementById("btn-skip");
  if (skip) skip.addEventListener("click", nextRound);
}

function wireControls() {
  document.querySelectorAll("[data-chamber]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-chamber]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chamber = btn.getAttribute("data-chamber");
      nextRound();
    });
  });

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.getAttribute("data-mode");
      nextRound();
    });
  });

  document.querySelectorAll("[data-choices]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-choices]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.choiceCount = Number(btn.getAttribute("data-choices"));
      nextRound();
    });
  });

  els.reset.addEventListener("click", () => {
    if (!confirm("Reset local score, streak, and seen count?")) return;
    state.stats = { correct: 0, wrong: 0, streak: 0, bestStreak: 0, seen: 0 };
    saveStats();
    updateScoreboard();
  });

  window.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      nextRound();
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (!state.answered) {
        e.preventDefault();
        revealAnswer();
      } else if (e.key === "Enter") {
        e.preventDefault();
        nextRound();
      }
      return;
    }
    const num = Number(e.key);
    if (num >= 1 && num <= state.choices.length && !state.answered) {
      e.preventDefault();
      onAnswer(state.choices[num - 1].id);
    }
  });
}

async function init() {
  updateScoreboard();
  wireControls();

  try {
    const res = await fetch("data/members.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load members.json (${res.status})`);
    const data = await res.json();
    state.members = (data.members || []).filter((m) => m && m.name && m.photo);

    const meta = data.meta || {};
    els.dataMeta.textContent = `${meta.totalCount ?? state.members.length} members · scraped ${meta.scrapedAt ?? "unknown"}`;

    if (state.members.length < 2) {
      throw new Error("Member dataset is empty or incomplete.");
    }

    nextRound();
  } catch (err) {
    console.error(err);
    els.stage.innerHTML = `<div class="error">Could not load member data.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

init();

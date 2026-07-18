/**
 * Capitol Rank · Streak · Combo · Confetti · Phantom Leaderboard
 * Self-contained; drop into any quiz UI via awardXP / registerCorrect / registerMiss.
 *
 * localStorage key: tx_leg_gamification
 */

export const GAMIFICATION_KEY = "tx_leg_gamification";

export const PLAYER_DISPLAY_NAME = "You";

/** @type {{ name: string, xp: number, phantom: true }[]} */
export const PHANTOM_OPPONENTS = [
  { name: "The Governor's Chief of Staff", xp: 7500, phantom: true },
  { name: "Senior Budget Analyst", xp: 4200, phantom: true },
  { name: "Anonymous Lobbyist", xp: 2100, phantom: true },
  { name: "Floor Parliamentarian", xp: 950, phantom: true },
  { name: "Freshman Rep's Intern", xp: 150, phantom: true },
];

/**
 * @typedef {object} GameState
 * @property {number} xp
 * @property {number} dayStreak
 * @property {number} combo
 * @property {number} bestCombo
 * @property {string} lastPlayDate  // YYYY-MM-DD local
 * @property {string} rankTitle
 */

/** @returns {string} */
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {string} ymd */
function parseDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * @param {number} xp
 * @returns {{ title: string, emoji: string, min: number, max: number|null }}
 */
export function getRankForXP(xp) {
  const n = Math.max(0, Number(xp) || 0);
  if (n <= 500) return { title: "Capitol Intern", emoji: "🐣", min: 0, max: 500 };
  if (n <= 1500) return { title: "Committee Clerk", emoji: "📋", min: 501, max: 1500 };
  if (n <= 3000) return { title: "Legislative Director", emoji: "👔", min: 1501, max: 3000 };
  if (n <= 6000) return { title: "Chief of Staff", emoji: "🏛️", min: 3001, max: 6000 };
  return { title: "Power Lobbyist", emoji: "💼", min: 6001, max: null };
}

export function formatRank(xp) {
  const r = getRankForXP(xp);
  return `${r.emoji} ${r.title}`;
}

/** @returns {GameState} */
export function defaultGameState() {
  return {
    xp: 0,
    dayStreak: 0,
    combo: 0,
    bestCombo: 0,
    lastPlayDate: "",
    rankTitle: formatRank(0),
  };
}

/** @returns {GameState} */
export function loadGameState() {
  try {
    const raw = localStorage.getItem(GAMIFICATION_KEY);
    if (!raw) return defaultGameState();
    const p = JSON.parse(raw);
    const xp = Math.max(0, Number(p.xp) || 0);
    return {
      xp,
      dayStreak: Math.max(0, Number(p.dayStreak) || 0),
      combo: Math.max(0, Number(p.combo) || 0),
      bestCombo: Math.max(0, Number(p.bestCombo) || 0),
      lastPlayDate: typeof p.lastPlayDate === "string" ? p.lastPlayDate : "",
      rankTitle: formatRank(xp),
    };
  } catch {
    return defaultGameState();
  }
}

/** @param {GameState} state */
export function saveGameState(state) {
  localStorage.setItem(
    GAMIFICATION_KEY,
    JSON.stringify({
      xp: state.xp,
      dayStreak: state.dayStreak,
      combo: state.combo,
      bestCombo: state.bestCombo,
      lastPlayDate: state.lastPlayDate,
      rankTitle: formatRank(state.xp),
    })
  );
}

/**
 * Touch day streak once per calendar day of activity.
 * @param {GameState} state
 * @returns {GameState}
 */
export function touchDayStreak(state) {
  const today = todayKey();
  if (state.lastPlayDate === today) return state;

  if (!state.lastPlayDate) {
    state.dayStreak = 1;
  } else {
    const prev = parseDay(state.lastPlayDate);
    const cur = parseDay(today);
    const diffDays = Math.round((cur - prev) / 86400000);
    state.dayStreak = diffDays === 1 ? state.dayStreak + 1 : 1;
  }
  state.lastPlayDate = today;
  return state;
}

/**
 * Award XP for a correct answer. Doubles at 5+ day streak.
 * @param {GameState} [state]
 * @returns {{ state: GameState, gained: number, rankedUp: boolean, prevRank: string, nextRank: string, comboHit: number|null }}
 */
export function awardXP(state = loadGameState()) {
  state = touchDayStreak({ ...state });
  const prevRank = formatRank(state.xp);

  const base = 10;
  const gained = state.dayStreak >= 5 ? base * 2 : base;
  state.xp += gained;
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.rankTitle = formatRank(state.xp);

  const nextRank = formatRank(state.xp);
  const rankedUp = prevRank !== nextRank;

  /** @type {number|null} */
  let comboHit = null;
  if (state.combo === 3 || state.combo === 5 || state.combo === 10 || (state.combo > 10 && state.combo % 5 === 0)) {
    comboHit = state.combo;
  }

  saveGameState(state);
  return { state, gained, rankedUp, prevRank, nextRank, comboHit };
}

/**
 * Miss / wrong answer — break combo, still count the day for streak.
 * @param {GameState} [state]
 * @returns {GameState}
 */
export function registerMiss(state = loadGameState()) {
  state = touchDayStreak({ ...state });
  state.combo = 0;
  state.rankTitle = formatRank(state.xp);
  saveGameState(state);
  return state;
}

/**
 * Inject player XP into phantom board, sort descending.
 * @param {number} [playerXP]
 * @param {string} [playerName]
 * @returns {{ name: string, xp: number, isPlayer: boolean, phantom?: boolean }[]}
 */
export function updateLeaderboard(playerXP, playerName = PLAYER_DISPLAY_NAME) {
  const xp = playerXP ?? loadGameState().xp;
  const rows = PHANTOM_OPPONENTS.map((o) => ({
    name: o.name,
    xp: o.xp,
    isPlayer: false,
    phantom: true,
  }));
  rows.push({ name: playerName, xp, isPlayer: true, phantom: false });
  rows.sort((a, b) => b.xp - a.xp || (a.isPlayer ? -1 : 1));
  return rows;
}

/* ==========================================================================
   Visual dopamine
   ========================================================================== */

/**
 * Floating combo text over a container (e.g. "#stack" or card).
 * @param {HTMLElement|null} host
 * @param {number} combo
 */
export function showComboToast(host, combo) {
  if (!host || !combo) return;
  const el = document.createElement("div");
  el.className = "combo-toast";
  el.setAttribute("aria-live", "polite");
  el.textContent = `${combo}X COMBO! 🔥`;
  host.appendChild(el);
  // force reflow for animation
  void el.offsetWidth;
  el.classList.add("is-on");
  setTimeout(() => {
    el.classList.remove("is-on");
    el.classList.add("is-off");
    setTimeout(() => el.remove(), 400);
  }, 1100);
}

/**
 * Brief XP float near host.
 * @param {HTMLElement|null} host
 * @param {number} amount
 */
export function showXPFloat(host, amount) {
  if (!host || !amount) return;
  const el = document.createElement("div");
  el.className = "xp-float";
  el.textContent = `+${amount} XP`;
  host.appendChild(el);
  void el.offsetWidth;
  el.classList.add("is-on");
  setTimeout(() => el.remove(), 900);
}

/**
 * Green glow pulse on correct.
 * @param {HTMLElement|null} el
 */
export function pulseCorrect(el) {
  if (!el) return;
  el.classList.remove("feedback-wrong", "feedback-correct");
  void el.offsetWidth;
  el.classList.add("feedback-correct");
  setTimeout(() => el.classList.remove("feedback-correct"), 520);
}

/**
 * Horizontal shake + optional button red flash on wrong.
 * @param {HTMLElement|null} cardEl
 * @param {HTMLElement|null} [buttonEl]
 */
export function pulseWrong(cardEl, buttonEl) {
  if (cardEl) {
    cardEl.classList.remove("feedback-wrong", "feedback-correct");
    void cardEl.offsetWidth;
    cardEl.classList.add("feedback-wrong");
    setTimeout(() => cardEl.classList.remove("feedback-wrong"), 450);
  }
  if (buttonEl) {
    buttonEl.classList.add("btn-wrong-flash");
    setTimeout(() => buttonEl.classList.remove("btn-wrong-flash"), 450);
  }
}

/**
 * Lightweight DOM confetti from bottom corners — ~2s, no libraries.
 * @param {number} [durationMs]
 */
export function triggerConfetti(durationMs = 2000) {
  let root = document.getElementById("confetti-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "confetti-root";
    root.className = "confetti-root";
    root.setAttribute("aria-hidden", "true");
    document.body.appendChild(root);
  }

  const colors = ["#d4af37", "#bf0a30", "#1f9d62", "#8ec5ff", "#f5f7fb", "#e85d04"];
  const shapes = ["square", "rect", "tri"];
  const count = 56;
  const end = Date.now() + durationMs;

  function spawnBurst(fromLeft) {
    for (let i = 0; i < count / 2; i += 1) {
      const p = document.createElement("span");
      const shape = shapes[i % shapes.length];
      p.className = `confetti-piece confetti-${shape}`;
      p.style.left = fromLeft ? `${4 + Math.random() * 18}%` : `${78 + Math.random() * 18}%`;
      p.style.bottom = "0";
      const color = colors[i % colors.length];
      if (shape === "tri") {
        p.style.borderBottomColor = color;
      } else {
        p.style.background = color;
      }
      p.style.setProperty("--dx", `${(fromLeft ? 1 : -1) * (40 + Math.random() * 120)}px`);
      p.style.setProperty("--dy", `${-(180 + Math.random() * 320)}px`);
      p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      p.style.setProperty("--delay", `${Math.random() * 0.25}s`);
      p.style.setProperty("--dur", `${1.2 + Math.random() * 0.9}s`);
      root.appendChild(p);
      setTimeout(() => p.remove(), 2200);
    }
  }

  spawnBurst(true);
  spawnBurst(false);

  // second wave mid-burst
  setTimeout(() => {
    if (Date.now() < end) {
      spawnBurst(true);
      spawnBurst(false);
    }
  }, 400);

  // rank-up banner
  const banner = document.createElement("div");
  banner.className = "rankup-banner";
  banner.innerHTML = `<span class="rankup-label">RANK UP</span>`;
  document.body.appendChild(banner);
  void banner.offsetWidth;
  banner.classList.add("is-on");
  setTimeout(() => {
    banner.classList.remove("is-on");
    setTimeout(() => banner.remove(), 350);
  }, 1800);
}

/**
 * Full correct-answer juice pipeline.
 * @param {{ host?: HTMLElement|null, card?: HTMLElement|null }} els
 * @returns {ReturnType<typeof awardXP>}
 */
export function onCorrectAnswer(els = {}) {
  const result = awardXP();
  pulseCorrect(els.card || els.host || null);
  showXPFloat(els.host || els.card || null, result.gained);
  if (result.comboHit) {
    showComboToast(els.host || els.card || null, result.comboHit);
  }
  if (result.rankedUp) {
    triggerConfetti(2000);
    // show new rank on banner
    const b = document.querySelector(".rankup-banner");
    if (b) {
      b.innerHTML = `<span class="rankup-label">RANK UP</span><span class="rankup-title">${escapeHtml(
        result.nextRank
      )}</span>`;
    }
  }
  return result;
}

/**
 * Full wrong-answer juice pipeline.
 * @param {{ card?: HTMLElement|null, button?: HTMLElement|null }} els
 */
export function onWrongAnswer(els = {}) {
  registerMiss();
  pulseWrong(els.card || null, els.button || null);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ==========================================================================
   Leaderboard UI
   ========================================================================== */

/**
 * Build sorted board with player injected.
 * @param {number} [playerXP]
 */
export function getLeaderboardRows(playerXP) {
  return updateLeaderboard(playerXP);
}

/**
 * Render overlay into #leaderboard-root (or create it).
 * @param {HTMLElement|null} [mount]
 * @param {GameState} [game]
 */
export function renderLeaderboard(mount, game = loadGameState()) {
  const root = mount || ensureLeaderboardRoot();
  const rows = updateLeaderboard(game.xp);
  const rank = formatRank(game.xp);

  root.innerHTML = `
    <div class="lb-backdrop" data-lb-close></div>
    <div class="lb-sheet" role="dialog" aria-labelledby="lb-title" aria-modal="true">
      <header class="lb-head">
        <div>
          <h2 id="lb-title">Capitol Leaderboard</h2>
          <p class="lb-sub">Phantom rivals · your XP is live</p>
        </div>
        <button type="button" class="lb-close" data-lb-close aria-label="Close">✕</button>
      </header>
      <div class="lb-you">
        <span class="lb-you-rank">${escapeHtml(rank)}</span>
        <span class="lb-you-xp">${game.xp.toLocaleString()} XP</span>
        <span class="lb-you-meta">🔥 ${game.dayStreak}d streak · combo ${game.combo}</span>
      </div>
      <ol class="lb-list">
        ${rows
          .map((row, i) => {
            const cls = row.isPlayer ? "lb-row is-you" : "lb-row";
            return `
              <li class="${cls}">
                <span class="lb-place">${i + 1}</span>
                <span class="lb-name">${escapeHtml(row.name)}</span>
                <span class="lb-xp">${row.xp.toLocaleString()} XP</span>
              </li>
            `;
          })
          .join("")}
      </ol>
      <p class="lb-foot">
        <button type="button" class="lb-reset" id="btn-reset-learning">Reset learned faces</button>
        <a class="kofi-link kofi-inline" href="https://ko-fi.com/poseyatx" target="_blank" rel="noopener noreferrer"
          >☕ buy me a ko-fi</a
        >
      </p>
    </div>
  `;

  root.hidden = false;
  root.classList.add("is-open");
  document.body.classList.add("lb-open");

  root.querySelectorAll("[data-lb-close]").forEach((el) => {
    el.addEventListener("click", () => closeLeaderboard(root));
  });
}

/** @param {HTMLElement|null} [root] */
export function closeLeaderboard(root) {
  const el = root || document.getElementById("leaderboard-root");
  if (!el) return;
  el.classList.remove("is-open");
  el.hidden = true;
  el.innerHTML = "";
  document.body.classList.remove("lb-open");
}

export function ensureLeaderboardRoot() {
  let root = document.getElementById("leaderboard-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "leaderboard-root";
    root.className = "leaderboard-root";
    root.hidden = true;
    document.body.appendChild(root);
  }
  return root;
}

/**
 * Paint compact HUD stats into existing elements.
 * @param {{ xp?: HTMLElement|null, streak?: HTMLElement|null, combo?: HTMLElement|null, rank?: HTMLElement|null }} els
 * @param {GameState} [game]
 */
export function renderHUD(els, game = loadGameState()) {
  if (els.xp) els.xp.textContent = `${game.xp.toLocaleString()} XP`;
  if (els.streak) els.streak.textContent = `${game.dayStreak}🔥`;
  if (els.combo) {
    els.combo.textContent = game.combo > 0 ? `${game.combo}x` : "—";
    els.combo.classList.toggle("is-hot", game.combo >= 3);
  }
  if (els.rank) els.rank.textContent = formatRank(game.xp);
}

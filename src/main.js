/**
 * Who's Who — Texas Legislature
 * Dead-simple mobile deck for people who need faces, not settings menus.
 *
 * UX (that's the whole app):
 *   1. See a face
 *   2. Tap card or "Show name" to flip
 *   3. Swipe right / "Know them"  → schedule later (Good)
 *   4. Swipe left  / "Don't know" → see them again soon (Again)
 *
 * SM-2 still runs under the hood. No multiple choice. No typing. No scrolling.
 */

import {
  applyGrade,
  buildQueue,
  ensureCards,
  formatInterval,
  loadStore,
  markIntroduced,
  memberOrder,
  normalizeCard,
  saveStore,
} from "./srs.js";

/** @typedef {{ id: string, name: string, chamber: 'House'|'Senate', district: number, photo: string, url: string, party: string|null }} Member */

const SWIPE_PX = 64;
const FLY_MS = 280;

const state = {
  members: /** @type {Member[]} */ ([]),
  pool: /** @type {Member[]} */ ([]),
  store: loadStore(),
  queue: /** @type {string[]} */ ([]),
  counts: { learningDue: 0, reviewDue: 0, newAvailable: 0, newTotal: 0, mature: 0 },
  current: /** @type {Member|null} */ (null),
  currentSrs: /** @type {import('./srs.js').SrsCard|null} */ (null),
  flipped: false,
  animating: false,
};

const gesture = {
  active: false,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  pointerId: /** @type {number|null} */ (null),
  moved: false,
};

const $ = (id) => document.getElementById(id);

const els = {
  stage: $("stage"),
  left: $("stat-left"),
  coach: $("coach"),
  dont: $("btn-dont"),
  flip: $("btn-flip"),
  know: $("btn-know"),
};

function persist() {
  saveStore(state.store);
}

function setDockEnabled(on) {
  els.dont.disabled = !on;
  els.flip.disabled = !on;
  els.know.disabled = !on;
}

function updateChrome() {
  const due = state.counts.learningDue + state.counts.reviewDue;
  const left = due + state.counts.newAvailable;
  els.left.textContent = left > 0 ? `${left} left` : "Done";

  if (els.flip) {
    els.flip.classList.toggle("is-answer", state.flipped);
    const label = els.flip.querySelector(".dock-label");
    if (label) label.textContent = state.flipped ? "Hide name" : "Show name";
  }

  if (els.coach) {
    els.coach.textContent = state.flipped
      ? "Swipe right if you knew them · left if you didn't"
      : "Tap the card or Show name · then swipe";
  }
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

  if (state.pool.length < 1) {
    els.stage.innerHTML = `<div class="error">No member data loaded.</div>`;
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
  state.flipped = false;
  state.animating = false;

  refreshPoolAndQueue();
  renderCard(dropIn);
  setDockEnabled(true);
  updateChrome();
}

/**
 * @param {1|2|3|4} quality
 * @param {'left'|'right'} dir
 */
async function gradeAndAdvance(quality, dir) {
  if (!state.current || !state.currentSrs || state.animating) return;
  state.animating = true;
  setDockEnabled(false);

  const stack = $("stack");
  if (stack) {
    stack.classList.remove("dragging", "show-know", "show-dont");
    stack.style.transform = "";
    stack.classList.add(dir === "right" ? "fly-right" : "fly-left");
    await sleep(FLY_MS);
  }

  const updated = applyGrade(state.currentSrs, quality, Date.now());
  state.store.cards[state.current.id] = updated;
  persist();

  state.animating = false;
  nextCard();
}

function knowThem() {
  // Good = 3 — “I knew that face”
  gradeAndAdvance(3, "right");
}

function dontKnow() {
  // Again = 1 — bring them back soon
  gradeAndAdvance(1, "left");
}

function flip() {
  if (state.animating || !state.current) return;
  state.flipped = !state.flipped;
  $("card")?.classList.toggle("flipped", state.flipped);
  updateChrome();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- gestures ---------------- */

function bindGestures(stack) {
  if ("PointerEvent" in window) {
    stack.addEventListener("pointerdown", onDown);
    stack.addEventListener("pointermove", onMove);
    stack.addEventListener("pointerup", onUp);
    stack.addEventListener("pointercancel", onUp);
  } else {
    stack.addEventListener("touchstart", onTouchStart, { passive: true });
    stack.addEventListener("touchmove", onTouchMove, { passive: false });
    stack.addEventListener("touchend", onTouchEnd);
    stack.addEventListener("touchcancel", onTouchEnd);
  }
}

function onDown(e) {
  if (state.animating || e.button === 2) return;
  // Dock buttons are outside the stack — anything on the card is fair game
  gesture.active = true;
  gesture.moved = false;
  gesture.pointerId = e.pointerId;
  gesture.startX = e.clientX;
  gesture.startY = e.clientY;
  gesture.dx = 0;
  gesture.dy = 0;
  const stack = $("stack");
  stack?.classList.add("dragging");
  try {
    stack?.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function onMove(e) {
  if (!gesture.active || e.pointerId !== gesture.pointerId) return;
  gesture.dx = e.clientX - gesture.startX;
  gesture.dy = e.clientY - gesture.startY;

  if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) gesture.moved = true;

  // Ignore mostly-vertical (rare; we lock page scroll anyway)
  if (Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5) return;

  e.preventDefault();
  paintDrag(gesture.dx);
}

function onUp(e) {
  if (!gesture.active) return;
  if (gesture.pointerId != null && e.pointerId !== gesture.pointerId) return;
  endGesture();
}

function onTouchStart(e) {
  if (state.animating || !e.changedTouches?.length) return;
  const t = e.changedTouches[0];
  gesture.active = true;
  gesture.moved = false;
  gesture.pointerId = null;
  gesture.startX = t.clientX;
  gesture.startY = t.clientY;
  gesture.dx = 0;
  gesture.dy = 0;
  $("stack")?.classList.add("dragging");
}

function onTouchMove(e) {
  if (!gesture.active || !e.touches?.length) return;
  const t = e.touches[0];
  gesture.dx = t.clientX - gesture.startX;
  gesture.dy = t.clientY - gesture.startY;
  if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) gesture.moved = true;
  if (Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5) return;
  e.preventDefault();
  paintDrag(gesture.dx);
}

function onTouchEnd() {
  if (!gesture.active) return;
  endGesture();
}

function paintDrag(dx) {
  const stack = $("stack");
  if (!stack) return;
  const rot = Math.max(-14, Math.min(14, dx / 16));
  stack.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
  stack.classList.toggle("show-know", dx > SWIPE_PX * 0.5);
  stack.classList.toggle("show-dont", dx < -SWIPE_PX * 0.5);
}

function endGesture() {
  const dx = gesture.dx;
  const wasTap = !gesture.moved && Math.abs(dx) < 12 && Math.abs(gesture.dy) < 12;
  gesture.active = false;
  gesture.pointerId = null;

  const stack = $("stack");
  if (!stack) return;

  stack.classList.remove("dragging", "show-know", "show-dont");

  if (dx >= SWIPE_PX) {
    knowThem();
    return;
  }
  if (dx <= -SWIPE_PX) {
    dontKnow();
    return;
  }

  // Tap card = flip (no need to hunt for the middle button)
  if (wasTap) {
    stack.style.transform = "";
    flip();
    return;
  }

  // Snap back
  stack.style.transition = "transform 0.2s ease";
  stack.style.transform = "";
  setTimeout(() => {
    if (stack) stack.style.transition = "";
  }, 200);
}

/* ---------------- render ---------------- */

function renderCard(dropIn) {
  const m = state.current;
  if (!m) return;

  els.stage.innerHTML = `
    <div class="stack${dropIn ? " drop-in" : ""}" id="stack">
      <div class="stamp dont" aria-hidden="true">Don't know</div>
      <div class="stamp know" aria-hidden="true">Know them</div>

      <div class="scene">
        <div class="card${state.flipped ? " flipped" : ""}" id="card">
          <div class="face front">
            <div class="photo-wrap">
              <img src="${escapeHtml(m.photo)}" alt="Legislator" draggable="false" referrerpolicy="no-referrer" />
              <div class="face-caption">
                <p class="eyebrow">Texas Legislature</p>
                <p class="prompt">Who is this?</p>
                <p class="hint">Tap card to show name</p>
              </div>
            </div>
          </div>
          <div class="face back">
            <div class="photo-wrap">
              <img src="${escapeHtml(m.photo)}" alt="" draggable="false" referrerpolicy="no-referrer" />
              <div class="face-caption">
                <p class="eyebrow">${escapeHtml(m.chamber)}</p>
                <p class="name">${escapeHtml(chamberLabel(m))} ${escapeHtml(m.name)}</p>
                <p class="meta">${escapeHtml(metaLine(m))}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const stack = $("stack");
  if (stack) bindGestures(stack);
}

function renderDone() {
  setDockEnabled(false);
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
        <p>${
          nextIn
            ? `Next review in about <strong>${escapeHtml(nextIn)}</strong>.`
            : "No reviews waiting right now."
        }</p>
        ${
          nextNew
            ? `<button type="button" class="dock-btn know" id="btn-more" style="padding:0.85rem 1rem;border-radius:14px">
                 <span class="dock-label" style="font-size:0.95rem">Study a few more</span>
               </button>`
            : ""
        }
      </div>
    </div>
  `;

  $("btn-more")?.addEventListener("click", () => {
    if (nextNew) showMember(nextNew, true);
  });

  if (els.coach) els.coach.textContent = "Come back later — the hard ones return first.";
  updateChrome();
}

/* ---------------- chrome ---------------- */

function wireDock() {
  els.dont.addEventListener("click", (e) => {
    e.preventDefault();
    dontKnow();
  });
  els.know.addEventListener("click", (e) => {
    e.preventDefault();
    knowThem();
  });
  els.flip.addEventListener("click", (e) => {
    e.preventDefault();
    flip();
  });

  // Keyboard for desk users / accessibility
  window.addEventListener("keydown", (e) => {
    if (state.animating || !state.current) return;
    if (e.key === " " || e.key === "Enter" || e.key === "f" || e.key === "F") {
      e.preventDefault();
      flip();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      knowThem();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      dontKnow();
    }
  });
}

async function init() {
  wireDock();

  try {
    const res = await fetch("data/members.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load members (${res.status})`);
    const data = await res.json();
    state.members = (data.members || [])
      .filter((m) => m?.name && m?.photo)
      .sort(memberOrder);

    if (state.members.length < 1) throw new Error("Empty member list");

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

/* ═══════════════════════════════════════════════════════════════════
   LAB · Experiment 02 — MAGNET.
   A fake macOS cursor replaces the real one over the task. When a card is
   picked up it attaches to the fake cursor. The cursor is driven by a
   spring (velocity + stiffness + damping) in a requestAnimationFrame loop,
   so as it nears the AI's suggested slot it is magnetically eased/pulled
   toward it — with momentum and lag, not a rigid snap. Attraction is measured
   from the tile's RIGHT EDGE (a grab-independent anchor), not the mouse, so the
   pull feels the same no matter where on the card you picked it up. The pull is
   partial (peak < 1), so the participant can always resist and place a card
   deliberately wrong. Physics adapted from a reference magnetic-cursor.js.
   Self-contained: does NOT touch the study code base. Loaded by
   lab.html (?exp=02).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!window.LAB) { console.error("lab_02.js needs the lab.html harness"); return; }
  var LAB = window.LAB;

  /* ── tunable design parameters ── */
  var CFG = {
    seededErrors: false,    // AI suggests a deliberately imperfect order
    magnetRadius: 90,     // px tile-right-edge → slot-right-edge (responsive; recomputed in computeRadius)
    magnetStrength: 0.58,  // 0–1 displacement of the tile toward the magnet (peak < 1 → overridable)
    springK: 0.22,         // spring stiffness (0–1): how hard it chases the target
    damping: 0.62,         // velocity damping per frame (0–1): the "weight" / overshoot
    snap: false,           // hard-snap to the slot centre when very close
    snapThreshold: 0.55,   // fraction of radius at which snap kicks in
    dragThreshold: 5,
    // responsive radius: magnetRadius = radiusBase × (viewport height / radiusRefH), clamped.
    radiusBase: 90,       // px at the reference viewport height
    radiusRefH: 900,       // reference viewport height (≈ a typical laptop browser)
    radiusMin: 160,
    radiusMax: 560,
  };

  /* ── data: placeholder items A–F, correct urgency order A→F ── */
  var ITEMS = [
    { id: "A", rank: 1, icon: "A", title: "Item A", detail: "Placeholder description for item A." },
    { id: "B", rank: 2, icon: "B", title: "Item B", detail: "Placeholder description for item B." },
    { id: "C", rank: 3, icon: "C", title: "Item C", detail: "Placeholder description for item C." },
    { id: "D", rank: 4, icon: "D", title: "Item D", detail: "Placeholder description for item D." },
    { id: "E", rank: 5, icon: "E", title: "Item E", detail: "Placeholder description for item E." },
    { id: "F", rank: 6, icon: "F", title: "Item F", detail: "Placeholder description for item F." },
  ];
  var correctOrder = ITEMS.slice().sort(function (a, b) { return a.rank - b.rank; }).map(function (i) { return i.id; });
  function makeAiRanking() {
    var r = correctOrder.slice();
    if (!CFG.seededErrors) return r;
    var t;
    t = r[0]; r[0] = r[4]; r[4] = t;   // swap rank 1 ↔ 5
    t = r[1]; r[1] = r[5]; r[5] = t;   // swap rank 2 ↔ 6
    return r;
  }
  // Slot the magnet pulls toward for a card → AI's suggested slot.
  // Switch to `correctOrder.indexOf(id)` to pull toward the truly-correct slot.
  function magnetTargetSlot(id) { return aiRanking.indexOf(id); }

  var SLOT_LABELS = ["Most urgent", "", "", "", "", "Least urgent"];
  var CARD_MARGIN_R = 10;   // px: the placed card's right margin (`.t-slot .card`) — the tile's right edge snaps here

  /* ── state & elements ── */
  var cards, byId, aiRanking, inbox, slots, drag, log;
  var root, taskEl, ghost, fakeCursor, fxCanvas, fxCtx, confirmBtn, inboxEl, ladderEl, inboxHd;
  var real = { x: 0, y: 0 };   // raw pointer (never the one you see while in a field)
  var fake = { x: 0, y: 0 };   // displayed, spring-driven cursor
  var vel  = { x: 0, y: 0 };
  var cursorActive = false, rafId = null, lastTick = 0, radiusAuto = true;

  var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = 0 | (Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  function logEvent(type, data) { var e = Object.assign({ type: type, t: Math.round(performance.now()) }, data || {}); log.push(e); LAB.log(type, data || {}); }

  injectStyles();
  LAB.setTitle("Experiment 02 · MAGNET");
  LAB.onRestart(build);
  document.addEventListener("mousemove", onMove);
  window.addEventListener("resize", function () { sizeCanvas(); computeRadius(); });
  build();
  startLoop();

  /* ── build one run ── */
  function build() {
    cards = shuffle(ITEMS.map(function (it) { return Object.assign({}, it); }));
    byId = {}; cards.forEach(function (c) { byId[c.id] = c; });
    aiRanking = makeAiRanking();
    inbox = cards.slice();
    slots = [null, null, null, null, null, null];
    drag = null;
    log = [];
    logEvent("run_start", { inboxOrder: cards.map(function (c) { return c.id; }), aiSuggested: aiRanking });

    root = LAB.root;
    root.innerHTML =
      '<div class="lab-task">' +
        '<div class="t-banner">' +
          '<span class="b-badge">MAGNET' + (CFG.seededErrors ? " · scripted" : "") + '</span>' +
          '<span class="t-hint">Pick up a card and move it into the ranking. Near the AI’s suggested slot the card is magnetically pulled into place — but you can resist and drop it wherever you want.</span>' +
        '</div>' +
        '<div class="t-main">' +
          '<div class="t-col"><div class="t-col-hd" id="t-inbox-hd">Inbox — incoming items</div><div class="t-scroll" id="t-inbox"></div></div>' +
          '<div class="t-col"><div class="t-col-hd">Urgency ranking — drag items here</div><div class="t-ladder" id="t-ladder"></div></div>' +
        '</div>' +
        '<div class="t-footer">' +
          '<div class="tune">' +
            '<label>Strength <input type="range" id="tune-strength" min="0" max="1" step="0.02" value="' + CFG.magnetStrength + '"></label>' +
            '<label>Radius <input type="range" id="tune-radius" min="0" max="600" step="5" value="' + CFG.magnetRadius + '"></label>' +
            '<label>Spring <input type="range" id="tune-spring" min="0.05" max="0.6" step="0.01" value="' + CFG.springK + '"></label>' +
            '<label class="opt"><input type="checkbox" id="tune-snap"' + (CFG.snap ? " checked" : "") + '> Snap</label>' +
            '<span id="tune-readout"></span>' +
          '</div>' +
          '<button class="t-btn t-primary" id="t-confirm" disabled>Confirm ranking</button>' +
        '</div>' +
        '<canvas id="fx-canvas" class="fx-canvas"></canvas>' +
        '<div id="fake-cursor" class="fake-cursor">' +
          '<svg width="22" height="26" viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M2 1.5 L2 20.5 L7 15.6 L10.3 22.8 L13.2 21.5 L10 14.4 L17.2 14.4 Z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>' +
          '</svg></div>' +
      '</div>' +
      '<div id="t-ghost" class="t-ghost"><div class="card-icon" id="t-ghost-icon"></div>' +
        '<div><div class="card-title" id="t-ghost-title"></div><div class="card-detail" id="t-ghost-detail"></div></div></div>';

    taskEl = root.querySelector(".lab-task");
    inboxEl = root.querySelector("#t-inbox");
    ladderEl = root.querySelector("#t-ladder");
    inboxHd = root.querySelector("#t-inbox-hd");
    confirmBtn = root.querySelector("#t-confirm");
    ghost = root.querySelector("#t-ghost");
    fakeCursor = root.querySelector("#fake-cursor");
    fxCanvas = root.querySelector("#fx-canvas");
    fxCtx = fxCanvas.getContext("2d");
    sizeCanvas();

    confirmBtn.addEventListener("click", confirmRanking);

    var strengthEl = root.querySelector("#tune-strength");
    var radiusEl = root.querySelector("#tune-radius");
    var springEl = root.querySelector("#tune-spring");
    var snapEl = root.querySelector("#tune-snap");
    strengthEl.addEventListener("input", function () { CFG.magnetStrength = +strengthEl.value; refreshReadout(); });
    radiusEl.addEventListener("input", function () { CFG.magnetRadius = +radiusEl.value; radiusAuto = false; refreshReadout(); });
    springEl.addEventListener("input", function () { CFG.springK = +springEl.value; refreshReadout(); });
    snapEl.addEventListener("change", function () { CFG.snap = snapEl.checked; refreshReadout(); });

    render();
    computeRadius();   // responsive default radius from viewport height (also refreshes the readout)
  }

  /* ── render ── */
  function render() {
    renderInbox();
    renderLadder();
    confirmBtn.disabled = !slots.every(Boolean);
  }
  function renderInbox() {
    inboxEl.innerHTML = "";
    if (!inbox.length) {
      var n = document.createElement("div"); n.className = "t-empty"; n.textContent = "All items placed."; inboxEl.appendChild(n);
    } else {
      inbox.forEach(function (c) { inboxEl.appendChild(makeCardEl(c, "inbox")); });
    }
    inboxHd.textContent = "Inbox — incoming items (" + inbox.length + " remaining)";
  }
  function renderLadder() {
    ladderEl.innerHTML = "";
    slots.forEach(function (id, i) {
      var slot = document.createElement("div"); slot.className = "t-slot"; slot.dataset.slot = i;
      var num = document.createElement("div"); num.className = "t-slot-num"; num.textContent = i + 1; slot.appendChild(num);
      if (id) {
        slot.appendChild(makeCardEl(byId[id], i));
      } else {
        var lbl = document.createElement("div"); lbl.className = "t-slot-lbl"; lbl.textContent = SLOT_LABELS[i] || "—"; slot.appendChild(lbl);
      }
      ladderEl.appendChild(slot);
    });
  }
  function makeCardEl(card, from) {
    var div = document.createElement("div");
    div.className = "card"; div.dataset.id = card.id; div.dataset.from = String(from);
    div.innerHTML = '<div class="card-icon">' + card.icon + '</div>' +
      '<div class="card-txt"><div class="card-title">' + card.title + '</div>' +
      '<div class="card-detail">' + card.detail + '</div></div><div class="card-grip">⠿</div>';
    div.addEventListener("mousedown", onMouseDown);
    return div;
  }

  /* ── magnet helpers ── */
  function snapPoint() {
    if (!drag) return null;
    var idx = magnetTargetSlot(drag.id);
    if (idx < 0) return null;
    var el = root.querySelector('[data-slot="' + idx + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    // attract the tile's right edge to the placed card's right edge (slot right
    // edge minus its margin), vertically centred — so it lines up when it snaps.
    return { x: r.right - CARD_MARGIN_R, y: r.top + r.height / 2 };
  }
  // The tile's magnet anchor (right edge, vertically centred) for a given cursor
  // point, via the fixed per-drag offset.
  function anchorAt(px, py) { return { x: px + drag.anchorOffX, y: py + drag.anchorOffY }; }

  // Where the cursor "wants" to be. We attract the tile's RIGHT EDGE (not the
  // mouse) toward the magnet, then convert that displaced anchor back into a
  // cursor target — so the pull is identical regardless of where the card was
  // grabbed. The spring then chases this target.
  function computeTarget() {
    if (drag && drag.started) {
      var snap = snapPoint();
      if (snap) {
        var a = anchorAt(real.x, real.y);          // tile right edge implied by the raw pointer
        var dx = snap.x - a.x, dy = snap.y - a.y;
        var dist = Math.hypot(dx, dy) || 1;
        if (dist < CFG.magnetRadius) {
          var tx, ty;
          if (CFG.snap && dist < CFG.magnetRadius * CFG.snapThreshold) { tx = snap.x; ty = snap.y; }
          else { tx = a.x + dx * CFG.magnetStrength; ty = a.y + dy * CFG.magnetStrength; }
          return { x: tx - drag.anchorOffX, y: ty - drag.anchorOffY };   // displaced anchor → cursor
        }
      }
    }
    return { x: real.x, y: real.y };
  }
  function highlightUnder(x, y) {
    root.querySelectorAll(".t-slot").forEach(function (s) { s.classList.remove("drop-target"); });
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) s.classList.add("drop-target");
    });
  }

  /* ── canvas sizing & spring loop ── */
  function sizeCanvas() {
    if (!fxCanvas || !taskEl) return;
    var r = taskEl.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    fxCanvas.width = Math.max(1, Math.round(r.width * dpr));
    fxCanvas.height = Math.max(1, Math.round(r.height * dpr));
    fxCanvas.style.width = r.width + "px";
    fxCanvas.style.height = r.height + "px";
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // Responsive magnet radius: scales with the viewport height so the reach feels
  // the same on any screen. Skipped once the user drags the Radius slider.
  function computeRadius() {
    if (!radiusAuto) return;
    var h = window.innerHeight || CFG.radiusRefH;
    var r = CFG.radiusBase * h / CFG.radiusRefH;
    CFG.magnetRadius = Math.round(Math.max(CFG.radiusMin, Math.min(CFG.radiusMax, r)));
    var el = root && root.querySelector("#tune-radius");
    if (el) el.value = CFG.magnetRadius;
    refreshReadout();
  }
  function refreshReadout() {
    var ro = root && root.querySelector("#tune-readout");
    if (ro) ro.textContent = "strength " + CFG.magnetStrength.toFixed(2) + " · radius " + CFG.magnetRadius + "px · spring " + CFG.springK.toFixed(2) + (CFG.snap ? " · snap" : "");
  }
  function startLoop() { if (rafId == null) rafId = requestAnimationFrame(tick); }
  function tick() {
    rafId = requestAnimationFrame(tick);
    lastTick = performance.now();
    step();
  }
  // One spring + render step. Driven by rAF; also driven by mousemove as a
  // fallback when rAF is throttled (e.g. a background / headless tab).
  function step() {
    if (!fxCtx || !taskEl) return;
    var tr = taskEl.getBoundingClientRect();
    fxCtx.clearRect(0, 0, tr.width, tr.height);
    if (!cursorActive) return;

    // spring the fake cursor toward its (possibly magnet-displaced) target
    var target = computeTarget();
    vel.x += (target.x - fake.x) * CFG.springK;
    vel.y += (target.y - fake.y) * CFG.springK;
    vel.x *= CFG.damping;
    vel.y *= CFG.damping;
    fake.x += vel.x;
    fake.y += vel.y;

    // carry the attached tile + show where it will land (by the tile's right edge)
    if (drag && drag.started) {
      ghost.style.left = (fake.x - drag.offsetX) + "px";
      ghost.style.top = (fake.y - drag.offsetY) + "px";
      var a = anchorAt(fake.x, fake.y);
      highlightUnder(a.x, a.y);
    }

    drawFx(tr);
    // position the DOM mac cursor (tip ≈ fake)
    fakeCursor.style.left = (fake.x - 2) + "px";
    fakeCursor.style.top = (fake.y - 2) + "px";
  }
  function drawFx(tr) {
    if (!(drag && drag.started)) return;
    var snap = snapPoint();
    if (!snap) return;
    var a = anchorAt(real.x, real.y);
    var dist = Math.hypot(snap.x - a.x, snap.y - a.y);
    var t = Math.max(0, 1 - dist / CFG.magnetRadius);
    if (t <= 0) return;

    var ctx = fxCtx;
    var sx = snap.x - tr.left, sy = snap.y - tr.top;     // magnet (target slot) — local
    var fx = fake.x - tr.left, fy = fake.y - tr.top;     // fake cursor — local
    ctx.save();
    // dashed tether from the magnet to the cursor (grows as you near the slot)
    ctx.beginPath();
    ctx.setLineDash([3, 5]);
    ctx.moveTo(sx, sy); ctx.lineTo(fx, fy);
    ctx.strokeStyle = "rgba(21,127,59," + (0.45 * t) + ")";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ── pointer tracking ── */
  function onMove(e) {
    if (!taskEl || !fakeCursor) return;
    real.x = e.clientX; real.y = e.clientY;
    var tb = taskEl.getBoundingClientRect();
    var over = e.clientX >= tb.left && e.clientX <= tb.right && e.clientY >= tb.top && e.clientY <= tb.bottom;
    if (over) {
      if (!cursorActive) { cursorActive = true; fake.x = real.x; fake.y = real.y; vel.x = vel.y = 0; } // snap on entry
      fakeCursor.style.display = "block";
      if (drag && !drag.started && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= CFG.dragThreshold) startDrag();
      if (performance.now() - lastTick > 60) step(); // keep the spring moving if rAF is throttled
    } else {
      cursorActive = false;
      fakeCursor.style.display = "none";
    }
  }

  /* ── drag ── */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    var card = e.currentTarget;
    var from = card.dataset.from === "inbox" ? "inbox" : +card.dataset.from;
    var rect = card.getBoundingClientRect();
    drag = { id: card.dataset.id, from: from, started: false,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      srcW: rect.width, srcH: rect.height };
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }
  function startDrag() {
    drag.started = true;
    // grab-independent magnet anchor = the tile's right edge, vertically centred,
    // expressed as a fixed offset from the cursor for this drag.
    drag.anchorOffX = (drag.srcW || 280) - drag.offsetX;
    drag.anchorOffY = (drag.srcH || 72) / 2 - drag.offsetY;
    var c = byId[drag.id];
    root.querySelector("#t-ghost-icon").textContent = c.icon;
    root.querySelector("#t-ghost-title").textContent = c.title;
    root.querySelector("#t-ghost-detail").textContent = c.detail;
    ghost.style.display = "flex";
    ghost.style.width = (drag.srcW || 280) + "px";
    var src = root.querySelector('[data-id="' + drag.id + '"]');
    if (src) src.classList.add("ghost");
    logEvent("pick", { cardId: drag.id, from: drag.from });
  }
  function onMouseUp() {
    document.removeEventListener("mouseup", onMouseUp);
    root.querySelectorAll(".t-slot").forEach(function (s) { s.classList.remove("drop-target"); });

    if (!drag) return;
    if (!drag.started) { drag = null; return; }

    ghost.style.display = "none";
    var src = root.querySelector('[data-id="' + drag.id + '"]');
    if (src) src.classList.remove("ghost");

    // drop by the tile's right edge (the magnet anchor) for slots; by the cursor
    // for the inbox (returning a card to the left column)
    var a = anchorAt(fake.x, fake.y);
    var px = a.x, py = a.y;
    var targetSlot = null;
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) targetSlot = +s.dataset.slot;
    });
    var ir = inboxEl.getBoundingClientRect();
    var inInbox = fake.x >= ir.left && fake.x <= ir.right && fake.y >= ir.top && fake.y <= ir.bottom;

    var id = drag.id, from = drag.from;
    drag = null;

    if (targetSlot != null) { logEvent("drop", { cardId: id, to: "slot_" + targetSlot }); placeCard(id, from, targetSlot); }
    else if (inInbox && from !== "inbox") { logEvent("drop", { cardId: id, to: "inbox" }); returnToInbox(id, from); }
    render();
  }
  function placeCard(id, from, toSlot) {
    var displaced = slots[toSlot];
    slots[toSlot] = id;
    if (from === "inbox") {
      inbox = inbox.filter(function (c) { return c.id !== id; });
      if (displaced) { inbox = inbox.filter(function (c) { return c.id !== displaced; }); inbox.push(byId[displaced]); }
    } else {
      slots[from] = displaced || null;
    }
  }
  function returnToInbox(id, fromSlot) {
    slots[fromSlot] = null;
    if (!inbox.some(function (c) { return c.id === id; })) inbox.push(byId[id]);
  }

  /* ── confirm → result readout ── */
  function confirmRanking() {
    var deviations = 0, score = 0;
    slots.forEach(function (id, i) {
      var ap = aiRanking.indexOf(id);
      if (ap !== -1 && ap !== i) deviations++;
      if (id && byId[id].rank === i + 1) score++;
    });
    logEvent("confirm", { ranking: slots.slice(), score: score, deviations: deviations });
    showResults(score, deviations);
  }
  function showResults(score, deviations) {
    var correct = ITEMS.slice().sort(function (a, b) { return a.rank - b.rank; });
    var yours = slots.map(function (id, i) {
      var it = byId[id], ok = it.rank === i + 1;
      return '<div class="t-rc-row"><b>' + (i + 1) + '</b><span class="ri">' + it.icon + '</span>' + it.title +
        '<span class="' + (ok ? "ok" : "err") + '">' + (ok ? "✓" : "✗") + '</span></div>';
    }).join("");
    var right = correct.map(function (p, i) {
      return '<div class="t-rc-row"><b>' + (i + 1) + '</b><span class="ri">' + p.icon + '</span>' + p.title + '</div>';
    }).join("");

    var overlay = document.createElement("div");
    overlay.className = "t-results";
    overlay.innerHTML =
      '<div class="t-results-card">' +
        '<h2>Result — ' + score + '/6 correct</h2>' +
        '<p class="muted">Placed ' + deviations + " of 6 away from the AI's suggestion.</p>" +
        '<div class="t-results-cols"><div><div class="t-rc-hd">Your ranking</div>' + yours + '</div>' +
          '<div><div class="t-rc-hd">Correct order</div>' + right + '</div></div>' +
        '<button class="t-btn t-primary" id="t-again">Run again</button>' +
      '</div>';
    root.appendChild(overlay);
    overlay.querySelector("#t-again").addEventListener("click", function () { LAB.restart(); });
  }

  /* ── styles (edit freely — scoped to this experiment) ── */
  function injectStyles() {
    if (document.getElementById("lab-02-style")) return;
    var css =
      ".lab-task{flex:1;display:flex;flex-direction:column;overflow:hidden;color:#0a0a0a;font-size:15px;position:relative;cursor:none}" +
      ".lab-task *{cursor:none}" +
      ".t-banner{display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid #cfcfcf;flex-shrink:0}" +
      ".t-banner .b-badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:4px;letter-spacing:.04em;background:#eef9f0;color:#157f3b;border:1px solid #a7e0ba}" +
      ".t-hint{font-size:13.5px;color:#383838}" +
      ".t-main{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}" +
      ".t-col{display:flex;flex-direction:column;overflow:hidden;padding:22px 26px}" +
      ".t-col+.t-col{border-left:1px solid #cfcfcf}" +
      ".t-col-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;padding-bottom:14px;flex-shrink:0}" +
      ".t-scroll,.t-ladder{display:flex;flex-direction:column;overflow-y:auto;flex:1;padding:2px 8px 2px 2px}" +
      ".card{background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;margin-bottom:11px;display:flex;align-items:flex-start;gap:13px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 3px 8px rgba(0,0,0,.07);transition:box-shadow .12s,transform .08s,opacity .1s;position:relative}" +
      ".card:hover{box-shadow:0 3px 8px rgba(0,0,0,.1),0 8px 20px rgba(0,0,0,.12);transform:translateY(-1px)}" +
      ".card.ghost{opacity:.25}" +
      ".card-icon{font-size:17px;font-weight:800;width:26px;text-align:center;color:#0a0a0a;flex-shrink:0}" +
      ".card-txt{flex:1;min-width:0}.card-title{font-size:15px;font-weight:700}" +
      ".card-detail{font-size:13.5px;color:#383838;margin-top:3px;line-height:1.5}" +
      ".card-grip{color:#9a9a9a;font-size:15px;align-self:center;flex-shrink:0}" +
      ".t-slot{border-bottom:1px solid #cfcfcf;min-height:72px;display:flex;align-items:center;transition:background .08s}" +
      ".t-slot:last-child{border-bottom:none}" +
      ".t-slot.drop-target{background:#eef9f0}" +
      ".t-slot-num{font-size:14px;font-weight:700;color:#565656;width:32px;text-align:center;flex-shrink:0}" +
      ".t-slot-lbl{font-size:13px;color:#565656;padding:0 8px}" +
      ".t-slot .card{flex:1;margin:9px 10px 9px 2px}" +
      ".fx-canvas{position:absolute;inset:0;pointer-events:none;z-index:8500}" +
      ".t-ghost{position:fixed;pointer-events:none;z-index:9000;background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;display:none;align-items:flex-start;gap:12px;box-shadow:0 12px 34px rgba(0,0,0,.26)}" +
      ".t-ghost .card-icon{font-size:17px;font-weight:800}.t-ghost .card-title{font-size:15px;font-weight:700}.t-ghost .card-detail{font-size:13.5px;color:#383838;margin-top:3px}" +
      ".fake-cursor{position:fixed;z-index:9600;pointer-events:none;display:none;width:22px;height:26px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.4))}" +
      ".t-footer{border-top:1px solid #cfcfcf;padding:12px 28px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-shrink:0}" +
      ".tune{display:flex;align-items:center;gap:16px;font-size:12px;color:#383838;flex-wrap:wrap}" +
      ".tune label{display:flex;align-items:center;gap:7px}.tune input[type=range]{width:92px}" +
      ".tune .opt input{width:15px;height:15px}" +
      "#tune-readout{color:#565656;font-variant-numeric:tabular-nums}" +
      ".t-empty{font-size:13.5px;color:#565656;text-align:center;padding:18px 0}" +
      ".t-btn{padding:8px 18px;border-radius:7px;border:1px solid #cfcfcf;font-size:13.5px;font-weight:600;background:#fff;color:#0a0a0a}" +
      ".t-btn:disabled{opacity:.45}" +
      ".t-primary{background:#111;color:#fff;border-color:#111}.t-primary:disabled{background:#cfcfcf;border-color:#cfcfcf;color:#fff}" +
      ".t-results{position:absolute;inset:0;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:9999}" +
      ".t-results-card{background:#fff;border:1px solid #cfcfcf;border-radius:14px;box-shadow:0 14px 46px rgba(0,0,0,.2);padding:28px 32px;max-width:620px;width:90%}" +
      ".t-results-card h2{font-size:19px;font-weight:700;margin-bottom:4px}" +
      ".t-results-card .muted{color:#565656;font-size:13px;margin-bottom:18px}" +
      ".t-results-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:20px}" +
      ".t-rc-hd{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;margin-bottom:10px}" +
      ".t-rc-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}" +
      ".t-rc-row b{color:#565656;width:18px}.t-rc-row .ri{font-weight:800;width:18px;text-align:center}" +
      ".t-rc-row .ok{color:#157f3b;margin-left:auto;font-weight:800}.t-rc-row .err{color:#b00020;margin-left:auto;font-weight:800}";
    var st = document.createElement("style"); st.id = "lab-02-style"; st.textContent = css;
    document.head.appendChild(st);
  }
})();

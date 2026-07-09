/* ═══════════════════════════════════════════════════════════════════
   LAB · Experiment 03 — RADIAL (extracted from V1.html).
   Hover a card in the inbox and, after a short dwell, the AI opens two
   placement options beside the pointer. One is the card's genuinely
   correct slot, the other is a random decoy — they look identical and
   their order is randomised, so the participant has to judge which to
   trust. Hover an option to preview, click to commit. Or ignore the
   menu and mousedown+drag the card anywhere by hand. Fully
   self-contained: does NOT touch the study code base (js/*, styles*.css).
   Loaded by lab.html (?exp=03).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!window.LAB) { console.error("lab_03.js needs the lab.html harness"); return; }
  var LAB = window.LAB;

  /* ── tunable design parameters ── */
  var CFG = {
    dwell: 220,          // ms hover before the two options appear
    hideDelay: 260,      // ms grace period before the menu closes on mouseleave
    dragThreshold: 5,    // px before a press becomes a manual drag
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
  var SLOT_LABELS = ["Most urgent", "", "", "", "", "Least urgent"];

  // The AI offers two candidate slots for a card: its genuinely correct
  // slot plus one random decoy. Swap this for real model output — it only
  // needs to return {trueSlot, decoy} (0-based slot indices, distinct).
  function suggestSlots(id) {
    var trueSlot = byId[id].rank - 1;
    var pool = [0, 1, 2, 3, 4, 5].filter(function (s) { return s !== trueSlot; });
    var decoy = pool[0 | (Math.random() * pool.length)];
    return { trueSlot: trueSlot, decoy: decoy };
  }

  /* ── per-run state & elements ── */
  var cards, byId, inbox, slots, drag, log, tally;
  var root, ghost, confirmBtn, inboxEl, ladderEl, inboxHd, radialLayer;
  var hover = { cardId: null, timer: null, hideTimer: null, menuOpen: false, lastX: null, lastY: null, _els: null, _srcEl: null };

  var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = 0 | (Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  function logEvent(type, data) { var e = Object.assign({ type: type, t: Math.round(performance.now()) }, data || {}); log.push(e); LAB.log(type, data || {}); }

  injectStyles();
  ensureRadialLayer();
  window.addEventListener("scroll", function () { closeMenu(true); }, true);
  LAB.setTitle("Experiment 03 · RADIAL");
  LAB.onRestart(function () { closeMenu(true); build(); });
  build();

  function ensureRadialLayer() {
    radialLayer = document.getElementById("lab-03-radial");
    if (!radialLayer) {
      radialLayer = document.createElement("div");
      radialLayer.id = "lab-03-radial";
      document.body.appendChild(radialLayer);
    }
    radialLayer.innerHTML = "";
  }

  /* ── build one run ── */
  function build() {
    cards = shuffle(ITEMS.map(function (it) { return Object.assign({}, it); }));
    byId = {}; cards.forEach(function (c) { byId[c.id] = c; });
    inbox = cards.slice();
    slots = [null, null, null, null, null, null];
    drag = null;
    log = [];
    tally = { menuTrue: 0, menuDecoy: 0, manual: 0 };
    ensureRadialLayer();
    logEvent("run_start", { inboxOrder: cards.map(function (c) { return c.id; }) });

    root = LAB.root;
    root.innerHTML =
      '<div class="lab-task">' +
        '<div class="t-banner">' +
          '<span class="b-badge">RADIAL</span>' +
          '<span class="t-hint">Hover a card — the AI opens two placement options beside it. Hover an option to preview, click to place it. Or ignore the menu and drag the card yourself.</span>' +
        '</div>' +
        '<div class="t-main">' +
          '<div class="t-col"><div class="t-col-hd" id="t-inbox-hd">Inbox — incoming items</div><div class="t-scroll" id="t-inbox"></div></div>' +
          '<div class="t-col"><div class="t-col-hd">Urgency ranking — drag items here</div><div class="t-ladder" id="t-ladder"></div></div>' +
        '</div>' +
        '<div class="t-footer">' +
          '<span class="t-note">The AI proposes two slots — one is a decoy. Pick one, or drag the card yourself.</span>' +
          '<button class="t-btn t-primary" id="t-confirm" disabled>Confirm ranking</button>' +
        '</div>' +
      '</div>' +
      '<div id="t-ghost" class="t-ghost"><div class="card-icon" id="t-ghost-icon"></div>' +
        '<div><div class="card-title" id="t-ghost-title"></div><div class="card-detail" id="t-ghost-detail"></div></div></div>';

    inboxEl = root.querySelector("#t-inbox");
    ladderEl = root.querySelector("#t-ladder");
    inboxHd = root.querySelector("#t-inbox-hd");
    confirmBtn = root.querySelector("#t-confirm");
    ghost = root.querySelector("#t-ghost");
    confirmBtn.addEventListener("click", confirmRanking);

    render();
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
    if (from === "inbox") {
      div.addEventListener("mouseenter", function (e) { onCardEnter(card.id, div, e); });
      div.addEventListener("mousemove", function (e) { hover.lastX = e.clientX; hover.lastY = e.clientY; });
      div.addEventListener("mouseleave", function () { onCardLeave(card.id); });
    }
    return div;
  }

  /* ── hover → two-option menu (inbox cards only) ── */
  function onCardEnter(id, el, e) {
    if (drag) return;
    clearTimeout(hover.hideTimer);
    hover.lastX = e.clientX; hover.lastY = e.clientY;
    if (hover.menuOpen && hover.cardId === id) return;
    closeMenu();
    hover.cardId = id;
    clearTimeout(hover.timer);
    hover.timer = setTimeout(function () {
      if (hover.cardId === id) openMenu(id, el);
    }, CFG.dwell);
  }
  function onCardLeave(id) {
    clearTimeout(hover.timer);
    if (hover.cardId === id && !hover.menuOpen) hover.cardId = null;
    if (hover.menuOpen) {
      hover.hideTimer = setTimeout(function () { closeMenu(); }, CFG.hideDelay);
    }
  }
  function openMenu(id, el) {
    var s = suggestSlots(id);
    if (!s) return;
    closeMenu(true);
    hover.menuOpen = true;
    hover.cardId = id;
    el.classList.add("suggesting");

    // anchor the two options on the pointer's current position
    var r = el.getBoundingClientRect();
    var anchorX = hover.lastX != null ? hover.lastX : r.right;
    var anchorY = hover.lastY != null ? hover.lastY : r.top + r.height / 2;

    // true slot + random decoy, presented identically in randomised order
    var options = shuffle([
      { slot: s.trueSlot, correct: true },
      { slot: s.decoy, correct: false },
    ]);
    options[0].dy = -42; options[1].dy = 42;

    var petalEls = [];
    options.forEach(function (p) {
      var px = anchorX + 130, py = anchorY + p.dy;

      var btn = document.createElement("div");
      btn.className = "rm-petal";
      btn.style.left = px + "px";
      btn.style.top = py + "px";
      btn.innerHTML =
        '<div class="rm-num">' + (p.slot + 1) + '</div>' +
        '<div class="rm-txt">' +
          '<div class="rm-rank">AI option</div>' +
          '<div class="rm-lbl">' + (SLOT_LABELS[p.slot] || "Slot " + (p.slot + 1)) + '</div>' +
        '</div>';
      btn.addEventListener("mouseenter", function () {
        clearTimeout(hover.hideTimer);
        btn.classList.add("hovered");
        previewSlot(p.slot);
      });
      btn.addEventListener("mouseleave", function () {
        btn.classList.remove("hovered");
        clearPreview();
        hover.hideTimer = setTimeout(function () { closeMenu(); }, CFG.hideDelay);
      });
      btn.addEventListener("click", function () {
        logEvent("radial_pick", { cardId: id, slot: p.slot, correct: p.correct });
        if (p.correct) tally.menuTrue++; else tally.menuDecoy++;
        placeCard(id, "inbox", p.slot);
        closeMenu(true);
        render();
      });
      radialLayer.appendChild(btn);
      petalEls.push(btn);
      requestAnimationFrame(function () { btn.classList.add("show"); });
    });

    hover._els = petalEls;
    hover._srcEl = el;
    logEvent("radial_open", { cardId: id, trueSlot: s.trueSlot, decoy: s.decoy });
  }
  function previewSlot(i) {
    clearPreview();
    var el = root.querySelector('.t-slot[data-slot="' + i + '"]');
    if (el) el.classList.add("slot-preview");
  }
  function clearPreview() {
    root.querySelectorAll(".t-slot.slot-preview").forEach(function (s) { s.classList.remove("slot-preview"); });
  }
  function closeMenu(immediate) {
    clearTimeout(hover.hideTimer);
    if (hover._srcEl) hover._srcEl.classList.remove("suggesting");
    if (hover._els) hover._els.forEach(function (el) { el.remove(); });
    hover._els = null; hover._srcEl = null; hover.menuOpen = false;
    if (immediate) { clearTimeout(hover.timer); hover.cardId = null; }
    clearPreview();
  }

  /* ── custom drag (manual placement — always available) ── */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    closeMenu(true);
    var card = e.currentTarget;
    var from = card.dataset.from === "inbox" ? "inbox" : +card.dataset.from;
    var rect = card.getBoundingClientRect();
    drag = { id: card.dataset.id, from: from, started: false,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      srcW: rect.width, srcH: rect.height };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }
  function startDrag() {
    if (drag.started) return;
    drag.started = true;
    var c = byId[drag.id];
    root.querySelector("#t-ghost-icon").textContent = c.icon;
    root.querySelector("#t-ghost-title").textContent = c.title;
    root.querySelector("#t-ghost-detail").textContent = c.detail;
    ghost.style.display = "flex";
    ghost.style.width = (drag.srcW || 280) + "px";
    var src = root.querySelector('[data-id="' + drag.id + '"]');
    if (src) src.classList.add("ghost");
    logEvent("drag_start", { cardId: drag.id, from: drag.from });
  }
  function onMouseMove(e) {
    if (!drag) return;
    if (!drag.started && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < CFG.dragThreshold) return;
    startDrag();

    root.querySelectorAll(".t-slot").forEach(function (s) { s.classList.remove("drop-target"); });
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) s.classList.add("drop-target");
    });

    ghost.style.left = (e.clientX - drag.offsetX) + "px";
    ghost.style.top = (e.clientY - drag.offsetY) + "px";
  }
  function onMouseUp(e) {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    root.querySelectorAll(".t-slot").forEach(function (s) { s.classList.remove("drop-target", "slot-preview"); });

    if (!drag) return;
    if (!drag.started) { drag = null; return; }

    ghost.style.display = "none";
    var src = root.querySelector('[data-id="' + drag.id + '"]');
    if (src) src.classList.remove("ghost");

    var px = e.clientX, py = e.clientY; // drop by the pointer position
    var targetSlot = null;
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) targetSlot = +s.dataset.slot;
    });
    var ir = inboxEl.getBoundingClientRect();
    var inInbox = px >= ir.left && px <= ir.right && py >= ir.top && py <= ir.bottom;

    var id = drag.id, from = drag.from;
    drag = null;

    if (targetSlot != null) { logEvent("drop", { cardId: id, to: "slot_" + targetSlot, method: "manual" }); tally.manual++; placeCard(id, from, targetSlot); }
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
    var score = 0;
    slots.forEach(function (id, i) { if (id && byId[id].rank === i + 1) score++; });
    logEvent("confirm", { ranking: slots.slice(), score: score, menuTrue: tally.menuTrue, menuDecoy: tally.menuDecoy, manual: tally.manual });
    showResults(score);
  }
  function showResults(score) {
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
        '<p class="muted">Menu picks: ' + tally.menuTrue + " correct · " + tally.menuDecoy + " decoy  ·  Dragged by hand: " + tally.manual + "</p>" +
        '<div class="t-results-cols"><div><div class="t-rc-hd">Your ranking</div>' + yours + '</div>' +
          '<div><div class="t-rc-hd">Correct order</div>' + right + '</div></div>' +
        '<button class="t-btn t-primary" id="t-again">Run again</button>' +
      '</div>';
    root.querySelector(".lab-task").appendChild(overlay);
    overlay.querySelector("#t-again").addEventListener("click", function () { LAB.restart(); });
  }

  /* ── styles (edit freely — scoped to this experiment) ── */
  function injectStyles() {
    if (document.getElementById("lab-03-style")) return;
    var css =
      ".lab-task{flex:1;display:flex;flex-direction:column;overflow:hidden;color:#0a0a0a;font-size:15px;position:relative}" +
      ".t-banner{display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid #cfcfcf;flex-shrink:0}" +
      ".t-banner .b-badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:4px;letter-spacing:.04em;background:#eaf3fc;color:#0b5fae;border:1px solid #a9cdec}" +
      ".t-hint{font-size:13.5px;color:#383838}" +
      ".t-main{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}" +
      ".t-col{display:flex;flex-direction:column;overflow:hidden;padding:22px 26px}" +
      ".t-col+.t-col{border-left:1px solid #cfcfcf}" +
      ".t-col-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;padding-bottom:14px;flex-shrink:0}" +
      ".t-scroll,.t-ladder{display:flex;flex-direction:column;overflow-y:auto;flex:1;padding:2px 8px 2px 2px;position:relative}" +
      ".card{background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;margin-bottom:11px;display:flex;align-items:flex-start;gap:13px;cursor:grab;box-shadow:0 1px 2px rgba(0,0,0,.06),0 3px 8px rgba(0,0,0,.07);transition:box-shadow .12s,transform .08s,opacity .1s;position:relative}" +
      ".card:hover{box-shadow:0 3px 8px rgba(0,0,0,.1),0 8px 20px rgba(0,0,0,.12);transform:translateY(-1px)}" +
      ".card:active{cursor:grabbing}.card.ghost{opacity:.25}" +
      ".card.suggesting{box-shadow:0 0 0 2px rgba(11,95,174,.2),0 3px 8px rgba(0,0,0,.1),0 8px 20px rgba(0,0,0,.12)}" +
      ".card-icon{font-size:17px;font-weight:800;width:26px;text-align:center;color:#0a0a0a;flex-shrink:0}" +
      ".card-txt{flex:1;min-width:0}.card-title{font-size:15px;font-weight:700}" +
      ".card-detail{font-size:13.5px;color:#383838;margin-top:3px;line-height:1.5}" +
      ".card-grip{color:#9a9a9a;font-size:15px;align-self:center;flex-shrink:0}" +
      ".t-slot{border-bottom:1px solid #cfcfcf;min-height:72px;display:flex;align-items:center;transition:background .08s}" +
      ".t-slot:last-child{border-bottom:none}" +
      ".t-slot.drop-target{background:#eaf3fc}" +
      ".t-slot.slot-preview{background:#eaf3fc;box-shadow:inset 3px 0 0 #0b5fae}" +
      ".t-slot-num{font-size:14px;font-weight:700;color:#565656;width:32px;text-align:center;flex-shrink:0}" +
      ".t-slot-lbl{font-size:13px;color:#565656;padding:0 8px}" +
      ".t-slot .card{flex:1;margin:9px 10px 9px 2px}" +
      ".t-ghost{position:fixed;pointer-events:none;z-index:9000;background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;display:none;align-items:flex-start;gap:12px;box-shadow:0 10px 32px rgba(0,0,0,.22)}" +
      ".t-ghost .card-icon{font-size:17px;font-weight:800}.t-ghost .card-title{font-size:15px;font-weight:700}.t-ghost .card-detail{font-size:13.5px;color:#383838;margin-top:3px}" +
      ".t-footer{border-top:1px solid #cfcfcf;padding:12px 28px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-shrink:0;flex-wrap:wrap}" +
      ".t-note{font-size:12.5px;color:#8a8a8a}" +
      ".t-empty{font-size:13.5px;color:#565656;text-align:center;padding:18px 0}" +
      ".t-btn{padding:8px 18px;border-radius:7px;border:1px solid #cfcfcf;font-size:13.5px;font-weight:600;cursor:pointer;background:#fff;color:#0a0a0a}" +
      ".t-btn:disabled{opacity:.45;cursor:default}" +
      ".t-primary{background:#111;color:#fff;border-color:#111}.t-primary:disabled{background:#cfcfcf;border-color:#cfcfcf;color:#fff}" +
      "#lab-03-radial{position:fixed;inset:0;pointer-events:none;z-index:8000}" +
      ".rm-petal{position:fixed;pointer-events:auto;display:flex;flex-direction:row;align-items:center;gap:12px;width:196px;padding:11px 18px;border-radius:16px;background:#fff;border:2px solid #0b5fae;color:#0a0a0a;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.18);transform:translate(-50%,-50%) scale(.5);opacity:0;transition:transform .16s cubic-bezier(.2,1.4,.4,1),opacity .12s,background .12s,border-color .12s}" +
      ".rm-petal.show{transform:translate(-50%,-50%) scale(1);opacity:1}" +
      ".rm-petal:hover,.rm-petal.hovered{background:#0b5fae;color:#fff}" +
      ".rm-petal .rm-num{font-size:24px;font-weight:800;line-height:1;flex-shrink:0;width:30px;text-align:center}" +
      ".rm-petal .rm-txt{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".rm-petal .rm-rank{font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;opacity:.75}" +
      ".rm-petal .rm-lbl{font-size:11.5px;font-weight:600;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".t-results{position:absolute;inset:0;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:200}" +
      ".t-results-card{background:#fff;border:1px solid #cfcfcf;border-radius:14px;box-shadow:0 14px 46px rgba(0,0,0,.2);padding:28px 32px;max-width:620px;width:90%}" +
      ".t-results-card h2{font-size:19px;font-weight:700;margin-bottom:4px}" +
      ".t-results-card .muted{color:#565656;font-size:13px;margin-bottom:18px}" +
      ".t-results-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:20px}" +
      ".t-rc-hd{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;margin-bottom:10px}" +
      ".t-rc-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}" +
      ".t-rc-row b{color:#565656;width:18px}.t-rc-row .ri{font-weight:800;width:18px;text-align:center}" +
      ".t-rc-row .ok{color:#157f3b;margin-left:auto;font-weight:800}.t-rc-row .err{color:#b00020;margin-left:auto;font-weight:800}";
    var st = document.createElement("style"); st.id = "lab-03-style"; st.textContent = css;
    document.head.appendChild(st);
  }
})();

/* ═══════════════════════════════════════════════════════════════════
   LAB · Experiment 04 — HEATMAP (extracted from V2.html).
   Hover (or drag) a card and every slot in the ranking lights up on a
   hot→cold scale: red = the AI's most-probable slot, blue = unlikely.
   The hot spot sits on the card's genuinely correct slot, with a
   Gaussian falloff around it. Purely a passive visual suggestion —
   nothing is clickable, the participant still places every card by hand.
   Fully self-contained: does NOT touch the study code base
   (js/*, styles*.css). Loaded by lab.html (?exp=04).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!window.LAB) { console.error("lab_04.js needs the lab.html harness"); return; }
  var LAB = window.LAB;

  /* ── tunable design parameters (toggle live in the footer) ── */
  var CFG = {
    sigma: 1.2,       // spread of the heat falloff (smaller = tighter hot spot)
    opacity: 0.5,     // overlay alpha at full saturation
    showPct: true,    // show the numeric probability badge per slot
    dragThreshold: 5,
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

  // Hot→cold colour scale: 3 stops (blue → pale grey → red), so every slot
  // reads as cold / neutral / hot. t=1 hottest (most probable), t=0 coldest.
  var STOPS = [
    { t: 0.00, c: [40, 90, 200] },
    { t: 0.50, c: [235, 235, 233] },
    { t: 1.00, c: [205, 46, 46] },
  ];
  function colorForT(t) {
    t = Math.max(0, Math.min(1, t));
    for (var i = 0; i < STOPS.length - 1; i++) {
      var a = STOPS[i], b = STOPS[i + 1];
      if (t >= a.t && t <= b.t) {
        var f = (b.t === a.t) ? 0 : (t - a.t) / (b.t - a.t);
        return [
          Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
          Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
          Math.round(a.c[2] + (b.c[2] - a.c[2]) * f),
        ];
      }
    }
    return STOPS[STOPS.length - 1].c;
  }
  function luminance(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  // Probability the card belongs in each of the 6 slots — a Gaussian falloff
  // around the card's genuinely correct slot (so red marks the true position).
  // Swap this for a real model's output; it only needs to return 6
  // non-negative scores (any scale).
  function computeHeat(id) {
    var target = byId[id].rank - 1;
    var scores = [0, 0, 0, 0, 0, 0].map(function (_, i) {
      var d = i - target;
      return Math.exp(-(d * d) / (2 * CFG.sigma * CFG.sigma));
    });
    var sum = scores.reduce(function (a, b) { return a + b; }, 0);
    var pct = scores.map(function (s) { return (s / sum) * 100; });
    return { scores: scores, pct: pct };   // scores peak at 1 (target slot)
  }

  /* ── per-run state & elements ── */
  var cards, byId, inbox, slots, drag, log, activeHeatId;
  var root, ghost, confirmBtn, inboxEl, ladderEl, inboxHd;

  var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = 0 | (Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  function logEvent(type, data) { var e = Object.assign({ type: type, t: Math.round(performance.now()) }, data || {}); log.push(e); LAB.log(type, data || {}); }

  injectStyles();
  LAB.setTitle("Experiment 04 · HEATMAP");
  LAB.onRestart(build);
  build();

  /* ── build one run ── */
  function build() {
    cards = shuffle(ITEMS.map(function (it) { return Object.assign({}, it); }));
    byId = {}; cards.forEach(function (c) { byId[c.id] = c; });
    inbox = cards.slice();
    slots = [null, null, null, null, null, null];
    drag = null;
    activeHeatId = null;
    log = [];
    logEvent("run_start", { inboxOrder: cards.map(function (c) { return c.id; }) });

    root = LAB.root;
    root.innerHTML =
      '<div class="lab-task">' +
        '<div class="t-banner">' +
          '<span class="b-badge">HEATMAP</span>' +
          '<span class="t-hint">Hover a card — every slot lights up on a hot-to-cold scale showing where the AI thinks it belongs. It’s only a suggestion: nothing is clickable, you place every card by hand.</span>' +
        '</div>' +
        '<div class="t-main">' +
          '<div class="t-col"><div class="t-col-hd" id="t-inbox-hd">Inbox — incoming items</div><div class="t-scroll" id="t-inbox"></div></div>' +
          '<div class="t-col"><div class="t-col-hd">Urgency ranking — drag items here</div><div class="t-ladder" id="t-ladder"></div></div>' +
        '</div>' +
        '<div class="t-footer">' +
          '<div class="t-legend"><span>Cold</span><span class="bar"></span><span>Hot = most probable</span></div>' +
          '<div class="t-tune">' +
            '<label>Spread <input type="range" id="tune-sigma" min="0.5" max="2.6" step="0.1" value="' + CFG.sigma + '"></label>' +
            '<label>Opacity <input type="range" id="tune-opacity" min="0.2" max="0.85" step="0.05" value="' + CFG.opacity + '"></label>' +
            '<label class="opt"><input type="checkbox" id="tune-pct"' + (CFG.showPct ? " checked" : "") + '> Show %</label>' +
          '</div>' +
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

    var sigmaEl = root.querySelector("#tune-sigma");
    var opEl = root.querySelector("#tune-opacity");
    var pctEl = root.querySelector("#tune-pct");
    sigmaEl.addEventListener("input", function () { CFG.sigma = +sigmaEl.value; if (activeHeatId) applyHeat(activeHeatId); });
    opEl.addEventListener("input", function () { CFG.opacity = +opEl.value; if (activeHeatId) applyHeat(activeHeatId); });
    pctEl.addEventListener("change", function () { CFG.showPct = pctEl.checked; if (activeHeatId) applyHeat(activeHeatId); });

    render();
  }

  /* ── render ── */
  function render() {
    renderInbox();
    renderLadder();
    confirmBtn.disabled = !slots.every(Boolean);
    if (activeHeatId) applyHeat(activeHeatId);
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
      var heat = document.createElement("div"); heat.className = "t-slot-heat"; slot.appendChild(heat);
      var pct = document.createElement("div"); pct.className = "t-slot-pct"; slot.appendChild(pct);
      var tag = document.createElement("div"); tag.className = "t-slot-tag"; tag.textContent = "Most likely"; slot.appendChild(tag);
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
    div.addEventListener("mouseenter", function () { onCardEnter(card.id, div); });
    div.addEventListener("mouseleave", function () { onCardLeave(card.id); });
    return div;
  }

  /* ── hover / drag → hot-to-cold heatmap ── */
  function onCardEnter(id, el) {
    if (drag) return;
    el.classList.add("suggesting");
    applyHeat(id);
    logEvent("heat_show", { cardId: id, trigger: "hover" });
  }
  function onCardLeave(id) {
    if (drag && drag.id === id) return; // keep the heatmap up while this card is being dragged
    var el = root.querySelector('.card[data-id="' + id + '"]');
    if (el) el.classList.remove("suggesting");
    clearHeat();
  }
  function applyHeat(id) {
    var h = computeHeat(id);
    activeHeatId = id;
    var maxIdx = h.scores.indexOf(Math.max.apply(null, h.scores));
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var i = +s.dataset.slot;
      var color = colorForT(h.scores[i]);
      var heatEl = s.querySelector(".t-slot-heat");
      var pctEl = s.querySelector(".t-slot-pct");
      heatEl.style.background = "rgba(" + color.join(",") + "," + CFG.opacity + ")";
      pctEl.textContent = CFG.showPct ? Math.round(h.pct[i]) + "%" : "";
      pctEl.style.color = luminance(color) > 150 ? "#0a0a0a" : "#fff";
      s.classList.add("heat-active");
      s.classList.toggle("best", i === maxIdx);
    });
  }
  function clearHeat() {
    activeHeatId = null;
    root.querySelectorAll(".t-slot").forEach(function (s) {
      s.classList.remove("heat-active", "best");
      var pctEl = s.querySelector(".t-slot-pct");
      if (pctEl) pctEl.textContent = "";
    });
  }

  /* ── custom drag (manual placement — the only way to place a card) ── */
  function onMouseDown(e) {
    if (e.button !== 0) return;
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
    applyHeat(drag.id);
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
    root.querySelectorAll(".t-slot").forEach(function (s) { s.classList.remove("drop-target"); });

    if (!drag) return;
    if (!drag.started) { drag = null; return; }

    ghost.style.display = "none";
    var src = root.querySelector('[data-id="' + drag.id + '"]');
    if (src) src.classList.remove("ghost", "suggesting");
    clearHeat();

    var px = e.clientX, py = e.clientY;
    var targetSlot = null;
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) targetSlot = +s.dataset.slot;
    });
    var ir = inboxEl.getBoundingClientRect();
    var inInbox = px >= ir.left && px <= ir.right && py >= ir.top && py <= ir.bottom;

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
      if (id && byId[id].rank - 1 !== i) deviations++;   // placed away from the hot (correct) cell
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
        '<p class="muted">Placed ' + deviations + " of 6 away from the AI's hottest cell.</p>" +
        '<div class="t-results-cols"><div><div class="t-rc-hd">Your ranking</div>' + yours + '</div>' +
          '<div><div class="t-rc-hd">Correct order</div>' + right + '</div></div>' +
        '<button class="t-btn t-primary" id="t-again">Run again</button>' +
      '</div>';
    root.querySelector(".lab-task").appendChild(overlay);
    overlay.querySelector("#t-again").addEventListener("click", function () { LAB.restart(); });
  }

  /* ── styles (edit freely — scoped to this experiment) ── */
  function injectStyles() {
    if (document.getElementById("lab-04-style")) return;
    var css =
      ".lab-task{flex:1;display:flex;flex-direction:column;overflow:hidden;color:#0a0a0a;font-size:15px;position:relative}" +
      ".t-banner{display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid #cfcfcf;flex-shrink:0}" +
      ".t-banner .b-badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:4px;letter-spacing:.04em;background:#fdece1;color:#9a3412;border:1px solid #f3c19a}" +
      ".t-hint{font-size:13.5px;color:#383838}" +
      ".t-main{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}" +
      ".t-col{display:flex;flex-direction:column;overflow:hidden;padding:22px 26px}" +
      ".t-col+.t-col{border-left:1px solid #cfcfcf}" +
      ".t-col-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;padding-bottom:14px;flex-shrink:0}" +
      ".t-scroll,.t-ladder{display:flex;flex-direction:column;overflow-y:auto;flex:1;padding:2px 8px 2px 2px;position:relative}" +
      ".card{background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;margin-bottom:11px;display:flex;align-items:flex-start;gap:13px;cursor:grab;box-shadow:0 1px 2px rgba(0,0,0,.06),0 3px 8px rgba(0,0,0,.07);transition:box-shadow .12s,transform .08s,opacity .1s;position:relative;z-index:1}" +
      ".card:hover{box-shadow:0 3px 8px rgba(0,0,0,.1),0 8px 20px rgba(0,0,0,.12);transform:translateY(-1px)}" +
      ".card:active{cursor:grabbing}.card.ghost{opacity:.25}" +
      ".card.suggesting{box-shadow:0 0 0 2px rgba(154,52,18,.28),0 3px 8px rgba(0,0,0,.1),0 8px 20px rgba(0,0,0,.12)}" +
      ".card-icon{font-size:17px;font-weight:800;width:26px;text-align:center;color:#0a0a0a;flex-shrink:0}" +
      ".card-txt{flex:1;min-width:0}.card-title{font-size:15px;font-weight:700}" +
      ".card-detail{font-size:13.5px;color:#383838;margin-top:3px;line-height:1.5}" +
      ".card-grip{color:#9a9a9a;font-size:15px;align-self:center;flex-shrink:0}" +
      ".t-slot{border-bottom:1px solid #cfcfcf;min-height:72px;display:flex;align-items:center;position:relative;transition:background .08s}" +
      ".t-slot:last-child{border-bottom:none}" +
      ".t-slot.drop-target{outline:2px solid rgba(10,10,10,.18);outline-offset:-2px}" +
      ".t-slot-num{font-size:14px;font-weight:700;color:#565656;width:32px;text-align:center;flex-shrink:0;position:relative;z-index:1}" +
      ".t-slot-lbl{font-size:13px;color:#565656;padding:0 8px;position:relative;z-index:1}" +
      ".t-slot .card{flex:1;margin:9px 10px 9px 2px}" +
      ".t-slot-heat{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;background:transparent;transition:background-color .16s ease,opacity .16s ease}" +
      ".t-slot-pct{position:absolute;top:7px;right:12px;z-index:2;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;pointer-events:none;opacity:0;transition:opacity .16s ease}" +
      ".t-slot-tag{position:absolute;bottom:6px;right:12px;z-index:2;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9a3412;pointer-events:none;opacity:0;transition:opacity .16s ease}" +
      ".t-slot.best .t-slot-tag{opacity:1}" +
      ".t-slot.heat-active .t-slot-heat{opacity:1}" +
      ".t-slot.heat-active .t-slot-pct{opacity:1}" +
      ".t-ghost{position:fixed;pointer-events:none;z-index:9000;background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;display:none;align-items:flex-start;gap:12px;box-shadow:0 10px 32px rgba(0,0,0,.22)}" +
      ".t-ghost .card-icon{font-size:17px;font-weight:800}.t-ghost .card-title{font-size:15px;font-weight:700}.t-ghost .card-detail{font-size:13.5px;color:#383838;margin-top:3px}" +
      ".t-footer{border-top:1px solid #cfcfcf;padding:12px 28px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-shrink:0;flex-wrap:wrap}" +
      ".t-legend{display:flex;align-items:center;gap:10px;font-size:12px;color:#565656}" +
      ".t-legend .bar{width:120px;height:9px;border-radius:5px;background:linear-gradient(90deg,#285ac8,#ebebe9,#cd2e2e)}" +
      ".t-tune{display:flex;align-items:center;gap:16px;font-size:12px;color:#383838;flex-wrap:wrap}" +
      ".t-tune label{display:flex;align-items:center;gap:7px}" +
      ".t-tune input[type=range]{width:92px}" +
      ".t-tune .opt input{width:15px;height:15px;cursor:pointer}" +
      ".t-btn{padding:8px 18px;border-radius:7px;border:1px solid #cfcfcf;font-size:13.5px;font-weight:600;cursor:pointer;background:#fff;color:#0a0a0a}" +
      ".t-btn:disabled{opacity:.45;cursor:default}" +
      ".t-primary{background:#111;color:#fff;border-color:#111}.t-primary:disabled{background:#cfcfcf;border-color:#cfcfcf;color:#fff}" +
      ".t-empty{font-size:13.5px;color:#565656;text-align:center;padding:18px 0}" +
      ".t-results{position:absolute;inset:0;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:200}" +
      ".t-results-card{background:#fff;border:1px solid #cfcfcf;border-radius:14px;box-shadow:0 14px 46px rgba(0,0,0,.2);padding:28px 32px;max-width:620px;width:90%}" +
      ".t-results-card h2{font-size:19px;font-weight:700;margin-bottom:4px}" +
      ".t-results-card .muted{color:#565656;font-size:13px;margin-bottom:18px}" +
      ".t-results-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:20px}" +
      ".t-rc-hd{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;margin-bottom:10px}" +
      ".t-rc-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}" +
      ".t-rc-row b{color:#565656;width:18px}.t-rc-row .ri{font-weight:800;width:18px;text-align:center}" +
      ".t-rc-row .ok{color:#157f3b;margin-left:auto;font-weight:800}.t-rc-row .err{color:#b00020;margin-left:auto;font-weight:800}";
    var st = document.createElement("style"); st.id = "lab-04-style"; st.textContent = css;
    document.head.appendChild(st);
  }
})();

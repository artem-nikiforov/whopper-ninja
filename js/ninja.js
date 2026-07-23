/* ════════════════════════════════════════════════════════════════════════
   Воппер Ниндзя — логика игр и гейтинга. Поверх kuds.js / ku-scorm.js.
   Механики по docs/MECHANICS.md: своя проверка + .ku-feedback, markDone,
   тач-перетаскивание клоном, таймер как вызов (не наказание).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var P = function () { return (window.KU && window.KU.progress) || null; };
  function markDone(id) { var p = P(); if (p) p.markDone(id); }
  function isDone(id) { var p = P(); return p ? p.isDone(id) : false; }

  function feedback(id, ok, okHtml, badHtml) {
    var fb = document.getElementById(id);
    if (!fb) return;
    fb.className = "ku-feedback show " + (ok ? "correct" : "incorrect");
    fb.innerHTML = '<span class="ku-fb-msg">' + (ok ? okHtml : badHtml) + "</span>";
  }

  /* ══ ИНГРЕДИЕНТЫ ═══════════════════════════════════════════════════════
     idx = правильный порядок сборки (сверху вниз, «вверх дном»):
     верхняя булочка → майонез → салат → томат → соус → огурцы → котлета →
     нижняя булочка. */
  var ING = [
    { key: "crown",   idx: 0, label: "Верхняя булочка", gly: bun(true) },
    { key: "mayo",    idx: 1, label: "Майонез ×2",       gly: dots("#f4ead2", 2) },
    { key: "lettuce", idx: 2, label: "Салат айсберг",    gly: ruffle("#6ab04c") },
    { key: "tomato",  idx: 3, label: "Томат ×2",          gly: circles("#d84a3a", 2) },
    { key: "sauce",   idx: 4, label: "Соус Ниндзя",       gly: spiral() },
    { key: "pickles", idx: 5, label: "Огурцы ×4",         gly: circles("#8bbf3f", 4) },
    { key: "patty",   idx: 6, label: "Котлета",           gly: slab("#7a3b1e") },
    { key: "heel",    idx: 7, label: "Нижняя булочка",    gly: bun(false) }
  ];
  var CORRECT = ING.map(function (i) { return i.idx; }); // [0..7]
  var byKey = {}; ING.forEach(function (i) { byKey[i.key] = i; });

  function bun(top) {
    return top
      ? '<svg class="nj-gly" viewBox="0 0 30 18"><path d="M2 15 Q15 -4 28 15 Z" fill="#e79a3c"/><path d="M2 15 Q15 1 28 15" fill="#f4b25a"/><circle cx="11" cy="8" r="1" fill="#fff6e6"/><circle cx="18" cy="6" r="1" fill="#fff6e6"/></svg>'
      : '<svg class="nj-gly" viewBox="0 0 30 18"><rect x="2" y="4" width="26" height="11" rx="5" fill="#d98b34"/><path d="M2 9 h26 v4 a5 5 0 0 1-5 5 H7 a5 5 0 0 1-5-5 Z" fill="#c9792a"/></svg>';
  }
  function dots(c, n) {
    var s = '<svg class="nj-gly" viewBox="0 0 30 18"><rect x="2" y="6" width="26" height="6" rx="3" fill="#efe6cf"/>';
    for (var i = 0; i < n; i++) s += '<circle cx="' + (10 + i * 10) + '" cy="9" r="2.4" fill="' + c + '"/>';
    return s + '</svg>';
  }
  function ruffle(c) { return '<svg class="nj-gly" viewBox="0 0 30 18"><path d="M2 12 q3-6 5 0 q3-6 5 0 q3-6 5 0 q3-6 5 0 q3-6 5 0 v4 H2 Z" fill="' + c + '"/></svg>'; }
  function circles(c, n) {
    var s = '<svg class="nj-gly" viewBox="0 0 30 18">', step = 26 / (n + 1);
    for (var i = 0; i < n; i++) s += '<circle cx="' + (2 + step * (i + 1)) + '" cy="9" r="' + (n > 2 ? 2.4 : 4) + '" fill="' + c + '"/>';
    return s + '</svg>';
  }
  function spiralPath(cx, cy, maxR, turns, pts) {
    var d = "", tot = turns * 2 * Math.PI;
    for (var i = 0; i <= pts; i++) {
      var t = i / pts, ang = t * tot, r = maxR * t;
      d += (i ? "L" : "M") + (cx + r * Math.cos(ang)).toFixed(2) + " " + (cy + r * Math.sin(ang)).toFixed(2) + " ";
    }
    return d.trim();
  }
  function spiral() { return '<svg class="nj-gly nj-gly--sauce" viewBox="0 0 30 18"><rect x="2" y="3" width="26" height="12" rx="6" fill="#efe6cf"/><path d="' + spiralPath(15, 9, 5, 3, 140) + '" fill="none" stroke="#12100e" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function slab(c) { return '<svg class="nj-gly" viewBox="0 0 30 18"><rect x="2" y="4" width="26" height="10" rx="5" fill="' + c + '"/></svg>'; }

  /* ══ ИГРА 1 — СОБЕРИ ВОППЕР ════════════════════════════════════════════
     asm.placed — ключи в порядке стопки (index 0 — верхний слой, последний —
     нижний). Правильный порядок — это ПОСЛЕДОВАТЕЛЬНОСТЬ слоёв; направление
     не важно (сборка идёт снизу вверх), поэтому эталон засчитывается и в
     прямом, и в обратном прочтении. Ингредиент можно перетащить на любую
     позицию, в т.ч. МЕЖДУ уже добавленными; поставленный слой можно перетащить
     на новое место или убрать крестиком. */
  var asm = { round: 1, placed: [], timer: null, timeLeft: 40, running: false };
  var stage, pool, poolOrder = [], gapEl = null;

  function shuffled(arr) { arr = arr.slice(); for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function eqArr(a, b) { return a.length === b.length && a.every(function (v, i) { return v === b[i]; }); }
  function missCount(a, b) { var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }

  function initPoolOrder() { poolOrder = shuffled(ING).map(function (i) { return i.key; }); }

  function renderPool() {
    pool.innerHTML = "";
    poolOrder.forEach(function (key) {
      if (asm.placed.indexOf(key) === -1) pool.appendChild(makeChip(key));
    });
  }
  function renderStack() {
    stage.querySelectorAll(".nj-layer").forEach(function (n) { n.remove(); });
    asm.placed.forEach(function (key) { stage.appendChild(makeLayer(key)); });
    stage.classList.toggle("has-items", asm.placed.length > 0);
  }
  function render() { renderStack(); renderPool(); }
  function clearAll() { asm.placed = []; render(); }

  function makeChip(key) {
    var ing = byKey[key];
    var b = document.createElement("button");
    b.type = "button";
    b.className = "nj-chip";
    b.setAttribute("data-key", key);
    b.innerHTML = ing.gly + "<span>" + ing.label + "</span>";
    attachDrag(b, key, false);
    return b;
  }
  function makeLayer(key) {
    var ing = byKey[key];
    var layer = document.createElement("div");
    layer.className = "nj-layer";
    layer.setAttribute("data-key", key);
    layer.innerHTML = ing.gly + "<span>" + ing.label + "</span>" +
      '<button type="button" class="nj-layer__rm" aria-label="Убрать"><svg class="ku-ico s"><use href="#i-x"/></svg></button>';
    layer.querySelector(".nj-layer__rm").addEventListener("click", function (e) { e.stopPropagation(); removeKey(key); });
    attachDrag(layer, key, true);
    return layer;
  }
  function removeKey(key) {
    var i = asm.placed.indexOf(key);
    if (i === -1) return;
    asm.placed.splice(i, 1);
    render();
  }

  /* Перетаскивание клоном (mouse + touch). Источник — чип из набора или
     уже поставленный слой (fromStack). Дроп на платформу вставляет элемент на
     позицию под курсором (между слоями). Только drag — тап ничего не ставит. */
  function attachDrag(el, key, fromStack) {
    var ghost = null, moved = false, sx = 0, sy = 0;
    el.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest(".nj-layer__rm")) return; // крестик — не начинаем drag
      moved = false; sx = e.clientX; sy = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
    function onMove(e) {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      if (!moved) {
        moved = true;
        ghost = buildGhost(key);
        document.body.appendChild(ghost);
        el.classList.add("is-dragging");
        if (fromStack) {                          // вынимаем слой из стопки на время переноса
          var i = asm.placed.indexOf(key);
          if (i !== -1) { asm.placed.splice(i, 1); renderStack(); }
        }
      }
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      var over = overStage(e.clientX, e.clientY);
      stage.classList.toggle("drag-over", over);
      if (over) showGap(insertIndexAt(e.clientY)); else hideGap();
    }
    function onUp(e) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      stage.classList.remove("drag-over");
      el.classList.remove("is-dragging");
      if (ghost) { ghost.remove(); ghost = null; }
      if (!moved) {                                   // тап (без перетаскивания)
        hideGap();
        if (!fromStack && asm.placed.indexOf(key) === -1) { asm.placed.push(key); render(); afterPlace(); }
        return;
      }
      var over = overStage(e.clientX, e.clientY);
      var idx = over ? insertIndexAt(e.clientY) : -1;
      hideGap();
      if (over) { asm.placed.splice(idx, 0, key); render(); afterPlace(); }
      else render();   // вне платформы: из стопки — вернётся в набор, из набора — без изменений
    }
  }
  function buildGhost(key) {
    var ing = byKey[key];
    var g = document.createElement("div");
    g.className = "nj-chip nj-ghost";
    g.innerHTML = ing.gly + "<span>" + ing.label + "</span>";
    return g;
  }
  function overStage(x, y) {
    var r = stage.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  function insertIndexAt(y) {
    var layers = Array.prototype.slice.call(stage.querySelectorAll(".nj-layer"));
    for (var i = 0; i < layers.length; i++) {
      var r = layers[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return layers.length;
  }
  function showGap(idx) {
    hideGap();
    gapEl = document.createElement("div");
    gapEl.className = "nj-gap";
    var layers = stage.querySelectorAll(".nj-layer");
    if (idx >= layers.length) stage.appendChild(gapEl);
    else stage.insertBefore(gapEl, layers[idx]);
  }
  function hideGap() { if (gapEl) { gapEl.remove(); gapEl = null; } }
  function afterPlace() { if (asm.placed.length === ING.length && asm.round === 2) njAsmCheck(); }

  window.njAsmReset = function () {
    if (asm.timer) { clearInterval(asm.timer); asm.timer = null; }
    asm.running = false;
    initPoolOrder(); clearAll();
    var fb = document.getElementById("fb-asm"); if (fb) fb.className = "ku-feedback";
    if (asm.round === 2) resetTimerBadge();
  };

  window.njAsmCheck = function () {
    var arr = asm.placed.map(function (k) { return byKey[k].idx; });
    var full = arr.length === ING.length;
    var rev = CORRECT.slice().reverse();
    var ok = full && (eqArr(arr, CORRECT) || eqArr(arr, rev));

    if (asm.round === 1) {
      if (!full) { feedback("fb-asm", false, "", "<strong>Пока не всё.</strong> Поставь на платформу все 8 ингредиентов."); return; }
      if (ok) {
        feedback("fb-asm", true, "<strong>Верный порядок!</strong> Теперь собери то же самое на время.");
        goRound2();
      } else {
        markWrong();
        feedback("fb-asm", false, "", "<strong>Порядок сбит.</strong> Соус — сразу после томата, огурцы — перед котлетой, булочки — по краям. Поправь и проверь снова.");
      }
      return;
    }
    // round 2 — на время
    if (!full) return;
    if (ok) {
      if (asm.timer) { clearInterval(asm.timer); asm.timer = null; }
      asm.running = false;
      markDone("assembly");
      njUpdateGates();
      feedback("fb-asm", true, "<strong>Готово, и вовремя!</strong> Сборку Воппера ты знаешь.");
    } else {
      markWrong();
      feedback("fb-asm", false, "", "<strong>Почти!</strong> Порядок неверный — поправь слои местами, пока идёт время.");
    }
  };

  function markWrong() {
    var arr = asm.placed.map(function (k) { return byKey[k].idx; });
    var rev = CORRECT.slice().reverse();
    var target = missCount(arr, rev) < missCount(arr, CORRECT) ? rev : CORRECT;
    var bad = -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i] !== target[i]) { bad = i; break; } }
    if (bad === -1) return;
    var layer = stage.querySelectorAll(".nj-layer")[bad];
    if (layer) { layer.classList.add("wrong", "ku-shake"); setTimeout(function () { layer.classList.remove("ku-shake"); }, 500); }
  }

  function goRound2() {
    asm.round = 2;
    document.querySelectorAll("#asm-rounds .nj-round-pill").forEach(function (p) {
      var r = +p.getAttribute("data-round");
      p.classList.toggle("active", r === 2);
      p.classList.toggle("done", r === 1);
    });
    document.getElementById("asm-check").style.display = "none";
    document.getElementById("asm-start").style.display = "";
    document.getElementById("asm-timer").style.display = "";
    resetTimerBadge();
    // не сбрасываем платформу сразу — даём нажать «Старт»
  }
  function resetTimerBadge() {
    asm.timeLeft = 40;
    var t = document.getElementById("asm-timer");
    if (t) { t.classList.remove("solid"); t.innerHTML = '<svg class="ku-ico s"><use href="#i-clock"/></svg> 0:' + pad(asm.timeLeft); }
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  window.njAsmStart = function () {
    initPoolOrder(); clearAll();
    var fb = document.getElementById("fb-asm"); if (fb) fb.className = "ku-feedback";
    resetTimerBadge();
    asm.running = true;
    if (asm.timer) clearInterval(asm.timer);
    asm.timer = setInterval(function () {
      asm.timeLeft--;
      var t = document.getElementById("asm-timer");
      if (t) { t.innerHTML = '<svg class="ku-ico s"><use href="#i-clock"/></svg> 0:' + pad(Math.max(0, asm.timeLeft)); t.classList.toggle("solid", asm.timeLeft <= 10); }
      if (asm.timeLeft <= 0) {
        clearInterval(asm.timer); asm.timer = null; asm.running = false;
        feedback("fb-asm", false, "", "<strong>Время вышло.</strong> Это тренировка на скорость — нажми «Старт на время» и попробуй ещё раз.");
      }
    }, 1000);
  };

  /* ══ ИГРА 2 — УПАКОВКА ═════════════════════════════════════════════════ */
  /* Шаг 1 — поворот бумаги. Верно = оранжевый лого к сборщику (низ листа).
     В исходном PNG оранжевый лого снизу → правильный угол = 0°.
     Старт со случайного неверного угла. */
  var CORRECT_ROT = 0;
  var paperRot = 0;

  function initPaper() {
    var img = document.getElementById("pack-paper");
    if (!img) return;
    var wrong = [90, 180, 270];
    paperRot = wrong[Math.floor(Math.random() * wrong.length)];
    applyRot();
    img.addEventListener("click", function () { paperRot = (paperRot + 90) % 360; applyRot(); });
    img.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); paperRot = (paperRot + 90) % 360; applyRot(); }
    });
  }
  function applyRot() {
    var img = document.getElementById("pack-paper");
    if (img) img.style.setProperty("--nj-rot", paperRot + "deg");
  }
  window.njPaperConfirm = function () {
    if (paperRot % 360 === CORRECT_ROT) {
      feedback("fb-paper", true, "<strong>Верно!</strong> Оранжевый лого смотрит на сборщика — так и надо. Нажми «Далее».");
      var pc = document.getElementById("paper-confirm"), pn = document.getElementById("paper-next");
      if (pc) pc.style.display = "none";
      if (pn) pn.style.display = "";
    } else {
      feedback("fb-paper", false, "", "<strong>Не та сторона.</strong> Вспомни стандарт: какой стороной лист должен лежать к сборщику. Поверни лист и попробуй снова.");
    }
  };
  window.njPaperNext = function () {
    document.getElementById("pack-step-1").classList.remove("active");
    document.getElementById("pack-step-2").classList.add("active");
  };

  /* Шаг 2 — свайп бургера по оси Y. Цель — печатная линия сгиба «Воппер» на
     бумаге (~32% сверху). Засчитывается по НИЖНЕМУ краю Воппера на линии. */
  var TARGET_PCT = 31, TOL = 5, burgerPct = 80, dragging = false;

  function initBurger() {
    var burger = document.getElementById("wrap-burger"), stg = document.getElementById("wrap-stage");
    if (!burger || !stg) return;
    setBurger(80);
    burger.addEventListener("pointerdown", function (e) {
      dragging = true;
      try { burger.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    burger.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var r = stg.getBoundingClientRect();
      var pct = ((e.clientY - r.top) / r.height) * 100;
      setBurger(Math.max(8, Math.min(92, pct)));
    });
    function end() { dragging = false; }
    burger.addEventListener("pointerup", end);
    burger.addEventListener("pointercancel", end);
  }
  function setBurger(pct) {
    burgerPct = pct;
    var b = document.getElementById("wrap-burger");
    if (b) b.style.top = pct + "%";
  }
  window.njBurgerConfirm = function () {
    var stg = document.getElementById("wrap-stage"), b = document.getElementById("wrap-burger");
    if (!stg || !b) return;
    var sr = stg.getBoundingClientRect(), br = b.getBoundingClientRect();
    var bottomPct = ((br.bottom - sr.top) / sr.height) * 100;   // нижний край Воппера
    var ok = Math.abs(bottomPct - TARGET_PCT) <= TOL;
    if (ok) {
      var halfH = (br.height / 2) / sr.height * 100;
      setBurger(TARGET_PCT - halfH);                            // нижний край ровно на линию
      b.classList.add("snapped");
      var t = document.getElementById("wrap-target");
      if (t) { t.style.top = TARGET_PCT + "%"; t.classList.add("hit"); }
      markDone("packaging");
      njUpdateGates();
      feedback("fb-burger", true, "<strong>Готово!</strong> Нижний край Воппера лёг ровно на линию «Воппер».");
    } else {
      var dir = bottomPct > TARGET_PCT ? "выше" : "ниже";
      feedback("fb-burger", false, "", "<strong>Пока мимо.</strong> Смотри на бумагу: нижний край Воппера должен лечь на нужную линию. Сдвинь чуть " + dir + ".");
    }
  };

  /* ══ РЕЗУЛЬТАТЫ ════════════════════════════════════════════════════════
     Сюда попадаешь, только пройдя обе игры (гейт на ch3), поэтому всё
     зачтено. Видео — по желанию (пометка один раз). */
  var VIDS = {
    whopper:   { page: "v-whopper",  title: "Сборка классического Воппера" },
    paper:     { page: "v-paper",    title: "Заворот бумаги (à la française)" },
    clamshell: { page: "v-clamshell", title: "Закрытие кламшелла" }
  };
  function row(title, sub) {
    return '<div class="nj-result-row pass">' +
      '<span class="nj-r-ico"><svg class="ku-ico s"><use href="#i-check-check"/></svg></span>' +
      '<div><div class="nj-result-row__t">' + title + '</div>' +
      '<div class="nj-result-row__s">' + sub + '</div></div></div>';
  }
  function vidCard(key) {
    var v = VIDS[key], watched = isDone("vid-" + key);
    return '<div class="nj-vid-card' + (watched ? " done" : "") + '"><div class="nj-vid-card__top">' +
      '<svg class="ku-ico brand"><use href="#i-play"/></svg>' +
      '<span class="nj-vid-card__title">' + v.title + '</span></div>' +
      '<div class="nj-controls"><button class="ku-btn soft s" onclick="kuNavigate(\'' + v.page + '\')">' +
      '<svg class="ku-ico"><use href="#i-play"/></svg> ' + (watched ? "Пересмотреть" : "Смотреть") + '</button></div></div>';
  }
  function buildResults() {
    var rowsEl = document.getElementById("res-rows"), vidsEl = document.getElementById("res-videos");
    if (!rowsEl || !vidsEl) return;
    rowsEl.innerHTML = row("Сборка Воппера", "Пройдено — порядок и скорость.") +
                       row("Закрытие и заворот упаковки", "Пройдено — сторона и позиция.");
    vidsEl.innerHTML = vidCard("whopper") + vidCard("paper") + vidCard("clamshell");
    var lead = document.getElementById("res-lead"), vnote = document.getElementById("res-vid-note"),
        note = document.getElementById("res-complete-note"), btn = document.getElementById("res-complete");
    if (lead) lead.textContent = "Обе игры пройдены — отличная работа!";
    if (vnote) vnote.textContent = "Эти видео — по желанию, для закрепления приёмов.";
    if (note) note.textContent = "Всё готово — можно завершать курс.";
    if (btn) btn.disabled = false;
  }
  window.njWatched = function (key) { markDone("vid-" + key); kuNavigate("results"); };

  /* ══ ТЕСТ ПО СОУСУ (сабмит, не блокирующий) ════════════════════════════ */
  document.addEventListener("click", function (e) {     // одиночный выбор варианта
    var c = e.target.closest(".nj-choice");
    if (!c) return;
    var q = c.closest(".nj-q"); if (!q) return;
    q.querySelectorAll(".nj-choice").forEach(function (b) { b.classList.remove("selected", "correct", "wrong"); });
    c.classList.add("selected");
  });
  window.njSauceCheck = function () {
    var ex = document.getElementById("sauce-test"); if (!ex) return;
    var qs = ex.querySelectorAll(".nj-q"), answered = true, correct = 0, total = qs.length;
    qs.forEach(function (q) {
      if (q.getAttribute("data-q") === "3") {           // сопоставление
        var sels = q.querySelectorAll(".nj-match__sel"), allSel = true, allRight = true;
        sels.forEach(function (s) {
          s.classList.remove("nj-ok", "nj-bad");
          if (!s.value) { allSel = false; return; }
          var good = s.value === s.getAttribute("data-correct");
          s.classList.add(good ? "nj-ok" : "nj-bad");
          if (!good) allRight = false;
        });
        if (!allSel) answered = false; else if (allRight) correct++;
      } else {                                          // одиночный выбор
        var sel = q.querySelector(".nj-choice.selected");
        if (!sel) { answered = false; return; }
        q.querySelectorAll(".nj-choice").forEach(function (b) { b.classList.remove("correct", "wrong"); });
        var ok = sel.getAttribute("data-correct") === "1";
        sel.classList.add(ok ? "correct" : "wrong");
        if (!ok) { var right = q.querySelector('.nj-choice[data-correct="1"]'); if (right) right.classList.add("correct"); }
        if (ok) correct++;
      }
    });
    if (!answered) { feedback("fb-sauce", false, "", "<strong>Ответь на все вопросы.</strong> Выбери вариант в каждом задании."); return; }
    var all = correct === total, fb = document.getElementById("fb-sauce");
    fb.className = "ku-feedback show " + (all ? "correct" : "incorrect");
    fb.innerHTML = '<span class="ku-fb-msg">' + (all
      ? "<strong>Отлично!</strong> Все ответы верны."
      : "<strong>Верно " + correct + " из " + total + ".</strong> Посмотри разбор ниже.") + "</span>";
    var rec = document.getElementById("sauce-rec"); if (rec) rec.hidden = all;
    var after = document.getElementById("sauce-after"); if (after) { after.hidden = false; after.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    markDone("sauce-test");                              // зачёт по факту прохождения
    njUpdateGates();
  };

  /* ══ НАВИГАЦИЯ · ГЕЙТИНГ · ВИДЕО ═══════════════════════════════════════ */
  var navHist = [];

  function currentPageId() {
    var a = document.querySelector(".ku-page.active");
    return a ? a.id.replace("ku-page-", "") : null;
  }
  // Последовательное прохождение (по факту, не по результату):
  //  ch2 открыт после просмотра ch1; ch3 — после прохождения теста по соусу.
  window.njGoChapter = function (id) {
    if (id === "ch2" && !isDone("ch1-seen")) return;
    if (id === "ch3" && !isDone("sauce-test")) return;
    kuNavigate(id);
  };
  function njUpdateGates() {
    var c2 = document.getElementById("ku-home-card-2"), c3 = document.getElementById("ku-home-card-3");
    if (c2) c2.classList.toggle("locked", !isDone("ch1-seen"));
    if (c3) c3.classList.toggle("locked", !isDone("sauce-test"));
    var nx = document.getElementById("ch3-next");
    if (nx) {
      var ready = isDone("assembly") && isDone("packaging");
      nx.disabled = !ready;
      var hint = document.getElementById("ch3-next-hint");
      if (hint) hint.textContent = ready ? "" : "Пройди обе игры, чтобы продолжить.";
    }
  }
  function njManageVideos() {                            // грузим видео активной страницы, гасим остальные (R16)
    document.querySelectorAll(".ku-page").forEach(function (pg) {
      var active = pg.classList.contains("active");
      pg.querySelectorAll("iframe[data-src]").forEach(function (f) {
        if (active) { if (!f.getAttribute("src")) f.setAttribute("src", f.getAttribute("data-src")); }
        else if (f.getAttribute("src")) f.removeAttribute("src");
      });
    });
  }
  function afterNav(id) {
    if (id === "ch1") markDone("ch1-seen");
    njManageVideos();
    njUpdateGates();
    if (id === "results") buildResults();
    var bk = document.getElementById("nj-back");
    if (bk) bk.hidden = (id === "home" || !id);
  }
  function wrapNavigate() {
    if (typeof window.kuNavigate !== "function") return;
    var orig = window.kuNavigate;
    window.kuNavigate = function (id) {
      var cur = currentPageId();
      if (cur && cur !== id) navHist.push(cur);
      orig(id);
      afterNav(id);
    };
    window.njBack = function () {
      if (!navHist.length) return;
      var prev = navHist.pop();
      orig(prev);
      afterNav(prev);
    };
  }

  /* ══ ИНИЦИАЛИЗАЦИЯ ═════════════════════════════════════════════════════ */
  function init() {
    stage = document.getElementById("asm-stage");
    pool = document.getElementById("asm-pool");
    if (pool) { initPoolOrder(); renderPool(); }
    initPaper();
    initBurger();
    wrapNavigate();
    njManageVideos();
    njUpdateGates();
    buildResults();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  // после ku:ready DS сам зовёт applyLocks — откладываем свой апдейт, чтобы наши замки были последними
  document.addEventListener("ku:ready", function () { setTimeout(function () { njUpdateGates(); buildResults(); }, 0); });
})();

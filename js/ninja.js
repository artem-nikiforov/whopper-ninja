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
  function spiral() { return '<svg class="nj-gly nj-gly--sauce" viewBox="0 0 30 18"><rect x="2" y="3" width="26" height="12" rx="6" fill="#efe6cf"/><path d="M15 9 m-5 0 a5 5 0 1 1 5 5 a3.2 3.2 0 1 1-3.2-3.2 a1.6 1.6 0 1 1 1.6 1.6" fill="none" stroke="#12100e" stroke-width="1.7"/></svg>'; }
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
      if (!moved) { hideGap(); return; }
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
      feedback("fb-paper", true, "<strong>Верно!</strong> Оранжевый лого смотрит на сборщика — так и надо.");
      setTimeout(function () {
        document.getElementById("pack-step-1").classList.remove("active");
        document.getElementById("pack-step-2").classList.add("active");
      }, 700);
    } else {
      feedback("fb-paper", false, "", "<strong>Не та сторона.</strong> К сборщику должен смотреть <em>оранжевый</em> лого. Поворачивай лист нажатием.");
    }
  };

  /* Шаг 2 — свайп бургера по оси Y к отметке «Воппер». */
  var TARGET_PCT = 33, TOL = 7, burgerPct = 80, dragging = false;

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
    var ok = Math.abs(burgerPct - TARGET_PCT) <= TOL;
    if (ok) {
      var b = document.getElementById("wrap-burger");
      if (b) { b.classList.add("snapped"); b.style.top = TARGET_PCT + "%"; }
      markDone("packaging");
      feedback("fb-burger", true, "<strong>Точно на отметке «Воппер»!</strong> Упаковку ты закрыл верно.");
    } else {
      var dir = burgerPct > TARGET_PCT ? "выше" : "ниже";
      feedback("fb-burger", false, "", "<strong>Мимо отметки.</strong> Подвинь Воппер чуть " + dir + " — точно на пунктирную линию «Воппер».");
    }
  };

  /* ══ РЕЗУЛЬТАТЫ + ГЕЙТИНГ ══════════════════════════════════════════════ */
  var VIDS = {
    whopper:   { page: "v-whopper",  title: "Сборка классического Воппера" },
    paper:     { page: "v-paper",    title: "Заворот бумаги (à la française)" },
    clamshell: { page: "v-clamshell", title: "Закрытие кламшелла" }
  };

  function row(pass, title, subPass, subFail) {
    return '<div class="nj-result-row ' + (pass ? "pass" : "fail") + '">' +
      '<span class="nj-r-ico"><svg class="ku-ico s"><use href="#' + (pass ? "i-check-check" : "i-x") + '"/></svg></span>' +
      '<div><div class="nj-result-row__t">' + title + '</div>' +
      '<div class="nj-result-row__s">' + (pass ? subPass : subFail) + '</div></div></div>';
  }

  function vidCard(key, required) {
    var v = VIDS[key], watched = isDone("vid-" + key);
    var tag = watched ? '<span class="nj-tag done">Просмотрено</span>'
      : (required ? '<span class="nj-tag req">Обязательно</span>' : '<span class="nj-tag opt">По желанию</span>');
    var cls = "nj-vid-card" + (required ? " req" : "") + (watched ? " done" : "");
    var btn = '<button class="ku-btn ' + (required && !watched ? "primary" : "soft") + ' s" onclick="kuNavigate(\'' + v.page + '\')">' +
      '<svg class="ku-ico"><use href="#i-play"/></svg> ' + (watched ? "Пересмотреть" : "Смотреть") + '</button>';
    return '<div class="' + cls + '"><div class="nj-vid-card__top">' +
      '<svg class="ku-ico brand"><use href="#i-play"/></svg>' +
      '<span class="nj-vid-card__title">' + v.title + '</span>' + tag + '</div>' +
      '<div class="nj-controls">' + btn + '</div></div>';
  }

  function buildResults() {
    var rowsEl = document.getElementById("res-rows"),
        vidsEl = document.getElementById("res-videos");
    if (!rowsEl || !vidsEl) return;
    var asmPass = isDone("assembly"), packPass = isDone("packaging");

    rowsEl.innerHTML =
      row(asmPass, "Сборка Воппера",
        "Пройдено — порядок и скорость.",
        "Не зачтено — собери Воппер на время в главе 3.") +
      row(packPass, "Закрытие и заворот упаковки",
        "Пройдено — сторона и позиция верны.",
        "Не зачтено — поверни бумагу и поставь Воппер на отметку в главе 3.");

    // обязательность видео зависит от провала
    var reqWhopper = !asmPass, reqPaper = !packPass;
    vidsEl.innerHTML =
      vidCard("whopper", reqWhopper) +
      vidCard("paper", reqPaper) +
      vidCard("clamshell", false);

    // гейт кнопки «Завершить»
    var need = [];
    if (reqWhopper) need.push("whopper");
    if (reqPaper) need.push("paper");
    var pending = need.filter(function (k) { return !isDone("vid-" + k); });

    var btn = document.getElementById("res-complete"),
        note = document.getElementById("res-complete-note"),
        lead = document.getElementById("res-lead"),
        vnote = document.getElementById("res-vid-note");

    if (asmPass && packPass) {
      lead.textContent = "Обе игры пройдены — отличная работа! Видео ниже можно посмотреть по желанию.";
      vnote.textContent = "Все видео — по желанию: пересмотри, если хочешь освежить приёмы.";
    } else {
      lead.textContent = "Разбираем итог. Что не зачтено — закрой обязательным видео, затем завершай курс.";
      vnote.textContent = "Отмеченное «Обязательно» нужно посмотреть, чтобы открыть кнопку «Завершить курс».";
    }

    if (pending.length === 0) {
      btn.disabled = false;
      note.textContent = (asmPass && packPass)
        ? "Всё готово — завершай курс."
        : "Обязательные видео просмотрены — можно завершать.";
    } else {
      btn.disabled = true;
      note.textContent = "Посмотри обязательные видео выше (осталось: " + pending.length + ").";
    }
  }

  window.njWatched = function (key) {
    markDone("vid-" + key);
    kuNavigate("results");
    buildResults();
  };

  /* Пересобирать результаты при каждом заходе на экран results. */
  function wrapNavigate() {
    if (typeof window.kuNavigate !== "function") return;
    var orig = window.kuNavigate;
    window.kuNavigate = function (id) {
      orig(id);
      if (id === "results") buildResults();
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
    buildResults();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  // при восстановлении прогресса из LMS/localStorage — обновить результаты
  document.addEventListener("ku:ready", buildResults);
})();

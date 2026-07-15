(() => {
  const STORAGE_KEY = "wochenplaner.tasks.v1";
  const MEMBERS_KEY = "wochenplaner.members.v1";
  const THEME_KEY = "wochenplaner.theme";
  const PRIVACY_KEY = "wochenplaner.hidePrivate";
  const ME_KEY = "wochenplaner.me.v1";
  const ROUTINES_KEY = "wochenplaner.routines.v1";
  const SKIPS_KEY = "wochenplaner.routineSkips.v1";
  const GROUP_KEY = "wochenplaner.group.v1";
  const TOMBS_KEY = "wochenplaner.tombstones.v1";
  const SHOP_KEY = "wochenplaner.shop.v1";
  // Speicher ohne Konto/Anmeldung; Inhalte sind vor dem Upload verschlüsselt
  const STORE_READ = "https://textdb.online/";
  const STORE_WRITE = "https://textdb.online/update/";
  const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const DATE_FMT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
  const RANGE_FMT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const PRIO_ORDER = ["none", "low", "med", "high"];
  const PRIO_WEIGHT = { high: 0, med: 1, low: 2, none: 3 };
  const EMPTY_HINTS = ["Nichts geplant", "Freier Tag", "Noch leer", "Zeit für euch"];
  const CONFETTI_COLORS = ["#c05a28", "#d9a13b", "#7d9c6e", "#c8462e", "#e0a878"];
  const MEMBER_COLORS = ["#c05a28", "#5b7fa6", "#7d9c6e", "#b0568c", "#d9a13b", "#7a6bb0", "#3f8f8a", "#8a6f4d"];

  const board = document.getElementById("board");
  const dayTemplate = document.getElementById("dayTemplate");
  const taskTemplate = document.getElementById("taskTemplate");
  const weekRangeEl = document.getElementById("weekRange");
  const weekNumberEl = document.getElementById("weekNumber");
  const statsTextEl = document.getElementById("statsText");
  const statsFillEl = document.getElementById("statsFill");
  const statsPctEl = document.getElementById("statsPct");
  const memberStatsEl = document.getElementById("memberStats");
  const famModal = document.getElementById("famModal");
  const memberListEl = document.getElementById("memberList");
  const privacyBtn = document.getElementById("privacyBtn");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vtOk = () => !reducedMotion && typeof document.startViewTransition === "function";

  let data = loadJSON(STORAGE_KEY, {});
  let members = loadJSON(MEMBERS_KEY, []);
  let routines = loadJSON(ROUTINES_KEY, []);
  let routineSkips = new Set(loadJSON(SKIPS_KEY, []));
  let group = loadJSON(GROUP_KEY, null); // {bucket, key} für den Handy-Sync
  let tombs = loadJSON(TOMBS_KEY, { tasks: {}, members: {}, routines: {}, shop: {} });
  if (!tombs.shop) tombs.shop = {};
  let shop = loadJSON(SHOP_KEY, []);
  let currentWeekStart = startOfWeek(new Date());
  let dragInfo = null;
  let filterMember = null; // null = alle, "open" = nicht zugewiesen, sonst member.id
  let hidePrivate = localStorage.getItem(PRIVACY_KEY) === "1";
  let me = localStorage.getItem(ME_KEY) || null; // wer dieses Gerät benutzt

  const mobileQuery = window.matchMedia("(max-width: 640px)");
  let selectedDayIdx = (new Date().getDay() + 6) % 7; // heute vorausgewählt
  mobileQuery.addEventListener("change", () => render());
  const dayStrip = document.getElementById("dayStrip");

  /* ---------- storage ---------- */

  function loadJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function saveMembers() {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
  }

  function saveRoutines() {
    localStorage.setItem(ROUTINES_KEY, JSON.stringify(routines));
    localStorage.setItem(SKIPS_KEY, JSON.stringify([...routineSkips]));
  }

  function saveShop() {
    localStorage.setItem(SHOP_KEY, JSON.stringify(shop));
  }

  // Wiederholungs-Arten
  const FREQ = ["weekly", "daily", "weekdays", "biweekly", "monthly"];
  const FREQ_TEXT = {
    weekly: "Jede Woche an diesem Tag",
    daily: "Jeden Tag",
    weekdays: "Montags bis freitags",
    biweekly: "Jede 2. Woche an diesem Tag",
    monthly: "Einmal im Monat (an diesem Datum)",
  };
  const FREQ_KURZ = { weekly: "wöchentlich", daily: "täglich", weekdays: "Mo–Fr", biweekly: "2-wöchentlich", monthly: "monatlich" };

  // An welchen Tagen dieser Woche soll die Routine erscheinen?
  function routineDays(r, weekStart) {
    const freq = r.freq || "weekly";
    const tage = [];
    const push = (i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      tage.push(d);
    };
    if (freq === "daily") { for (let i = 0; i < 7; i++) push(i); }
    else if (freq === "weekdays") { for (let i = 0; i < 5; i++) push(i); }
    else if (freq === "biweekly") {
      const start = dateFromKey(r.createdWeek || toKey(weekStart));
      const wochen = Math.round((weekStart - startOfWeek(start)) / (7 * 86400000));
      if (wochen % 2 === 0) push(r.dayIdx);
    } else if (freq === "monthly") {
      const tagImMonat = r.monthDay || dateFromKey(r.createdWeek).getDate();
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        if (d.getDate() === tagImMonat) tage.push(d);
      }
    } else push(r.dayIdx); // weekly
    return tage;
  }

  // Routinen für die angezeigte Woche anlegen (überspringt einzeln Gelöschtes)
  function materializeRoutines(weekStart) {
    if (!routines.length) return;
    const weekKey = toKey(weekStart);
    let changed = false;
    routines.forEach((r) => {
      if (r.createdWeek && weekKey < r.createdWeek) return;
      routineDays(r, weekStart).forEach((d) => {
        const dayKey = toKey(d);
        if (routineSkips.has(`${r.id}:${dayKey}`) || routineSkips.has(`${r.id}:${weekKey}`)) return;
        if ((data[dayKey] || []).some((t) => t.routineId === r.id)) return;
        if (!data[dayKey]) data[dayKey] = [];
        data[dayKey].push({
          // deterministische ID: beide Handys erzeugen dieselbe Instanz -> kein Duplikat beim Sync
          id: `r-${r.id}-${dayKey}`,
          routineId: r.id,
          text: r.text,
          time: r.time || "",
          prio: r.prio || "none",
          assignee: r.assignee || null,
          private: !!r.private,
          kind: r.kind || "task",
          from: r.from || null,
          note: "",
          done: false,
          u: Date.now(),
        });
        changed = true;
      });
    });
    if (changed) {
      saveData();
      markDirty(weekKey);
    }
  }

  function memberById(id) {
    return members.find((m) => m.id === id) || null;
  }

  /* ---------- dates ---------- */

  function startOfWeek(date) {
    const d = new Date(date);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function toKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  function weekDates(weekStart) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  /* ---------- rendering ---------- */

  function sortTasks(tasks) {
    // Sobald ein Tag von Hand sortiert wurde, gilt diese Reihenfolge
    const handSortiert = tasks.some((t) => typeof t.ord === "number");
    return tasks.slice().sort((a, b) => {
      // Erledigtes sinkt nach unten, Offenes bleibt im Blick
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (handSortiert) {
        const ao = typeof a.ord === "number" ? a.ord : Infinity;
        const bo = typeof b.ord === "number" ? b.ord : Infinity;
        if (ao !== bo) return ao - bo;
      }
      const t = (a.time || "99:99").localeCompare(b.time || "99:99");
      if (t !== 0) return t;
      return (PRIO_WEIGHT[a.prio] ?? 3) - (PRIO_WEIGHT[b.prio] ?? 3);
    });
  }

  // Reihenfolge in der Tagesspalte: Erinnerungen, Aufgaben, Privates
  function groupOf(task) {
    if (task.kind === "reminder") return 0;
    if (task.private) return 2;
    return 1;
  }

  // Datenschutz-Sichtbarkeit: Erinnerungen sieht nur der Empfänger und
  // der Absender. Gilt auch für alle Zähler, damit nichts durchsickert.
  function canSee(task) {
    if (hidePrivate && task.private) return false;
    if (task.kind === "reminder") {
      const recipient = memberById(task.assignee);
      if (!recipient) return true; // Empfänger gelöscht -> wieder für alle
      return me === task.assignee || me === task.from;
    }
    return true;
  }

  function taskVisible(task) {
    if (!canSee(task)) return false;
    if (filterMember === "open") return !task.assignee || !memberById(task.assignee);
    if (filterMember) return task.assignee === filterMember;
    return true;
  }

  function visibleTasks(dayKey) {
    return (data[dayKey] || []).filter(canSee);
  }

  // Nur neu aufbauen, wenn sich die Struktur wirklich ändert (Woche, Tag, Ansicht)
  let builtSig = null;

  function boardSig() {
    // heutiges Datum mitzählen: sonst bleibt der HEUTE-Marker über Mitternacht stehen
    return `${toKey(currentWeekStart)}|${mobileQuery.matches ? `d${selectedDayIdx}` : "week"}|${toKey(new Date())}`;
  }

  // Punkt Mitternacht neu zeichnen, damit „Heute" mitwandert
  function scheduleMidnight() {
    const jetzt = new Date();
    const mitternacht = new Date(jetzt);
    mitternacht.setHours(24, 0, 5, 0); // 5 Sek. Puffer
    setTimeout(() => {
      const heuteIdx = (new Date().getDay() + 6) % 7;
      // Wer die aktuelle Woche ansieht, wandert automatisch auf den neuen Tag
      if (toKey(currentWeekStart) !== toKey(startOfWeek(new Date()))) {
        currentWeekStart = startOfWeek(new Date());
      }
      if (mobileQuery.matches) selectedDayIdx = heuteIdx;
      render();
      checkDue();
      scheduleMidnight();
    }, mitternacht - jetzt);
  }
  scheduleMidnight();

  function render() {
    materializeRoutines(currentWeekStart);
    const dates = weekDates(currentWeekStart);
    const todayKey = toKey(new Date());
    const mobile = mobileQuery.matches;
    const sig = boardSig();

    board.classList.toggle("single-day", mobile);
    dayStrip.hidden = !mobile;
    if (mobile) renderDayStrip(dates, todayKey);

    if (sig === builtSig && board.children.length) {
      refreshBoard(dates); // Spalten bleiben stehen, nur Inhalte anpassen
    } else {
      buildBoard(dates, todayKey, mobile);
      builtSig = sig;
    }

    weekRangeEl.textContent = `${RANGE_FMT.format(dates[0])} – ${RANGE_FMT.format(dates[6])}`;
    weekNumberEl.textContent = `KW ${isoWeekNumber(dates[0])}`;
    animateWeekLabel(toKey(dates[0]));
    updateWeekStats(dates);
    updateScrollFade();
    updateWelcome();
    updateSuggestions();
  }

  // Inhalte auffrischen, ohne Spalten, Eingabefelder oder Scrollposition anzutasten
  function refreshBoard(dates) {
    [...board.children].forEach((col) => {
      const key = col.dataset.day;
      if (!key) return;
      renderTasks(col.querySelector(".task-list"), key, sortTasks(data[key] || []).filter(taskVisible));
      updateProgress(col.querySelector(".day-progress"), visibleTasks(key));
    });
  }

  // Einen einzelnen Tag auffrischen (z. B. nach Löschen oder Abhaken)
  function refreshDay(dayKey) {
    const col = [...board.children].find((c) => c.dataset.day === dayKey);
    if (col) {
      renderTasks(col.querySelector(".task-list"), dayKey, sortTasks(data[dayKey] || []).filter(taskVisible));
      updateProgress(col.querySelector(".day-progress"), visibleTasks(dayKey));
    }
    updateWeekStats(weekDates(currentWeekStart));
    if (mobileQuery.matches) renderDayStrip(weekDates(currentWeekStart), toKey(new Date()));
  }

  function buildBoard(dates, todayKey, mobile) {
    board.innerHTML = "";
    dates.forEach((date, i) => {
      if (mobile && i !== selectedDayIdx) return;
      const key = toKey(date);
      const frag = dayTemplate.content.cloneNode(true);
      const col = frag.querySelector(".day-col");
      col.dataset.day = key;
      col.style.setProperty("--i", i);
      if (vtOk()) col.style.viewTransitionName = `day-${key}`;
      if (key === todayKey) col.classList.add("is-today");

      frag.querySelector(".day-name").textContent = DAY_NAMES[i];
      if (key === todayKey) {
        const tag = document.createElement("span");
        tag.className = "today-tag";
        tag.textContent = "Heute";
        frag.querySelector(".day-name").appendChild(tag);
      }
      frag.querySelector(".day-date").textContent = DATE_FMT.format(date);

      // Composer: Formular erst auf Klick zeigen
      const ghost = frag.querySelector(".add-ghost");
      ghost.addEventListener("click", () => {
        col.classList.add("composing");
        col.querySelector(".add-input").focus();
      });

      const list = frag.querySelector(".task-list");
      const tasks = sortTasks(data[key] || []).filter(taskVisible);
      renderTasks(list, key, tasks);
      updateProgress(frag.querySelector(".day-progress"), visibleTasks(key));
      setupDropZone(list, key);
      setupAddForm(frag.querySelector(".add-form"), key);

      board.appendChild(frag);
    });
  }

  /* Eingabe-Vorschläge: lernen aus euren bisherigen Aufgaben */
  const DEFAULT_SUGGESTIONS = [
    "Staubsaugen", "Müll rausbringen", "Wocheneinkauf", "Wäsche waschen",
    "Spülmaschine ausräumen", "Bad putzen", "Kochen", "Blumen gießen",
    "Betten frisch beziehen", "Altglas wegbringen",
  ];

  function updateSuggestions() {
    const counts = new Map();
    Object.values(data).forEach((list) =>
      list.forEach((t) => {
        const text = (t.text || "").trim();
        if (!text) return;
        const k = text.toLowerCase();
        const e = counts.get(k) || { text, n: 0, last: 0 };
        e.n++;
        e.last = Math.max(e.last, t.u || 0);
        counts.set(k, e);
      })
    );
    // häufig Genutztes zuerst, danach die Standard-Ideen
    const own = [...counts.values()]
      .sort((a, b) => b.n - a.n || b.last - a.last)
      .map((e) => e.text);
    const seen = new Set();
    const final = [...own, ...DEFAULT_SUGGESTIONS].filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 20);

    const dl = document.getElementById("choreSuggestions");
    dl.innerHTML = "";
    final.forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      dl.appendChild(o);
    });
  }

  /* Wochenlabel sanft überblenden, wenn die Woche wechselt */
  let lastWeekKey = null;
  function animateWeekLabel(weekKey) {
    if (lastWeekKey !== null && lastWeekKey !== weekKey && !reducedMotion) {
      weekRangeEl.parentElement.animate(
        [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
    lastWeekKey = weekKey;
  }

  /* weiche Kanten, wenn das Board horizontal scrollt */
  function updateScrollFade() {
    board.classList.toggle("can-scroll", board.scrollWidth > board.clientWidth + 4);
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateScrollFade, 150);
  });

  /* Willkommens-Karte nur beim allerersten Start */
  function updateWelcome() {
    const isEmpty = !members.length && !Object.values(data).some((list) => list.length);
    document.getElementById("welcome").hidden = !isEmpty || welcomeDismissed;
  }

  let welcomeDismissed = sessionStorage.getItem("wochenplaner.welcomeSkip") === "1";
  document.getElementById("welcomeFam").addEventListener("click", () => openFamModal());
  document.getElementById("welcomeSkip").addEventListener("click", () => {
    welcomeDismissed = true;
    sessionStorage.setItem("wochenplaner.welcomeSkip", "1");
    updateWelcome();
  });

  function renderDayStrip(dates, todayKey) {
    dayStrip.innerHTML = "";
    const SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    dates.forEach((date, i) => {
      const key = toKey(date);
      const tasks = visibleTasks(key);
      const chip = document.createElement("button");
      chip.className = "day-chip";
      if (i === selectedDayIdx) chip.classList.add("active");
      if (key === todayKey) chip.classList.add("is-today");

      const name = document.createElement("span");
      name.className = "dc-name";
      name.textContent = SHORT[i];
      const dt = document.createElement("span");
      dt.className = "dc-date";
      dt.textContent = String(date.getDate()).padStart(2, "0");
      chip.append(name, dt);

      if (tasks.length) {
        const dot = document.createElement("span");
        dot.className = "dc-dot";
        if (tasks.every((t) => t.done)) dot.classList.add("all-done");
        chip.appendChild(dot);
      }
      if (me && tasks.some((t) => t.kind === "reminder" && t.assignee === me && !t.done)) {
        chip.classList.add("has-reminder");
      }

      chip.addEventListener("click", () => {
        if (i === selectedDayIdx) return;
        board.style.setProperty("--sx", i > selectedDayIdx ? "36px" : "-36px");
        selectedDayIdx = i;
        render();
      });

      dayStrip.appendChild(chip);
    });
  }

  function stepDay(dir) {
    let next = selectedDayIdx + dir;
    if (next < 0) {
      currentWeekStart.setDate(currentWeekStart.getDate() - 7);
      next = 6;
    } else if (next > 6) {
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      next = 0;
    }
    selectedDayIdx = next;
    board.style.setProperty("--sx", dir > 0 ? "36px" : "-36px");
    render();
  }

  // swipe left/right on the board to change the day (mobile)
  let touchX = null;
  let touchY = null;
  board.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  board.addEventListener("touchend", (e) => {
    if (touchX === null || !mobileQuery.matches) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) stepDay(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Wraps render() in a View Transition so adds, deletes and drags morph
  // smoothly (FLIP) instead of snapping. Falls back to a plain render.
  function animatedRender(after) {
    const doRender = () => {
      if (after) after();
      else render();
    };
    if (!vtOk()) {
      doRender();
      return;
    }
    document.documentElement.classList.add("vt");
    const t = document.startViewTransition(doRender);
    t.finished.finally(() => document.documentElement.classList.remove("vt"));
  }

  const GROUP_META = [
    { cls: "gl-reminder", label: "Erinnerungen", icon: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2a4 4 0 0 0-4 4v2.6L2.8 11h10.4L12 8.8V6.2a4 4 0 0 0-4-4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>' },
    { cls: "gl-task", label: "Aufgaben", icon: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { cls: "gl-private", label: "Privat", icon: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
  ];

  // Kennung aller sichtbaren Eigenschaften — ändert sie sich, wird die Karte aufgefrischt
  function taskSig(t) {
    return [
      typeof t.ord === "number" ? t.ord : "",
      t.done ? 1 : 0, t.text, t.time || "", t.prio || "none", t.assignee || "",
      t.private ? 1 : 0, t.kind || "task", t.from || "", t.note || "", t.routineId ? 1 : 0,
    ].join("");
  }

  function getTask(dayKey, id) {
    return (data[dayKey] || []).find((t) => t.id === id);
  }

  // Bestehende Karten behalten und nur anpassen — kein Neuaufbau, kein Flackern
  function renderTasks(list, dayKey, tasks) {
    if (!tasks.length) {
      if (!list.querySelector(".empty-hint")) {
        list.innerHTML = "";
        const hint = document.createElement("div");
        hint.className = "empty-hint";
        const img = document.createElement("img");
        img.className = "empty-img";
        img.src = "assets/empty.png";
        img.alt = "";
        img.width = 92;
        img.height = 92;
        const label = document.createElement("span");
        label.textContent = EMPTY_HINTS[hashCode(dayKey) % EMPTY_HINTS.length];
        hint.append(img, label);
        list.appendChild(hint);
      }
      return;
    }
    const hint = list.querySelector(".empty-hint");
    if (hint) hint.remove();

    // Gewünschte Reihenfolge: nach Gruppen, Labels nur bei gemischten Tagen
    const grouped = tasks.slice().sort((a, b) => groupOf(a) - groupOf(b));
    const showLabels = new Set(grouped.map(groupOf)).size > 1;
    const desired = [];
    let lastGroup = -1;
    grouped.forEach((task) => {
      const g = groupOf(task);
      if (showLabels && g !== lastGroup) {
        lastGroup = g;
        desired.push({ type: "label", key: `g${g}`, g });
      }
      desired.push({ type: "task", key: `t${task.id}`, task });
    });

    const vorhanden = new Map();
    [...list.children].forEach((el) => { if (el.dataset.key) vorhanden.set(el.dataset.key, el); });

    const behalten = new Set();
    let prev = null;
    desired.forEach((d, idx) => {
      let el = vorhanden.get(d.key);
      if (d.type === "label") {
        if (!el) el = buildLabelEl(d.g);
      } else if (el) {
        if (el.dataset.sig !== taskSig(d.task)) paintTaskEl(el, d.task); // nur auffrischen
      } else {
        el = buildTaskEl(dayKey, d.task, idx);
      }
      behalten.add(d.key);
      const ziel = prev ? prev.nextSibling : list.firstChild;
      if (el !== ziel) list.insertBefore(el, ziel); // verschiebt, ohne neu zu erzeugen
      prev = el;
    });

    [...list.children].forEach((el) => {
      if (!el.dataset.key || !behalten.has(el.dataset.key)) el.remove();
    });
  }

  function buildLabelEl(g) {
    const label = document.createElement("li");
    label.className = `group-label ${GROUP_META[g].cls}`;
    label.dataset.key = `g${g}`;
    label.innerHTML = `${GROUP_META[g].icon}<span>${GROUP_META[g].label}</span>`;
    return label;
  }

  // Inhalte einer bestehenden Karte aktualisieren
  function paintTaskEl(li, task) {
    const check = li.querySelector(".task-check");
    if (check.checked !== !!task.done) check.checked = !!task.done;
    li.classList.toggle("is-done", !!task.done);
    li.classList.toggle("is-private", !!task.private);
    li.classList.toggle("is-routine", !!task.routineId);
    li.classList.toggle("is-reminder", task.kind === "reminder");
    li.classList.toggle("has-note", !!task.note);

    const sender = memberById(task.from);
    li.querySelector(".task-from").textContent =
      task.kind === "reminder" && sender ? `von ${sender.name}` : "";

    const textEl = li.querySelector(".task-text");
    if (textEl.contentEditable !== "true" && textEl.textContent !== task.text) textEl.textContent = task.text;
    const noteEl = li.querySelector(".task-note");
    if (noteEl.contentEditable !== "true" && noteEl.textContent !== (task.note || "")) noteEl.textContent = task.note || "";

    const timeEl = li.querySelector(".task-time");
    if (timeEl.textContent !== (task.time || "")) timeEl.textContent = task.time || "";
    li.querySelector(".task-prio").dataset.p = task.prio || "none";
    paintAssignBtn(li.querySelector(".task-assign"), task);
    li.dataset.sig = taskSig(task);
  }

  function buildTaskEl(dayKey, task, idx) {
    const frag = taskTemplate.content.cloneNode(true);
    const li = frag.querySelector(".task");
    const taskId = task.id;
    const hole = () => getTask(dayKey, taskId);

    li.dataset.key = `t${taskId}`;
    li.dataset.id = taskId;
    li.style.animationDelay = `${Math.min(idx, 8) * 35}ms`;
    if (vtOk()) li.style.viewTransitionName = `t-${taskId}`;
    paintTaskEl(li, task);

    const check = li.querySelector(".task-check");
    const textEl = li.querySelector(".task-text");
    const noteEl = li.querySelector(".task-note");
    const assignBtn = li.querySelector(".task-assign");

    li.querySelector(".task-note-btn").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = hole();
      if (!t) return;
      li.classList.add("has-note");
      startNoteEdit(noteEl, t, dayKey, li);
    });

    noteEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = hole();
      if (t) startNoteEdit(noteEl, t, dayKey, li);
    });

    assignBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = hole();
      if (!t) return;
      if (t.kind === "reminder") {
        const rec = memberById(t.assignee);
        const sender = memberById(t.from);
        showToast(`Erinnerung${sender ? ` von ${sender.name}` : ""}${rec ? ` an ${rec.name}` : ""} — nur ihr beide seht sie.`);
        return;
      }
      if (!members.length) {
        openFamModal();
        showToast("Lege zuerst eure Familienmitglieder an.");
        return;
      }
      cycleAssignee(t);
      touch(t);
      markDirty(weekKeyOfDay(dayKey));
      saveData();
      paintTaskEl(li, t);
      updateWeekStats(weekDates(currentWeekStart));
      const m = memberById(t.assignee);
      if (m) showToast(`${m.name} übernimmt: ${t.text}`);
    });

    check.addEventListener("change", () => {
      const t = hole();
      if (!t) return;
      t.done = check.checked;
      touch(t);
      markDirty(weekKeyOfDay(dayKey));
      saveData();
      li.classList.toggle("is-done", t.done);
      li.dataset.sig = taskSig(t);
      if (t.done) {
        li.classList.add("just-done");
        li.addEventListener("animationend", () => li.classList.remove("just-done"), { once: true });
        if (navigator.vibrate && !reducedMotion) navigator.vibrate(12);
      }
      const col = li.closest(".day-col");
      const chip = col.querySelector(".day-progress");
      updateProgress(chip, visibleTasks(dayKey));
      updateWeekStats(weekDates(currentWeekStart), true);
      if (mobileQuery.matches) renderDayStrip(weekDates(currentWeekStart), toKey(new Date()));
      checkDue();
      if (t.done && visibleTasks(dayKey).every((x) => x.done)) {
        confettiBurst(chip);
        if (navigator.vibrate && !reducedMotion) navigator.vibrate([16, 60, 24]);
        showToast(`${dayNameFor(dayKey)} komplett erledigt ✨`);
      }
      // Erledigtes sinkt nach unten — sanft nachsortieren, statt alles neu zu bauen
      clearTimeout(li._sortTimer);
      li._sortTimer = setTimeout(() => refreshDay(dayKey), 450);
    });

    li.querySelector(".task-del").addEventListener("click", () => {
      const t = hole();
      if (!t) return;
      data[dayKey] = (data[dayKey] || []).filter((x) => x.id !== taskId);
      // nur diesen einen Termin überspringen, die Routine läuft weiter
      const skipKey = t.routineId ? `${t.routineId}:${dayKey}` : null;
      if (skipKey) routineSkips.add(skipKey);
      tombs.tasks[taskId] = Date.now();
      saveTombs();
      markDirty(weekKeyOfDay(dayKey));
      markDirty("meta");
      saveData();
      saveRoutines();
      removeTaskEl(li, dayKey);
      showToast(
        t.routineId ? "Dieser Routine-Termin wurde übersprungen." : "Aufgabe gelöscht.",
        "Rückgängig",
        () => {
          if (!data[dayKey]) data[dayKey] = [];
          delete tombs.tasks[taskId];
          touch(t);
          data[dayKey].push(t);
          if (skipKey) routineSkips.delete(skipKey);
          saveTombs();
          markDirty(weekKeyOfDay(dayKey));
          markDirty("meta");
          saveData();
          saveRoutines();
          refreshDay(dayKey);
        }
      );
    });

    textEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const t = hole();
      if (t) startInlineEdit(textEl, t, dayKey);
    });

    li.addEventListener("dragstart", (e) => {
      dragInfo = { taskId, fromKey: dayKey };
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", taskId);
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      dragInfo = null;
    });

    return li;
  }

  // Karte weich ausblenden, dann Tag auffrischen
  function removeTaskEl(li, dayKey) {
    if (reducedMotion) { li.remove(); refreshDay(dayKey); return; }
    li.style.pointerEvents = "none";
    li.animate(
      [{ opacity: 1, transform: "translateX(0) scale(1)" }, { opacity: 0, transform: "translateX(-14px) scale(0.94)" }],
      { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
    ).onfinish = () => { li.remove(); refreshDay(dayKey); };
  }

  function paintAssignBtn(btn, task) {
    const m = memberById(task.assignee);
    if (m) {
      btn.classList.add("assigned");
      btn.style.background = m.color;
      btn.textContent = initials(m.name);
      btn.title = `${m.name} übernimmt — tippen zum Wechseln`;
    } else {
      btn.classList.remove("assigned");
      btn.style.background = "";
      btn.textContent = "?";
      btn.title = "Noch offen — wer übernimmt das?";
    }
  }

  function cycleAssignee(task) {
    const idx = members.findIndex((m) => m.id === task.assignee);
    const next = idx + 1; // -1 (offen) -> 0 -> 1 ... -> länge (wieder offen)
    task.assignee = next < members.length ? members[next].id : null;
  }

  function initials(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  function startNoteEdit(noteEl, task, dayKey, li) {
    noteEl.contentEditable = "true";
    noteEl.dataset.ph = "Notiz…";
    noteEl.focus();
    const range = document.createRange();
    range.selectNodeContents(noteEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = (commit) => {
      noteEl.contentEditable = "false";
      const next = noteEl.textContent.trim();
      if (commit && next !== (task.note || "")) {
        task.note = next;
        touch(task);
        markDirty(weekKeyOfDay(dayKey));
        saveData();
      }
      noteEl.textContent = task.note || "";
      li.classList.toggle("has-note", !!task.note);
    };

    noteEl.addEventListener("blur", () => finish(true), { once: true });
    noteEl.addEventListener("keydown", function onKey(e) {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        noteEl.removeEventListener("keydown", onKey);
        noteEl.blur();
      } else if (e.key === "Escape") {
        noteEl.removeEventListener("keydown", onKey);
        noteEl.textContent = task.note || "";
        noteEl.blur();
      }
    });
  }

  function startInlineEdit(textEl, task, dayKey) {
    textEl.contentEditable = "true";
    textEl.focus();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = (commit) => {
      textEl.contentEditable = "false";
      const next = textEl.textContent.trim();
      if (commit && next && next !== task.text) {
        task.text = next;
        touch(task);
        markDirty(weekKeyOfDay(dayKey));
        saveData();
      }
      textEl.textContent = task.text;
    };

    textEl.addEventListener("blur", () => finish(true), { once: true });
    textEl.addEventListener("keydown", function onKey(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        textEl.removeEventListener("keydown", onKey);
        textEl.blur();
      } else if (e.key === "Escape") {
        textEl.removeEventListener("keydown", onKey);
        textEl.textContent = task.text;
        textEl.blur();
      }
    });
  }

  // Karte unterhalb des Zeigers finden — bestimmt die Einfügestelle
  function elementNachPosition(list, y) {
    return [...list.querySelectorAll(".task:not(.dragging)")].reduce(
      (naechste, el) => {
        const box = el.getBoundingClientRect();
        const abstand = y - box.top - box.height / 2;
        return abstand < 0 && abstand > naechste.abstand ? { abstand, el } : naechste;
      },
      { abstand: -Infinity, el: null }
    ).el;
  }

  // Reihenfolge aus dem sichtbaren Zustand in die Daten übernehmen
  function ordnungSpeichern(list, dayKey) {
    const reihenfolge = [...list.querySelectorAll(".task")].map((el) => el.dataset.id);
    let geaendert = false;
    (data[dayKey] || []).forEach((t) => {
      const idx = reihenfolge.indexOf(t.id);
      const neu = idx >= 0 ? idx : 999;
      if (t.ord !== neu) { t.ord = neu; touch(t); geaendert = true; }
    });
    if (geaendert) {
      saveData();
      markDirty(weekKeyOfDay(dayKey));
    }
  }

  function setupDropZone(list, dayKey) {
    list.addEventListener("dragover", (e) => {
      if (!dragInfo) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.classList.add("drag-over");
      // Innerhalb desselben Tages: Karte live an die Zielstelle schieben
      if (dragInfo.fromKey !== dayKey) return;
      const gezogen = list.querySelector(".task.dragging");
      if (!gezogen) return;
      const danach = elementNachPosition(list, e.clientY);
      if (danach) { if (danach !== gezogen.nextSibling) list.insertBefore(gezogen, danach); }
      else if (list.lastElementChild !== gezogen) list.appendChild(gezogen);
    });
    list.addEventListener("dragleave", () => list.classList.remove("drag-over"));
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      list.classList.remove("drag-over");
      if (!dragInfo) return;

      // Sortieren innerhalb desselben Tages
      if (dragInfo.fromKey === dayKey) {
        ordnungSpeichern(list, dayKey);
        return;
      }

      const fromList = data[dragInfo.fromKey] || [];
      const task = fromList.find((t) => t.id === dragInfo.taskId);
      if (!task) return;
      data[dragInfo.fromKey] = fromList.filter((t) => t.id !== task.id);
      if (!data[dayKey]) data[dayKey] = [];
      const vonTag = dragInfo.fromKey;
      touch(task);
      // ans Ende des Zieltages, falls dieser von Hand sortiert ist
      const maxOrd = Math.max(-1, ...(data[dayKey] || []).map((t) => (typeof t.ord === "number" ? t.ord : -1)));
      task.ord = maxOrd >= 0 ? maxOrd + 1 : undefined;
      data[dayKey].push(task);
      markDirty(weekKeyOfDay(dayKey));
      markDirty(weekKeyOfDay(vonTag));
      saveData();
      animatedRender(() => { refreshDay(vonTag); refreshDay(dayKey); });
      showToast(`Verschoben nach ${dayNameFor(dayKey)}.`);
    });
  }

  function setupAddForm(form, dayKey) {
    const prioBtn = form.querySelector(".prio-btn");
    const lockBtn = form.querySelector(".lock-btn");
    const bellBtn = form.querySelector(".bell-btn");
    const repeatBtn = form.querySelector(".repeat-btn");
    const chipsEl = form.querySelector(".assign-chips");
    let selectedAssignee = null;
    let isPrivate = false;
    let isReminder = false;
    let freqIdx = -1; // -1 = keine Wiederholung

    repeatBtn.addEventListener("click", () => {
      freqIdx = freqIdx >= FREQ.length - 1 ? -1 : freqIdx + 1;
      const an = freqIdx >= 0;
      repeatBtn.classList.toggle("on", an);
      repeatBtn.dataset.freq = an ? FREQ_KURZ[FREQ[freqIdx]] : "";
      repeatBtn.title = an ? `Wiederholung: ${FREQ_TEXT[FREQ[freqIdx]]} — tippen zum Wechseln` : "Wiederholen (tippen zum Wählen)";
      if (an) showToast(FREQ_TEXT[FREQ[freqIdx]]);
    });

    members.forEach((m) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "assign-chip";
      chip.title = `${m.name} übernimmt`;
      const av = document.createElement("span");
      av.className = "avatar";
      av.style.background = m.color;
      av.textContent = initials(m.name);
      chip.appendChild(av);
      chip.addEventListener("click", () => {
        selectedAssignee = selectedAssignee === m.id ? null : m.id;
        chipsEl.querySelectorAll(".assign-chip").forEach((c) => c.classList.remove("selected"));
        if (selectedAssignee) chip.classList.add("selected");
      });
      chipsEl.appendChild(chip);
    });

    lockBtn.addEventListener("click", () => {
      isPrivate = !isPrivate;
      lockBtn.classList.toggle("on", isPrivate);
      lockBtn.title = isPrivate ? "Privat — nur mit Auge-Button sichtbar schaltbar" : "Als privat markieren";
    });

    bellBtn.addEventListener("click", () => {
      if (!isReminder) {
        if (!members.length) {
          openFamModal();
          showToast("Lege zuerst eure Familienmitglieder an.");
          return;
        }
        if (!me) {
          openMeModal();
          showToast("Sag mir zuerst, wer du bist — sonst weiß niemand, von wem die Erinnerung kommt.");
          return;
        }
      }
      isReminder = !isReminder;
      bellBtn.classList.toggle("on", isReminder);
      bellBtn.title = isReminder
        ? "Erinnerung aktiv — wähle daneben aus, für wen sie ist"
        : "Als Erinnerung senden (sieht nur der Empfänger)";
    });

    prioBtn.addEventListener("click", () => {
      const cur = prioBtn.dataset.p || "none";
      const next = PRIO_ORDER[(PRIO_ORDER.indexOf(cur) + 1) % PRIO_ORDER.length];
      prioBtn.dataset.p = next;
      prioBtn.title = { none: "Keine Priorität", low: "Niedrige Priorität", med: "Mittlere Priorität", high: "Hohe Priorität" }[next];
    });

    // Escape schließt den Composer
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        form.closest(".day-col").classList.remove("composing");
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector(".add-input");
      const timeInput = form.querySelector(".add-time");
      const text = input.value.trim();
      if (!text) return;
      if (isReminder && !selectedAssignee) {
        showToast("Für wen ist die Erinnerung? Tippe auf einen Avatar daneben.");
        return;
      }
      if (!data[dayKey]) data[dayKey] = [];
      const newTask = {
        id: crypto.randomUUID(),
        text,
        time: timeInput.value || "",
        prio: prioBtn.dataset.p || "none",
        assignee: selectedAssignee,
        private: isPrivate,
        kind: isReminder ? "reminder" : "task",
        from: isReminder ? me : null,
        note: "",
        done: false,
        u: Date.now(),
      };
      markDirty(weekKeyOfDay(dayKey));
      const isRepeating = freqIdx >= 0;
      if (isRepeating) {
        const dates = weekDates(currentWeekStart);
        const dayIdx = dates.findIndex((d) => toKey(d) === dayKey);
        const routine = {
          id: crypto.randomUUID(),
          text: newTask.text,
          time: newTask.time,
          prio: newTask.prio,
          assignee: newTask.assignee,
          private: newTask.private,
          kind: newTask.kind,
          from: newTask.from,
          dayIdx: Math.max(0, dayIdx),
          freq: FREQ[freqIdx],
          monthDay: dateFromKey(dayKey).getDate(),
          createdWeek: toKey(currentWeekStart),
          u: Date.now(),
        };
        routines.push(routine);
        newTask.routineId = routine.id;
        saveRoutines();
        markDirty("meta");
      }
      data[dayKey].push(newTask);
      saveData();
      if (isReminder) {
        const rec = memberById(selectedAssignee);
        showToast(`Erinnerung an ${rec ? rec.name : "?"} gespeichert 🔔`);
      } else if (isRepeating) {
        showToast(`Routine angelegt: ${FREQ_TEXT[FREQ[freqIdx]].toLowerCase()}.`);
      }
      // Eingabefelder leeren, Editor bleibt offen und fokussiert
      input.value = "";
      timeInput.value = "";
      prioBtn.dataset.p = "none";
      if (isPrivate) { isPrivate = false; lockBtn.classList.remove("on"); }
      if (isReminder) { isReminder = false; bellBtn.classList.remove("on"); }
      if (isRepeating) { freqIdx = -1; repeatBtn.classList.remove("on"); repeatBtn.dataset.freq = ""; }
      selectedAssignee = null;
      chipsEl.querySelectorAll(".assign-chip").forEach((c) => c.classList.remove("selected"));

      // Nur diesen Tag auffrischen — die neue Karte gleitet herein
      refreshDay(dayKey);
      updateSuggestions();
      input.focus();
    });
  }

  /* ---------- family / members ---------- */

  function openFamModal() {
    renderMemberList();
    renderRoutineList();
    updateSyncUi();
    updateBackupHint();
    famModal.hidden = false;
    document.getElementById("memberName").focus();
  }

  function renderRoutineList() {
    const section = document.getElementById("routineSection");
    const list = document.getElementById("routineList");
    section.hidden = !routines.length;
    list.innerHTML = "";
    const SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    routines.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = "member-row";
      li.style.animationDelay = `${i * 40}ms`;

      const freq = r.freq || "weekly";
      const day = document.createElement("span");
      day.className = "routine-day";
      day.textContent = freq === "daily" ? "Tgl." : freq === "weekdays" ? "Mo–Fr" : freq === "monthly" ? `${r.monthDay || "?"}.` : SHORT[r.dayIdx] || "?";
      day.title = FREQ_TEXT[freq];

      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = r.text + (r.time ? ` · ${r.time}` : "");
      const sub = document.createElement("small");
      sub.className = "routine-freq";
      sub.textContent = FREQ_KURZ[freq];
      name.appendChild(sub);

      const del = document.createElement("button");
      del.className = "member-del";
      del.title = "Routine beenden";
      del.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
      del.addEventListener("click", () => {
        const removed = r;
        routines = routines.filter((x) => x.id !== r.id);
        tombs.routines[r.id] = Date.now();
        saveTombs();
        markDirty("meta");
        saveRoutines();
        renderRoutineList();
        showToast("Routine beendet — bestehende Einträge bleiben.", "Rückgängig", () => {
          delete tombs.routines[removed.id];
          touch(removed);
          routines.push(removed);
          saveTombs();
          markDirty("meta");
          saveRoutines();
          renderRoutineList();
        });
      });

      li.append(day, name, del);
      list.appendChild(li);
    });
  }

  function closeFamModal() {
    famModal.hidden = true;
  }

  function renderMemberList() {
    memberListEl.innerHTML = "";
    if (!members.length) {
      const empty = document.createElement("li");
      empty.className = "member-empty";
      empty.textContent = "Noch niemand da — füge unten eure Namen hinzu.";
      memberListEl.appendChild(empty);
      return;
    }
    members.forEach((m, i) => {
      const li = document.createElement("li");
      li.className = "member-row";
      li.style.animationDelay = `${i * 45}ms`;

      const av = document.createElement("span");
      av.className = "avatar";
      av.style.background = m.color;
      av.textContent = initials(m.name);

      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = m.name;

      const del = document.createElement("button");
      del.className = "member-del";
      del.title = `${m.name} entfernen`;
      del.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
      del.addEventListener("click", () => {
        members = members.filter((x) => x.id !== m.id);
        if (filterMember === m.id) filterMember = null;
        if (me === m.id) {
          me = null;
          localStorage.removeItem(ME_KEY);
          paintMeBtn();
        }
        tombs.members[m.id] = Date.now();
        saveTombs();
        markDirty("meta");
        saveMembers();
        renderMemberList();
        render();
        showToast(`${m.name} entfernt. Zugewiesene Aufgaben sind wieder offen.`);
      });

      li.append(av, name, del);
      memberListEl.appendChild(li);
    });
  }

  function nextColor() {
    const used = new Set(members.map((m) => m.color));
    return MEMBER_COLORS.find((c) => !used.has(c)) || MEMBER_COLORS[members.length % MEMBER_COLORS.length];
  }

  document.getElementById("famBtn").addEventListener("click", openFamModal);
  document.getElementById("famClose").addEventListener("click", closeFamModal);
  famModal.addEventListener("click", (e) => {
    if (e.target === famModal) closeFamModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!famModal.hidden) closeFamModal();
      ["meModal", "helpModal", "joinModal", "shopModal", "recapModal"].forEach((id) => {
        const m = document.getElementById(id);
        if (!m.hidden) m.hidden = true;
      });
      if (tourEls) endTour();
    }
  });

  /* ---------- Anleitung ---------- */

  const helpModal = document.getElementById("helpModal");
  document.getElementById("helpBtn").addEventListener("click", () => { helpModal.hidden = false; });
  document.getElementById("helpClose").addEventListener("click", () => { helpModal.hidden = true; });
  document.getElementById("welcomeHelp").addEventListener("click", () => startTour());
  document.getElementById("startTour").addEventListener("click", () => {
    helpModal.hidden = true;
    startTour();
  });
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.hidden = true;
  });

  /* ---------- Interaktive Tour: jeder Knopf wird markiert und erklärt ---------- */

  const TOUR_ICONS = {
    person: '<circle cx="8" cy="5.5" r="2.6" stroke="currentColor" stroke-width="1.3"/><path d="M3 13.5c.5-2.8 2.4-4.2 5-4.2s4.5 1.4 5 4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    family: '<circle cx="6" cy="5.5" r="2.3" stroke="currentColor" stroke-width="1.3"/><path d="M2 13c.4-2.3 2-3.5 4-3.5s3.6 1.2 4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="11.5" cy="6" r="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M11 9.6c1.7.1 2.8 1.1 3.1 2.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    redo: '<path d="M3 8a5 5 0 1 1 1.5 3.6M3 12V8.8h3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    days: '<rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.5h12M5.5 3V1.8M10.5 3V1.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    hand: '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.5 2"/><path d="M8 5.5v3l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    bell: '<path d="M8 2.2a4 4 0 0 0-4 4v2.6L2.8 11h10.4L12 8.8V6.2a4 4 0 0 0-4-4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.6 13a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    repeat: '<path d="M3 8a5 5 0 0 1 8.5-3.6M13 8a5 5 0 0 1-8.5 3.6M11.5 1.6v2.8h-2.8M4.5 14.4v-2.8h2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    dot: '<circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.1" opacity="0.4"/>',
    heart: '<path d="M8 13.4 3.4 8.8a3 3 0 0 1 4.2-4.2l.4.4.4-.4a3 3 0 0 1 4.2 4.2L8 13.4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  };

  // Nur die Knöpfe, die man wirklich erklärt bekommen muss
  const TOUR_STEPS = [
    { sel: "#meBtn", ico: "person", title: "Wer bist du?", text: "Tippe hier und wähle deinen Namen — dann zeigt dir die App deine Erinnerungen und Aufgaben. Die Wahl gilt nur für dieses Gerät." },
    { sel: "#famBtn", ico: "family", title: "Familie & Sync", text: "Hier legt ihr eure Mitglieder an, verwaltet Routinen — und verbindet eure Handys über den Einladungslink." },
    { sel: "#copyPrevBtn", ico: "redo", title: "Vorwoche übernehmen", text: "Holt alle offenen Aufgaben der letzten Woche in diese Woche — praktisch für den Wochenstart." },
    { sel: ".day-strip", ico: "days", title: "Tage wechseln", text: "Tippe auf einen Tag oder wische einfach nach links und rechts. Der orange Punkt zeigt: Hier wartet eine Erinnerung auf dich.", onlyIf: () => mobileQuery.matches },
    { sel: ".add-ghost", ico: "plus", title: "Aufgabe hinzufügen", text: "Ein Tipp öffnet die Eingabe. Beim Tippen bekommst du Vorschläge aus euren bisherigen Aufgaben." },
    { sel: ".assign-chips", ico: "hand", title: "Wer übernimmt's?", text: "Tippe auf einen Avatar, um die Aufgabe jemandem zu geben. Ohne Auswahl bleibt sie offen — wer zuerst tippt, übernimmt.", prep: "composer", onlyIf: () => members.length > 0 },
    { sel: ".bell-btn", ico: "bell", title: "Erinnerung senden", text: "Macht aus der Aufgabe eine persönliche Erinnerung — nur der gewählte Empfänger (und du) bekommt sie zu sehen.", prep: "composer" },
    { sel: ".repeat-btn", ico: "repeat", title: "Wochen-Routine", text: "Die Aufgabe erscheint automatisch jede Woche am selben Tag wieder — perfekt für Mülltonnen & Co.", prep: "composer" },
    { sel: ".lock-btn", ico: "lock", title: "Privat markieren", text: "Kennzeichnet die Aufgabe als privat. Mit dem Auge-Knopf oben blendest du alles Private mit einem Tipp aus.", prep: "composer" },
    { sel: ".prio-btn", ico: "dot", title: "Priorität", text: "Tippe den Punkt: grün → gelb → rot. Wichtiges rückt in der Tagesliste automatisch nach oben.", prep: "composer" },
    { sel: "#forYou", ico: "heart", title: "Für dich", text: "Deine Woche auf einen Blick: alle Erinnerungen an dich und deine Aufgaben. Antippen springt direkt zum richtigen Tag.", onlyIf: () => !document.getElementById("forYou").hidden },
  ];

  let tourIdx = -1;
  let tourEls = null;
  let tourComposerCol = null;

  function tourTargets(step) {
    return [...document.querySelectorAll(step.sel)].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function startTour() {
    endTour();
    document.getElementById("welcome").hidden = true;
    const catcher = document.createElement("div");
    catcher.className = "tour-catcher";
    const ring = document.createElement("div");
    ring.className = "tour-ring";
    const tip = document.createElement("div");
    tip.className = "tour-tip";
    document.body.append(catcher, ring, tip);
    tourEls = { catcher, ring, tip };
    catcher.addEventListener("click", () => showTourStep(tourIdx + 1));
    tourIdx = -1;
    showTourStep(0);
  }

  function endTour() {
    if (tourEls) {
      Object.values(tourEls).forEach((el) => el.remove());
      tourEls = null;
    }
    if (tourComposerCol) {
      tourComposerCol.classList.remove("composing");
      tourComposerCol = null;
    }
    tourIdx = -1;
    updateWelcome();
  }

  function showTourStep(i) {
    if (!tourEls) return;
    // nächsten gültigen Schritt suchen
    let step = null;
    let target = null;
    while (i < TOUR_STEPS.length) {
      const s = TOUR_STEPS[i];
      if (!s.onlyIf || s.onlyIf()) {
        if (s.prep === "composer") {
          const col = document.querySelector(".day-col");
          if (col && !col.classList.contains("composing")) {
            col.classList.add("composing");
            tourComposerCol = col;
          }
        } else if (tourComposerCol) {
          tourComposerCol.classList.remove("composing");
          tourComposerCol = null;
        }
        const t = tourTargets(s);
        if (t) { step = s; target = t; break; }
      }
      i++;
    }
    if (!step) {
      endTour();
      showToast("Das war die Tour — viel Spaß beim Planen ✨");
      return;
    }
    tourIdx = i;

    target.scrollIntoView({ block: "center", behavior: "instant" });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = target.getBoundingClientRect();
      const pad = 6;
      const { ring, tip } = tourEls;
      ring.style.top = `${r.top - pad}px`;
      ring.style.left = `${r.left - pad}px`;
      ring.style.width = `${r.width + pad * 2}px`;
      ring.style.height = `${r.height + pad * 2}px`;
      const br = parseFloat(getComputedStyle(target).borderRadius) || 12;
      ring.style.borderRadius = `${Math.min(br + pad, (r.height + pad * 2) / 2)}px`;

      const active = TOUR_STEPS.filter((s) => !s.onlyIf || s.onlyIf());
      const total = active.length;
      const current = total - TOUR_STEPS.slice(tourIdx).filter((s) => !s.onlyIf || s.onlyIf()).length + 1;

      tip.innerHTML = "";
      const head = document.createElement("div");
      head.className = "tour-head";
      const ico = document.createElement("span");
      ico.className = "tour-ico";
      ico.innerHTML = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">${TOUR_ICONS[step.ico] || TOUR_ICONS.plus}</svg>`;
      const h = document.createElement("h3");
      h.textContent = step.title;
      head.append(ico, h);

      const p = document.createElement("p");
      p.textContent = step.text;

      const foot = document.createElement("div");
      foot.className = "tour-foot";
      const dots = document.createElement("span");
      dots.className = "tour-dots";
      for (let d = 0; d < total; d++) {
        const dot = document.createElement("i");
        if (d < current) dot.classList.add("on");
        if (d === current - 1) dot.classList.add("now");
        dots.appendChild(dot);
      }
      const btns = document.createElement("span");
      btns.className = "tour-btns";
      const quit = document.createElement("button");
      quit.className = "tour-quit";
      quit.textContent = "Beenden";
      quit.addEventListener("click", (e) => { e.stopPropagation(); endTour(); });
      const next = document.createElement("button");
      next.className = "tour-next";
      next.innerHTML = current < total
        ? 'Weiter <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : 'Fertig <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      next.addEventListener("click", (e) => { e.stopPropagation(); showTourStep(tourIdx + 1); });
      btns.append(quit, next);
      foot.append(dots, btns);
      tip.append(head, p, foot);

      // Karte unter- oder oberhalb platzieren, Pfeil zeigt aufs Ziel
      const tipH = 170;
      const below = r.bottom + tipH + 20 < window.innerHeight;
      tip.classList.toggle("above", !below);
      tip.style.top = below ? `${r.bottom + pad + 14}px` : "";
      tip.style.bottom = below ? "" : `${window.innerHeight - r.top + pad + 14}px`;
      const left = Math.max(16, Math.min(r.left + r.width / 2 - 150, window.innerWidth - tip.offsetWidth - 16));
      tip.style.left = `${left}px`;
      const arrowX = Math.max(18, Math.min(r.left + r.width / 2 - left - 7, tip.offsetWidth - 32));
      tip.style.setProperty("--ax", `${arrowX}px`);
      tip.classList.remove("tip-anim");
      void tip.offsetWidth;
      tip.classList.add("tip-anim");
    }));
  }

  window.addEventListener("resize", () => {
    if (tourEls && tourIdx >= 0) showTourStep(tourIdx);
  });

  document.getElementById("memberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("memberName");
    const name = input.value.trim();
    if (!name) return;
    members.push({ id: crypto.randomUUID(), name, color: nextColor(), u: Date.now() });
    saveMembers();
    markDirty("meta");
    input.value = "";
    renderMemberList();
    render();
  });

  /* ---------- Handy-Sync (verschlüsselt über kvdb.io) ---------- */

  let cryptoKey = null;
  let dirty = new Set(); // "meta" oder Wochen-Schlüssel
  let pushTimer = null;
  let lastSync = null;

  function touch(entity) {
    entity.u = Date.now();
  }

  function saveTombs() {
    localStorage.setItem(TOMBS_KEY, JSON.stringify(tombs));
  }

  function weekKeyOfDay(dayKey) {
    return toKey(startOfWeek(dateFromKey(dayKey)));
  }

  function dateFromKey(k) {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function markDirty(k) {
    if (!group) return;
    dirty.add(k);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 900);
  }

  function markAllDirty() {
    if (!group) return;
    dirty.add("meta");
    Object.keys(data).forEach((dayKey) => {
      if ((data[dayKey] || []).length) dirty.add(weekKeyOfDay(dayKey));
    });
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 400);
  }

  /* --- Verschlüsselung: AES-GCM, Schlüssel steckt nur im Einladungslink --- */

  function b64uToBytes(s) {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  }

  function bytesToB64(bytes) {
    let bin = "";
    bytes.forEach((x) => { bin += String.fromCharCode(x); });
    return btoa(bin);
  }

  function bytesToB64u(bytes) {
    return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function getCryptoKey() {
    if (!cryptoKey) {
      cryptoKey = await crypto.subtle.importKey("raw", b64uToBytes(group.key), "AES-GCM", false, ["encrypt", "decrypt"]);
    }
    return cryptoKey;
  }

  async function encPayload(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getCryptoKey(), new TextEncoder().encode(JSON.stringify(obj)))
    );
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv);
    all.set(ct, 12);
    return bytesToB64u(all); // URL-sicher: bleibt in der Adresse kompakt
  }

  async function decPayload(s) {
    try {
      const all = b64uToBytes(s.trim());
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await getCryptoKey(), all.slice(12));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch {
      return null;
    }
  }

  /* --- Speicher-Zugriff --- */

  function storeKey(k) {
    return `wp-${group.bucket}-${k}`;
  }

  async function kvGet(k) {
    // ohne Schrägstrich am Ende: sonst 301-Weiterleitung ohne CORS-Freigabe -> Browser blockt
    const r = await fetch(`${STORE_READ}${storeKey(k)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`store ${r.status}`);
    const t = (await r.text()).trim();
    return t.length ? t : null; // leer = noch nichts gespeichert
  }

  async function kvPut(k, body) {
    // POST mit Query-Parametern = einfache Anfrage, kein CORS-Vorabcheck nötig
    const url = `${STORE_WRITE}?key=${encodeURIComponent(storeKey(k))}&value=${encodeURIComponent(body)}`;
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) throw new Error(`store ${r.status}`);
  }

  // Alten Speicher leeren, damit ein weitergegebener Link auch die alte
  // Momentaufnahme nicht mehr hergibt
  async function wipeGroup(g) {
    const keys = ["meta", ...new Set(Object.keys(data).filter((d) => (data[d] || []).length).map((d) => `w${weekKeyOfDay(d)}`))];
    await Promise.all(
      keys.map((k) =>
        fetch(`${STORE_WRITE}?key=${encodeURIComponent(`wp-${g.bucket}-${k}`)}&value=`, { method: "POST" }).catch(() => {})
      )
    );
  }

  /* --- Zusammenführen: neuere Änderung gewinnt, Löschung per Grabstein --- */

  function mergeEntities(localArr, remoteArr, tombMap) {
    const map = new Map();
    localArr.forEach((e) => map.set(e.id, e));
    (remoteArr || []).forEach((e) => {
      const ex = map.get(e.id);
      if (!ex || (e.u || 0) > (ex.u || 0)) map.set(e.id, e);
    });
    const out = [];
    map.forEach((e) => {
      const dt = tombMap[e.id];
      if (dt !== undefined && dt >= (e.u || 0)) return;
      out.push(e);
    });
    return out;
  }

  function mergeTombMaps(a, b) {
    const out = { ...a };
    Object.entries(b || {}).forEach(([id, t]) => {
      if (!(id in out) || t > out[id]) out[id] = t;
    });
    const entries = Object.entries(out);
    if (entries.length > 300) {
      entries.sort((x, y) => y[1] - x[1]);
      return Object.fromEntries(entries.slice(0, 300));
    }
    return out;
  }

  function collectWeekTasks(weekKey) {
    const out = [];
    weekDates(dateFromKey(weekKey)).forEach((d) => {
      const dk = toKey(d);
      (data[dk] || []).forEach((t) => out.push({ ...t, day: dk }));
    });
    return out;
  }

  function applyWeekTasks(weekKey, flat) {
    weekDates(dateFromKey(weekKey)).forEach((d) => { delete data[toKey(d)]; });
    flat.forEach((t) => {
      const day = t.day;
      const copy = { ...t };
      delete copy.day;
      if (!data[day]) data[day] = [];
      data[day].push(copy);
    });
  }

  function weekSignature(flat) {
    return JSON.stringify(flat.map((t) => [t.id, t.u || 0, t.done, t.text, t.day, t.assignee]).sort());
  }

  async function mergeRemoteKey(k) {
    const raw = await kvGet(k);
    if (raw === null) return false;
    const remote = await decPayload(raw);
    if (!remote) return false;

    if (k === "meta") {
      const before = JSON.stringify([members, routines, [...routineSkips].sort(), shop]);
      tombs = {
        tasks: mergeTombMaps(tombs.tasks, remote.tombs && remote.tombs.tasks),
        members: mergeTombMaps(tombs.members, remote.tombs && remote.tombs.members),
        routines: mergeTombMaps(tombs.routines, remote.tombs && remote.tombs.routines),
        shop: mergeTombMaps(tombs.shop, remote.tombs && remote.tombs.shop),
      };
      members = mergeEntities(members, remote.members, tombs.members);
      routines = mergeEntities(routines, remote.routines, tombs.routines);
      shop = mergeEntities(shop, remote.shop, tombs.shop);
      (remote.skips || []).forEach((s) => routineSkips.add(s));
      saveMembers();
      saveRoutines();
      saveShop();
      saveTombs();
      renderShop();
      return JSON.stringify([members, routines, [...routineSkips].sort(), shop]) !== before;
    }

    const weekKey = k.slice(1);
    const local = collectWeekTasks(weekKey);
    const merged = mergeEntities(local, remote.tasks, tombs.tasks);
    if (weekSignature(local) === weekSignature(merged)) return false;
    applyWeekTasks(weekKey, merged);
    saveData();
    return true;
  }

  // Lesen und Schreiben laufen nacheinander in einer Warteschlange —
  // so blockiert ein Abgleich nie einen wartenden Upload.
  let syncChain = Promise.resolve();
  function queueSync(fn) {
    syncChain = syncChain.then(fn, fn);
    return syncChain;
  }

  function pullNow() { return queueSync(doPull); }
  function pushNow() { return queueSync(doPush); }

  /* --- Statusanzeige: abgeglichen / überträgt / offline --- */

  let syncState = "ok"; // ok | busy | offline

  function setSyncState(s) {
    syncState = s;
    const chip = document.getElementById("syncChip");
    if (!chip) return;
    chip.hidden = !group;
    if (!group) return;
    chip.classList.toggle("busy", s === "busy");
    chip.classList.toggle("offline", s === "offline");
    const txt = document.getElementById("syncChipText");
    const zeit = lastSync
      ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(lastSync)
      : null;
    if (s === "busy") {
      txt.textContent = "Überträgt…";
      chip.title = "Daten werden gerade abgeglichen";
    } else if (s === "offline") {
      txt.textContent = "Offline";
      chip.title = zeit
        ? `Kein Kontakt zum Speicher — zuletzt abgeglichen ${zeit} Uhr. Änderungen werden nachgeholt.`
        : "Kein Kontakt zum Speicher — Änderungen werden nachgeholt, sobald ihr wieder online seid.";
    } else {
      txt.textContent = "Abgeglichen";
      chip.title = zeit ? `Alles synchron · zuletzt ${zeit} Uhr` : "Alles synchron";
    }
  }

  async function doPull() {
    if (!group) return;
    setSyncState("busy");
    try {
      const shownWeek = toKey(currentWeekStart);
      const todayWeek = toKey(startOfWeek(new Date()));
      const wants = ["meta", `w${shownWeek}`];
      if (todayWeek !== shownWeek) wants.push(`w${todayWeek}`);
      let changed = false;
      for (const k of wants) {
        if (await mergeRemoteKey(k)) changed = true;
      }
      lastSync = Date.now();
      if (changed) safeRender();
      updateSyncUi();
      setSyncState(dirty.size ? "busy" : "ok");
    } catch {
      setSyncState("offline"); // nächster Versuch kommt automatisch
    }
    if (dirty.size) pushNow();
  }

  async function doPush() {
    if (!group || !dirty.size) return;
    setSyncState("busy");
    const items = [...dirty];
    dirty.clear();
    try {
      for (const k of items) {
        // erst zusammenführen, dann schreiben — so überschreibt niemand die anderen
        if (k === "meta") {
          await mergeRemoteKey("meta");
          await kvPut("meta", await encPayload({ members, routines, shop, skips: [...routineSkips], tombs, u: Date.now() }));
        } else {
          await mergeRemoteKey(`w${k}`);
          await kvPut(`w${k}`, await encPayload({ tasks: collectWeekTasks(k), u: Date.now() }));
        }
      }
      lastSync = Date.now();
      safeRender();
      updateSyncUi();
      setSyncState("ok");
    } catch {
      items.forEach((i) => dirty.add(i)); // beim nächsten Versuch erneut senden
      setSyncState("offline");
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 4000);
    }
  }

  // Nicht mitten ins Tippen neu zeichnen — aber sobald das Feld verlassen wird nachholen
  let renderPending = false;

  function typingInComposer() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest(".add-form"));
  }

  function safeRender() {
    if (typingInComposer()) { renderPending = true; return; }
    renderPending = false;
    render();
  }

  document.addEventListener("focusout", () => {
    if (!renderPending) return;
    setTimeout(() => {
      if (!renderPending || typingInComposer()) return;
      renderPending = false;
      render();
    }, 120);
  });

  /* --- Gruppen-Verwaltung --- */

  function inviteLink() {
    return `${location.origin}${location.pathname}#join=${group.bucket}.${group.key}`;
  }

  function updateSyncUi() {
    const off = document.getElementById("syncOff");
    const on = document.getElementById("syncOn");
    if (!off) return;
    off.hidden = !!group;
    on.hidden = !group;
    if (group) {
      const status = document.getElementById("syncStatus");
      const t = lastSync ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(lastSync) : "–";
      status.textContent = `Gruppe verbunden · zuletzt abgeglichen ${t} Uhr`;
      document.getElementById("inviteLink").value = inviteLink();
      document.getElementById("waShare").href =
        `https://wa.me/?text=${encodeURIComponent("Komm in unseren Familien-Wochenplaner! Öffne den Link auf deinem Handy: " + inviteLink())}`;
    }
  }

  function setGroup(g) {
    group = g;
    cryptoKey = null;
    if (g) localStorage.setItem(GROUP_KEY, JSON.stringify(g));
    else localStorage.removeItem(GROUP_KEY);
    updateSyncUi();
    setSyncState(g ? "busy" : "ok");
  }

  document.getElementById("syncChip").addEventListener("click", () => {
    if (syncState === "offline") { pullNow(); pushNow(); showToast("Neuer Verbindungsversuch läuft…"); }
    else openFamModal();
  });

  window.addEventListener("online", () => { if (group) { pullNow(); pushNow(); } });
  window.addEventListener("offline", () => { if (group) setSyncState("offline"); });

  function parseJoinCode(input) {
    const m = String(input).match(/#join=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,})/) ||
      String(input).trim().match(/^([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{20,})$/);
    return m ? { bucket: m[1], key: m[2] } : null;
  }

  async function joinGroup(g) {
    setGroup(g);
    showToast("Gruppe verbunden — Daten werden abgeglichen…");
    await pullNow();
    markAllDirty();
    render();
    showToast("Ihr seid jetzt verbunden ✨");
  }

  document.getElementById("createGroupBtn").addEventListener("click", async () => {
    // Gruppen-Kennung und Schlüssel entstehen direkt auf dem Gerät — kein Konto, keine E-Mail
    const bucket = bytesToB64u(crypto.getRandomValues(new Uint8Array(12)));
    const key = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    await joinGroup({ bucket, key });
  });

  document.getElementById("joinBtn").addEventListener("click", () => {
    const g = parseJoinCode(document.getElementById("joinInput").value);
    if (!g) {
      showToast("Das sieht nicht wie ein Einladungslink aus.");
      return;
    }
    joinGroup(g);
  });

  document.getElementById("copyInvite").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      showToast("Einladungslink kopiert.");
    } catch {
      document.getElementById("inviteLink").select();
      showToast("Bitte manuell kopieren (Strg+C).");
    }
  });

  // Neuen Schlüssel erzeugen: alte Einladungslinks werden damit wertlos
  document.getElementById("rotateGroup").addEventListener("click", async () => {
    if (!group) return;
    const alt = group;
    setGroup({
      bucket: bytesToB64u(crypto.getRandomValues(new Uint8Array(12))),
      key: bytesToB64u(crypto.getRandomValues(new Uint8Array(32))),
    });
    markAllDirty();
    await pushNow();          // erst alles im neuen Speicher sichern …
    await wipeGroup(alt);     // … dann den alten leeren
    updateSyncUi();
    showToast("Neuer Schlüssel aktiv — alte Links führen ins Leere. Teile den neuen Link mit der Familie.");
  });

  document.getElementById("leaveGroup").addEventListener("click", () => {
    const old = group;
    setGroup(null);
    showToast("Gruppe verlassen — eure Daten bleiben auf diesem Gerät.", "Rückgängig", () => setGroup(old));
  });

  // Beitritt über einen geteilten Link (#join=…) — echter Dialog, kein flüchtiger Toast.
  // Läuft beim Laden UND bei jeder Hash-Änderung (Link in bereits offener App geöffnet).
  let pendingJoin = null;

  function maybeOfferJoin() {
    const g = parseJoinCode(location.hash);
    if (!g) return;
    const clearHash = () => history.replaceState(null, "", location.pathname + location.search);
    if (group && group.bucket === g.bucket) {
      clearHash();
      showToast("Du bist schon in dieser Gruppe.");
      return;
    }
    pendingJoin = g;
    document.getElementById("joinModal").hidden = false;
  }

  document.getElementById("joinAccept").addEventListener("click", () => {
    document.getElementById("joinModal").hidden = true;
    history.replaceState(null, "", location.pathname + location.search);
    if (pendingJoin) joinGroup(pendingJoin);
    pendingJoin = null;
  });

  document.getElementById("joinDecline").addEventListener("click", () => {
    document.getElementById("joinModal").hidden = true;
    history.replaceState(null, "", location.pathname + location.search);
    pendingJoin = null;
    showToast("Kein Problem — der Link funktioniert jederzeit wieder.");
  });

  window.addEventListener("hashchange", maybeOfferJoin);
  // erst nach dem vollständigen Start prüfen: showToast greift auf später
  // deklarierte Variablen zu und würde die Initialisierung sonst abbrechen
  setTimeout(maybeOfferJoin, 0);

  // regelmäßig abgleichen, solange die App sichtbar ist
  function syncTick() {
    if (!group || document.visibilityState !== "visible") return;
    pullNow();
    if (dirty.size) pushNow();
  }
  setSyncState(group ? "busy" : "ok"); // Chip beim Start sofort anzeigen
  if (group) setTimeout(syncTick, 500);
  setInterval(syncTick, 15000);
  document.addEventListener("visibilitychange", syncTick);

  /* ---------- "wer bist du?" (Profil pro Gerät) ---------- */

  const meModal = document.getElementById("meModal");
  const meBtn = document.getElementById("meBtn");

  function paintMeBtn() {
    const av = meBtn.querySelector(".me-avatar");
    const m = memberById(me);
    if (m) {
      av.classList.remove("open");
      av.style.background = m.color;
      av.textContent = initials(m.name);
      meBtn.title = `Du bist ${m.name} — tippen zum Wechseln`;
    } else {
      av.classList.add("open");
      av.style.background = "";
      av.textContent = "?";
      meBtn.title = "Wer bist du? Tippen zum Auswählen";
    }
  }

  function openMeModal() {
    renderMeList();
    meModal.hidden = false;
  }

  function closeMeModal() {
    meModal.hidden = true;
  }

  function renderMeList() {
    const list = document.getElementById("meList");
    list.innerHTML = "";
    if (!members.length) {
      const empty = document.createElement("li");
      empty.className = "member-empty";
      empty.textContent = "Lege zuerst unter „Familie“ eure Mitglieder an.";
      list.appendChild(empty);
      return;
    }
    members.forEach((m, i) => {
      const li = document.createElement("li");
      li.className = "member-row selectable";
      if (m.id === me) li.classList.add("is-me");
      li.style.animationDelay = `${i * 45}ms`;

      const av = document.createElement("span");
      av.className = "avatar";
      av.style.background = m.color;
      av.textContent = initials(m.name);

      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = m.name;

      li.append(av, name);
      if (m.id === me) {
        const check = document.createElement("span");
        check.className = "me-check";
        check.textContent = "✓";
        li.appendChild(check);
      }

      li.addEventListener("click", () => {
        me = m.id;
        localStorage.setItem(ME_KEY, me);
        paintMeBtn();
        closeMeModal();
        showToast(`Hallo, ${m.name}! 👋`);
        animatedRender();
      });

      list.appendChild(li);
    });
  }

  meBtn.addEventListener("click", openMeModal);
  document.getElementById("meClose").addEventListener("click", closeMeModal);
  meModal.addEventListener("click", (e) => {
    if (e.target === meModal) closeMeModal();
  });

  paintMeBtn();

  /* ---------- Wochenrückblick & Punkte ---------- */

  // Punkte: Aufgabe = 1, mittlere Priorität = 2, hohe = 3
  const PUNKTE = { none: 1, low: 1, med: 2, high: 3 };
  const recapModal = document.getElementById("recapModal");
  const recapBtn = document.getElementById("recapBtn");

  function weekStats(dates) {
    const alle = [];
    dates.forEach((d) => alle.push(...visibleTasks(toKey(d))));
    const erledigt = alle.filter((t) => t.done);
    const proPerson = members.map((m) => {
      const meine = erledigt.filter((t) => t.assignee === m.id);
      return { m, anzahl: meine.length, punkte: meine.reduce((s, t) => s + (PUNKTE[t.prio] || 1), 0) };
    }).sort((a, b) => b.punkte - a.punkte || b.anzahl - a.anzahl);
    return { gesamt: alle.length, erledigt: erledigt.length, proPerson };
  }

  function updateRecapBtn(dates) {
    if (!recapBtn) return;
    const s = weekStats(dates);
    // erst anbieten, wenn es etwas zu zeigen gibt
    recapBtn.hidden = !members.length || s.gesamt === 0;
    const istSonntag = new Date().getDay() === 0;
    const istDieseWoche = toKey(dates[0]) === toKey(startOfWeek(new Date()));
    document.getElementById("recapBtnText").textContent =
      istSonntag && istDieseWoche ? "Wochenrückblick — wie lief eure Woche?" : "Wochenrückblick ansehen";
  }

  function openRecap() {
    const dates = weekDates(currentWeekStart);
    const s = weekStats(dates);
    const pct = s.gesamt ? Math.round((s.erledigt / s.gesamt) * 100) : 0;

    document.getElementById("recapTitle").textContent =
      `${DATE_FMT.format(dates[0])} – ${DATE_FMT.format(dates[6])}`;

    const body = document.getElementById("recapBody");
    body.innerHTML = "";

    const hero = document.createElement("div");
    hero.className = "recap-hero";
    const big = document.createElement("div");
    big.className = "recap-big";
    big.textContent = `${pct}%`;
    const sub = document.createElement("div");
    sub.className = "recap-sub";
    sub.textContent = `${s.erledigt} von ${s.gesamt} Aufgaben erledigt`;
    hero.append(big, sub);
    body.appendChild(hero);

    const max = Math.max(1, ...s.proPerson.map((p) => p.punkte));
    s.proPerson.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "recap-line";
      const av = document.createElement("span");
      av.className = "avatar";
      av.style.background = p.m.color;
      av.textContent = initials(p.m.name);
      const name = document.createElement("span");
      name.className = "recap-name";
      name.textContent = p.m.name;
      if (i === 0 && p.punkte > 0 && (s.proPerson.length < 2 || p.punkte > s.proPerson[1].punkte)) {
        const krone = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        krone.setAttribute("viewBox", "0 0 16 16");
        krone.setAttribute("class", "crown");
        krone.innerHTML = '<path d="M2.5 5.5 5 8l3-4 3 4 2.5-2.5-1 7h-9l-1-7Z" fill="currentColor"/>';
        name.appendChild(krone);
      }
      const bar = document.createElement("span");
      bar.className = "recap-bar";
      const fill = document.createElement("span");
      fill.className = "recap-fill";
      fill.style.background = p.m.color;
      fill.style.width = "0%";
      bar.appendChild(fill);
      const pts = document.createElement("span");
      pts.className = "recap-pts";
      pts.textContent = `${p.punkte} Pkt.`;
      row.append(av, name, bar, pts);
      body.appendChild(row);
      requestAnimationFrame(() => {
        setTimeout(() => { fill.style.width = `${Math.round((p.punkte / max) * 100)}%`; }, 80 + i * 90);
      });
    });

    const note = document.createElement("p");
    note.className = "recap-note";
    const beste = s.proPerson[0];
    if (!s.gesamt) note.textContent = "Diese Woche war noch nichts geplant.";
    else if (pct === 100) note.textContent = "Alles geschafft — starke Woche! 🎉";
    else if (beste && beste.punkte > 0) {
      note.textContent = `${beste.m.name} liegt mit ${beste.punkte} Punkten vorn. Punkte gibt es pro erledigter Aufgabe: normal 1, mittlere Priorität 2, hohe 3.`;
    } else note.textContent = "Noch nichts abgehakt — die Woche ist ja noch jung.";
    body.appendChild(note);

    recapModal.hidden = false;
    if (pct === 100 && s.gesamt > 0) setTimeout(() => confettiBurst(big, 26), 350);
  }

  if (recapBtn) recapBtn.addEventListener("click", openRecap);
  document.getElementById("recapClose").addEventListener("click", () => { recapModal.hidden = true; });
  recapModal.addEventListener("click", (e) => { if (e.target === recapModal) recapModal.hidden = true; });

  /* ---------- Einkaufsliste (gleicht sich über "meta" mit ab) ---------- */

  const SHOP_IDEEN = ["Milch", "Brot", "Butter", "Eier", "Käse", "Kaffee", "Obst", "Gemüse", "Nudeln", "Klopapier", "Zahnpasta", "Spülmittel"];
  const shopModal = document.getElementById("shopModal");

  function shopSuggest() {
    const zaehler = new Map();
    shop.forEach((i) => {
      const k = i.text.toLowerCase();
      zaehler.set(k, (zaehler.get(k) || 0) + 1);
    });
    const eigene = [...zaehler.keys()].sort((a, b) => zaehler.get(b) - zaehler.get(a));
    const gesehen = new Set();
    const dl = document.getElementById("shopSuggestions");
    dl.innerHTML = "";
    [...eigene, ...SHOP_IDEEN].forEach((t) => {
      const k = t.toLowerCase();
      if (gesehen.has(k)) return;
      gesehen.add(k);
      const o = document.createElement("option");
      o.value = t.charAt(0).toUpperCase() + t.slice(1);
      dl.appendChild(o);
    });
  }

  function renderShop() {
    const list = document.getElementById("shopList");
    if (!list) return;
    const offen = shop.filter((i) => !i.done).length;

    const badge = document.getElementById("shopCount");
    badge.hidden = offen === 0;
    badge.textContent = offen > 99 ? "99+" : offen;
    document.getElementById("shopBtn").title = offen ? `Einkaufsliste — ${offen} offen` : "Einkaufsliste";

    if (shopModal.hidden) return; // nur zeichnen, wenn sichtbar
    list.innerHTML = "";

    if (!shop.length) {
      const leer = document.createElement("li");
      leer.className = "shop-empty";
      leer.textContent = "Noch nichts drauf — was fehlt euch?";
      list.appendChild(leer);
    } else {
      // Offenes zuerst, Abgehaktes nach unten
      shop.slice().sort((a, b) => (a.done === b.done ? (b.u || 0) - (a.u || 0) : a.done ? 1 : -1))
        .forEach((item, idx) => {
          const li = document.createElement("li");
          li.className = "shop-row" + (item.done ? " done" : "");
          li.style.animationDelay = `${Math.min(idx, 8) * 30}ms`;

          const label = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!item.done;
          const mark = document.createElement("span");
          mark.className = "checkmark";
          mark.innerHTML = '<svg viewBox="0 0 12 10" fill="none"><polyline points="1.5 5.5 4.5 8.5 10.5 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          const txt = document.createElement("span");
          txt.className = "shop-text";
          txt.textContent = item.text;
          label.append(cb, mark, txt);

          cb.addEventListener("change", () => {
            item.done = cb.checked;
            item.by = item.done ? me : item.by;
            touch(item);
            saveShop();
            markDirty("meta");
            renderShop();
            if (item.done && navigator.vibrate && !reducedMotion) navigator.vibrate(10);
          });

          const von = memberById(item.addedBy);
          if (von) {
            const by = document.createElement("span");
            by.className = "shop-by";
            by.textContent = von.name;
            li.appendChild(label);
            li.appendChild(by);
          } else {
            li.appendChild(label);
          }

          const del = document.createElement("button");
          del.className = "member-del";
          del.title = "Entfernen";
          del.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
          del.addEventListener("click", () => {
            const weg = item;
            shop = shop.filter((x) => x.id !== item.id);
            tombs.shop[item.id] = Date.now();
            saveShop();
            saveTombs();
            markDirty("meta");
            renderShop();
            showToast(`„${weg.text}" entfernt.`, "Rückgängig", () => {
              delete tombs.shop[weg.id];
              touch(weg);
              shop.push(weg);
              saveShop();
              saveTombs();
              markDirty("meta");
              renderShop();
            });
          });
          li.appendChild(del);
          list.appendChild(li);
        });
    }

    const erledigt = shop.filter((i) => i.done).length;
    document.getElementById("shopSummary").textContent = shop.length
      ? `${offen} offen · ${erledigt} im Wagen`
      : "";
    document.getElementById("shopClear").hidden = erledigt === 0;
    shopSuggest();
  }

  function openShop() {
    shopModal.hidden = false;
    renderShop();
    document.getElementById("shopInput").focus();
  }

  document.getElementById("shopBtn").addEventListener("click", openShop);
  document.getElementById("shopClose").addEventListener("click", () => { shopModal.hidden = true; });
  shopModal.addEventListener("click", (e) => { if (e.target === shopModal) shopModal.hidden = true; });

  document.getElementById("shopForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("shopInput");
    const text = input.value.trim();
    if (!text) return;
    shop.push({ id: crypto.randomUUID(), text, done: false, addedBy: me, u: Date.now() });
    input.value = "";
    saveShop();
    markDirty("meta");
    renderShop();
    input.focus();
  });

  document.getElementById("shopClear").addEventListener("click", () => {
    const weg = shop.filter((i) => i.done);
    if (!weg.length) return;
    weg.forEach((i) => { tombs.shop[i.id] = Date.now(); });
    shop = shop.filter((i) => !i.done);
    saveShop();
    saveTombs();
    markDirty("meta");
    renderShop();
    showToast(`${weg.length} erledigte Einträge entfernt.`, "Rückgängig", () => {
      weg.forEach((i) => { delete tombs.shop[i.id]; touch(i); shop.push(i); });
      saveShop();
      saveTombs();
      markDirty("meta");
      renderShop();
    });
  });

  renderShop();

  /* ---------- Benachrichtigungen & Icon-Zähler ---------- */

  const NOTIF_KEY = "wochenplaner.notif.v1";
  const NOTIFIED_KEY = "wochenplaner.notified.v1";
  let notifOn = localStorage.getItem(NOTIF_KEY) === "1";
  let notified = new Set(loadJSON(NOTIFIED_KEY, []));
  const notifBtn = document.getElementById("notifBtn");

  function paintNotifBtn() {
    if (!notifBtn) return;
    const erlaubt = "Notification" in window && Notification.permission === "granted";
    notifBtn.classList.toggle("on", notifOn && erlaubt);
    notifBtn.title = notifOn && erlaubt
      ? "Erinnerungen melden sich — tippen zum Ausschalten"
      : "Erinnerungen aufs Handy melden lassen";
  }

  async function toggleNotif() {
    if (!("Notification" in window)) {
      showToast("Dein Browser unterstützt keine Benachrichtigungen.");
      return;
    }
    if (notifOn) {
      notifOn = false;
      localStorage.setItem(NOTIF_KEY, "0");
      paintNotifBtn();
      showToast("Benachrichtigungen aus.");
      return;
    }
    let p = Notification.permission;
    if (p === "default") p = await Notification.requestPermission();
    if (p !== "granted") {
      showToast("Benachrichtigungen sind im Browser blockiert — bitte dort erlauben.");
      return;
    }
    notifOn = true;
    localStorage.setItem(NOTIF_KEY, "1");
    paintNotifBtn();
    showToast("Erinnerungen melden sich jetzt zur Uhrzeit 🔔");
    checkDue();
  }

  if (notifBtn) notifBtn.addEventListener("click", toggleNotif);

  async function notify(titel, text) {
    if (!notifOn || Notification.permission !== "granted") return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const opts = { body: text, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: titel + text };
      if (reg) await reg.showNotification(titel, opts);
      else new Notification(titel, opts);
    } catch { /* Benachrichtigung nicht möglich — kein Beinbruch */ }
  }

  // Fällige Erinnerungen/Aufgaben melden + Zahl am App-Icon setzen
  function checkDue() {
    const heute = toKey(new Date());
    const jetzt = new Date();
    const meine = (data[heute] || []).filter(
      (t) => !t.done && canSee(t) && (!t.assignee || t.assignee === me || !memberById(t.assignee))
    );

    // Zahl am App-Icon (bleibt auch nach dem Schließen stehen)
    if ("setAppBadge" in navigator) {
      const offen = meine.length;
      if (offen > 0) navigator.setAppBadge(offen).catch(() => {});
      else navigator.clearAppBadge?.().catch(() => {});
    }

    if (!notifOn) return;
    (data[heute] || []).forEach((t) => {
      if (t.done || !t.time || notified.has(t.id)) return;
      if (t.assignee && t.assignee !== me) return; // nur, was mich betrifft
      if (!canSee(t)) return;
      const [h, min] = t.time.split(":").map(Number);
      const faellig = new Date();
      faellig.setHours(h, min, 0, 0);
      // im Zeitfenster von 0–30 Min nach Fälligkeit melden
      const diff = jetzt - faellig;
      if (diff >= 0 && diff < 30 * 60 * 1000) {
        const von = memberById(t.from);
        notify(
          t.kind === "reminder" ? `Erinnerung${von ? ` von ${von.name}` : ""}` : "Wochenplaner",
          `${t.time} — ${t.text}`
        );
        notified.add(t.id);
        // Liste klein halten
        if (notified.size > 200) notified = new Set([...notified].slice(-100));
        localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified]));
      }
    });
  }

  paintNotifBtn();
  setInterval(checkDue, 60000);
  setTimeout(checkDue, 2000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDue();
  });

  /* ---------- Daten sichern & laden ---------- */

  const BACKUP_KEY = "wochenplaner.lastBackup";

  // Der Gratis-Speicher gibt keine Garantie — deshalb ans Sichern erinnern
  function updateBackupHint() {
    const hint = document.getElementById("backupHint");
    if (!hint) return;
    const anzahl = Object.values(data).reduce((s, l) => s + l.length, 0);
    if (anzahl < 5) { hint.hidden = true; return; }
    const letzte = Number(localStorage.getItem(BACKUP_KEY) || 0);
    const tage = letzte ? Math.floor((Date.now() - letzte) / 86400000) : null;
    if (letzte && tage < 30) { hint.hidden = true; return; }
    hint.hidden = false;
    document.getElementById("backupHintText").textContent = letzte
      ? `Deine letzte Sicherung ist ${tage} Tage her. Der Online-Speicher ist kostenlos und ohne Garantie — lade euch sicherheitshalber eine Kopie herunter.`
      : "Du hast noch nie gesichert. Der Online-Speicher ist kostenlos und ohne Garantie — lade euch einmal eine Kopie herunter und leg sie beiseite.";
  }

  document.getElementById("exportBtn").addEventListener("click", () => {
    const backup = {
      app: "wochenplaner",
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: data,
      members,
      routines,
      shop,
      routineSkips: [...routineSkips],
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wochenplaner-sicherung-${toKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    updateBackupHint();
    showToast("Sicherung heruntergeladen — leg die Datei gut weg.");
  });

  const importFile = document.getElementById("importFile");
  document.getElementById("importBtn").addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", () => {
    const file = importFile.files[0];
    importFile.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result);
        if (backup.app !== "wochenplaner" || typeof backup.tasks !== "object") {
          showToast("Das ist keine gültige Wochenplaner-Sicherung.");
          return;
        }
        const prev = { data, members, routines, shop, skips: [...routineSkips] };
        data = backup.tasks || {};
        members = backup.members || [];
        routines = backup.routines || [];
        shop = backup.shop || [];
        routineSkips = new Set(backup.routineSkips || []);
        saveShop();
        renderShop();
        // Import gewinnt beim Sync: alles frisch stempeln
        const stamp = Date.now();
        Object.values(data).forEach((list) => list.forEach((t) => { t.u = stamp; }));
        members.forEach((m) => { m.u = stamp; });
        routines.forEach((r) => { r.u = stamp; });
        markAllDirty();
        saveData();
        saveMembers();
        saveRoutines();
        paintMeBtn();
        closeFamModal();
        render();
        showToast("Sicherung geladen.", "Rückgängig", () => {
          data = prev.data;
          members = prev.members;
          routines = prev.routines;
          shop = prev.shop;
          routineSkips = new Set(prev.skips);
          saveData();
          saveMembers();
          saveRoutines();
          saveShop();
          paintMeBtn();
          renderShop();
          render();
        });
      } catch {
        showToast("Die Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  });

  /* ---------- privacy toggle ---------- */

  function applyPrivacy() {
    privacyBtn.classList.toggle("hiding", hidePrivate);
    privacyBtn.title = hidePrivate ? "Private Aufgaben einblenden" : "Private Aufgaben ausblenden";
  }

  privacyBtn.addEventListener("click", () => {
    hidePrivate = !hidePrivate;
    localStorage.setItem(PRIVACY_KEY, hidePrivate ? "1" : "0");
    applyPrivacy();
    animatedRender();
    showToast(hidePrivate ? "Private Aufgaben ausgeblendet." : "Private Aufgaben sichtbar.");
  });

  applyPrivacy();

  /* ---------- stats & helpers ---------- */

  function updateProgress(chipEl, tasks) {
    const done = tasks.filter((t) => t.done).length;
    chipEl.querySelector(".progress-count").textContent = `${done}/${tasks.length}`;
    chipEl.classList.toggle("all-done", tasks.length > 0 && done === tasks.length);
  }

  let pctAnim = null;
  let lastPct = null;

  function updateWeekStats(dates, celebrate = false) {
    let total = 0;
    let done = 0;
    dates.forEach((d) => {
      const tasks = visibleTasks(toKey(d));
      total += tasks.length;
      done += tasks.filter((t) => t.done).length;
    });
    const pct = total ? Math.round((done / total) * 100) : 0;
    statsTextEl.textContent = `${done} von ${total} erledigt`;
    statsFillEl.style.width = `${pct}%`;
    animatePct(pct);
    if (celebrate && pct === 100 && lastPct !== 100 && total > 0) confettiBurst(statsPctEl, 22);
    lastPct = pct;
    renderMemberStats(dates);
    renderForYou(dates);
    updateRecapBtn(dates);
  }

  /* ---------- "Für dich": deine Woche auf einen Blick ---------- */

  let fyOpen = false;
  const forYouEl = document.getElementById("forYou");
  const forYouToggle = document.getElementById("forYouToggle");
  const forYouPanel = document.getElementById("forYouPanel");
  const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  forYouToggle.addEventListener("click", () => {
    if (forYouToggle.dataset.mode === "pick") {
      openMeModal();
      return;
    }
    fyOpen = !fyOpen;
    forYouPanel.hidden = !fyOpen;
    forYouToggle.setAttribute("aria-expanded", String(fyOpen));
  });

  function renderForYou(dates) {
    const m = memberById(me);
    if (!members.length) {
      forYouEl.hidden = true;
      return;
    }
    forYouEl.hidden = false;

    // ohne Profil: sichtbare Einladung statt leerem Bereich
    if (!m) {
      const av0 = document.getElementById("fyAvatar");
      av0.classList.add("open");
      av0.style.background = "";
      av0.textContent = "?";
      document.getElementById("fySummary").textContent = "Tippe hier und sag uns, wer du bist — dann siehst du deine Woche auf einen Blick.";
      forYouPanel.hidden = true;
      forYouToggle.setAttribute("aria-expanded", "false");
      forYouToggle.dataset.mode = "pick";
      return;
    }
    forYouToggle.dataset.mode = "";

    const av = document.getElementById("fyAvatar");
    av.classList.remove("open");
    av.style.background = m.color;
    av.textContent = initials(m.name);

    const myReminders = [];
    const myTasks = [];
    dates.forEach((d, i) => {
      visibleTasks(toKey(d)).forEach((t) => {
        if (t.done) return;
        if (t.kind === "reminder" && t.assignee === me) myReminders.push({ t, i });
        else if (t.kind !== "reminder" && t.assignee === me) myTasks.push({ t, i });
      });
    });

    const parts = [];
    parts.push(myReminders.length === 1 ? "1 Erinnerung" : `${myReminders.length} Erinnerungen`);
    parts.push(myTasks.length === 1 ? "1 offene Aufgabe" : `${myTasks.length} offene Aufgaben`);
    document.getElementById("fySummary").textContent = parts.join(" · ");

    fillFyList(document.getElementById("fyReminders"), myReminders, dates, "Keine Erinnerungen — alles ruhig.");
    fillFyList(document.getElementById("fyTasks"), myTasks, dates, "Nichts zugewiesen — schnapp dir was vom Board.");
  }

  function fillFyList(listEl, items, dates, emptyText) {
    listEl.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "fy-empty";
      li.textContent = emptyText;
      listEl.appendChild(li);
      return;
    }
    items.forEach(({ t, i }) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "fy-item";

      const day = document.createElement("span");
      day.className = "fy-day";
      day.textContent = `${DAY_SHORT[i]} ${String(dates[i].getDate()).padStart(2, "0")}.`;

      const text = document.createElement("span");
      text.className = "fy-item-text";
      text.textContent = t.text;

      const meta = document.createElement("span");
      meta.className = "fy-meta";
      const sender = memberById(t.from);
      meta.textContent = t.time || (t.kind === "reminder" && sender ? `von ${sender.name}` : t.private ? "privat" : "");

      btn.append(day, text, meta);
      btn.title = "Zum Tag springen";
      btn.addEventListener("click", () => jumpToDay(i));
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function jumpToDay(idx) {
    if (mobileQuery.matches) {
      board.style.setProperty("--sx", idx > selectedDayIdx ? "36px" : "-36px");
      selectedDayIdx = idx;
      render();
      board.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const col = board.querySelectorAll(".day-col")[idx];
    if (!col) return;
    col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    col.classList.add("flash");
    col.addEventListener("animationend", () => col.classList.remove("flash"), { once: true });
  }

  function renderMemberStats(dates) {
    memberStatsEl.innerHTML = "";
    if (!members.length) {
      memberStatsEl.hidden = true;
      return;
    }
    memberStatsEl.hidden = false;

    const weekTasks = [];
    dates.forEach((d) => weekTasks.push(...visibleTasks(toKey(d))));

    const mkChip = (id, avatarEl, label, count) => {
      const chip = document.createElement("button");
      chip.className = "mchip" + (id === "open" ? " open-chip" : "");
      if (filterMember === id) chip.classList.add("active");
      chip.appendChild(avatarEl);
      const name = document.createElement("span");
      name.textContent = label;
      const cnt = document.createElement("span");
      cnt.className = "mcount";
      cnt.textContent = count;
      chip.append(name, cnt);
      chip.title = filterMember === id ? "Filter aufheben" : `Nur Aufgaben von ${label} zeigen`;
      chip.addEventListener("click", () => {
        filterMember = filterMember === id ? null : id;
        animatedRender();
      });
      return chip;
    };

    const openTasks = weekTasks.filter((t) => (!t.assignee || !memberById(t.assignee)) && !t.done);
    const openAv = document.createElement("span");
    openAv.className = "avatar open";
    openAv.textContent = "?";
    memberStatsEl.appendChild(mkChip("open", openAv, "Offen", `${openTasks.length}`));

    // Wochen-Champion: wer am meisten erledigt hat, bekommt die Krone
    const doneCounts = new Map(members.map((m) => [m.id, weekTasks.filter((t) => t.assignee === m.id && t.done).length]));
    const maxDone = Math.max(0, ...doneCounts.values());
    const champions = maxDone > 0 ? members.filter((m) => doneCounts.get(m.id) === maxDone) : [];
    const isChampion = (m) => champions.length === 1 && champions[0].id === m.id;

    members.forEach((m) => {
      const mine = weekTasks.filter((t) => t.assignee === m.id);
      const doneCount = doneCounts.get(m.id);
      const av = document.createElement("span");
      av.className = "avatar";
      av.style.background = m.color;
      av.textContent = initials(m.name);
      const chip = mkChip(m.id, av, m.name, `${doneCount}/${mine.length}`);
      if (isChampion(m)) {
        const crown = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        crown.setAttribute("viewBox", "0 0 16 16");
        crown.setAttribute("class", "crown");
        crown.innerHTML = '<path d="M2.5 5.5 5 8l3-4 3 4 2.5-2.5-1 7h-9l-1-7Z" fill="currentColor"/>';
        chip.insertBefore(crown, chip.children[1]);
        chip.title = `${m.name} ist Wochen-Champion! · ${chip.title}`;
      }
      memberStatsEl.appendChild(chip);
    });
  }

  function animatePct(target) {
    if (reducedMotion) {
      statsPctEl.textContent = `${target}%`;
      return;
    }
    const start = parseInt(statsPctEl.textContent, 10) || 0;
    if (pctAnim) cancelAnimationFrame(pctAnim);
    const t0 = performance.now();
    const dur = 700;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      statsPctEl.textContent = `${Math.round(start + (target - start) * e)}%`;
      if (k < 1) pctAnim = requestAnimationFrame(tick);
    };
    pctAnim = requestAnimationFrame(tick);
  }

  function confettiBurst(el, count = 14) {
    if (reducedMotion) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "confetti";
      p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      document.body.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const dist = 42 + Math.random() * 55;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 26;
      const rot = Math.random() * 720 - 360;
      p.animate(
        [
          { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 46}px)) scale(0.3) rotate(${rot}deg)`, opacity: 0 },
        ],
        { duration: 750 + Math.random() * 450, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)" }
      ).onfinish = () => p.remove();
    }
  }

  function dayNameFor(dayKey) {
    const [y, m, d] = dayKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return DAY_NAMES[(date.getDay() + 6) % 7];
  }

  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  let toastTimer = null;
  function showToast(message, actionLabel, onAction) {
    const toast = document.getElementById("toast");
    toast.textContent = "";
    const msg = document.createElement("span");
    msg.textContent = message;
    toast.appendChild(msg);
    if (actionLabel && onAction) {
      const btn = document.createElement("button");
      btn.className = "toast-action";
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => {
        onAction();
        toast.hidden = true;
        clearTimeout(toastTimer);
      });
      toast.appendChild(btn);
    }
    toast.classList.remove("out");
    toast.hidden = false;
    void toast.offsetWidth; // restart the entry animation
    clearTimeout(toastTimer);
    const dauer = actionLabel ? 5000 : 2400; // mit Rückgängig etwas länger zeigen
    toastTimer = setTimeout(() => {
      toast.classList.add("out");
      toastTimer = setTimeout(() => { toast.hidden = true; }, 380);
    }, dauer);
  }

  /* ---------- theme ---------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0f0d0a" : "#fbf8f2";
  }

  document.getElementById("themeBtn").addEventListener("click", (e) => {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";

    if (!vtOk()) {
      applyTheme(next);
      return;
    }

    // Circular reveal from the toggle button. Named elements would be
    // snapshotted separately and escape the clip, so strip names first.
    const named = [...document.querySelectorAll(".day-col, .task")];
    const saved = named.map((el) => el.style.viewTransitionName);
    named.forEach((el) => { el.style.viewTransitionName = "none"; });
    document.documentElement.classList.add("theme-anim");

    const btnRect = e.currentTarget.getBoundingClientRect();
    const x = btnRect.left + btnRect.width / 2;
    const y = btnRect.top + btnRect.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const vt = document.startViewTransition(() => applyTheme(next));
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    });
    vt.finished.finally(() => {
      document.documentElement.classList.remove("theme-anim");
      named.forEach((el, i) => { el.style.viewTransitionName = saved[i]; });
    });
  });

  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) {
    applyTheme(savedTheme);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark");
  }

  /* ---------- navigation ---------- */

  function navigate(deltaDays, slidePx) {
    if (deltaDays) currentWeekStart.setDate(currentWeekStart.getDate() + deltaDays);
    board.style.setProperty("--sx", `${slidePx}px`);
    render();
  }

  document.getElementById("prevWeek").addEventListener("click", () => navigate(-7, -30));
  document.getElementById("nextWeek").addEventListener("click", () => navigate(7, 30));

  document.getElementById("todayBtn").addEventListener("click", () => {
    currentWeekStart = startOfWeek(new Date());
    selectedDayIdx = (new Date().getDay() + 6) % 7;
    board.style.setProperty("--sx", "0px");
    render();
  });

  document.getElementById("copyPrevBtn").addEventListener("click", () => {
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevDates = weekDates(prevWeekStart);
    const curDates = weekDates(currentWeekStart);
    let copied = 0;
    prevDates.forEach((prevDate, i) => {
      const prevKey = toKey(prevDate);
      const curKey = toKey(curDates[i]);
      const open = (data[prevKey] || []).filter((t) => !t.done);
      if (!open.length) return;
      if (!data[curKey]) data[curKey] = [];
      open.forEach((t) => {
        data[curKey].push({
          id: crypto.randomUUID(),
          text: t.text,
          time: t.time,
          prio: t.prio || "none",
          assignee: t.assignee || null,
          private: !!t.private,
          kind: t.kind || "task",
          from: t.from || null,
          done: false,
          u: Date.now(),
        });
        copied++;
      });
    });
    if (copied) markDirty(toKey(currentWeekStart));
    saveData();
    animatedRender();
    showToast(copied ? `${copied} Aufgabe(n) übernommen.` : "Keine offenen Aufgaben in der Vorwoche gefunden.");
  });

  render();

  // sanfter Hinweis beim ersten Start ohne Mitglieder / ohne Profil
  if (!members.length) {
    setTimeout(() => showToast("Tipp: Lege unter „Familie“ an, wer bei euch mitmacht."), 900);
  } else if (!me) {
    setTimeout(() => showToast("Tipp: Tippe oben auf „?“ und sag mir, wer du bist."), 900);
  }

  // Magnetische Buttons (portiert aus dem Optima-Projekt) — nur Desktop
  if (!reducedMotion && window.matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      const strength = 0.24;
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) * strength;
        const y = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.transition = "transform 0s";
        el.style.transform = `translate(${x}px, ${y}px)`;
      });
      el.addEventListener("pointerleave", () => {
        const from = el.style.transform || "translate(0px, 0px)";
        el.style.transition = "";
        el.style.transform = "";
        el.animate(
          [{ transform: from }, { transform: "translate(0px, 0px)" }],
          { duration: 500, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      });
    });
  }

  // kompakter Header beim Scrollen (per Sentinel, ohne Scroll-Listener)
  const island = document.querySelector(".island");
  const sentinel = document.createElement("div");
  sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;";
  document.body.prepend(sentinel);
  new IntersectionObserver(
    ([entry]) => island.classList.toggle("compact", !entry.isIntersecting),
    { rootMargin: "60px 0px 0px 0px" }
  ).observe(sentinel);

  // PWA: offline-fähig, als App installierbar
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();

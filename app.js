(() => {
  const STORAGE_KEY = "wochenplaner.tasks.v1";
  const MEMBERS_KEY = "wochenplaner.members.v1";
  const THEME_KEY = "wochenplaner.theme";
  const PRIVACY_KEY = "wochenplaner.hidePrivate";
  const ME_KEY = "wochenplaner.me.v1";
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
    return tasks.slice().sort((a, b) => {
      const t = (a.time || "99:99").localeCompare(b.time || "99:99");
      if (t !== 0) return t;
      return (PRIO_WEIGHT[a.prio] ?? 3) - (PRIO_WEIGHT[b.prio] ?? 3);
    });
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

  function render() {
    board.innerHTML = "";
    const dates = weekDates(currentWeekStart);
    const todayKey = toKey(new Date());
    const mobile = mobileQuery.matches;

    board.classList.toggle("single-day", mobile);
    dayStrip.hidden = !mobile;
    if (mobile) renderDayStrip(dates, todayKey);

    dates.forEach((date, i) => {
      if (mobile && i !== selectedDayIdx) return;
      const key = toKey(date);
      const frag = dayTemplate.content.cloneNode(true);
      const col = frag.querySelector(".day-col");
      col.style.setProperty("--i", i);
      if (vtOk()) col.style.viewTransitionName = `day-${key}`;
      if (key === todayKey) col.classList.add("is-today");

      frag.querySelector(".day-name").textContent = DAY_NAMES[i];
      frag.querySelector(".day-date").textContent = DATE_FMT.format(date);

      const list = frag.querySelector(".task-list");
      const tasks = sortTasks(data[key] || []).filter(taskVisible);
      renderTasks(list, key, tasks);
      updateProgress(frag.querySelector(".day-progress"), visibleTasks(key));
      setupDropZone(list, key);
      setupAddForm(frag.querySelector(".add-form"), key);

      board.appendChild(frag);
    });

    weekRangeEl.textContent = `${RANGE_FMT.format(dates[0])} – ${RANGE_FMT.format(dates[6])}`;
    weekNumberEl.textContent = `KW ${isoWeekNumber(dates[0])}`;
    updateWeekStats(dates);
  }

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
      render();
      if (after) after();
    };
    if (!vtOk()) {
      doRender();
      return;
    }
    document.documentElement.classList.add("vt");
    const t = document.startViewTransition(doRender);
    t.finished.finally(() => document.documentElement.classList.remove("vt"));
  }

  function renderTasks(list, dayKey, tasks) {
    list.innerHTML = "";

    if (!tasks.length) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      const img = document.createElement("img");
      img.className = "empty-img";
      img.src = "assets/empty.png";
      img.alt = "";
      const label = document.createElement("span");
      label.textContent = EMPTY_HINTS[hashCode(dayKey) % EMPTY_HINTS.length];
      hint.append(img, label);
      list.appendChild(hint);
      return;
    }

    tasks.forEach((task, idx) => {
      const frag = taskTemplate.content.cloneNode(true);
      const li = frag.querySelector(".task");
      const check = frag.querySelector(".task-check");
      const timeEl = frag.querySelector(".task-time");
      const textEl = frag.querySelector(".task-text");
      const prioEl = frag.querySelector(".task-prio");
      const assignBtn = frag.querySelector(".task-assign");
      const delBtn = frag.querySelector(".task-del");

      li.style.animationDelay = `${idx * 35}ms`;
      if (vtOk()) li.style.viewTransitionName = `t-${task.id}`;
      check.checked = task.done;
      if (task.done) li.classList.add("is-done");
      if (task.private) li.classList.add("is-private");
      if (task.kind === "reminder") {
        li.classList.add("is-reminder");
        const sender = memberById(task.from);
        frag.querySelector(".task-from").textContent = sender ? `von ${sender.name}` : "";
      }
      timeEl.textContent = task.time || "";
      textEl.textContent = task.text;
      prioEl.dataset.p = task.prio || "none";
      paintAssignBtn(assignBtn, task);

      assignBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (task.kind === "reminder") {
          const rec = memberById(task.assignee);
          const sender = memberById(task.from);
          showToast(`Erinnerung${sender ? ` von ${sender.name}` : ""}${rec ? ` an ${rec.name}` : ""} — nur ihr beide seht sie.`);
          return;
        }
        if (!members.length) {
          openFamModal();
          showToast("Lege zuerst eure Familienmitglieder an.");
          return;
        }
        cycleAssignee(task);
        paintAssignBtn(assignBtn, task);
        saveData();
        updateWeekStats(weekDates(currentWeekStart));
        const m = memberById(task.assignee);
        if (m) showToast(`${m.name} übernimmt: ${task.text}`);
      });

      check.addEventListener("change", () => {
        task.done = check.checked;
        saveData();
        li.classList.toggle("is-done", task.done);
        if (task.done) {
          li.classList.add("just-done");
          li.addEventListener("animationend", () => li.classList.remove("just-done"), { once: true });
        }
        const col = li.closest(".day-col");
        const chip = col.querySelector(".day-progress");
        updateProgress(chip, visibleTasks(dayKey));
        updateWeekStats(weekDates(currentWeekStart), true);
        if (mobileQuery.matches) renderDayStrip(weekDates(currentWeekStart), toKey(new Date()));
        if (task.done && visibleTasks(dayKey).every((t) => t.done)) {
          confettiBurst(chip);
          showToast(`${dayNameFor(dayKey)} komplett erledigt ✨`);
        }
      });

      delBtn.addEventListener("click", () => {
        data[dayKey] = (data[dayKey] || []).filter((t) => t.id !== task.id);
        saveData();
        animatedRender();
      });

      // inline edit on double-click
      textEl.addEventListener("dblclick", (e) => {
        e.preventDefault();
        startInlineEdit(textEl, task);
      });

      // drag & drop
      li.addEventListener("dragstart", (e) => {
        dragInfo = { taskId: task.id, fromKey: dayKey };
        li.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        dragInfo = null;
      });

      list.appendChild(frag);
    });
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

  function startInlineEdit(textEl, task) {
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
      if (commit && next) {
        task.text = next;
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

  function setupDropZone(list, dayKey) {
    list.addEventListener("dragover", (e) => {
      if (!dragInfo) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.classList.add("drag-over");
    });
    list.addEventListener("dragleave", () => list.classList.remove("drag-over"));
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      list.classList.remove("drag-over");
      if (!dragInfo || dragInfo.fromKey === dayKey) return;
      const fromList = data[dragInfo.fromKey] || [];
      const task = fromList.find((t) => t.id === dragInfo.taskId);
      if (!task) return;
      data[dragInfo.fromKey] = fromList.filter((t) => t.id !== task.id);
      if (!data[dayKey]) data[dayKey] = [];
      data[dayKey].push(task);
      saveData();
      animatedRender();
      showToast(`Verschoben nach ${dayNameFor(dayKey)}.`);
    });
  }

  function setupAddForm(form, dayKey) {
    const prioBtn = form.querySelector(".prio-btn");
    const lockBtn = form.querySelector(".lock-btn");
    const bellBtn = form.querySelector(".bell-btn");
    const chipsEl = form.querySelector(".assign-chips");
    let selectedAssignee = null;
    let isPrivate = false;
    let isReminder = false;

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
      data[dayKey].push({
        id: crypto.randomUUID(),
        text,
        time: timeInput.value || "",
        prio: prioBtn.dataset.p || "none",
        assignee: selectedAssignee,
        private: isPrivate,
        kind: isReminder ? "reminder" : "task",
        from: isReminder ? me : null,
        done: false,
      });
      saveData();
      if (isReminder) {
        const rec = memberById(selectedAssignee);
        showToast(`Erinnerung an ${rec ? rec.name : "?"} gespeichert 🔔`);
      }
      animatedRender(() => {
        // refocus the same day's input for fast entry
        const cols = board.querySelectorAll(".day-col");
        const dates = weekDates(currentWeekStart);
        const idx = dates.findIndex((d) => toKey(d) === dayKey);
        if (idx >= 0) cols[idx]?.querySelector(".add-input")?.focus();
      });
    });
  }

  /* ---------- family / members ---------- */

  function openFamModal() {
    renderMemberList();
    famModal.hidden = false;
    document.getElementById("memberName").focus();
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
      const meM = document.getElementById("meModal");
      if (!meM.hidden) meM.hidden = true;
    }
  });

  document.getElementById("memberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("memberName");
    const name = input.value.trim();
    if (!name) return;
    members.push({ id: crypto.randomUUID(), name, color: nextColor() });
    saveMembers();
    input.value = "";
    renderMemberList();
    render();
  });

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

    members.forEach((m) => {
      const mine = weekTasks.filter((t) => t.assignee === m.id);
      const doneCount = mine.filter((t) => t.done).length;
      const av = document.createElement("span");
      av.className = "avatar";
      av.style.background = m.color;
      av.textContent = initials(m.name);
      memberStatsEl.appendChild(mkChip(m.id, av, m.name, `${doneCount}/${mine.length}`));
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
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.remove("out");
    toast.hidden = false;
    void toast.offsetWidth; // restart the entry animation
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add("out");
      toastTimer = setTimeout(() => { toast.hidden = true; }, 380);
    }, 2400);
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
        });
        copied++;
      });
    });
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

  // PWA: offline-fähig, als App installierbar
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();

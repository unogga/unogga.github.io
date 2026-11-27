(() => {
  "use strict";

  const STORAGE_TASKS_KEY = "pulso_tasks_v1";
  const STORAGE_SETTINGS_KEY = "pulso_settings_v1";
  const STORAGE_INIT_KEY = "pulso_initialized_v1";
  const DB_NAME = "PulsoMediaDB";
  const DB_STORE = "media";

  const VIEW_TITLES = {
    tasks: { title: "Minhas Tarefas", subtitle: "Pulso • Material Design 3" },
    focus: { title: "Modo Foco", subtitle: "Tela ativa, cronômetro e leitura em voz" },
    tools: { title: "Recursos & Dados", subtitle: "APIs HTML5, backup local e Material You" },
  };

  const PRIORITY_LABELS = { high: "Alta", medium: "Média", low: "Baixa" };
  const SEED_THEME_COLORS = {
    indigo: { light: "#6750A4", dark: "#141218" },
    emerald: { light: "#006B5E", dark: "#141218" },
    ocean: { light: "#0B57D0", dark: "#141218" },
    terracotta: { light: "#9C4146", dark: "#141218" },
  };

  /* ========================================================================
     ESTADO & PERSISTÊNCIA
     ======================================================================== */
  const defaultSettings = {
    theme: window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    seed: "indigo",
    sound: true,
    vibration: true,
  };

  let tasks = [];
  let settings = loadSettings();
  let currentView = "tasks";
  let currentFilter = "all";
  let searchQuery = "";
  let editingTaskId = null;

  // Rascunho do modal de tarefa
  let draftSubtasks = [];
  let draftPriority = "medium";
  let draftLocation = null;
  let draftPhotoId = null;
  let draftAudioId = null;
  let draftFile = null; // { mediaId, name, type, size }
  let pendingTempMediaIds = new Set(); // Limpa mídias criadas e descartadas se cancelar

  // Cache de ObjectURLs para evitar vazamento e recriação desnecessária
  const objectUrlCache = new Map();
  const memoryMediaFallback = new Map();
  let dbPromise = null;

  // Câmera e Gravação
  let cameraStream = null;
  let cameraFacingMode = "environment";
  let audioStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingInterval = null;
  let recordingSeconds = 0;

  // Foco, Wake Lock, Áudio e Snackbar
  let wakeLock = null;
  let wakeLockDesired = false;
  let audioCtx = null;
  let snackbarTimer = null;
  let undoPayload = null;

  // Cronômetro do Modo Foco
  let timerDurationSec = 25 * 60;
  let timerRemainingSec = 25 * 60;
  let timerRunning = false;
  let timerEndAt = null;
  let timerInterval = null;

  /* ========================================================================
     SELETORES DOM
     ======================================================================== */
  const $ = (id) => document.getElementById(id);

  const topAppBar = $("top-app-bar");
  const viewTitle = $("view-title");
  const viewSubtitle = $("view-subtitle");
  const insecureBanner = $("insecure-banner");
  const metaThemeColor = $("meta-theme-color");

  const progressHeadline = $("progress-headline");
  const progressSub = $("progress-sub");
  const progressRingFill = $("progress-ring-fill");
  const progressPct = $("progress-pct");
  const greetingBadge = $("greeting-badge");

  const quickCaptureForm = $("quick-capture-form");
  const quickTitleInput = $("quick-title-input");
  const quickPasteBtn = $("quick-paste-btn");
  const quickExpandBtn = $("quick-expand-btn");

  const searchInput = $("search-input");
  const copyListBtn = $("copy-list-btn");
  const clearCompletedBtn = $("clear-completed-btn");
  const taskListEl = $("task-list");
  const emptyStateEl = $("empty-state");
  const emptyStateMsg = $("empty-state-msg");
  const emptyAddBtn = $("empty-add-btn");

  const countAllEl = $("count-all");
  const countPendingEl = $("count-pending");
  const countCompletedEl = $("count-completed");

  const speakSummaryBtn = $("speak-summary-btn");
  const shareListBtn = $("share-list-btn");
  const fullscreenToggleBtn = $("fullscreen-toggle-btn");

  // Modal Tarefa
  const taskModalScrim = $("task-modal-scrim");
  const modalTitleEl = $("modal-title");
  const taskForm = $("task-form");
  const taskIdField = $("task-id-field");
  const taskTitleField = $("task-title-field");
  const taskNotesField = $("task-notes-field");
  const taskCategoryField = $("task-category-field");
  const taskDueField = $("task-due-field");
  const clearDueBtn = $("clear-due-btn");
  const subtaskInput = $("subtask-input");
  const addSubtaskBtn = $("add-subtask-btn");
  const subtaskDraftList = $("subtask-draft-list");

  const btnOpenCamera = $("btn-open-camera");
  const cameraBox = $("camera-box");
  const cameraVideo = $("camera-video");
  const cameraSwitchBtn = $("camera-switch-btn");
  const cameraSnapBtn = $("camera-snap-btn");
  const cameraCloseBtn = $("camera-close-btn");

  const btnToggleAudio = $("btn-toggle-audio");
  const audioBtnLabel = $("audio-btn-label");
  const recordingBar = $("recording-bar");
  const recordingTimerEl = $("recording-timer");
  const btnStopAudio = $("btn-stop-audio");

  const btnGetLocation = $("btn-get-location");
  const taskFileInput = $("task-file-input");
  const draftAttachmentsEl = $("draft-attachments");

  // Modal Preview
  const previewScrim = $("preview-scrim");
  const previewTitleEl = $("preview-title");
  const previewBodyEl = $("preview-body");
  const previewFooterEl = $("preview-footer");
  const closePreviewBtn = $("close-preview-btn");

  // Foco
  const focusTaskSelect = $("focus-task-select");
  const focusTaskTitle = $("focus-task-title");
  const focusTaskNotes = $("focus-task-notes");
  const focusSpeakBtn = $("focus-speak-btn");
  const focusCompleteBtn = $("focus-complete-btn");
  const focusFullscreenBtn = $("focus-fullscreen-btn");
  const focusFsLabel = $("focus-fs-label");
  const timerProgressCircle = $("timer-progress-circle");
  const timerDisplay = $("timer-display");
  const timerStatus = $("timer-status");
  const timerStartPauseBtn = $("timer-start-pause-btn");
  const timerBtnLabel = $("timer-btn-label");
  const timerResetBtn = $("timer-reset-btn");

  const wakelockSwitch = $("wakelock-switch");
  const wakelockStatusText = $("wakelock-status-text");
  const soundSwitch = $("sound-switch");
  const vibrationSwitch = $("vibration-switch");

  // Recursos
  const themeSwitch = $("theme-switch");
  const exportJsonBtn = $("export-json-btn");
  const exportMdBtn = $("export-md-btn");
  const importFileInput = $("import-file-input");
  const toolsPasteBtn = $("tools-paste-btn");
  const notifPermissionBadge = $("notif-permission-badge");
  const requestNotifBtn = $("request-notif-btn");
  const testNotifBtn = $("test-notif-btn");
  const apiMatrixEl = $("api-matrix");

  // Snackbar
  const snackbarEl = $("snackbar");
  const snackbarText = $("snackbar-text");
  const snackbarAction = $("snackbar-action");

  /* ========================================================================
     UTILITÁRIOS BÁSICOS
     ======================================================================== */
  function uid(prefix = "t") {
    if (window.crypto && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
      if (!raw) return { ...defaultSettings };
      return { ...defaultSettings, ...JSON.parse(raw) };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignora erro de cota
    }
  }

  function loadTasks() {
    try {
      const initialized = localStorage.getItem(STORAGE_INIT_KEY);
      const raw = localStorage.getItem(STORAGE_TASKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
      if (!initialized) {
        const seeded = createStarterTasks();
        localStorage.setItem(STORAGE_INIT_KEY, "1");
        localStorage.setItem(STORAGE_TASKS_KEY, JSON.stringify(seeded));
        return seeded;
      }
      return [];
    } catch {
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_INIT_KEY, "1");
      localStorage.setItem(STORAGE_TASKS_KEY, JSON.stringify(tasks));
    } catch {
      showSnackbar("Espaço de armazenamento local quase cheio.");
    }
  }

  function createStarterTasks() {
    const now = Date.now();
    return [
      {
        id: uid(),
        title: "Publicar SPA de Tarefas no GitHub Pages",
        notes: "Testar abertura no navegador do celular via HTTPS e validar Material Design 3.",
        category: "Estudos",
        priority: "high",
        completed: false,
        dueAt: null,
        reminded: false,
        subtasks: [
          { id: uid("s"), text: "Enviar arquivos para o repositório GitHub", done: true },
          { id: uid("s"), text: "Ativar GitHub Pages na branch main", done: false },
          { id: uid("s"), text: "Testar Câmera, GPS, Voz e Vibração no celular", done: false },
        ],
        location: null,
        photoId: null,
        audioId: null,
        file: null,
        createdAt: now - 3600000,
      },
      {
        id: uid(),
        title: "Experimentar o Modo Foco com tela sempre ativa",
        notes: "Use o menu inferior/lateral para ativar Screen Wake Lock e Fullscreen API durante uma sessão de estudo.",
        category: "Pessoal",
        priority: "medium",
        completed: false,
        dueAt: null,
        reminded: false,
        subtasks: [],
        location: null,
        photoId: null,
        audioId: null,
        file: null,
        createdAt: now - 1800000,
      },
      {
        id: uid(),
        title: "Conferir estrutura responsiva Material Design 3",
        notes: "Navigation Bar no celular, Navigation Rail no desktop e paleta dinâmica Material You.",
        category: "Trabalho",
        priority: "low",
        completed: true,
        dueAt: null,
        reminded: false,
        subtasks: [],
        location: null,
        photoId: null,
        audioId: null,
        file: null,
        createdAt: now - 7200000,
      },
    ];
  }

  function formatDateTime(isoOrMs) {
    if (!isoOrMs) return "";
    const d = new Date(isoOrMs);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function toDatetimeLocalValue(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function formatMMSS(totalSec) {
    const safe = Math.max(0, Math.ceil(totalSec));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function isSecureWebContext() {
    return (
      window.isSecureContext ||
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1"
    );
  }

  /* ========================================================================
     INDEXEDDB PARA MÍDIAS (FOTOS, ÁUDIOS, ARQUIVOS)
     ======================================================================== */
  function openMediaDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!("indexedDB" in window)) {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function saveMediaBlob(id, blob, meta = {}) {
    memoryMediaFallback.set(id, { id, blob, ...meta });
    const db = await openMediaDB();
    if (!db) return id;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put({ id, blob, ...meta });
        tx.oncomplete = () => resolve(id);
        tx.onerror = () => resolve(id);
      } catch {
        resolve(id);
      }
    });
  }

  async function getMediaRecord(id) {
    if (!id) return null;
    if (memoryMediaFallback.has(id)) return memoryMediaFallback.get(id);
    const db = await openMediaDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, "readonly");
        const req = tx.objectStore(DB_STORE).get(id);
        req.onsuccess = () => {
          if (req.result) memoryMediaFallback.set(id, req.result);
          resolve(req.result || null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function deleteMediaBlob(id) {
    if (!id) return;
    memoryMediaFallback.delete(id);
    if (objectUrlCache.has(id)) {
      URL.revokeObjectURL(objectUrlCache.get(id));
      objectUrlCache.delete(id);
    }
    const db = await openMediaDB();
    if (!db) return;
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
    } catch {
      // Ignora erro
    }
  }

  async function getMediaObjectUrl(id) {
    if (!id) return null;
    if (objectUrlCache.has(id)) return objectUrlCache.get(id);
    const rec = await getMediaRecord(id);
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    objectUrlCache.set(id, url);
    return url;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  /* ========================================================================
     APIS DE FEEDBACK: WEB AUDIO API & VIBRATION API
     ======================================================================== */
  function getAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playToneSequence(notes) {
    if (!settings.sound) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    notes.forEach(({ freq, offset, duration, type = "sine", gain = 0.08 }) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + offset);

      env.gain.setValueAtTime(0.0001, now + offset);
      env.gain.exponentialRampToValueAtTime(gain, now + offset + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);

      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + duration + 0.02);
    });
  }

  function playSoundEffect(kind) {
    if (kind === "complete") {
      playToneSequence([
        { freq: 523.25, offset: 0, duration: 0.14, type: "triangle" },
        { freq: 659.25, offset: 0.09, duration: 0.16, type: "triangle" },
        { freq: 783.99, offset: 0.18, duration: 0.28, type: "sine" },
      ]);
    } else if (kind === "add") {
      playToneSequence([
        { freq: 440, offset: 0, duration: 0.1, type: "sine", gain: 0.06 },
        { freq: 587.33, offset: 0.07, duration: 0.14, type: "sine", gain: 0.06 },
      ]);
    } else if (kind === "alarm") {
      playToneSequence([
        { freq: 783.99, offset: 0, duration: 0.22, type: "triangle", gain: 0.1 },
        { freq: 987.77, offset: 0.2, duration: 0.22, type: "triangle", gain: 0.1 },
        { freq: 1174.66, offset: 0.4, duration: 0.32, type: "sine", gain: 0.1 },
        { freq: 1567.98, offset: 0.65, duration: 0.45, type: "sine", gain: 0.1 },
      ]);
    }
  }

  function triggerVibration(patternKey) {
    if (!settings.vibration || !("vibrate" in navigator)) return;
    try {
      if (patternKey === "tap") navigator.vibrate(18);
      else if (patternKey === "confirm") navigator.vibrate([16, 28, 16]);
      else if (patternKey === "alarm") navigator.vibrate([140, 70, 140, 70, 220]);
    } catch {
      // Ignora em navegadores que bloqueiam vibração sem gesto ativo
    }
  }

  /* ========================================================================
     SNACKBAR M3
     ======================================================================== */
  function showSnackbar(message, actionLabel = null, actionFn = null) {
    snackbarText.textContent = message;
    undoPayload = actionFn;

    if (actionLabel && typeof actionFn === "function") {
      snackbarAction.textContent = actionLabel;
      snackbarAction.hidden = false;
    } else {
      snackbarAction.hidden = true;
    }

    snackbarEl.hidden = false;
    if (snackbarTimer) clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => {
      snackbarEl.hidden = true;
      undoPayload = null;
    }, 4500);
  }

  snackbarAction.addEventListener("click", () => {
    const fn = undoPayload;
    snackbarEl.hidden = true;
    undoPayload = null;
    if (typeof fn === "function") fn();
  });

  /* ========================================================================
     MATERIAL DESIGN 3: TEMA, COR DINÂMICA E POINTER RIPPLE
     ======================================================================== */
  function applyThemeAndSeed() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.documentElement.setAttribute("data-seed", settings.seed);
    themeSwitch.checked = settings.theme === "dark";
    soundSwitch.checked = settings.sound;
    vibrationSwitch.checked = settings.vibration;

    const palette = SEED_THEME_COLORS[settings.seed] || SEED_THEME_COLORS.indigo;
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", settings.theme === "dark" ? palette.dark : palette.light);
    }

    document.querySelectorAll(".seed-swatch").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.seed === settings.seed);
    });
  }

  // Pointer Events: Ripple M3 originado no ponto exato do toque/caneta/mouse
  document.addEventListener("pointerdown", (e) => {
    const host = e.target.closest(".ripple-host");
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = (e.clientX ? e.clientX - rect.left : rect.width / 2) - size / 2;
    const y = (e.clientY ? e.clientY - rect.top : rect.height / 2) - size / 2;

    const ink = document.createElement("span");
    ink.className = "ripple-ink";
    ink.style.width = `${size}px`;
    ink.style.height = `${size}px`;
    ink.style.left = `${x}px`;
    ink.style.top = `${y}px`;
    host.appendChild(ink);
    ink.addEventListener("animationend", () => ink.remove(), { once: true });
  });

  /* ========================================================================
     NAVEGAÇÃO SPA
     ======================================================================== */
  function switchView(viewName) {
    if (!VIEW_TITLES[viewName]) return;
    currentView = viewName;
    document.body.dataset.view = viewName;

    document.querySelectorAll(".spa-view").forEach((sec) => {
      sec.classList.toggle("is-active", sec.id === `view-${viewName}`);
    });

    document.querySelectorAll(".nav-item").forEach((btn) => {
      const active = btn.dataset.view === viewName;
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });

    viewTitle.textContent = VIEW_TITLES[viewName].title;
    viewSubtitle.textContent = VIEW_TITLES[viewName].subtitle;

    if (viewName === "focus") {
      syncFocusView();
    } else if (viewName === "tools") {
      renderApiMatrix();
      updateNotificationBadge();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  /* ========================================================================
     SPEECH SYNTHESIS API (LEITURA EM VOZ ALTA PT-BR)
     ======================================================================== */
  function speakText(text, triggerBtn = null) {
    if (!("speechSynthesis" in window)) {
      showSnackbar("Síntese de voz não suportada neste navegador.");
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      document.querySelectorAll(".is-speaking").forEach((el) => el.classList.remove("is-speaking", "is-active"));
      if (triggerBtn && triggerBtn.dataset.wasSpeaking === "1") {
        triggerBtn.dataset.wasSpeaking = "0";
        return;
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1.02;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("pt"));
    if (ptVoice) utterance.voice = ptVoice;

    if (triggerBtn) {
      triggerBtn.classList.add("is-speaking", "is-active");
      triggerBtn.dataset.wasSpeaking = "1";
    }

    utterance.onend = utterance.onerror = () => {
      if (triggerBtn) {
        triggerBtn.classList.remove("is-speaking", "is-active");
        triggerBtn.dataset.wasSpeaking = "0";
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  speakSummaryBtn.addEventListener("click", () => {
    const pending = tasks.filter((t) => !t.completed);
    if (pending.length === 0) {
      speakText("Parabéns! Você não tem nenhuma tarefa pendente no momento.", speakSummaryBtn);
      return;
    }
    const topTitles = pending
      .slice(0, 5)
      .map((t, i) => `${i + 1}: ${t.title}`)
      .join(". ");
    const msg = `Você tem ${pending.length} ${pending.length === 1 ? "tarefa pendente" : "tarefas pendentes"}. Principais itens: ${topTitles}.`;
    speakText(msg, speakSummaryBtn);
  });

  /* ========================================================================
     CLIPBOARD API & WEB SHARE API
     ======================================================================== */
  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Segue para fallback
      }
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  function formatTaskAsText(task) {
    const lines = [`[${task.completed ? "x" : " "}] ${task.title}`];
    if (task.notes) lines.push(`Notas: ${task.notes}`);
    lines.push(`Categoria: ${task.category} | Prioridade: ${PRIORITY_LABELS[task.priority] || "Média"}`);
    if (task.dueAt) lines.push(`Lembrete: ${formatDateTime(task.dueAt)}`);
    if (task.location) {
      lines.push(`Local: https://www.openstreetmap.org/?mlat=${task.location.lat}&mlon=${task.location.lng}#map=17/${task.location.lat}/${task.location.lng}`);
    }
    if (task.subtasks && task.subtasks.length) {
      task.subtasks.forEach((s) => lines.push(`  - [${s.done ? "x" : " "}] ${s.text}`));
    }
    return lines.join("\n");
  }

  function formatListAsMarkdown(list) {
    if (!list.length) return "Lista vazia.";
    return list
      .map((t) => {
        const head = `- [${t.completed ? "x" : " "}] **${t.title}** (${t.category} • ${PRIORITY_LABELS[t.priority] || "Média"})`;
        const subs = (t.subtasks || []).map((s) => `  - [${s.done ? "x" : " "}] ${s.text}`);
        return [head, ...subs].join("\n");
      })
      .join("\n");
  }

  async function shareContent(title, text) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    const copied = await copyTextToClipboard(text);
    showSnackbar(copied ? "Compartilhamento nativo indisponível; texto copiado!" : "Não foi possível compartilhar.");
  }

  shareListBtn.addEventListener("click", () => {
    const list = getFilteredTasks();
    if (!list.length) {
      showSnackbar("Nenhuma tarefa para compartilhar no filtro atual.");
      return;
    }
    shareContent("Minha Lista de Tarefas — Pulso", formatListAsMarkdown(list));
  });

  copyListBtn.addEventListener("click", async () => {
    const list = getFilteredTasks();
    if (!list.length) {
      showSnackbar("Nenhuma tarefa para copiar.");
      return;
    }
    const ok = await copyTextToClipboard(formatListAsMarkdown(list));
    showSnackbar(ok ? `${list.length} tarefa(s) copiadas para a área de transferência.` : "Falha ao copiar.");
  });

  function importLinesAsTasks(rawText) {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      showSnackbar("Nenhum texto válido encontrado para importar.");
      return 0;
    }

    let created = 0;
    lines.reverse().forEach((line) => {
      const doneMatch = line.match(/^[-*•]?\s*\[([xX ])\]\s*(.+)$/);
      let title = line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").replace(/\*\*/g, "").trim();
      let completed = false;
      if (doneMatch) {
        completed = doneMatch[1].toLowerCase() === "x";
        title = doneMatch[2].replace(/\*\*/g, "").trim();
      }
      if (title) {
        tasks.unshift({
          id: uid(),
          title: title.slice(0, 140),
          notes: "",
          category: "Pessoal",
          priority: "medium",
          completed,
          dueAt: null,
          reminded: false,
          subtasks: [],
          location: null,
          photoId: null,
          audioId: null,
          file: null,
          createdAt: Date.now(),
        });
        created += 1;
      }
    });

    if (created > 0) {
      saveTasks();
      renderTasks();
      playSoundEffect("add");
      triggerVibration("tap");
      showSnackbar(`${created} tarefa(s) importada(s)!`);
    }
    return created;
  }

  async function handlePasteTasksFlow() {
    if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim()) {
          importLinesAsTasks(clip);
          return;
        }
      } catch {
        // Fallback para modal de colagem manual se permissão negada
      }
    }
    openPasteFallbackDialog();
  }

  quickPasteBtn.addEventListener("click", handlePasteTasksFlow);
  toolsPasteBtn.addEventListener("click", handlePasteTasksFlow);

  function openPasteFallbackDialog() {
    previewTitleEl.textContent = "Colar lista de tarefas";
    previewBodyEl.innerHTML = "";
    previewFooterEl.innerHTML = "";

    const info = document.createElement("p");
    info.textContent = "Cole abaixo um texto com uma tarefa por linha (ex.: lista do WhatsApp ou Markdown):";
    info.style.marginTop = "0";

    const textarea = document.createElement("textarea");
    textarea.className = "paste-textarea";
    textarea.rows = 6;
    textarea.placeholder = "- [ ] Comprar café\n- [ ] Estudar Web II\n- [ ] Enviar link no Moodle";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "m3-btn m3-btn--text ripple-host";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.addEventListener("click", closePreviewModal);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "m3-btn m3-btn--filled ripple-host";
    confirmBtn.textContent = "Importar linhas";
    confirmBtn.addEventListener("click", () => {
      importLinesAsTasks(textarea.value);
      closePreviewModal();
    });

    previewBodyEl.append(info, textarea);
    previewFooterEl.append(cancelBtn, confirmBtn);
    previewScrim.hidden = false;
    setTimeout(() => textarea.focus(), 60);
  }

  /* ========================================================================
     NOTIFICATIONS API & SERVICE WORKER
     ======================================================================== */
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !isSecureWebContext()) return null;
    try {
      return await navigator.serviceWorker.register("./sw.js");
    } catch {
      return null;
    }
  }

  async function sendSystemNotification(title, body, tag = "pulso-alert") {
    if (!("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;

    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: "./icon.svg",
            badge: "./icon.svg",
            tag,
            vibrate: [140, 70, 140],
          });
          return true;
        }
      }
      new Notification(title, { body, icon: "./icon.svg", tag });
      return true;
    } catch {
      return false;
    }
  }

  function updateNotificationBadge() {
    if (!("Notification" in window)) {
      notifPermissionBadge.textContent = "Notifications API não suportada neste navegador";
      return;
    }
    const perm = Notification.permission;
    if (perm === "granted") {
      notifPermissionBadge.textContent = "Permissão concedida • Notificações ativas";
    } else if (perm === "denied") {
      notifPermissionBadge.textContent = "Permissão bloqueada nas configurações do navegador";
    } else {
      notifPermissionBadge.textContent = "Permissão pendente • Clique em Ativar";
    }
  }

  requestNotifBtn.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      showSnackbar("Este navegador não suporta a Notifications API.");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      updateNotificationBadge();
      if (result === "granted") {
        showSnackbar("Notificações ativadas com sucesso!");
        await sendSystemNotification("Pulso Tarefas", "Os lembretes de tarefas estão prontos.");
      } else {
        showSnackbar("Permissão de notificação não concedida.");
      }
    } catch {
      showSnackbar("Não foi possível solicitar permissão de notificação.");
    }
  });

  testNotifBtn.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      showSnackbar("Notifications API indisponível.");
      return;
    }
    if (Notification.permission === "default") {
      await Notification.requestPermission();
      updateNotificationBadge();
    }
    if (Notification.permission === "granted") {
      const ok = await sendSystemNotification(
        "Lembrete de teste • Pulso",
        "Suas notificações HTML5 estão funcionando neste dispositivo!"
      );
      playSoundEffect("alarm");
      triggerVibration("confirm");
      if (!ok) showSnackbar("Falha ao disparar notificação do sistema.");
    } else {
      showSnackbar("Conceda permissão de notificação primeiro.");
    }
  });

  function checkDueReminders() {
    const now = Date.now();
    let changed = false;
    tasks.forEach((task) => {
      if (!task.completed && task.dueAt && !task.reminded && task.dueAt <= now) {
        task.reminded = true;
        changed = true;
        playSoundEffect("alarm");
        triggerVibration("alarm");
        showSnackbar(`Lembrete: ${task.title}`);
        sendSystemNotification("Lembrete de Tarefa • Pulso", task.title, `due-${task.id}`);
      }
    });
    if (changed) {
      saveTasks();
      renderTasks();
    }
  }

  /* ========================================================================
     FULLSCREEN API & SCREEN WAKE LOCK API
     ======================================================================== */
  function syncFullscreenUI() {
    const isFs = Boolean(document.fullscreenElement);
    document.body.classList.toggle("is-fullscreen", isFs);
    if (focusFsLabel) {
      focusFsLabel.textContent = isFs ? "Sair da tela cheia" : "Tela cheia";
    }
  }

  async function toggleFullscreen() {
    const el = document.documentElement;
    if (!el.requestFullscreen) {
      showSnackbar("Fullscreen API indisponível neste navegador (comum no Safari iOS).");
      return;
    }
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showSnackbar("Não foi possível alternar para tela cheia.");
    }
  }

  fullscreenToggleBtn.addEventListener("click", toggleFullscreen);
  focusFullscreenBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenUI);

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      wakelockSwitch.checked = false;
      wakelockDesired = false;
      wakelockStatusText.textContent = "Screen Wake Lock API não suportada neste navegador.";
      showSnackbar("Screen Wake Lock indisponível neste navegador.");
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakelockDesired = true;
      wakelockSwitch.checked = true;
      wakelockStatusText.textContent = "Tela mantida ativa enquanto esta aba estiver visível.";
      wakeLock.addEventListener("release", () => {
        if (!wakelockDesired) {
          wakelockStatusText.textContent = "Bloqueio de tela liberado.";
        }
      });
    } catch {
      wakelockSwitch.checked = false;
      wakelockDesired = false;
      wakelockStatusText.textContent = "Não foi possível ativar (verifique HTTPS ou bateria).";
      showSnackbar("Wake Lock indisponível neste contexto.");
    }
  }

  async function releaseWakeLock() {
    wakelockDesired = false;
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        // Ignora
      }
      wakeLock = null;
    }
    wakelockStatusText.textContent = "Impede que o celular apague a tela durante a execução.";
  }

  wakelockSwitch.addEventListener("change", () => {
    if (wakelockSwitch.checked) requestWakeLock();
    else releaseWakeLock();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkDueReminders();
      if (wakelockDesired && (!wakeLock || wakeLock.released)) {
        requestWakeLock();
      }
    }
  });

  /* ========================================================================
     MODO FOCO: CRONÔMETRO E SELEÇÃO DE TAREFA
     ======================================================================== */
  function syncFocusView() {
    const pending = tasks.filter((t) => !t.completed);
    const prevValue = focusTaskSelect.value;
    focusTaskSelect.innerHTML = "";

    if (!pending.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhuma tarefa pendente";
      focusTaskSelect.appendChild(opt);
      focusTaskTitle.textContent = "Tudo concluído!";
      focusTaskNotes.textContent = "Crie uma nova tarefa para iniciar uma sessão de foco.";
      focusSpeakBtn.disabled = true;
      focusCompleteBtn.disabled = true;
      return;
    }

    pending.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.title} (${PRIORITY_LABELS[t.priority] || "Média"})`;
      focusTaskSelect.appendChild(opt);
    });

    if (prevValue && pending.some((t) => t.id === prevValue)) {
      focusTaskSelect.value = prevValue;
    }
    updateFocusTaskCard();
  }

  function updateFocusTaskCard() {
    const selected = tasks.find((t) => t.id === focusTaskSelect.value);
    if (!selected) return;
    focusTaskTitle.textContent = selected.title;
    focusTaskNotes.textContent = selected.notes || `Categoria: ${selected.category} • Prioridade: ${PRIORITY_LABELS[selected.priority]}`;
    focusSpeakBtn.disabled = false;
    focusCompleteBtn.disabled = false;
  }

  focusTaskSelect.addEventListener("change", updateFocusTaskCard);

  focusSpeakBtn.addEventListener("click", () => {
    const selected = tasks.find((t) => t.id === focusTaskSelect.value);
    if (!selected) return;
    const text = `Tarefa em foco: ${selected.title}. ${selected.notes || ""}`;
    speakText(text, focusSpeakBtn);
  });

  focusCompleteBtn.addEventListener("click", () => {
    const selected = tasks.find((t) => t.id === focusTaskSelect.value);
    if (!selected) return;
    toggleTaskComplete(selected.id, true);
    syncFocusView();
  });

  function renderTimerUI() {
    timerDisplay.textContent = formatMMSS(timerRemainingSec);
    const circumference = 2 * Math.PI * 96; // 603.19
    const ratio = timerDurationSec > 0 ? Math.max(0, Math.min(1, timerRemainingSec / timerDurationSec)) : 1;
    timerProgressCircle.style.strokeDashoffset = String(circumference * (1 - ratio));
  }

  function stopTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerRunning = false;
    timerBtnLabel.textContent = "Iniciar foco";
  }

  function startOrPauseTimer() {
    if (timerRunning) {
      timerRemainingSec = Math.max(0, (timerEndAt - Date.now()) / 1000);
      stopTimerInterval();
      timerStatus.textContent = "Pausado";
      return;
    }

    if (timerRemainingSec <= 0) {
      timerRemainingSec = timerDurationSec;
    }

    timerRunning = true;
    timerEndAt = Date.now() + timerRemainingSec * 1000;
    timerBtnLabel.textContent = "Pausar";
    timerStatus.textContent = "Foco em andamento...";
    triggerVibration("tap");

    timerInterval = setInterval(() => {
      const left = (timerEndAt - Date.now()) / 1000;
      if (left <= 0) {
        timerRemainingSec = 0;
        renderTimerUI();
        stopTimerInterval();
        timerStatus.textContent = "Sessão concluída!";
        playSoundEffect("alarm");
        triggerVibration("alarm");
        const active = tasks.find((t) => t.id === focusTaskSelect.value);
        sendSystemNotification(
          "Tempo de foco finalizado!",
          active ? `Sessão encerrada para: ${active.title}` : "Hora de fazer uma pausa curta.",
          "pulso-focus"
        );
        showSnackbar("Sessão de foco concluída!");
      } else {
        timerRemainingSec = left;
        renderTimerUI();
      }
    }, 250);
  }

  timerStartPauseBtn.addEventListener("click", startOrPauseTimer);
  timerResetBtn.addEventListener("click", () => {
    stopTimerInterval();
    timerRemainingSec = timerDurationSec;
    timerStatus.textContent = "Pronto para começar";
    renderTimerUI();
  });

  document.querySelectorAll(".js-timer-preset").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".js-timer-preset").forEach((c) => c.classList.remove("is-selected"));
      chip.classList.add("is-selected");
      stopTimerInterval();
      timerDurationSec = Math.round(Number(chip.dataset.minutes) * 60);
      timerRemainingSec = timerDurationSec;
      timerStatus.textContent = "Pronto para começar";
      renderTimerUI();
    });
  });

  function openTaskInFocus(taskId) {
    switchView("focus");
    if (tasks.some((t) => t.id === taskId && !t.completed)) {
      focusTaskSelect.value = taskId;
      updateFocusTaskCard();
    }
  }

  /* ========================================================================
     CRUD DE TAREFAS + SUBTAREFAS + RENDERIZAÇÃO
     ======================================================================== */
  function getFilteredTasks() {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (currentFilter === "pending" && t.completed) return false;
      if (currentFilter === "completed" && !t.completed) return false;
      if (currentFilter === "high" && (t.priority !== "high" || t.completed)) return false;
      if (currentFilter === "media" && !t.photoId && !t.audioId && !t.location && !t.file) return false;

      if (q) {
        const hay = `${t.title} ${t.notes || ""} ${t.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function updateProgressSummary() {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const pending = total - completed;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    countAllEl.textContent = String(total);
    countPendingEl.textContent = String(pending);
    countCompletedEl.textContent = String(completed);
    clearCompletedBtn.hidden = completed === 0;

    progressHeadline.textContent = `${completed} de ${total} concluídas`;
    progressPct.textContent = `${pct}%`;

    const circumference = 2 * Math.PI * 26; // 163.36
    progressRingFill.style.strokeDashoffset = String(circumference * (1 - pct / 100));

    if (total === 0) {
      progressSub.textContent = "Adicione sua primeira tarefa abaixo.";
    } else if (pending === 0) {
      progressSub.textContent = "Excelente! Todas as tarefas estão concluídas.";
    } else {
      const highPending = tasks.filter((t) => !t.completed && t.priority === "high").length;
      progressSub.textContent = highPending > 0
        ? `${pending} pendente(s) • ${highPending} com prioridade alta.`
        : `${pending} ${pending === 1 ? "tarefa restante" : "tarefas restantes"} para completar.`;
    }

    const hour = new Date().getHours();
    greetingBadge.textContent = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  }

  function makeSvgIcon(pathD) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  function attachSwipeBehavior(card, bgEl, task) {
    let startX = 0;
    let startY = 0;
    let currentDx = 0;
    let pointerId = null;
    let dragging = false;
    let directionLocked = null; // "h" | "v"

    card.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest("button, input, label, a, audio, select")) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      currentDx = 0;
      dragging = true;
      directionLocked = null;
    });

    card.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!directionLocked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.25) {
          directionLocked = "h";
          card.classList.add("is-dragging");
          try {
            card.setPointerCapture(pointerId);
          } catch {
            // Ignora
          }
        } else {
          directionLocked = "v";
          dragging = false;
          return;
        }
      }

      if (directionLocked === "h") {
        currentDx = Math.max(-130, Math.min(130, dx));
        card.style.transform = `translateX(${currentDx}px)`;
        const labelEl = bgEl.querySelector(".task-swipe-bg__label");
        if (currentDx > 36) {
          bgEl.classList.add("is-complete-intent");
          bgEl.classList.remove("is-delete-intent");
          if (labelEl) labelEl.textContent = task.completed ? "Reabrir tarefa" : "Concluir tarefa";
        } else if (currentDx < -36) {
          bgEl.classList.add("is-delete-intent");
          bgEl.classList.remove("is-complete-intent");
          if (labelEl) labelEl.textContent = "Excluir tarefa";
        } else {
          bgEl.classList.remove("is-complete-intent", "is-delete-intent");
        }
      }
    });

    function finishSwipe(e) {
      if (!dragging && directionLocked !== "h") return;
      if (e.pointerId !== pointerId) return;
      dragging = false;
      card.classList.remove("is-dragging");
      bgEl.classList.remove("is-complete-intent", "is-delete-intent");

      if (directionLocked === "h" && currentDx > 76) {
        card.style.transform = "";
        triggerVibration("confirm");
        toggleTaskComplete(task.id);
      } else if (directionLocked === "h" && currentDx < -76) {
        card.style.transform = "";
        triggerVibration("confirm");
        deleteTask(task.id);
      } else {
        card.style.transform = "";
      }
      directionLocked = null;
    }

    card.addEventListener("pointerup", finishSwipe);
    card.addEventListener("pointercancel", finishSwipe);
  }

  function renderTasks() {
    updateProgressSummary();
    const list = getFilteredTasks();
    taskListEl.innerHTML = "";

    if (!list.length) {
      emptyStateEl.hidden = false;
      emptyStateMsg.textContent = searchQuery.trim()
        ? "Nenhuma tarefa corresponde à sua busca."
        : "Toque em Nova tarefa para adicionar itens com foto, nota de voz, GPS ou lembrete.";
      return;
    }
    emptyStateEl.hidden = true;

    list.forEach((task) => {
      const wrap = document.createElement("div");
      wrap.className = "task-swipe-wrap";
      wrap.setAttribute("role", "listitem");

      const swipeBg = document.createElement("div");
      swipeBg.className = "task-swipe-bg";
      const bgLabel = document.createElement("span");
      bgLabel.className = "task-swipe-bg__label";
      bgLabel.textContent = task.completed ? "Reabrir / Excluir" : "Concluir / Excluir";
      swipeBg.appendChild(bgLabel);

      const card = document.createElement("article");
      card.className = `task-card${task.completed ? " is-completed" : ""}`;

      const main = document.createElement("div");
      main.className = "task-card__main";

      // Checkbox M3
      const checkLabel = document.createElement("label");
      checkLabel.className = "m3-checkbox";
      checkLabel.setAttribute("aria-label", `Marcar "${task.title}" como concluída`);
      const checkInput = document.createElement("input");
      checkInput.type = "checkbox";
      checkInput.checked = Boolean(task.completed);
      checkInput.addEventListener("change", () => toggleTaskComplete(task.id, checkInput.checked));
      const checkBox = document.createElement("span");
      checkBox.className = "m3-checkbox__box";
      checkBox.appendChild(makeSvgIcon("M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"));
      checkLabel.append(checkInput, checkBox);

      // Body
      const body = document.createElement("div");
      body.className = "task-card__body";

      const top = document.createElement("div");
      top.className = "task-card__top";
      const titleEl = document.createElement("h3");
      titleEl.className = "task-card__title";
      titleEl.textContent = task.title;
      top.appendChild(titleEl);
      body.appendChild(top);

      if (task.notes) {
        const notesEl = document.createElement("p");
        notesEl.className = "task-card__notes";
        notesEl.textContent = task.notes;
        body.appendChild(notesEl);
      }

      // Meta Chips
      const meta = document.createElement("div");
      meta.className = "task-card__meta";

      const catChip = document.createElement("span");
      catChip.className = "assist-chip";
      catChip.textContent = task.category || "Pessoal";
      meta.appendChild(catChip);

      const prioChip = document.createElement("span");
      prioChip.className = `assist-chip${task.priority === "high" ? " assist-chip--high" : ""}`;
      const dot = document.createElement("span");
      dot.className = `priority-dot priority-dot--${task.priority || "medium"}`;
      const prioText = document.createElement("span");
      prioText.textContent = PRIORITY_LABELS[task.priority] || "Média";
      prioChip.append(dot, prioText);
      meta.appendChild(prioChip);

      if (task.dueAt) {
        const dueChip = document.createElement("span");
        const overdue = !task.completed && task.dueAt < Date.now();
        dueChip.className = `assist-chip${overdue ? " assist-chip--overdue" : ""}`;
        dueChip.appendChild(makeSvgIcon("M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"));
        const dueTxt = document.createElement("span");
        dueTxt.textContent = formatDateTime(task.dueAt);
        dueChip.appendChild(dueTxt);
        meta.appendChild(dueChip);
      }

      if (task.location) {
        const locLink = document.createElement("a");
        locLink.className = "assist-chip";
        locLink.href = `https://www.openstreetmap.org/?mlat=${task.location.lat}&mlon=${task.location.lng}#map=17/${task.location.lat}/${task.location.lng}`;
        locLink.target = "_blank";
        locLink.rel = "noopener noreferrer";
        locLink.appendChild(makeSvgIcon("M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"));
        const locTxt = document.createElement("span");
        locTxt.textContent = `${task.location.lat.toFixed(4)}, ${task.location.lng.toFixed(4)}`;
        locLink.appendChild(locTxt);
        meta.appendChild(locLink);
      }

      if (task.file) {
        const fileBtn = document.createElement("button");
        fileBtn.type = "button";
        fileBtn.className = "assist-chip ripple-host";
        fileBtn.appendChild(makeSvgIcon("M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"));
        const fileTxt = document.createElement("span");
        fileTxt.textContent = `${task.file.name} (${formatBytes(task.file.size)})`;
        fileBtn.appendChild(fileTxt);
        fileBtn.addEventListener("click", () => openMediaPreview(task.file.mediaId, task.file.name, task.file.type));
        meta.appendChild(fileBtn);
      }

      body.appendChild(meta);

      // Subtasks
      if (task.subtasks && task.subtasks.length) {
        const subUl = document.createElement("ul");
        subUl.className = "task-subtasks";
        task.subtasks.forEach((sub) => {
          const li = document.createElement("li");
          li.className = `task-subtask-item${sub.done ? " is-done" : ""}`;
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = Boolean(sub.done);
          cb.addEventListener("change", () => toggleSubtask(task.id, sub.id, cb.checked));
          const span = document.createElement("span");
          span.textContent = sub.text;
          li.append(cb, span);
          subUl.appendChild(li);
        });
        body.appendChild(subUl);
      }

      // Media strip (Foto da Câmera + Nota de Voz)
      if (task.photoId || task.audioId) {
        const mediaStrip = document.createElement("div");
        mediaStrip.className = "task-media-strip";

        if (task.photoId) {
          const thumbBtn = document.createElement("button");
          thumbBtn.type = "button";
          thumbBtn.className = "task-photo-thumb ripple-host";
          thumbBtn.setAttribute("aria-label", "Ampliar foto anexada");
          const img = document.createElement("img");
          img.alt = "Foto da tarefa";
          getMediaObjectUrl(task.photoId).then((url) => {
            if (url) img.src = url;
          });
          thumbBtn.appendChild(img);
          thumbBtn.addEventListener("click", () => openMediaPreview(task.photoId, "Foto da tarefa", "image/jpeg"));
          mediaStrip.appendChild(thumbBtn);
        }

        if (task.audioId) {
          const audio = document.createElement("audio");
          audio.className = "task-audio-player";
          audio.controls = true;
          getMediaObjectUrl(task.audioId).then((url) => {
            if (url) audio.src = url;
          });
          mediaStrip.appendChild(audio);
        }

        body.appendChild(mediaStrip);
      }

      main.append(checkLabel, body);

      // Card Quick Actions
      const actions = document.createElement("div");
      actions.className = "task-card__actions";

      const speakBtn = document.createElement("button");
      speakBtn.type = "button";
      speakBtn.className = "icon-btn icon-btn--sm ripple-host";
      speakBtn.title = "Ouvir tarefa (SpeechSynthesis)";
      speakBtn.setAttribute("aria-label", "Ouvir tarefa");
      speakBtn.appendChild(makeSvgIcon("M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"));
      speakBtn.addEventListener("click", () => speakText(`${task.title}. ${task.notes || ""}`, speakBtn));

      const focusBtn = document.createElement("button");
      focusBtn.type = "button";
      focusBtn.className = "icon-btn icon-btn--sm ripple-host";
      focusBtn.title = "Focar nesta tarefa";
      focusBtn.setAttribute("aria-label", "Focar nesta tarefa");
      focusBtn.appendChild(makeSvgIcon("M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0012 4c-4.97 0-9 4.03-9 9s4.02 9 9 9a8.994 8.994 0 007.03-14.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"));
      focusBtn.addEventListener("click", () => openTaskInFocus(task.id));

      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "icon-btn icon-btn--sm ripple-host";
      shareBtn.title = "Compartilhar tarefa";
      shareBtn.setAttribute("aria-label", "Compartilhar tarefa");
      shareBtn.appendChild(makeSvgIcon("M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"));
      shareBtn.addEventListener("click", () => shareContent(task.title, formatTaskAsText(task)));

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "icon-btn icon-btn--sm ripple-host";
      editBtn.title = "Editar tarefa";
      editBtn.setAttribute("aria-label", "Editar tarefa");
      editBtn.appendChild(makeSvgIcon("M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"));
      editBtn.addEventListener("click", () => openTaskModal(task.id));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "icon-btn icon-btn--sm ripple-host";
      delBtn.title = "Excluir tarefa";
      delBtn.setAttribute("aria-label", "Excluir tarefa");
      delBtn.appendChild(makeSvgIcon("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"));
      delBtn.addEventListener("click", () => deleteTask(task.id));

      actions.append(speakBtn, focusBtn, shareBtn, editBtn, delBtn);
      card.append(main, actions);

      attachSwipeBehavior(card, swipeBg, task);
      wrap.append(swipeBg, card);
      taskListEl.appendChild(wrap);
    });
  }

  function toggleTaskComplete(taskId, explicitState = null) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.completed = explicitState !== null ? explicitState : !task.completed;
    saveTasks();
    renderTasks();

    if (task.completed) {
      playSoundEffect("complete");
      triggerVibration("confirm");
    } else {
      triggerVibration("tap");
    }
  }

  function toggleSubtask(taskId, subId, done) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !task.subtasks) return;
    const sub = task.subtasks.find((s) => s.id === subId);
    if (!sub) return;
    sub.done = done;
    saveTasks();
    renderTasks();
    triggerVibration("tap");
  }

  function deleteTask(taskId) {
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return;
    const [removed] = tasks.splice(idx, 1);
    saveTasks();
    renderTasks();

    let undone = false;
    showSnackbar(`"${removed.title}" removida.`, "Desfazer", () => {
      undone = true;
      tasks.splice(idx, 0, removed);
      saveTasks();
      renderTasks();
    });

    // Só remove mídias binárias do IndexedDB após expirar janela de Desfazer
    setTimeout(() => {
      if (!undone && !tasks.some((t) => t.id === removed.id)) {
        if (removed.photoId) deleteMediaBlob(removed.photoId);
        if (removed.audioId) deleteMediaBlob(removed.audioId);
        if (removed.file && removed.file.mediaId) deleteMediaBlob(removed.file.mediaId);
      }
    }, 5000);
  }

  clearCompletedBtn.addEventListener("click", () => {
    const completed = tasks.filter((t) => t.completed);
    if (!completed.length) return;
    const backup = [...tasks];
    tasks = tasks.filter((t) => !t.completed);
    saveTasks();
    renderTasks();

    let undone = false;
    showSnackbar(`${completed.length} tarefa(s) concluída(s) removida(s).`, "Desfazer", () => {
      undone = true;
      tasks = backup;
      saveTasks();
      renderTasks();
    });

    setTimeout(() => {
      if (!undone) {
        completed.forEach((t) => {
          if (t.photoId) deleteMediaBlob(t.photoId);
          if (t.audioId) deleteMediaBlob(t.audioId);
          if (t.file && t.file.mediaId) deleteMediaBlob(t.file.mediaId);
        });
      }
    }, 5000);
  });

  // Captura Rápida
  quickCaptureForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = quickTitleInput.value.trim();
    if (!title) {
      quickTitleInput.focus();
      return;
    }
    tasks.unshift({
      id: uid(),
      title,
      notes: "",
      category: "Pessoal",
      priority: "medium",
      completed: false,
      dueAt: null,
      reminded: false,
      subtasks: [],
      location: null,
      photoId: null,
      audioId: null,
      file: null,
      createdAt: Date.now(),
    });
    quickTitleInput.value = "";
    saveTasks();
    renderTasks();
    playSoundEffect("add");
    triggerVibration("tap");
  });

  quickExpandBtn.addEventListener("click", () => {
    openTaskModal(null, quickTitleInput.value.trim());
  });

  // Filtros e Busca
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    renderTasks();
  });

  document.querySelectorAll(".filter-chips .m3-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      currentFilter = chip.dataset.filter;
      document.querySelectorAll(".filter-chips .m3-chip").forEach((c) => {
        const active = c === chip;
        c.classList.toggle("is-selected", active);
        c.setAttribute("aria-selected", String(active));
      });
      renderTasks();
    });
  });

  /* ========================================================================
     MODAL DE TAREFA: CÂMERA, ÁUDIO, GPS, FILE API
     ======================================================================== */
  function setPriorityButtons(val) {
    draftPriority = val;
    document.querySelectorAll(".segmented-btn__opt").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.dataset.priority === val);
    });
  }

  document.querySelectorAll(".segmented-btn__opt").forEach((btn) => {
    btn.addEventListener("click", () => setPriorityButtons(btn.dataset.priority));
  });

  function renderDraftSubtasks() {
    subtaskDraftList.innerHTML = "";
    draftSubtasks.forEach((sub, idx) => {
      const li = document.createElement("li");
      li.className = "subtask-draft-item";
      const span = document.createElement("span");
      span.textContent = sub.text;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "icon-btn icon-btn--sm";
      rm.setAttribute("aria-label", "Remover etapa");
      rm.appendChild(makeSvgIcon("M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"));
      rm.addEventListener("click", () => {
        draftSubtasks.splice(idx, 1);
        renderDraftSubtasks();
      });
      li.append(span, rm);
      subtaskDraftList.appendChild(li);
    });
  }

  function addDraftSubtask() {
    const txt = subtaskInput.value.trim();
    if (!txt) return;
    draftSubtasks.push({ id: uid("s"), text: txt, done: false });
    subtaskInput.value = "";
    renderDraftSubtasks();
  }

  addSubtaskBtn.addEventListener("click", addDraftSubtask);
  subtaskInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDraftSubtask();
    }
  });

  async function renderDraftAttachments() {
    draftAttachmentsEl.innerHTML = "";

    if (draftLocation) {
      const row = document.createElement("div");
      row.className = "draft-chip";
      const txt = document.createElement("span");
      txt.textContent = `GPS: ${draftLocation.lat.toFixed(5)}, ${draftLocation.lng.toFixed(5)} (±${Math.round(draftLocation.accuracy || 0)}m)`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "m3-btn m3-btn--text m3-btn--sm";
      rm.textContent = "Remover";
      rm.addEventListener("click", () => {
        draftLocation = null;
        renderDraftAttachments();
      });
      row.append(txt, rm);
      draftAttachmentsEl.appendChild(row);
    }

    if (draftPhotoId) {
      const row = document.createElement("div");
      row.className = "draft-chip";
      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "10px";
      const img = document.createElement("img");
      img.className = "draft-photo-preview";
      img.alt = "Prévia da foto";
      const url = await getMediaObjectUrl(draftPhotoId);
      if (url) img.src = url;
      const lbl = document.createElement("span");
      lbl.textContent = "Foto capturada (Câmera)";
      left.append(img, lbl);

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "m3-btn m3-btn--text m3-btn--sm";
      rm.textContent = "Remover";
      rm.addEventListener("click", () => {
        draftPhotoId = null;
        renderDraftAttachments();
      });
      row.append(left, rm);
      draftAttachmentsEl.appendChild(row);
    }

    if (draftAudioId) {
      const row = document.createElement("div");
      row.className = "draft-chip";
      const audio = document.createElement("audio");
      audio.className = "task-audio-player";
      audio.controls = true;
      const url = await getMediaObjectUrl(draftAudioId);
      if (url) audio.src = url;

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "m3-btn m3-btn--text m3-btn--sm";
      rm.textContent = "Remover";
      rm.addEventListener("click", () => {
        draftAudioId = null;
        renderDraftAttachments();
      });
      row.append(audio, rm);
      draftAttachmentsEl.appendChild(row);
    }

    if (draftFile) {
      const row = document.createElement("div");
      row.className = "draft-chip";
      const txt = document.createElement("span");
      txt.textContent = `Arquivo: ${draftFile.name} (${formatBytes(draftFile.size)})`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "m3-btn m3-btn--text m3-btn--sm";
      rm.textContent = "Remover";
      rm.addEventListener("click", () => {
        draftFile = null;
        renderDraftAttachments();
      });
      row.append(txt, rm);
      draftAttachmentsEl.appendChild(row);
    }
  }

  function openTaskModal(taskId = null, prefillTitle = "") {
    editingTaskId = taskId;
    pendingTempMediaIds.clear();
    const existing = taskId ? tasks.find((t) => t.id === taskId) : null;

    modalTitleEl.textContent = existing ? "Editar tarefa" : "Nova tarefa";
    taskIdField.value = existing ? existing.id : "";
    taskTitleField.value = existing ? existing.title : prefillTitle;
    taskNotesField.value = existing ? existing.notes || "" : "";
    taskCategoryField.value = existing ? existing.category || "Pessoal" : "Pessoal";
    taskDueField.value = existing && existing.dueAt ? toDatetimeLocalValue(existing.dueAt) : "";

    setPriorityButtons(existing ? existing.priority || "medium" : "medium");
    draftSubtasks = existing && existing.subtasks ? existing.subtasks.map((s) => ({ ...s })) : [];
    draftLocation = existing && existing.location ? { ...existing.location } : null;
    draftPhotoId = existing ? existing.photoId || null : null;
    draftAudioId = existing ? existing.audioId || null : null;
    draftFile = existing && existing.file ? { ...existing.file } : null;

    subtaskInput.value = "";
    renderDraftSubtasks();
    renderDraftAttachments();

    taskModalScrim.hidden = false;
    setTimeout(() => taskTitleField.focus(), 80);
  }

  function closeTaskModal(saved = false) {
    stopCamera();
    stopAudioRecording(true);

    const keptIds = new Set(
      saved ? [draftPhotoId, draftAudioId, draftFile && draftFile.mediaId].filter(Boolean) : []
    );
    pendingTempMediaIds.forEach((id) => {
      if (!keptIds.has(id)) deleteMediaBlob(id);
    });
    pendingTempMediaIds.clear();
    taskModalScrim.hidden = true;
  }

  $("rail-add-btn").addEventListener("click", () => openTaskModal());
  $("mobile-add-fab").addEventListener("click", () => openTaskModal());
  emptyAddBtn.addEventListener("click", () => openTaskModal());
  $("close-modal-btn").addEventListener("click", () => closeTaskModal(false));
  $("cancel-modal-btn").addEventListener("click", () => closeTaskModal(false));

  taskModalScrim.addEventListener("click", (e) => {
    if (e.target === taskModalScrim) closeTaskModal(false);
  });

  // Botões rápidos de lembrete
  document.querySelectorAll(".js-quick-due").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mins = Number(btn.dataset.mins);
      taskDueField.value = toDatetimeLocalValue(Date.now() + mins * 60000);
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then(updateNotificationBadge).catch(() => {});
      }
    });
  });

  clearDueBtn.addEventListener("click", () => {
    taskDueField.value = "";
  });

  // Geolocation API
  btnGetLocation.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      showSnackbar("Geolocalização não suportada neste dispositivo.");
      return;
    }
    btnGetLocation.disabled = true;
    showSnackbar("Obtendo coordenadas GPS...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btnGetLocation.disabled = false;
        draftLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        triggerVibration("tap");
        renderDraftAttachments();
        showSnackbar("Localização anexada à tarefa!");
      },
      (err) => {
        btnGetLocation.disabled = false;
        const msg = err.code === 1
          ? "Permissão de localização negada."
          : "Não foi possível obter a localização.";
        showSnackbar(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  // MediaDevices API: Câmera
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showSnackbar("MediaDevices API indisponível neste navegador/contexto.");
      return;
    }
    stopCamera();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacingMode },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
      cameraBox.hidden = false;
    } catch {
      showSnackbar("Não foi possível acessar a câmera.");
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraBox.hidden = true;
  }

  btnOpenCamera.addEventListener("click", startCamera);
  cameraCloseBtn.addEventListener("click", stopCamera);
  cameraSwitchBtn.addEventListener("click", () => {
    cameraFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
    startCamera();
  });

  cameraSnapBtn.addEventListener("click", () => {
    if (!cameraVideo.videoWidth) return;
    const maxW = 1280;
    const scale = Math.min(1, maxW / cameraVideo.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cameraVideo.videoWidth * scale);
    canvas.height = Math.round(cameraVideo.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const mediaId = uid("photo");
      await saveMediaBlob(mediaId, blob, { type: "image/jpeg" });
      pendingTempMediaIds.add(mediaId);
      draftPhotoId = mediaId;
      stopCamera();
      triggerVibration("confirm");
      await renderDraftAttachments();
      showSnackbar("Foto capturada e anexada!");
    }, "image/jpeg", 0.85);
  });

  // MediaRecorder API: Áudio
  function pickAudioMimeType() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
  }

  async function startAudioRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      showSnackbar("Gravação de áudio (MediaRecorder) indisponível neste navegador.");
      return;
    }
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      const mimeType = pickAudioMimeType();
      mediaRecorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const finalType = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunks, { type: finalType });
        if (audioStream) {
          audioStream.getTracks().forEach((t) => t.stop());
          audioStream = null;
        }
        if (blob.size > 0 && !mediaRecorder._discard) {
          const mediaId = uid("audio");
          await saveMediaBlob(mediaId, blob, { type: finalType });
          pendingTempMediaIds.add(mediaId);
          draftAudioId = mediaId;
          triggerVibration("confirm");
          await renderDraftAttachments();
          showSnackbar("Nota de voz gravada!");
        }
      };

      recordingSeconds = 0;
      recordingTimerEl.textContent = "Gravando 00:00";
      recordingBar.hidden = false;
      audioBtnLabel.textContent = "Gravando...";
      btnToggleAudio.disabled = true;
      triggerVibration("tap");

      recordingInterval = setInterval(() => {
        recordingSeconds += 1;
        recordingTimerEl.textContent = `Gravando ${formatMMSS(recordingSeconds)}`;
      }, 1000);

      mediaRecorder.start();
    } catch {
      showSnackbar("Permissão de microfone negada ou indisponível.");
    }
  }

  function stopAudioRecording(discard = false) {
    if (recordingInterval) {
      clearInterval(recordingInterval);
      recordingInterval = null;
    }
    recordingBar.hidden = true;
    audioBtnLabel.textContent = "Nota de voz";
    btnToggleAudio.disabled = false;

    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder._discard = discard;
      mediaRecorder.stop();
    } else if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
  }

  btnToggleAudio.addEventListener("click", startAudioRecording);
  btnStopAudio.addEventListener("click", () => stopAudioRecording(false));

  // File API: Anexo na tarefa
  taskFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    taskFileInput.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showSnackbar("Arquivo acima de 15 MB. Escolha um arquivo menor.");
      return;
    }
    const mediaId = uid("file");
    await saveMediaBlob(mediaId, file, { name: file.name, type: file.type, size: file.size });
    pendingTempMediaIds.add(mediaId);
    draftFile = { mediaId, name: file.name, type: file.type || "application/octet-stream", size: file.size };
    await renderDraftAttachments();
    showSnackbar(`Arquivo "${file.name}" anexado.`);
  });

  // Salvar Tarefa
  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = taskTitleField.value.trim();
    if (!title) {
      taskTitleField.focus();
      return;
    }

    const dueMs = taskDueField.value ? new Date(taskDueField.value).getTime() : null;
    const validDue = Number.isFinite(dueMs) ? dueMs : null;
    const existing = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;

    if (existing) {
      // Remove mídias antigas que foram substituídas ou apagadas
      if (existing.photoId && existing.photoId !== draftPhotoId) deleteMediaBlob(existing.photoId);
      if (existing.audioId && existing.audioId !== draftAudioId) deleteMediaBlob(existing.audioId);
      if (existing.file && (!draftFile || existing.file.mediaId !== draftFile.mediaId)) {
        deleteMediaBlob(existing.file.mediaId);
      }

      existing.title = title;
      existing.notes = taskNotesField.value.trim();
      existing.category = taskCategoryField.value;
      existing.priority = draftPriority;
      if (existing.dueAt !== validDue) existing.reminded = false;
      existing.dueAt = validDue;
      existing.subtasks = draftSubtasks;
      existing.location = draftLocation;
      existing.photoId = draftPhotoId;
      existing.audioId = draftAudioId;
      existing.file = draftFile;
      showSnackbar("Tarefa atualizada.");
    } else {
      tasks.unshift({
        id: uid(),
        title,
        notes: taskNotesField.value.trim(),
        category: taskCategoryField.value,
        priority: draftPriority,
        completed: false,
        dueAt: validDue,
        reminded: false,
        subtasks: draftSubtasks,
        location: draftLocation,
        photoId: draftPhotoId,
        audioId: draftAudioId,
        file: draftFile,
        createdAt: Date.now(),
      });
      playSoundEffect("add");
      triggerVibration("tap");
      showSnackbar("Tarefa criada!");
    }

    saveTasks();
    renderTasks();
    closeTaskModal(true);
  });

  /* ========================================================================
     MODAL DE VISUALIZAÇÃO DE FOTO / ARQUIVO LOCAL (FILE API)
     ======================================================================== */
  async function openMediaPreview(mediaId, title, mimeType = "") {
    const rec = await getMediaRecord(mediaId);
    if (!rec || !rec.blob) {
      showSnackbar("Arquivo local não encontrado.");
      return;
    }

    const url = await getMediaObjectUrl(mediaId);
    previewTitleEl.textContent = title || "Arquivo";
    previewBodyEl.innerHTML = "";
    previewFooterEl.innerHTML = "";

    const type = mimeType || rec.type || rec.blob.type || "";
    if (type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = title;
      previewBodyEl.appendChild(img);
    } else if (type.startsWith("text/") || /\.(txt|md|json|csv|js|css|html)$/i.test(title || "")) {
      const text = await rec.blob.text();
      const pre = document.createElement("pre");
      pre.textContent = text.slice(0, 20000);
      previewBodyEl.appendChild(pre);
    } else {
      const p = document.createElement("p");
      p.textContent = `Arquivo "${title}" (${formatBytes(rec.blob.size)}) armazenado localmente no dispositivo.`;
      previewBodyEl.appendChild(p);
    }

    const dlLink = document.createElement("a");
    dlLink.className = "m3-btn m3-btn--tonal ripple-host";
    dlLink.href = url;
    dlLink.download = title || "anexo";
    dlLink.textContent = "Baixar arquivo";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "m3-btn m3-btn--filled ripple-host";
    closeBtn.textContent = "Fechar";
    closeBtn.addEventListener("click", closePreviewModal);

    previewFooterEl.append(dlLink, closeBtn);
    previewScrim.hidden = false;
  }

  function closePreviewModal() {
    previewScrim.hidden = true;
  }

  closePreviewBtn.addEventListener("click", closePreviewModal);
  previewScrim.addEventListener("click", (e) => {
    if (e.target === previewScrim) closePreviewModal();
  });

  /* ========================================================================
     EXPORTAR & IMPORTAR ARQUIVOS (FILE API)
     ======================================================================== */
  function triggerFileDownload(filename, content, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportJsonBtn.addEventListener("click", async () => {
    const mediaBundle = {};
    for (const t of tasks) {
      const ids = [t.photoId, t.audioId, t.file && t.file.mediaId].filter(Boolean);
      for (const id of ids) {
        const rec = await getMediaRecord(id);
        if (rec && rec.blob) {
          mediaBundle[id] = {
            dataUrl: await blobToDataUrl(rec.blob),
            name: rec.name || null,
            type: rec.type || rec.blob.type || "",
            size: rec.size || rec.blob.size,
          };
        }
      }
    }

    const payload = {
      app: "Pulso M3",
      exportedAt: new Date().toISOString(),
      tasks,
      media: mediaBundle,
    };

    triggerFileDownload(`pulso-tarefas-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
    showSnackbar("Backup JSON exportado!");
  });

  exportMdBtn.addEventListener("click", () => {
    const md = `# Lista de Tarefas — Pulso\n\n${formatListAsMarkdown(tasks)}\n`;
    triggerFileDownload(`pulso-checklist-${new Date().toISOString().slice(0, 10)}.md`, md, "text/markdown");
    showSnackbar("Checklist .MD exportado!");
  });

  importFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    importFileInput.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        const parsed = JSON.parse(text);
        const importedTasks = Array.isArray(parsed) ? parsed : parsed.tasks;
        if (!Array.isArray(importedTasks)) throw new Error("Formato JSON inválido");

        if (parsed.media && typeof parsed.media === "object") {
          for (const [id, entry] of Object.entries(parsed.media)) {
            if (entry && entry.dataUrl) {
              const blob = await dataUrlToBlob(entry.dataUrl);
              await saveMediaBlob(id, blob, {
                name: entry.name || id,
                type: entry.type || blob.type,
                size: entry.size || blob.size,
              });
            }
          }
        }

        const sanitized = importedTasks
          .filter((t) => t && typeof t.title === "string" && t.title.trim())
          .map((t) => ({
            id: t.id || uid(),
            title: t.title.trim().slice(0, 140),
            notes: typeof t.notes === "string" ? t.notes : "",
            category: t.category || "Pessoal",
            priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
            completed: Boolean(t.completed),
            dueAt: Number.isFinite(t.dueAt) ? t.dueAt : null,
            reminded: Boolean(t.reminded),
            subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
            location: t.location || null,
            photoId: t.photoId || null,
            audioId: t.audioId || null,
            file: t.file || null,
            createdAt: t.createdAt || Date.now(),
          }));

        tasks = [...sanitized, ...tasks];
        saveTasks();
        renderTasks();
        showSnackbar(`${sanitized.length} tarefa(s) restaurada(s) do JSON!`);
      } else {
        importLinesAsTasks(text);
      }
    } catch {
      showSnackbar("Não foi possível ler o arquivo selecionado.");
    }
  });

  /* ========================================================================
     DIAGNÓSTICO DE APIS HTML5 DA APOSTILA
     ======================================================================== */
  function renderApiMatrix() {
    const secure = isSecureWebContext();
    const apis = [
      {
        name: "Geolocation API",
        ok: "geolocation" in navigator && secure,
        status: !("geolocation" in navigator) ? "Não suportado" : secure ? "Ativo" : "Requer HTTPS",
        usage: "Registra coordenadas GPS na tarefa com link para mapa.",
      },
      {
        name: "MediaDevices API (Câmera)",
        ok: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && secure,
        status: !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? "Não suportado" : secure ? "Ativo" : "Requer HTTPS",
        usage: "Captura foto direta pela câmera traseira/frontal como anexo.",
      },
      {
        name: "MediaRecorder API",
        ok: typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices) && secure,
        status: typeof MediaRecorder === "undefined" ? "Não suportado" : secure ? "Ativo" : "Requer HTTPS",
        usage: "Grava notas de voz pelo microfone e salva localmente.",
      },
      {
        name: "Web Share API",
        ok: "share" in navigator && secure,
        status: "share" in navigator && secure ? "Nativo disponível" : "Fallback Clipboard",
        warn: !("share" in navigator),
        usage: "Compartilha tarefas ou a lista completa pelo menu do celular.",
      },
      {
        name: "Clipboard API",
        ok: Boolean(navigator.clipboard) && secure,
        status: navigator.clipboard && secure ? "Ativo" : "Fallback ativo",
        warn: !(navigator.clipboard && secure),
        usage: "Copia checklists e importa linhas coladas como tarefas.",
      },
      {
        name: "Notifications API",
        ok: "Notification" in window && secure,
        status: !("Notification" in window) ? "Não suportado" : `Permissão: ${Notification.permission}`,
        warn: "Notification" in window && Notification.permission !== "granted",
        usage: "Dispara lembretes agendados e avisos do Modo Foco.",
      },
      {
        name: "Vibration API",
        ok: "vibrate" in navigator,
        status: "vibrate" in navigator ? "Suportado" : "Sem hardware/suporte",
        warn: !("vibrate" in navigator),
        usage: "Feedback tátil ao concluir, deslizar ou encerrar cronômetro.",
      },
      {
        name: "File API",
        ok: typeof FileReader !== "undefined" && typeof Blob !== "undefined",
        status: "Ativo",
        usage: "Anexa arquivos locais e importa/exporta backups .JSON e .MD.",
      },
      {
        name: "Web Audio API",
        ok: Boolean(window.AudioContext || window.webkitAudioContext),
        status: window.AudioContext || window.webkitAudioContext ? "Ativo" : "Não suportado",
        usage: "Sintetiza efeitos sonoros e alarmes sem arquivos MP3 externos.",
      },
      {
        name: "SpeechSynthesis API",
        ok: "speechSynthesis" in window,
        status: "speechSynthesis" in window ? "Ativo (pt-BR)" : "Não suportado",
        usage: "Lê tarefas individuais e o resumo do dia em voz alta.",
      },
      {
        name: "Fullscreen API",
        ok: Boolean(document.documentElement.requestFullscreen),
        status: document.documentElement.requestFullscreen ? "Disponível" : "Restrito no navegador",
        warn: !document.documentElement.requestFullscreen,
        usage: "Exibe o Modo Foco ou toda a aplicação em tela cheia.",
      },
      {
        name: "Screen Wake Lock API",
        ok: "wakeLock" in navigator && secure,
        status: "wakeLock" in navigator && secure ? "Disponível" : "Indisponível",
        warn: !("wakeLock" in navigator && secure),
        usage: "Mantém a tela do celular acesa durante execução no Modo Foco.",
      },
      {
        name: "Pointer Events",
        ok: "PointerEvent" in window,
        status: "PointerEvent" in window ? "Ativo" : "Não suportado",
        usage: "Gesto de deslizar nos cards e efeito ripple M3 em toque/caneta/mouse.",
      },
    ];

    apiMatrixEl.innerHTML = "";
    apis.forEach((item) => {
      const card = document.createElement("div");
      card.className = "api-item";

      const head = document.createElement("div");
      head.className = "api-item__head";
      const strong = document.createElement("strong");
      strong.textContent = item.name;
      const badge = document.createElement("span");
      badge.className = `api-badge ${item.ok && !item.warn ? "api-badge--ok" : item.warn ? "api-badge--warn" : "api-badge--off"}`;
      badge.textContent = item.status;
      head.append(strong, badge);

      const desc = document.createElement("p");
      desc.textContent = item.usage;

      card.append(head, desc);
      apiMatrixEl.appendChild(card);
    });
  }

  /* ========================================================================
     EVENTOS DE CONFIGURAÇÕES, SCROLL E ATALHOS
     ======================================================================== */
  document.querySelectorAll(".js-toggle-theme").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      saveSettings();
      applyThemeAndSeed();
    });
  });

  themeSwitch.addEventListener("change", () => {
    settings.theme = themeSwitch.checked ? "dark" : "light";
    saveSettings();
    applyThemeAndSeed();
  });

  soundSwitch.addEventListener("change", () => {
    settings.sound = soundSwitch.checked;
    saveSettings();
    if (settings.sound) playSoundEffect("add");
  });

  vibrationSwitch.addEventListener("change", () => {
    settings.vibration = vibrationSwitch.checked;
    saveSettings();
    if (settings.vibration) triggerVibration("tap");
  });

  document.querySelectorAll(".seed-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.seed = btn.dataset.seed;
      saveSettings();
      applyThemeAndSeed();
    });
  });

  window.addEventListener("scroll", () => {
    topAppBar.classList.toggle("is-scrolled", window.scrollY > 4);
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!previewScrim.hidden) closePreviewModal();
      else if (!taskModalScrim.hidden) closeTaskModal(false);
    } else if (
      e.key.toLowerCase() === "n" &&
      taskModalScrim.hidden &&
      previewScrim.hidden &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      e.preventDefault();
      openTaskModal();
    }
  });

  /* ========================================================================
     INICIALIZAÇÃO
     ======================================================================== */
  function init() {
    document.body.dataset.view = currentView;
    applyThemeAndSeed();
    tasks = loadTasks();
    renderTasks();
    renderTimerUI();
    updateNotificationBadge();
    renderApiMatrix();
    registerServiceWorker();

    if (!isSecureWebContext()) {
      insecureBanner.hidden = false;
    }

    checkDueReminders();
    setInterval(checkDueReminders, 10000);
  }

  init();
})();

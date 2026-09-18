import { CrossingTracker, computeLineCoordinate } from "./tracker.js?v=0.2.0";

const STORAGE_KEY = "shopflow-counter-events-v1";
const SETTINGS_KEY = "shopflow-counter-settings-v1";
const MAX_STORED_EVENTS = 5000;

const $ = (selector) => document.querySelector(selector);
const elements = {
  video: $("#cameraVideo"),
  canvas: $("#overlayCanvas"),
  stage: $("#cameraStage"),
  placeholder: $("#cameraPlaceholder"),
  loading: $("#loadingOverlay"),
  loadingTitle: $("#loadingTitle"),
  loadingMessage: $("#loadingMessage"),
  status: $("#cameraStatus"),
  error: $("#errorMessage"),
  start: $("#startButton"),
  stop: $("#stopButton"),
  fullscreen: $("#fullscreenButton"),
  cameraSelect: $("#cameraSelect"),
  orientation: $("#orientationSelect"),
  direction: $("#directionSelect"),
  linePosition: $("#linePosition"),
  linePositionOutput: $("#linePositionOutput"),
  confidence: $("#confidenceRange"),
  confidenceOutput: $("#confidenceOutput"),
  mirror: $("#mirrorToggle"),
  entries: $("#entriesCount"),
  exits: $("#exitsCount"),
  occupancy: $("#occupancyCount"),
  detected: $("#detectedCount"),
  fps: $("#fpsLabel"),
  trend: $("#entriesTrend"),
  chart: $("#hourlyChart"),
  eventsList: $("#eventsList"),
  manualEntry: $("#manualEntryButton"),
  manualExit: $("#manualExitButton"),
  export: $("#exportButton"),
  reset: $("#resetButton"),
};

const context = elements.canvas.getContext("2d");
const tracker = new CrossingTracker();
let model = null;
let modelPromise = null;
let generation = 0;
let geometryRevision = 0;
let stream = null;
let running = false;
let detectionTimer = null;
let lastFrameAt = 0;
let displayedPredictions = [];
const savedEvents = loadJson(STORAGE_KEY, []);
let events = (Array.isArray(savedEvents) ? savedEvents : []).filter(event =>
  event && ["entry", "exit"].includes(event.type) && ["camera", "manual"].includes(event.source) &&
  typeof event.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(event.timestamp) &&
  Number.isFinite(Date.parse(event.timestamp))
);

const settings = {
  orientation: "vertical",
  entryDirection: "negative-to-positive",
  linePosition: 50,
  confidence: 0.55,
  mirror: true,
  ...loadJson(SETTINGS_KEY, {}),
};

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { showError("Stockage local indisponible : exportez les résultats CSV avant de fermer cette page."); }
}

function persistSettings() {
  saveJson(SETTINGS_KEY, settings);
}

function persistEvents() {
  events = events.slice(-MAX_STORED_EVENTS);
  saveJson(STORAGE_KEY, events);
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayEvents() {
  const key = localDateKey();
  return events.filter((event) => localDateKey(new Date(event.timestamp)) === key);
}

function setStatus(mode, label) {
  elements.status.className = `status-pill status-${mode}`;
  elements.status.innerHTML = `<span></span> ${label}`;
}

function setLoading(visible, title = "Chargement de l’IA…", message = "Le premier chargement peut prendre quelques secondes.") {
  elements.loading.hidden = !visible;
  elements.loadingTitle.textContent = title;
  elements.loadingMessage.textContent = message;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = !message;
}

function applySettingsToForm() {
  elements.orientation.value = settings.orientation;
  elements.linePosition.value = settings.linePosition;
  elements.linePositionOutput.textContent = `${settings.linePosition} %`;
  elements.confidence.value = Math.round(settings.confidence * 100);
  elements.confidenceOutput.textContent = `${Math.round(settings.confidence * 100)} %`;
  elements.mirror.checked = settings.mirror;
  elements.video.classList.toggle("mirrored", settings.mirror);
  updateDirectionOptions();
  elements.direction.value = settings.entryDirection;
}

function updateDirectionOptions() {
  const horizontal = settings.orientation === "horizontal";
  elements.direction.options[0].textContent = horizontal ? "Haut → bas" : "Gauche → droite";
  elements.direction.options[1].textContent = horizontal ? "Bas → haut" : "Droite → gauche";
}

async function ensureModel() {
  if (model) return;
  if (!window.cocoSsd || !window.tf) {
    throw new Error("Le module de détection n’a pas pu être chargé. Vérifiez votre connexion Internet.");
  }
  setLoading(true);
  setStatus("loading", "Chargement");
  await window.tf.ready();
  if (!modelPromise) {
    modelPromise = window.cocoSsd.load({ base: "lite_mobilenet_v2" }).catch(error => {
      modelPromise = null;
      throw error;
    });
  }
  model = await modelPromise;
}

async function requestCamera(deviceId = "", session) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Ce navigateur ne permet pas l’accès à la caméra. Utilisez une page HTTPS dans Chrome ou Edge.");
  }

  stopStream();
  const videoConstraint = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };

  const acquiredStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraint,
    audio: false,
  });
  if (session !== generation) {
    acquiredStream.getTracks().forEach(track => track.stop());
    return;
  }
  stream = acquiredStream;
  stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
    if (session === generation) {
      stopCounting();
      showError("La caméra a été déconnectée. Rebranchez-la puis relancez le comptage.");
    }
  }));
  elements.video.srcObject = stream;
  await elements.video.play();
  await new Promise((resolve) => {
    if (elements.video.readyState >= 2) resolve();
    else elements.video.addEventListener("loadedmetadata", resolve, { once: true });
  });
  if (session !== generation) return;
  resizeCanvas();
  await listCameras();
}

async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const selected = elements.cameraSelect.value;
  elements.cameraSelect.innerHTML = '<option value="">Caméra par défaut</option>';
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Caméra ${index + 1}`;
    elements.cameraSelect.append(option);
  });
  if ([...elements.cameraSelect.options].some((option) => option.value === selected)) {
    elements.cameraSelect.value = selected;
  }
}

function resizeCanvas() {
  const width = elements.video.videoWidth || 1280;
  const height = elements.video.videoHeight || 720;
  elements.canvas.width = width;
  elements.canvas.height = height;
  elements.stage.style.aspectRatio = `${width} / ${height}`;
}

async function startCounting() {
  if (running || elements.start.disabled) return;
  const session = ++generation;
  showError("");
  elements.start.disabled = true;
  elements.stop.disabled = false;
  elements.cameraSelect.disabled = true;

  try {
    setLoading(true, "Activation de la caméra…", "Autorisez l’accès lorsque le navigateur le demande.");
    setStatus("loading", "Initialisation");
    await requestCamera(elements.cameraSelect.value, session);
    if (session !== generation) return;
    await ensureModel();
    if (session !== generation) return;
    running = true;
    lastFrameAt = 0;
    elements.cameraSelect.disabled = false;
    tracker.reset();
    elements.placeholder.hidden = true;
    setLoading(false);
    setStatus("live", "Comptage actif");
    elements.fps.textContent = "Analyse en cours";
    scheduleDetection(0, session);
  } catch (error) {
    if (session !== generation) return;
    console.error(error);
    stopCounting();
    const permissionMessage = error?.name === "NotAllowedError"
      ? "L’accès à la caméra a été refusé. Autorisez la caméra dans les paramètres du navigateur puis réessayez."
      : error.message || "Impossible de démarrer la caméra.";
    showError(permissionMessage);
  }
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  elements.video.srcObject = null;
}

function stopCounting() {
  ++generation;
  running = false;
  clearTimeout(detectionTimer);
  detectionTimer = null;
  stopStream();
  tracker.reset();
  displayedPredictions = [];
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  elements.placeholder.hidden = false;
  setLoading(false);
  setStatus("idle", "En attente");
  elements.start.disabled = false;
  elements.cameraSelect.disabled = false;
  elements.stop.disabled = true;
  elements.detected.textContent = "0";
  elements.fps.textContent = "Caméra arrêtée";
}

function scheduleDetection(delay = 180, session = generation) {
  if (!running || session !== generation) return;
  clearTimeout(detectionTimer);
  detectionTimer = setTimeout(() => detectFrame(session), delay);
}

async function detectFrame(session) {
  if (!running || session !== generation || !model) return;
  if (elements.video.readyState < 2) {
    scheduleDetection(180, session);
    return;
  }
  const revision = geometryRevision;
  try {
    const predictions = await model.detect(elements.video, 12, settings.confidence);
    if (!running || session !== generation) return;
    if (revision !== geometryRevision) {
      scheduleDetection(0, session);
      return;
    }
    displayedPredictions = predictions.filter(p => p.class === "person").map(mapPredictionForDisplay);
    elements.detected.textContent = String(displayedPredictions.length);
    processCrossings(displayedPredictions);
    drawOverlay(displayedPredictions);
    const now = performance.now();
    elements.fps.textContent = lastFrameAt ? `${(1000 / (now - lastFrameAt)).toFixed(1)} analyses/s` : "Analyse en cours";
    lastFrameAt = now;
  } catch (error) {
    if (session !== generation) return;
    console.error(error);
    stopCounting();
    showError("L’analyse a rencontré un problème. Relancez le comptage.");
    return;
  }
  scheduleDetection(180, session);
}

function mapPredictionForDisplay(prediction) {
  const [sourceX, y, width, height] = prediction.bbox;
  const x = settings.mirror
    ? elements.canvas.width - sourceX - width
    : sourceX;
  return {
    x,
    y,
    width,
    height,
    score: prediction.score,
    center: { x: x + width / 2, y: y + height / 2 },
  };
}

function currentLineCoordinate() {
  return computeLineCoordinate(
    settings.orientation,
    settings.linePosition,
    elements.canvas.width,
    elements.canvas.height,
  );
}

function processCrossings(predictions) {
  const result = tracker.update(
    predictions,
    Date.now(),
    {
      orientation: settings.orientation,
      lineCoordinate: currentLineCoordinate(),
      entryDirection: settings.entryDirection,
    },
  );

  result.events.forEach((event) => recordEvent(event.type, "camera"));
}

function drawOverlay(predictions) {
  const { width, height } = elements.canvas;
  context.clearRect(0, 0, width, height);
  drawCountingLine();

  for (const prediction of predictions) {
    const { x, y, width: boxWidth, height: boxHeight, score } = prediction;
    context.strokeStyle = "#7bf0b0";
    context.lineWidth = Math.max(2, width / 600);
    context.setLineDash([]);
    context.strokeRect(x, y, boxWidth, boxHeight);

    const label = `Personne ${Math.round(score * 100)} %`;
    context.font = `600 ${Math.max(12, width / 80)}px system-ui`;
    const textWidth = context.measureText(label).width;
    context.fillStyle = "rgba(8, 16, 14, 0.82)";
    context.fillRect(x, Math.max(0, y - 27), textWidth + 18, 27);
    context.fillStyle = "#bffbd9";
    context.fillText(label, x + 9, Math.max(18, y - 8));
  }
}

function drawCountingLine() {
  const { width, height } = elements.canvas;
  const coordinate = currentLineCoordinate();
  context.save();
  context.strokeStyle = "#ffcf79";
  context.lineWidth = Math.max(2, width / 700);
  context.setLineDash([12, 10]);
  context.beginPath();
  if (settings.orientation === "horizontal") {
    context.moveTo(0, coordinate);
    context.lineTo(width, coordinate);
  } else {
    context.moveTo(coordinate, 0);
    context.lineTo(coordinate, height);
  }
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(8, 16, 14, 0.8)";
  context.fillRect(10, 10, 155, 30);
  context.fillStyle = "#ffcf79";
  context.font = `700 ${Math.max(12, width / 90)}px system-ui`;
  context.fillText("LIGNE DE COMPTAGE", 21, 31);
  context.restore();
}

function recordEvent(type, source) {
  events.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    source,
    timestamp: new Date().toISOString(),
  });
  persistEvents();
  renderAnalytics();
}

function renderAnalytics() {
  const today = todayEvents();
  const entries = today.filter((event) => event.type === "entry").length;
  const exits = today.filter((event) => event.type === "exit").length;
  elements.entries.textContent = String(entries);
  elements.exits.textContent = String(exits);
  elements.occupancy.textContent = String(Math.max(0, entries - exits));
  elements.trend.textContent = entries === 0 ? "Session locale" : `${entries} passage${entries > 1 ? "s" : ""} entrant${entries > 1 ? "s" : ""}`;
  renderChart(today);
  renderEventList(today);
}

function renderChart(today) {
  const hourly = Array.from({ length: 24 }, () => 0);
  today
    .filter((event) => event.type === "entry")
    .forEach((event) => { hourly[new Date(event.timestamp).getHours()] += 1; });
  const maximum = Math.max(1, ...hourly);
  elements.chart.innerHTML = hourly
    .map((count, hour) => {
      const height = count === 0 ? 2 : Math.max(8, (count / maximum) * 100);
      return `
        <div class="chart-column" title="${hour} h : ${count} entrée${count > 1 ? "s" : ""}">
          <div class="chart-bar" style="height: ${height}%"></div>
          <time>${String(hour).padStart(2, "0")}</time>
        </div>`;
    })
    .join("");
}

function renderEventList(today) {
  const latest = [...today].reverse().slice(0, 12);
  if (!latest.length) {
    elements.eventsList.innerHTML = '<div class="empty-state">Aucun passage enregistré aujourd’hui.</div>';
    return;
  }
  elements.eventsList.innerHTML = latest
    .map((event) => {
      const date = new Date(event.timestamp);
      const isEntry = event.type === "entry";
      return `
        <div class="event-row ${event.type}">
          <span class="event-badge">${isEntry ? "↘" : "↗"}</span>
          <span>
            <strong>${isEntry ? "Entrée" : "Sortie"}</strong>
            <small>${event.source === "camera" ? "Détection caméra" : "Correction manuelle"}</small>
          </span>
          <time datetime="${event.timestamp}">${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </div>`;
    })
    .join("");
}

function exportCsv() {
  const header = "date;heure;type;source";
  const rows = events.map((event) => {
    const date = new Date(event.timestamp);
    return [
      localDateKey(date),
      date.toLocaleTimeString("fr-FR"),
      event.type === "entry" ? "entree" : "sortie",
      event.source,
    ].join(";");
  });
  const blob = new Blob(["\ufeff", header, "\n", rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shopflow-passages-${localDateKey()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function changeCamera() {
  if (!running) return;
  stopCounting();
  await startCounting();
}

elements.start.addEventListener("click", startCounting);
elements.stop.addEventListener("click", stopCounting);
elements.cameraSelect.addEventListener("change", changeCamera);
elements.manualEntry.addEventListener("click", () => recordEvent("entry", "manual"));
elements.manualExit.addEventListener("click", () => recordEvent("exit", "manual"));
elements.export.addEventListener("click", exportCsv);
elements.reset.addEventListener("click", () => {
  if (!window.confirm("Effacer tous les passages conservés sur cet appareil ?")) return;
  events = [];
  persistEvents();
  renderAnalytics();
});

elements.orientation.addEventListener("change", () => {
  settings.orientation = elements.orientation.value;
  updateDirectionOptions();
  settings.entryDirection = "negative-to-positive";
  elements.direction.value = settings.entryDirection;
  tracker.reset();
  geometryRevision++;
  persistSettings();
  if (running) drawOverlay(displayedPredictions);
});

elements.direction.addEventListener("change", () => {
  settings.entryDirection = elements.direction.value;
  tracker.reset();
  geometryRevision++;
  persistSettings();
});

elements.linePosition.addEventListener("input", () => {
  settings.linePosition = Number(elements.linePosition.value);
  elements.linePositionOutput.textContent = `${settings.linePosition} %`;
  tracker.reset();
  geometryRevision++;
  persistSettings();
  if (running) drawOverlay(displayedPredictions);
});

elements.confidence.addEventListener("input", () => {
  settings.confidence = Number(elements.confidence.value) / 100;
  elements.confidenceOutput.textContent = `${elements.confidence.value} %`;
  persistSettings();
});

elements.mirror.addEventListener("change", () => {
  settings.mirror = elements.mirror.checked;
  elements.video.classList.toggle("mirrored", settings.mirror);
  tracker.reset();
  geometryRevision++;
  persistSettings();
});

elements.fullscreen.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await elements.stage.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    showError("Le plein écran n’est pas disponible dans ce navigateur.");
  }
});

window.addEventListener("resize", () => {
  if (running && elements.video.videoWidth !== elements.canvas.width) resizeCanvas();
});

window.addEventListener("pagehide", stopCounting);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (running || elements.start.disabled)) {
    stopCounting();
    showError("Comptage arrêté : gardez cet onglet visible et le PC éveillé, puis cliquez sur Démarrer.");
  }
});
setInterval(renderAnalytics, 60_000);

applySettingsToForm();
renderAnalytics();

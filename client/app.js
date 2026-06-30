const PENCIL_COLOR = "#1f2328";
const PENCIL_WIDTH = 3;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const BACKEND_URL = window.location.hostname === 'localhost' ? '' : 'https://coboard.up.railway.app'
const socket = io(BACKEND_URL);

// DOM refs
const canvas = document.getElementById("whiteboard");
const boardWrap = canvas.closest(".board-wrap");
const cursorLayer = document.getElementById("cursorLayer");
const clearButton = document.getElementById("clearButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const connectionStatus = document.getElementById("connectionStatus");
const roomBadge = document.getElementById("roomBadge");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const copyRoomId = document.getElementById("copyRoomId");

// Modal steps
const nameOverlay = document.getElementById("nameOverlay");
const stepName = document.getElementById("stepName");
const stepAction = document.getElementById("stepAction");
const stepJoin = document.getElementById("stepJoin");
const nameForm = document.getElementById("nameForm");
const nameInput = document.getElementById("nameInput");
const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const joinForm = document.getElementById("joinForm");
const roomIdInput = document.getElementById("roomIdInput");
const joinError = document.getElementById("joinError");
const btnBack = document.getElementById("btnBack");

const ctx = canvas.getContext("2d");

// Viewport transform: screenX = worldX * zoom + panX
let panX = 0;
let panY = 0;
let zoom = 1;

// Drawing state
let isDrawing = false;
let lastPoint = null;
let activePointerId = null;
let lines = [];
let joined = false;
let userName = "";

// Stroke tracking for undo/redo
const clientId = Math.random().toString(36).slice(2, 10);
let strokeCounter = 0;
let currentStrokeId = null;
let currentStrokeSegments = [];

// History stacks — each entry: { strokeId, segments }
let undoStack = [];
let redoStack = [];

// Pan state
let isPanning = false;
let panPointerId = null;
let panLastPos = null;
let spaceDown = false;

const remoteCursors = new Map();

// ── Canvas sizing ─────────────────────────────────────────────────────────────

let canvasInitialized = false;

function resizeCanvas() {
  const rect = boardWrap.getBoundingClientRect();
  if (!canvasInitialized) {
    canvasInitialized = true;
    canvas.width = rect.width;
    canvas.height = rect.height;
    panX = rect.width / 2;
    panY = rect.height / 2;
  } else {
    const cx = (canvas.width / 2 - panX) / zoom;
    const cy = (canvas.height / 2 - panY) / zoom;
    canvas.width = rect.width;
    canvas.height = rect.height;
    panX = canvas.width / 2 - cx * zoom;
    panY = canvas.height / 2 - cy * zoom;
  }
  redrawCanvas();
}

window.addEventListener("resize", () => {
  resizeCanvas();
  remoteCursors.forEach(renderCursor);
});

// ── Coordinate helpers ────────────────────────────────────────────────────────

function getWorldPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - panX) / zoom,
    y: (event.clientY - rect.top - panY) / zoom,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function setStrokeStyle() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = PENCIL_COLOR;
  ctx.lineWidth = PENCIL_WIDTH;
}

function drawGrid() {
  const gridSize = 32;
  const left = -panX / zoom;
  const top = -panY / zoom;
  const right = left + canvas.width / zoom;
  const bottom = top + canvas.height / zoom;
  const startX = Math.floor(left / gridSize) * gridSize;
  const startY = Math.floor(top / gridSize) * gridSize;

  ctx.beginPath();
  ctx.strokeStyle = "rgba(70, 76, 84, 0.08)";
  ctx.lineWidth = 1;
  for (let x = startX; x <= right + gridSize; x += gridSize) {
    const sx = x * zoom + panX;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvas.height);
  }
  for (let y = startY; y <= bottom + gridSize; y += gridSize) {
    const sy = y * zoom + panY;
    ctx.moveTo(0, sy);
    ctx.lineTo(canvas.width, sy);
  }
  ctx.stroke();
}

function drawSegmentInViewport(segment) {
  ctx.beginPath();
  ctx.moveTo(segment.from.x * zoom + panX, segment.from.y * zoom + panY);
  ctx.lineTo(segment.to.x * zoom + panX, segment.to.y * zoom + panY);
  ctx.stroke();
}

function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  setStrokeStyle();
  lines.forEach(drawSegmentInViewport);
}

// ── Zoom & pan ────────────────────────────────────────────────────────────────

function applyZoom(delta, originX, originY) {
  const factor = delta < 0 ? 1.1 : 1 / 1.1;
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
  panX = originX - (originX - panX) * (newZoom / zoom);
  panY = originY - (originY - panY) * (newZoom / zoom);
  zoom = newZoom;
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const ox = event.clientX - rect.left;
  const oy = event.clientY - rect.top;
  if (event.ctrlKey || event.metaKey) {
    applyZoom(event.deltaY, ox, oy);
  } else {
    panX -= event.deltaX;
    panY -= event.deltaY;
  }
  redrawCanvas();
  remoteCursors.forEach(renderCursor);
}, { passive: false });

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (mod && !e.shiftKey && key === "z") {
    e.preventDefault();
    undo();
    return;
  }
  if (mod && e.shiftKey && key === "z") {
    e.preventDefault();
    redo();
    return;
  }
  if (e.ctrlKey && key === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (e.code === "Space" && !e.target.matches("input, textarea")) {
    spaceDown = true;
    if (!isDrawing) canvas.style.cursor = "grab";
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceDown = false;
    if (!isPanning) canvas.style.cursor = "crosshair";
  }
});

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function updateHistoryButtons() {
  undoButton.disabled = !joined || undoStack.length === 0;
  redoButton.disabled = !joined || redoStack.length === 0;
}

function undo() {
  if (!joined || isDrawing || undoStack.length === 0) return;
  const entry = undoStack.pop();
  redoStack.push(entry);
  lines = lines.filter((s) => s.strokeId !== entry.strokeId);
  redrawCanvas();
  socket.emit("undo-stroke", { strokeId: entry.strokeId });
  updateHistoryButtons();
}

function redo() {
  if (!joined || isDrawing || redoStack.length === 0) return;
  const entry = redoStack.pop();
  undoStack.push(entry);
  lines.push(...entry.segments);
  redrawCanvas();
  socket.emit("redo-stroke", { strokeId: entry.strokeId, segments: entry.segments });
  updateHistoryButtons();
}

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

// ── Remote cursors ────────────────────────────────────────────────────────────

function renderCursor(cursor) {
  const screenX = cursor.x * zoom + panX;
  const screenY = cursor.y * zoom + panY;
  cursor.element.style.transform = `translate(${screenX}px, ${screenY}px)`;
}

function getRemoteCursor(id, name, color) {
  const existing = remoteCursors.get(id);
  if (existing) {
    if (name) existing.label.textContent = name;
    if (color) existing.element.style.setProperty("--cursor-color", color);
    return existing;
  }
  const element = document.createElement("div");
  element.className = "remote-cursor";
  element.style.setProperty("--cursor-color", color || "#e05252");
  const label = document.createElement("span");
  label.className = "cursor-name";
  label.textContent = name || "";
  element.appendChild(label);
  cursorLayer.appendChild(element);
  const cursor = { element, label, x: 0, y: 0 };
  remoteCursors.set(id, cursor);
  return cursor;
}

// ── Status ────────────────────────────────────────────────────────────────────

function setConnectionStatus(text, stateClass) {
  connectionStatus.textContent = text;
  connectionStatus.classList.remove("is-online", "is-offline");
  if (stateClass) connectionStatus.classList.add(stateClass);
}

// ── Modal flow ────────────────────────────────────────────────────────────────

function showStep(step) {
  [stepName, stepAction, stepJoin].forEach((s) => (s.style.display = "none"));
  step.style.display = "block";
}

nameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  userName = name;
  showStep(stepAction);
});

btnCreate.addEventListener("click", () => socket.emit("create-room", { name: userName }));

btnJoin.addEventListener("click", () => {
  joinError.textContent = "";
  roomIdInput.value = "";
  showStep(stepJoin);
  roomIdInput.focus();
});

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const roomId = roomIdInput.value.trim();
  if (!/^\d{6}$/.test(roomId)) {
    joinError.textContent = "Please enter a valid 6-digit ID.";
    return;
  }
  joinError.textContent = "";
  socket.emit("join-room", { name: userName, roomId });
});

btnBack.addEventListener("click", () => showStep(stepAction));

copyRoomId.addEventListener("click", () => {
  navigator.clipboard.writeText(roomIdDisplay.textContent).then(() => {
    copyRoomId.textContent = "Copied!";
    setTimeout(() => (copyRoomId.textContent = "Copy"), 1500);
  });
});

// ── Socket events ─────────────────────────────────────────────────────────────

socket.on("connect", () => setConnectionStatus("Connected", "is-online"));
socket.on("disconnect", () => setConnectionStatus("Disconnected", "is-offline"));

socket.on("room-joined", ({ roomId, lines: serverLines }) => {
  joined = true;
  nameOverlay.classList.add("hidden");
  roomIdDisplay.textContent = roomId;
  roomBadge.hidden = false;
  lines = Array.isArray(serverLines) ? serverLines : [];
  redrawCanvas();
  updateHistoryButtons();
});

socket.on("room-error", ({ message }) => {
  joinError.textContent = message;
});

socket.on("draw-line", (segment) => {
  lines.push(segment);
  setStrokeStyle();
  drawSegmentInViewport(segment);
});

socket.on("clear-canvas", () => {
  lines = [];
  undoStack = [];
  redoStack = [];
  redrawCanvas();
  updateHistoryButtons();
});

// Remote user undid their stroke — remove it from our lines and redraw
socket.on("undo-stroke", ({ strokeId }) => {
  lines = lines.filter((s) => s.strokeId !== strokeId);
  redrawCanvas();
});

// Remote user redid their stroke — add segments back and draw them
socket.on("redo-stroke", ({ segments }) => {
  if (!Array.isArray(segments)) return;
  lines.push(...segments);
  setStrokeStyle();
  segments.forEach(drawSegmentInViewport);
});

socket.on("cursor-move", ({ id, x, y, name, color }) => {
  const cursor = getRemoteCursor(id, name, color);
  cursor.x = x;
  cursor.y = y;
  renderCursor(cursor);
});

socket.on("cursor-remove", (id) => {
  const cursor = remoteCursors.get(id);
  if (!cursor) return;
  cursor.element.remove();
  remoteCursors.delete(id);
});

// ── Pointer events ────────────────────────────────────────────────────────────

boardWrap.addEventListener("pointermove", (event) => {
  if (!joined) return;
  socket.emit("cursor-move", getWorldPoint(event));
});

canvas.addEventListener("pointerdown", (event) => {
  if (!joined) return;

  if (event.button === 1 || (event.button === 0 && spaceDown)) {
    isPanning = true;
    panPointerId = event.pointerId;
    panLastPos = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    event.preventDefault();
    return;
  }

  if (event.button === 0) {
    isDrawing = true;
    activePointerId = event.pointerId;
    lastPoint = getWorldPoint(event);
    currentStrokeId = `${clientId}-${++strokeCounter}`;
    currentStrokeSegments = [];
    canvas.setPointerCapture(activePointerId);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (isPanning && event.pointerId === panPointerId) {
    const dx = event.clientX - panLastPos.x;
    const dy = event.clientY - panLastPos.y;
    panX += dx;
    panY += dy;
    panLastPos = { x: event.clientX, y: event.clientY };
    redrawCanvas();
    remoteCursors.forEach(renderCursor);
    return;
  }

  if (!isDrawing || event.pointerId !== activePointerId || !lastPoint) return;

  const currentPoint = getWorldPoint(event);
  const segment = { from: lastPoint, to: currentPoint, strokeId: currentStrokeId };

  lines.push(segment);
  currentStrokeSegments.push(segment);
  setStrokeStyle();
  drawSegmentInViewport(segment);
  socket.emit("draw-line", segment);
  lastPoint = currentPoint;
});

function commitStroke() {
  if (currentStrokeSegments.length > 0) {
    undoStack.push({ strokeId: currentStrokeId, segments: [...currentStrokeSegments] });
    redoStack = []; // new drawing clears redo history
    currentStrokeSegments = [];
    currentStrokeId = null;
    updateHistoryButtons();
  }
}

function stopPanning(event) {
  if (!isPanning || event.pointerId !== panPointerId) return;
  isPanning = false;
  panPointerId = null;
  panLastPos = null;
  canvas.style.cursor = spaceDown ? "grab" : "crosshair";
}

function stopDrawing(event) {
  if (!isDrawing || event.pointerId !== activePointerId) return;
  isDrawing = false;
  lastPoint = null;
  activePointerId = null;
  commitStroke();
}

canvas.addEventListener("pointerup", (event) => {
  stopPanning(event);
  stopDrawing(event);
});

canvas.addEventListener("pointercancel", (event) => {
  stopPanning(event);
  stopDrawing(event);
});

canvas.addEventListener("pointerleave", (event) => {
  stopDrawing(event);
});

clearButton.addEventListener("click", () => {
  if (!joined) return;
  // Clear also resets local history since the whole board is wiped
  socket.emit("clear-canvas");
});

// Initialize
resizeCanvas();
updateHistoryButtons();

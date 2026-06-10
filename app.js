const MODEL_CONFIG = {
  useRemoteModel: false,
  endpoint: "http://localhost:8000/api/compose",
  requestTimeoutMs: 30000,
  useOpaPlacement: true,
  opaPlacementEndpoint: "http://127.0.0.1:8000/api/predict",
  opaPlacementTimeoutMs: 300000,
  useBrowserCutoutModel: true,
  cutoutLibraryUrl: "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm",
  repairSmallCutoutHoles: true,
  maxRepairHoleRatio: 0.035,
  minSolidAlpha: 96,
  strengthenWeakCutoutAlpha: true,
  weakAlphaRatioToStrengthen: 0,
  cutoutAlphaStrength: 0.62,
  minVisibleAlphaAfterStrengthen: 86,
  solidAlphaThreshold: 168,
};

const state = {
  subjectImage: null,
  backgroundImage: null,
  selection: null,
  foregroundCanvas: null,
  foregroundBaseCanvas: null,
  foregroundOriginalCanvas: null,
  resultBlobUrl: null,
  cutoutModule: null,
  resultEdit: null,
  subjectView: { scale: 1, x: 0, y: 0 },
  cutoutView: { scale: 1, x: 0, y: 0 },
  cutoutAdjust: { opacity: 1, tone: 0, sharpen: 0, eraser: false, eraserSize: 28 },
  placementAdjust: { scheme: 1, precision: 3, size: 3 },
  cutoutUndoStack: [],
  activeStage: 0,
  isProcessing: false,
};

const STAGE_COUNT = 4;
const CUTOUT_SCAN_MIN_MS = 950;

const EXAMPLE_BACKGROUNDS = Array.from({ length: 60 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    src: `assets/example-backgrounds/background-${number}.jpg`,
    label: "背景示例",
  };
});

const FOREGROUND_IMAGE_FILES = [
  "foreground-01.jpg",
  "foreground-02.jpg",
  "foreground-03.webp",
  "foreground-04.webp",
  "foreground-05.webp",
  "foreground-06.webp",
  "foreground-07.webp",
  "foreground-08.webp",
  "foreground-09.webp",
  "foreground-10.webp",
  "foreground-11.webp",
  "foreground-12.webp",
  "foreground-13.webp",
  "foreground-14.webp",
  "foreground-15.webp",
  "foreground-16.webp",
  "foreground-17.webp",
  "foreground-18.webp",
  "foreground-19.webp",
  "foreground-20.webp",
  "foreground-21.webp",
  "foreground-22.webp",
];

const EXAMPLE_FOREGROUNDS = FOREGROUND_IMAGE_FILES.map((file) => ({
  src: `assets/example-foregrounds/${file}`,
  label: "前景推荐",
}));

const HAS_LOCAL_FOREGROUND_RECOMMENDATIONS = true;

const els = {
  landing: document.querySelector("#landing"),
  composerApp: document.querySelector("#composerApp"),
  homeTab: document.querySelector("#homeTab"),
  composeTab: document.querySelector("#composeTab"),
  tutorialTab: document.querySelector("#tutorialTab"),
  startButton: document.querySelector("#startButton"),
  stageViewport: document.querySelector("#stageViewport"),
  stageTrack: document.querySelector("#stageTrack"),
  stageTitle: document.querySelector("#stageTitle"),
  stageHint: document.querySelector("#stageHint"),
  stageCounter: document.querySelector("#stageCounter"),
  stageSlides: Array.from(document.querySelectorAll(".stage-slide")),
  recommendPanel: document.querySelector("#recommendPanel"),
  recommendTitle: document.querySelector("#recommendTitle"),
  recommendTrack: document.querySelector("#recommendTrack"),
  prevStageButton: document.querySelector("#prevStageButton"),
  nextStageButton: document.querySelector("#nextStageButton"),
  viewOriginalButton: document.querySelector("#viewOriginalButton"),
  resetSubjectViewButton: document.querySelector("#resetSubjectViewButton"),
  resetCutoutViewButton: document.querySelector("#resetCutoutViewButton"),
  viewCutoutButton: document.querySelector("#viewCutoutButton"),
  viewBackgroundButton: document.querySelector("#viewBackgroundButton"),
  downloadMenuButton: document.querySelector("#downloadMenuButton"),
  downloadDialog: document.querySelector("#downloadDialog"),
  dialogCutoutDownloadButton: document.querySelector("#dialogCutoutDownloadButton"),
  dialogResultDownloadButton: document.querySelector("#dialogResultDownloadButton"),
  dialogCloseButton: document.querySelector("#dialogCloseButton"),
  exampleTracks: [
    document.querySelector("#exampleTrackA"),
    document.querySelector("#exampleTrackB"),
    document.querySelector("#exampleTrackC"),
  ],
  subjectInput: document.querySelector("#subjectInput"),
  backgroundInput: document.querySelector("#backgroundInput"),
  subjectDrop: document.querySelector("#subjectDrop"),
  backgroundDrop: document.querySelector("#backgroundDrop"),
  subjectCanvasWrap: document.querySelector("#subjectCanvasWrap"),
  backgroundCanvasWrap: document.querySelector("#backgroundCanvasWrap"),
  subjectCanvas: document.querySelector("#subjectCanvas"),
  cutoutScanLine: document.querySelector("#cutoutScanLine"),
  cutoutCanvas: document.querySelector("#cutoutCanvas"),
  backgroundCanvas: document.querySelector("#backgroundCanvas"),
  resultCanvas: document.querySelector("#resultCanvas"),
  resultEditBox: document.querySelector("#resultEditBox"),
  selectionBox: document.querySelector("#selectionBox"),
  selectionHint: document.querySelector("#selectionHint") || document.querySelector("#stageHint"),
  backgroundHint: document.querySelector("#backgroundHint") || document.querySelector("#stageHint"),
  resultHint: document.querySelector("#resultHint") || document.querySelector("#stageHint"),
  runButton: document.querySelector("#runButton"),
  downloadButton: document.querySelector("#downloadButton"),
  cutoutDownloadButton: document.querySelector("#cutoutDownloadButton"),
  restoreSubjectButton: document.querySelector("#restoreSubjectButton"),
  serviceStatus: document.querySelector("#serviceStatus"),
  scoreCard: document.querySelector("#scoreCard"),
  scoreValue: document.querySelector("#scoreValue"),
  adjustWidget: document.querySelector("#adjustWidget"),
  adjustFloatButton: document.querySelector("#adjustFloatButton"),
  cutoutAdjustCard: document.querySelector("#cutoutAdjustCard"),
  placementAdjustCard: document.querySelector("#placementAdjustCard"),
  cutoutAdjustPanel: document.querySelector("#cutoutAdjustPanel"),
  cutoutOpacitySlider: document.querySelector("#cutoutOpacitySlider"),
  cutoutToneSlider: document.querySelector("#cutoutToneSlider"),
  cutoutSharpenSlider: document.querySelector("#cutoutSharpenSlider"),
  eraserToggleButton: document.querySelector("#eraserToggleButton"),
  eraserSizeSlider: document.querySelector("#eraserSizeSlider"),
  cutoutUndoButton: document.querySelector("#cutoutUndoButton"),
  cutoutResetButton: document.querySelector("#cutoutResetButton"),
  placementAdjustPanel: document.querySelector("#placementAdjustPanel"),
  placementSchemeButtons: Array.from(document.querySelectorAll("[data-placement-scheme]")),
  placementPrecisionSlider: document.querySelector("#placementPrecisionSlider"),
  placementPrecisionValue: document.querySelector("#placementPrecisionValue"),
  placementSizeSlider: document.querySelector("#placementSizeSlider"),
  placementSizeValue: document.querySelector("#placementSizeValue"),
  placementSearchButton: document.querySelector("#placementSearchButton"),
  placementStatus: document.querySelector("#placementStatus"),
};

function canvasContext(canvas) {
  return canvas.getContext("2d", { willReadFrequently: true });
}

function setCanvasSize(canvas, width, height) {
  const maxWidth = canvas.parentElement.clientWidth - 24;
  const maxHeight = canvas.parentElement.clientHeight - 24;
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.dataset.scale = String(ratio);
}

async function fileToImage(file) {
  return blobToImage(file);
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  return sourceToImage(url);
}

async function sourceToImage(src) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  return image;
}

async function urlToImage(src) {
  const embeddedSrc = window.FOREGROUND_IMAGE_DATA?.[src] || window.BACKGROUND_IMAGE_DATA?.[src];
  if (embeddedSrc) return sourceToImage(embeddedSrc);

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`图片载入失败 ${response.status}`);
    return blobToImage(await response.blob());
  } catch (error) {
    return sourceToImage(src);
  }
}

async function handleImageUpload(kind, file) {
  if (!file || !file.type.startsWith("image/")) return;
  const image = await fileToImage(file);
  if (kind === "subject") {
    state.subjectImage = image;
    resetSubjectView();
    drawImageToCanvas(els.subjectCanvas, image);
    state.selection = null;
    state.foregroundCanvas = null;
    state.foregroundBaseCanvas = null;
    state.foregroundOriginalCanvas = null;
    els.selectionBox.hidden = true;
    els.selectionHint.textContent = "拖拽框选人像或主要物品";
    els.serviceStatus.textContent = "等待框选";
    initEmptyCanvas(els.cutoutCanvas, "等待抠图");
    goToStage(0);
  } else {
    state.backgroundImage = image;
    drawImageToCanvas(els.backgroundCanvas, image);
    els.backgroundHint.textContent = `${image.naturalWidth} x ${image.naturalHeight}`;
    els.serviceStatus.textContent = state.selection ? "可以生成" : "等待框选";
    advanceStage(2);
  }
  resetResult();
  updateButtons();
}

async function useExampleBackground(src) {
  const image = await urlToImage(src);
  state.backgroundImage = image;
  drawImageToCanvas(els.backgroundCanvas, image);
  els.backgroundHint.textContent = `${image.naturalWidth} x ${image.naturalHeight}`;
  els.serviceStatus.textContent = state.selection ? "可以生成" : "等待框选";
  resetResult();
  advanceStage(2);
  updateButtons();
}

async function useExampleForeground(src) {
  const image = await urlToImage(src);
  state.subjectImage = image;
  resetSubjectView();
  drawImageToCanvas(els.subjectCanvas, image);
  state.selection = null;
  state.foregroundCanvas = null;
  state.foregroundBaseCanvas = null;
  state.foregroundOriginalCanvas = null;
  els.selectionBox.hidden = true;
  els.selectionHint.textContent = "拖拽框选人像或主要物品";
  els.serviceStatus.textContent = "等待框选";
  initEmptyCanvas(els.cutoutCanvas, "等待抠图");
  goToStage(0);
  resetResult();
  updateButtons();
}

function drawImageToCanvas(canvas, image) {
  setCanvasSize(canvas, image.naturalWidth, image.naturalHeight);
  if (canvas === els.subjectCanvas) {
    els.subjectCanvasWrap.classList.add("has-subject-image");
    els.subjectCanvasWrap.style.setProperty("--subject-canvas-height", `${canvas.height}px`);
  }
  const ctx = canvasContext(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (canvas === els.subjectCanvas) applySubjectView();
}

function repaintImageInCanvas(canvas, image) {
  const ctx = canvasContext(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function drawCanvasToCanvas(target, source) {
  setCanvasSize(target, source.width, source.height);
  const ctx = canvasContext(target);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0, target.width, target.height);
  if (target === els.cutoutCanvas) applyCutoutView();
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvasContext(canvas).drawImage(source, 0, 0);
  return canvas;
}

function wireDropzone(dropzone, input, kind) {
  input.addEventListener("change", () => handleImageUpload(kind, input.files[0]));
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove("dragging"));
  }
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    handleImageUpload(kind, event.dataTransfer.files[0]);
  });
}

function updateButtons() {
  els.runButton.disabled = !(state.foregroundCanvas && state.backgroundImage);
  els.downloadButton.disabled = !state.resultBlobUrl;
  els.cutoutDownloadButton.disabled = !state.foregroundCanvas;
  els.restoreSubjectButton.disabled = !state.subjectImage || !state.foregroundCanvas;
  els.viewCutoutButton.disabled = !state.foregroundCanvas;
  els.viewBackgroundButton.disabled = !state.backgroundImage;
  updateSubjectViewResetButton();
  els.downloadMenuButton.disabled = !state.foregroundCanvas && !state.resultBlobUrl;
  els.dialogCutoutDownloadButton.disabled = !state.foregroundCanvas;
  els.dialogResultDownloadButton.disabled = !state.resultBlobUrl;
  els.prevStageButton.disabled = state.activeStage === 0;
  els.nextStageButton.disabled = state.activeStage === STAGE_COUNT - 1;
}

function setProcessing(isProcessing, kind = "") {
  state.isProcessing = isProcessing;
  document.body.classList.toggle("is-processing", isProcessing);
  document.body.classList.toggle("is-cutting", isProcessing && kind === "cutout");
  document.body.classList.toggle("is-fusing", isProcessing && kind === "fusion");
  els.subjectCanvasWrap.classList.toggle("is-cutting-scan", isProcessing && kind === "cutout");
  if (els.cutoutScanLine && (!isProcessing || kind !== "cutout")) {
    els.cutoutScanLine.classList.remove("scan-restart");
    els.cutoutScanLine.removeAttribute("aria-busy");
  }
  if (isProcessing && kind === "cutout" && els.cutoutScanLine) {
    els.cutoutScanLine.classList.remove("scan-restart");
    void els.cutoutScanLine.offsetWidth;
    els.cutoutScanLine.classList.add("scan-restart");
    els.cutoutScanLine.setAttribute("aria-busy", "true");
  }
  if (isProcessing && kind === "fusion") {
    els.runButton.textContent = "融合中...";
  } else {
    els.runButton.textContent = "图像融合";
  }
  updateAdjustUi();
}

function waitForMinimumDuration(startTime, minMs) {
  const elapsed = performance.now() - startTime;
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, minMs - elapsed)));
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function resetResult() {
  if (state.resultBlobUrl) {
    URL.revokeObjectURL(state.resultBlobUrl);
    state.resultBlobUrl = null;
  }
  state.resultEdit = null;
  if (els.resultEditBox) els.resultEditBox.hidden = true;
  els.scoreCard.hidden = true;
  els.resultHint.textContent = "模型判断位置、尺寸和阴影";
}

function goToStage(index) {
  const next = Math.max(0, Math.min(STAGE_COUNT - 1, index));
  const previous = state.activeStage;
  state.activeStage = next;
  els.stageTrack.style.transform = `translateX(${-next * 100}%)`;
  const slide = els.stageSlides[next];
  els.stageTitle.textContent = slide?.dataset.stageTitle || "";
  els.stageHint.textContent = slide?.dataset.stageHint || "";
  els.stageCounter.textContent = `${next + 1} / ${STAGE_COUNT}`;
  document.querySelectorAll(".stage-tool").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.toolStage) === next);
  });
  if (previous !== next) closeAdjustCards();
  updateRecommendations();
  updateSubjectViewResetButton();
  updateCutoutViewResetButton();
  updateAdjustUi();
  updateButtons();
}

function advanceStage(index) {
  if (index > state.activeStage) goToStage(index);
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * (canvas.width / rect.width))),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * (canvas.height / rect.height))),
    rect,
  };
}

function rectToLocalMetrics(rect, parent) {
  const parentRect = parent.getBoundingClientRect();
  const zoomX = parent.offsetWidth ? parentRect.width / parent.offsetWidth : 1;
  const zoomY = parent.offsetHeight ? parentRect.height / parent.offsetHeight : 1;
  return {
    left: (rect.left - parentRect.left) / zoomX,
    top: (rect.top - parentRect.top) / zoomY,
    width: rect.width / zoomX,
    height: rect.height / zoomY,
  };
}

function positionSelectionBox(selection, rect) {
  const wrap = els.subjectCanvas.parentElement;
  const local = rectToLocalMetrics(rect, wrap);
  const scaleX = local.width / els.subjectCanvas.width;
  const scaleY = local.height / els.subjectCanvas.height;
  els.selectionBox.hidden = false;
  els.selectionBox.style.left = `${local.left + selection.x * scaleX}px`;
  els.selectionBox.style.top = `${local.top + selection.y * scaleY}px`;
  els.selectionBox.style.width = `${selection.w * scaleX}px`;
  els.selectionBox.style.height = `${selection.h * scaleY}px`;
}

function normalizeSelection(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function applySubjectView() {
  if (!els.subjectCanvas) return;
  const { scale, x, y } = state.subjectView;
  els.subjectCanvas.style.transformOrigin = "center center";
  els.subjectCanvas.style.animation = scale === 1 && x === 0 && y === 0 ? "" : "none";
  els.subjectCanvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  if (!els.selectionBox.hidden) {
    positionSelectionBox(state.selection || { x: 0, y: 0, w: 0, h: 0 }, els.subjectCanvas.getBoundingClientRect());
  }
  updateSubjectViewResetButton();
}

function applyCutoutView() {
  if (!els.cutoutCanvas) return;
  const { scale, x, y } = state.cutoutView;
  els.cutoutCanvas.style.transformOrigin = "center center";
  els.cutoutCanvas.style.animation = scale === 1 && x === 0 && y === 0 ? "" : "none";
  els.cutoutCanvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  updateCutoutViewResetButton();
}

function subjectViewChanged() {
  const { scale, x, y } = state.subjectView;
  return Math.abs(scale - 1) > 0.001 || Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
}

function cutoutViewChanged() {
  const { scale, x, y } = state.cutoutView;
  return Math.abs(scale - 1) > 0.001 || Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
}

function updateSubjectViewResetButton() {
  if (!els.resetSubjectViewButton) return;
  const shouldShow = state.subjectImage && state.activeStage === 0 && subjectViewChanged();
  els.resetSubjectViewButton.hidden = !shouldShow;
  els.subjectCanvasWrap.classList.toggle("has-view-reset", shouldShow);
  updateRecommendationVisibilityOnly();
}

function updateCutoutViewResetButton() {
  if (!els.resetCutoutViewButton) return;
  const shouldShow = state.foregroundCanvas && state.activeStage === 1 && cutoutViewChanged();
  els.resetCutoutViewButton.hidden = !shouldShow;
  els.cutoutCanvas.parentElement.classList.toggle("has-view-reset", shouldShow);
  updateRecommendationVisibilityOnly();
}

function updateRecommendationVisibilityOnly() {
  if (!els.recommendPanel) return;
  const shouldHide =
    state.activeStage === 3 ||
    (state.activeStage === 0 && subjectViewChanged()) ||
    (state.activeStage === 1 && cutoutViewChanged());
  els.recommendPanel.hidden = shouldHide;
  els.composerApp?.classList.toggle("recommendations-collapsed", shouldHide);
}

function resetSubjectView() {
  state.subjectView = { scale: 1, x: 0, y: 0 };
  applySubjectView();
}

function resetCutoutView() {
  state.cutoutView = { scale: 1, x: 0, y: 0 };
  applyCutoutView();
}

function zoomSubjectView(delta, anchorEvent) {
  if (!state.subjectImage || state.activeStage !== 0) return;
  const oldScale = state.subjectView.scale;
  const nextScale = Math.max(0.35, Math.min(4, oldScale * (delta > 0 ? 0.9 : 1.1)));
  if (nextScale === oldScale) return;
  if (anchorEvent) {
    const rect = els.subjectCanvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = nextScale / oldScale;
    state.subjectView.x = anchorEvent.clientX - centerX - (anchorEvent.clientX - centerX - state.subjectView.x) * ratio;
    state.subjectView.y = anchorEvent.clientY - centerY - (anchorEvent.clientY - centerY - state.subjectView.y) * ratio;
  }
  state.subjectView.scale = nextScale;
  applySubjectView();
}

function zoomCutoutView(delta, anchorEvent) {
  if (!state.foregroundCanvas || state.activeStage !== 1) return;
  const oldScale = state.cutoutView.scale;
  const nextScale = Math.max(0.35, Math.min(4, oldScale * (delta > 0 ? 0.9 : 1.1)));
  if (nextScale === oldScale) return;
  if (anchorEvent) {
    const rect = els.cutoutCanvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = nextScale / oldScale;
    state.cutoutView.x = anchorEvent.clientX - centerX - (anchorEvent.clientX - centerX - state.cutoutView.x) * ratio;
    state.cutoutView.y = anchorEvent.clientY - centerY - (anchorEvent.clientY - centerY - state.cutoutView.y) * ratio;
  }
  state.cutoutView.scale = nextScale;
  applyCutoutView();
}

function panSubjectView(dx, dy) {
  if (!state.subjectImage || state.activeStage !== 0) return;
  state.subjectView.x += dx;
  state.subjectView.y += dy;
  applySubjectView();
}

function panCutoutView(dx, dy) {
  if (!state.foregroundCanvas || state.activeStage !== 1) return;
  state.cutoutView.x += dx;
  state.cutoutView.y += dy;
  applyCutoutView();
}

function wireSelection() {
  let start = null;
  let panStart = null;
  let cutoutPanStart = null;

  els.subjectCanvas.addEventListener("pointerdown", (event) => {
    if (!state.subjectImage || state.isProcessing) return;
    if (event.button === 1) {
      event.preventDefault();
      panStart = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        view: { ...state.subjectView },
      };
      els.subjectCanvas.setPointerCapture(event.pointerId);
      return;
    }
    setProcessing(false);
    repaintImageInCanvas(els.subjectCanvas, state.subjectImage);
    els.selectionBox.hidden = true;
    els.subjectCanvasWrap.classList.add("is-selecting");
    start = canvasPoint(event, els.subjectCanvas);
    els.subjectCanvas.setPointerCapture(event.pointerId);
  });

  els.subjectCanvas.addEventListener("pointermove", (event) => {
    if (panStart) {
      event.preventDefault();
      state.subjectView.x = panStart.view.x + event.clientX - panStart.x;
      state.subjectView.y = panStart.view.y + event.clientY - panStart.y;
      applySubjectView();
      return;
    }
    if (!start) return;
    const end = canvasPoint(event, els.subjectCanvas);
    positionSelectionBox(normalizeSelection(start, end), els.subjectCanvas.getBoundingClientRect());
  });

  els.subjectCanvas.addEventListener("pointerup", async (event) => {
    if (panStart) {
      panStart = null;
      return;
    }
    if (!start) return;
    const end = canvasPoint(event, els.subjectCanvas);
    const selection = normalizeSelection(start, end);
    start = null;
    els.subjectCanvasWrap.classList.remove("is-selecting");
    if (selection.w < 12 || selection.h < 12) {
      els.selectionBox.hidden = true;
      return;
    }
    state.selection = selection;
    state.foregroundCanvas = null;
    initEmptyCanvas(els.cutoutCanvas, "正在抠图");
    els.selectionBox.hidden = true;
    els.selectionHint.textContent = "正在抠图...";
    els.serviceStatus.textContent = "分割主体";
    updateButtons();
    try {
      const scanStartedAt = performance.now();
      setProcessing(true, "cutout");
      await waitForNextPaint();
      state.foregroundCanvas = await createForegroundCutout(selection);
      state.foregroundBaseCanvas = cloneCanvas(state.foregroundCanvas);
      state.foregroundOriginalCanvas = cloneCanvas(state.foregroundCanvas);
      state.cutoutUndoStack = [];
      resetCutoutView();
      resetCutoutAdjustments();
      await waitForMinimumDuration(scanStartedAt, CUTOUT_SCAN_MIN_MS);
      drawCutoutPreview(state.foregroundCanvas);
      advanceStage(1);
      els.selectionHint.textContent = `已选择 ${Math.round(selection.w)} x ${Math.round(selection.h)}`;
      els.serviceStatus.textContent = state.backgroundImage ? "可以生成" : "等待背景";
      resetResult();
    } catch (error) {
      state.selection = null;
      state.foregroundCanvas = null;
      state.foregroundBaseCanvas = null;
      state.foregroundOriginalCanvas = null;
      initEmptyCanvas(els.cutoutCanvas, "等待抠图");
      els.selectionHint.textContent = `抠图失败：${error.message}`;
      els.serviceStatus.textContent = "等待重新框选";
    } finally {
      setProcessing(false);
      updateButtons();
    }
  });
  els.subjectCanvas.addEventListener("pointercancel", () => {
    start = null;
    panStart = null;
    els.subjectCanvasWrap.classList.remove("is-selecting");
  });

  els.subjectCanvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  els.subjectCanvasWrap.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey || state.activeStage !== 0 || !state.subjectImage) return;
      event.preventDefault();
      event.stopPropagation();
      zoomSubjectView(event.deltaY, event);
    },
    { passive: false },
  );

  els.cutoutCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 1 || !state.foregroundCanvas || state.activeStage !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    cutoutPanStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view: { ...state.cutoutView },
    };
    els.cutoutCanvas.setPointerCapture(event.pointerId);
  });

  els.cutoutCanvas.addEventListener("pointermove", (event) => {
    if (!cutoutPanStart) return;
    event.preventDefault();
    event.stopPropagation();
    state.cutoutView.x = cutoutPanStart.view.x + event.clientX - cutoutPanStart.x;
    state.cutoutView.y = cutoutPanStart.view.y + event.clientY - cutoutPanStart.y;
    applyCutoutView();
  });

  els.cutoutCanvas.addEventListener("pointerup", (event) => {
    if (cutoutPanStart) {
      event.preventDefault();
      event.stopPropagation();
    }
    cutoutPanStart = null;
  });
  els.cutoutCanvas.addEventListener("pointercancel", (event) => {
    if (cutoutPanStart) {
      event.preventDefault();
      event.stopPropagation();
    }
    cutoutPanStart = null;
  });

  els.cutoutCanvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  els.cutoutCanvas.parentElement.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey || state.activeStage !== 1 || !state.foregroundCanvas) return;
      event.preventDefault();
      event.stopPropagation();
      zoomCutoutView(event.deltaY, event);
    },
    { passive: false },
  );
}

function wireResultEditor() {
  if (!els.resultEditBox) return;
  let action = null;

  const pointOnResultCanvas = (event) => {
    const rect = els.resultCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (els.resultCanvas.width / rect.width),
      y: (event.clientY - rect.top) * (els.resultCanvas.height / rect.height),
    };
  };

  const hitResultForeground = (point) => {
    if (!state.resultEdit) return false;
    const { x, y, w, h } = state.resultEdit;
    return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
  };

  const canvasDelta = (event) => {
    const rect = els.resultCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - action.startClientX) * (els.resultCanvas.width / rect.width),
      y: (event.clientY - action.startClientY) * (els.resultCanvas.height / rect.height),
    };
  };

  els.resultEditBox.addEventListener("pointerdown", (event) => {
    if (!state.resultEdit || state.isProcessing) return;
    event.preventDefault();
    event.stopPropagation();
    state.resultEdit.active = true;
    els.resultEditBox.setPointerCapture(event.pointerId);
    action = {
      pointerId: event.pointerId,
      mode: event.target.dataset.handle ? "resize" : "move",
      handle: event.target.dataset.handle || "",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startEdit: { ...state.resultEdit },
      source: els.resultEditBox,
    };
  });

  els.resultCanvas.addEventListener("pointerdown", (event) => {
    if (!state.resultEdit || state.isProcessing || state.activeStage !== 3) return;
    event.stopPropagation();
    const point = pointOnResultCanvas(event);
    if (!hitResultForeground(point)) {
      state.resultEdit.active = false;
      updateResultEditBox();
      return;
    }

    event.preventDefault();
    state.resultEdit.active = true;
    updateResultEditBox();
    els.resultCanvas.setPointerCapture(event.pointerId);
    action = {
      pointerId: event.pointerId,
      mode: "move",
      handle: "",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startEdit: { ...state.resultEdit },
      source: els.resultCanvas,
    };
  });

  els.resultCanvas.addEventListener("pointermove", (event) => {
    if (!action || action.source !== els.resultCanvas) return;
    event.stopPropagation();
    moveResultEdit(event);
  });

  els.resultCanvas.addEventListener("pointerup", async (event) => {
    if (!action || action.source !== els.resultCanvas) return;
    event.stopPropagation();
    await finishResultEdit(event);
  });

  els.resultEditBox.addEventListener("pointermove", (event) => {
    if (!action || !state.resultEdit) return;
    event.stopPropagation();
    moveResultEdit(event);
  });

  els.resultEditBox.addEventListener("pointerup", async (event) => {
    event.stopPropagation();
    await finishResultEdit(event);
  });

  els.resultEditBox.addEventListener("pointercancel", () => {
    action = null;
    updateResultEditBox();
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!state.resultEdit?.active || state.activeStage !== 3) return;
      if (els.resultEditBox.contains(event.target) || event.target === els.resultCanvas) return;
      state.resultEdit.active = false;
      updateResultEditBox();
    },
    true,
  );

  function moveResultEdit(event) {
    if (!action || !state.resultEdit) return;
    event.preventDefault();
    const delta = canvasDelta(event);
    const next = { ...action.startEdit, active: true };

    if (action.mode === "move") {
      next.x += delta.x;
      next.y += delta.y;
    } else {
      const aspect = action.startEdit.w / action.startEdit.h;
      const signX = action.handle.includes("w") ? -1 : 1;
      const signY = action.handle.includes("n") ? -1 : 1;
      const sizeDelta =
        Math.abs(delta.x) > Math.abs(delta.y) ? delta.x * signX : delta.y * signY * aspect;
      next.w = Math.max(24, action.startEdit.w + sizeDelta);
      next.h = next.w / aspect;
      if (action.handle.includes("w")) next.x = action.startEdit.x + action.startEdit.w - next.w;
      if (action.handle.includes("n")) next.y = action.startEdit.y + action.startEdit.h - next.h;
    }

    state.resultEdit = next;
    clampResultEdit();
    drawEditableResult();
  }

  async function finishResultEdit(event) {
    if (!action) return;
    event.preventDefault();
    action = null;
    drawEditableResult();
    await updateResultBlob();
  }
}

function wireAdjustWidget() {
  if (!els.adjustWidget || !els.adjustFloatButton) return;
  let drag = null;
  let moved = false;
  let erasing = false;

  els.adjustFloatButton.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      left: els.adjustWidget.offsetLeft,
      top: els.adjustWidget.offsetTop,
    };
    moved = false;
    els.adjustFloatButton.setPointerCapture(event.pointerId);
  });

  els.adjustFloatButton.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    const parent = els.adjustWidget.offsetParent || document.body;
    const maxLeft = parent.clientWidth - els.adjustWidget.offsetWidth - 12;
    const maxTop = parent.clientHeight - els.adjustWidget.offsetHeight - 12;
    els.adjustWidget.style.left = `${Math.max(12, Math.min(maxLeft, drag.left + dx))}px`;
    els.adjustWidget.style.top = `${Math.max(76, Math.min(maxTop, drag.top + dy))}px`;
    els.adjustWidget.style.right = "auto";
  });

  els.adjustFloatButton.addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null;
    if (!moved) toggleAdjustCard();
  });

  for (const slider of [els.cutoutOpacitySlider, els.cutoutToneSlider, els.cutoutSharpenSlider]) {
    slider?.addEventListener("pointerdown", pushCutoutUndo);
    slider?.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        pushCutoutUndo();
      }
    });
  }
  els.cutoutOpacitySlider?.addEventListener("input", () => {
    state.cutoutAdjust.opacity = Number(els.cutoutOpacitySlider.value) / 100;
    applyCutoutAdjustments();
  });
  els.cutoutToneSlider?.addEventListener("input", () => {
    state.cutoutAdjust.tone = Number(els.cutoutToneSlider.value);
    applyCutoutAdjustments();
  });
  els.cutoutSharpenSlider?.addEventListener("input", () => {
    state.cutoutAdjust.sharpen = Number(els.cutoutSharpenSlider.value);
    applyCutoutAdjustments();
  });
  els.eraserSizeSlider?.addEventListener("input", () => {
    state.cutoutAdjust.eraserSize = Number(els.eraserSizeSlider.value);
  });
  els.eraserToggleButton?.addEventListener("click", () => {
    state.cutoutAdjust.eraser = !state.cutoutAdjust.eraser;
    updateAdjustUi();
    if (state.cutoutAdjust.eraser) goToStage(1);
  });
  els.cutoutResetButton?.addEventListener("click", () => {
    if (!state.foregroundOriginalCanvas && state.foregroundCanvas) {
      state.foregroundOriginalCanvas = cloneCanvas(state.foregroundCanvas);
    }
    if (!state.foregroundOriginalCanvas) return;
    pushCutoutUndo();
    state.foregroundBaseCanvas = cloneCanvas(state.foregroundOriginalCanvas);
    resetCutoutAdjustments();
    applyCutoutAdjustments();
  });
  els.cutoutUndoButton?.addEventListener("click", undoCutoutStep);
  for (const button of els.placementSchemeButtons) {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.placementAdjust.scheme = Number(button.dataset.placementScheme) || 1;
      updateAdjustUi();
    });
  }
  els.placementPrecisionSlider?.addEventListener("input", () => {
    state.placementAdjust.precision = Number(els.placementPrecisionSlider.value);
    updateAdjustUi();
  });
  els.placementSizeSlider?.addEventListener("input", () => {
    state.placementAdjust.size = Number(els.placementSizeSlider.value);
    updateAdjustUi();
  });
  els.placementSearchButton?.addEventListener("click", () => {
    if (!state.foregroundCanvas || !state.backgroundImage || state.isProcessing) return;
    els.runButton.click();
  });

  els.cutoutCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.cutoutAdjust.eraser || !state.foregroundBaseCanvas) return;
    event.preventDefault();
    pushCutoutUndo();
    erasing = true;
    els.cutoutCanvas.setPointerCapture(event.pointerId);
    eraseCutoutAt(event);
  });
  els.cutoutCanvas.addEventListener("pointermove", (event) => {
    if (!erasing) return;
    event.preventDefault();
    eraseCutoutAt(event);
  });
  els.cutoutCanvas.addEventListener("pointerup", () => {
    erasing = false;
  });
  els.cutoutCanvas.addEventListener("pointercancel", () => {
    erasing = false;
  });

  updateAdjustUi();
}

function toggleAdjustCard() {
  const card = getActiveAdjustCard();
  if (!card) return;
  const show = card.hidden;
  closeAdjustCards();
  card.hidden = !show;
  els.adjustFloatButton.setAttribute("aria-expanded", String(show));
  els.adjustWidget.classList.toggle("open", show);
}

function getActiveAdjustCard() {
  if (state.activeStage === 1) return els.cutoutAdjustCard;
  if (state.activeStage === 3) return els.placementAdjustCard;
  return null;
}

function closeAdjustCards() {
  if (els.cutoutAdjustCard) els.cutoutAdjustCard.hidden = true;
  if (els.placementAdjustCard) els.placementAdjustCard.hidden = true;
  els.adjustFloatButton?.setAttribute("aria-expanded", "false");
  els.adjustWidget?.classList.remove("open");
}

function updateAdjustUi() {
  const isResultStage = state.activeStage === 3;
  const hasAdjustCard = state.activeStage === 1 || isResultStage;
  if (els.adjustWidget) els.adjustWidget.hidden = !hasAdjustCard;
  if (els.eraserToggleButton) {
    els.eraserToggleButton.classList.toggle("active", state.cutoutAdjust.eraser);
  }
  if (els.adjustWidget) {
    els.adjustWidget.classList.toggle("eraser-active", state.cutoutAdjust.eraser);
  }
  document.body.classList.toggle("eraser-active", state.cutoutAdjust.eraser);
  if (els.cutoutUndoButton) {
    els.cutoutUndoButton.disabled = state.cutoutUndoStack.length === 0;
  }
  for (const button of els.placementSchemeButtons) {
    button.classList.toggle(
      "active",
      Number(button.dataset.placementScheme) === state.placementAdjust.scheme,
    );
  }
  if (els.placementPrecisionSlider) {
    els.placementPrecisionSlider.value = String(state.placementAdjust.precision);
  }
  if (els.placementPrecisionValue) {
    els.placementPrecisionValue.value = String(state.placementAdjust.precision);
    els.placementPrecisionValue.textContent = String(state.placementAdjust.precision);
  }
  if (els.placementSizeSlider) {
    els.placementSizeSlider.value = String(state.placementAdjust.size);
  }
  if (els.placementSizeValue) {
    els.placementSizeValue.value = String(state.placementAdjust.size);
    els.placementSizeValue.textContent = String(state.placementAdjust.size);
  }
  if (els.placementSearchButton) {
    els.placementSearchButton.disabled =
      state.isProcessing || !state.foregroundCanvas || !state.backgroundImage;
  }
}

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function sampleBorderColor(imageData, width, height) {
  const data = imageData.data;
  const samples = [];
  const read = (x, y) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 24))) {
    read(x, 0);
    read(x, height - 1);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 24))) {
    read(0, y);
    read(width - 1, y);
  }
  return samples
    .reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
    .map((value) => value / samples.length);
}

function makeForegroundCanvas(selection) {
  const source = els.subjectCanvas;
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round(selection.w));
  crop.height = Math.max(1, Math.round(selection.h));
  const ctx = canvasContext(crop);
  ctx.drawImage(
    source,
    selection.x,
    selection.y,
    selection.w,
    selection.h,
    0,
    0,
    crop.width,
    crop.height,
  );

  const imageData = ctx.getImageData(0, 0, crop.width, crop.height);
  const data = imageData.data;
  const bg = sampleBorderColor(imageData, crop.width, crop.height);
  const feather = Math.max(10, Math.min(crop.width, crop.height) * 0.08);

  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const i = (y * crop.width + x) * 4;
      const dist = colorDistance([data[i], data[i + 1], data[i + 2]], bg);
      const edge = Math.min(x, y, crop.width - 1 - x, crop.height - 1 - y);
      const edgeAlpha = Math.min(1, edge / feather);
      const bgAlpha = Math.min(1, Math.max(0, (dist - 28) / 58));
      const alphaRatio = Math.min(edgeAlpha, bgAlpha);
      data[i + 3] = Math.round(255 * Math.pow(alphaRatio, 0.72));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return crop;
}

function cropSelectionCanvas(selection) {
  const source = els.subjectCanvas;
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round(selection.w));
  crop.height = Math.max(1, Math.round(selection.h));
  const ctx = canvasContext(crop);
  ctx.drawImage(
    source,
    selection.x,
    selection.y,
    selection.w,
    selection.h,
    0,
    0,
    crop.width,
    crop.height,
  );
  return crop;
}

async function loadCutoutModule() {
  if (!MODEL_CONFIG.useBrowserCutoutModel) return null;
  if (!state.cutoutModule) {
    state.cutoutModule = await import(MODEL_CONFIG.cutoutLibraryUrl);
  }
  return state.cutoutModule;
}

async function createForegroundCutout(selection) {
  const crop = cropSelectionCanvas(selection);
  try {
    const mod = await loadCutoutModule();
    const removeBackground = mod?.removeBackground || mod?.default;
    if (!removeBackground) throw new Error("背景移除库未提供 removeBackground");
    const blob = await new Promise((resolve) => crop.toBlob(resolve, "image/png", 0.96));
    const resultBlob = await removeBackground(blob, {
      model: "medium",
      output: {
        format: "image/png",
        quality: 1,
      },
    });
    return repairCutoutIfNeeded(await blobToCanvas(resultBlob));
  } catch (error) {
    els.selectionHint.textContent = `模型不可用，已使用本地抠图：${error.message}`;
    return repairCutoutIfNeeded(makeForegroundCanvas(selection));
  }
}

async function blobToCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvasContext(canvas);
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function drawCutoutPreview(cutout) {
  drawCanvasToCanvas(els.cutoutCanvas, cutout);
}

function resetCutoutAdjustments() {
  state.cutoutAdjust = { opacity: 1, tone: 0, sharpen: 0, eraser: false, eraserSize: 28 };
  if (els.cutoutOpacitySlider) els.cutoutOpacitySlider.value = "100";
  if (els.cutoutToneSlider) els.cutoutToneSlider.value = "0";
  if (els.cutoutSharpenSlider) els.cutoutSharpenSlider.value = "0";
  if (els.eraserSizeSlider) els.eraserSizeSlider.value = "28";
  updateAdjustUi();
}

function pushCutoutUndo() {
  if (!state.foregroundBaseCanvas) return;
  state.cutoutUndoStack.push({
    canvas: cloneCanvas(state.foregroundBaseCanvas),
    adjust: { ...state.cutoutAdjust },
  });
  if (state.cutoutUndoStack.length > 16) state.cutoutUndoStack.shift();
  updateAdjustUi();
}

function undoCutoutStep() {
  const previous = state.cutoutUndoStack.pop();
  if (!previous) return;
  state.foregroundBaseCanvas = previous.canvas;
  state.cutoutAdjust = previous.adjust;
  if (els.cutoutOpacitySlider) els.cutoutOpacitySlider.value = String(Math.round(state.cutoutAdjust.opacity * 100));
  if (els.cutoutToneSlider) els.cutoutToneSlider.value = String(state.cutoutAdjust.tone);
  if (els.cutoutSharpenSlider) els.cutoutSharpenSlider.value = String(state.cutoutAdjust.sharpen);
  if (els.eraserSizeSlider) els.eraserSizeSlider.value = String(state.cutoutAdjust.eraserSize);
  applyCutoutAdjustments();
  updateAdjustUi();
}

async function applyCutoutAdjustments({ resetResultImage = true } = {}) {
  if (!state.foregroundBaseCanvas) return;
  const canvas = cloneCanvas(state.foregroundBaseCanvas);
  const ctx = canvasContext(canvas);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const opacity = state.cutoutAdjust.opacity;
  const tone = state.cutoutAdjust.tone;
  const sharpen = state.cutoutAdjust.sharpen;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha <= 0) continue;
    data[i + 3] = Math.max(0, Math.min(255, Math.round(alpha * opacity)));
    if (tone !== 0) {
      const amount = Math.abs(tone) / 100;
      if (tone > 0) {
        data[i] = Math.min(255, Math.round(data[i] + 24 * amount));
        data[i + 1] = Math.min(255, Math.round(data[i + 1] + 8 * amount));
        data[i + 2] = Math.max(0, Math.round(data[i + 2] - 16 * amount));
      } else {
        data[i] = Math.max(0, Math.round(data[i] - 12 * amount));
        data[i + 1] = Math.min(255, Math.round(data[i + 1] + 6 * amount));
        data[i + 2] = Math.min(255, Math.round(data[i + 2] + 26 * amount));
      }
    }
  }

  if (sharpen !== 0) {
    processCutoutEdges(imageData, canvas.width, canvas.height, sharpen);
  }

  ctx.putImageData(imageData, 0, 0);
  state.foregroundCanvas = canvas;
  drawCutoutPreview(canvas);
  if (resetResultImage) resetResult();
  updateButtons();
}

function processCutoutEdges(imageData, width, height, amount) {
  const { data } = imageData;
  const copy = new Uint8ClampedArray(data);
  const strength = Math.abs(amount) / 100;
  const sharpen = amount > 0;
  const alphaAt = (x, y) => copy[(y * width + x) * 4 + 3];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4;
      const alpha = copy[index + 3];
      if (alpha <= 0) continue;
      const neighborAverage =
        (alphaAt(x - 1, y) + alphaAt(x + 1, y) + alphaAt(x, y - 1) + alphaAt(x, y + 1)) / 4;
      const edge = Math.abs(alpha - neighborAverage);
      if (edge > 8) {
        if (sharpen) {
          data[index + 3] = Math.max(0, Math.min(255, Math.round(alpha + (alpha - neighborAverage) * strength)));
          data[index] = Math.max(0, Math.min(255, Math.round(copy[index] * (1 + 0.08 * strength))));
          data[index + 1] = Math.max(0, Math.min(255, Math.round(copy[index + 1] * (1 + 0.08 * strength))));
          data[index + 2] = Math.max(0, Math.min(255, Math.round(copy[index + 2] * (1 + 0.08 * strength))));
        } else {
          data[index + 3] = Math.max(0, Math.min(255, Math.round(alpha + (neighborAverage - alpha) * strength * 0.9)));
          if (alpha < 220 && neighborAverage < alpha) {
            data[index + 3] = Math.round(data[index + 3] * (1 - 0.28 * strength));
          }
        }
      }
    }
  }
}

function eraseCutoutAt(event) {
  if (!state.foregroundBaseCanvas || !state.cutoutAdjust.eraser || state.activeStage !== 1) return;
  const rect = els.cutoutCanvas.getBoundingClientRect();
  const previewX = (event.clientX - rect.left) * (els.cutoutCanvas.width / rect.width);
  const previewY = (event.clientY - rect.top) * (els.cutoutCanvas.height / rect.height);
  const x = previewX * (state.foregroundBaseCanvas.width / els.cutoutCanvas.width);
  const y = previewY * (state.foregroundBaseCanvas.height / els.cutoutCanvas.height);
  const radius = state.cutoutAdjust.eraserSize;
  const baseCtx = canvasContext(state.foregroundBaseCanvas);
  baseCtx.save();
  baseCtx.globalCompositeOperation = "destination-out";
  baseCtx.beginPath();
  baseCtx.arc(x, y, radius, 0, Math.PI * 2);
  baseCtx.fill();
  baseCtx.restore();
  applyCutoutAdjustments({ resetResultImage: true });
}

function viewOriginalSubject() {
  if (state.subjectImage) {
    drawImageToCanvas(els.subjectCanvas, state.subjectImage);
    els.selectionBox.hidden = true;
  }
  goToStage(0);
}

function repairCutoutIfNeeded(canvas) {
  if (!MODEL_CONFIG.repairSmallCutoutHoles && !MODEL_CONFIG.strengthenWeakCutoutAlpha) {
    return canvas;
  }
  const ctx = canvasContext(canvas);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const repaired = MODEL_CONFIG.repairSmallCutoutHoles
    ? repairSmallAlphaHoles(imageData, canvas.width, canvas.height)
    : 0;
  const strengthened = MODEL_CONFIG.strengthenWeakCutoutAlpha
    ? strengthenWeakCutoutAlpha(imageData)
    : 0;
  if (repaired > 0 || strengthened > 0) {
    ctx.putImageData(imageData, 0, 0);
    const messages = [];
    if (repaired > 0) messages.push(`修补 ${repaired} 处小缺口`);
    if (strengthened > 0) messages.push("增强主体不透明度");
    els.selectionHint.textContent = `已自动${messages.join("，")}`;
  }
  return canvas;
}

function strengthenWeakCutoutAlpha(imageData) {
  const { data } = imageData;
  let visible = 0;
  let weak = 0;

  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha <= 8) continue;
    visible++;
    if (alpha < 230) weak++;
  }

  if (!visible || weak / visible < MODEL_CONFIG.weakAlphaRatioToStrengthen) return 0;

  let strengthened = 0;
  const strength = MODEL_CONFIG.cutoutAlphaStrength;
  const minVisibleAlpha = MODEL_CONFIG.minVisibleAlphaAfterStrengthen;
  const solidThreshold = MODEL_CONFIG.solidAlphaThreshold;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha <= 8 || alpha >= 255) continue;
    const normalized = alpha / 255;
    let boosted = Math.round(255 * Math.pow(normalized, 1 - strength));
    if (alpha > 28) boosted = Math.max(boosted, minVisibleAlpha);
    if (alpha >= solidThreshold) boosted = Math.max(boosted, 242);
    if (alpha >= 220) boosted = 255;
    if (boosted > alpha) {
      data[i] = boosted;
      strengthened++;
    }
  }

  return strengthened;
}

function repairSmallAlphaHoles(imageData, width, height) {
  const { data } = imageData;
  const total = width * height;
  const visited = new Uint8Array(total);
  const solidAlpha = MODEL_CONFIG.minSolidAlpha;
  const maxArea = Math.max(24, Math.floor(total * MODEL_CONFIG.maxRepairHoleRatio));
  let repairedCount = 0;

  const alphaAt = (index) => data[index * 4 + 3];
  const isTransparent = (index) => alphaAt(index) < solidAlpha;
  const neighbors = (index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const list = [];
    if (x > 0) list.push(index - 1);
    if (x < width - 1) list.push(index + 1);
    if (y > 0) list.push(index - width);
    if (y < height - 1) list.push(index + width);
    return list;
  };

  for (let index = 0; index < total; index++) {
    if (visited[index] || !isTransparent(index)) continue;

    const queue = [index];
    const component = [];
    let touchesEdge = false;
    visited[index] = 1;

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const x = current % width;
      const y = Math.floor(current / width);
      component.push(current);
      touchesEdge ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;

      for (const next of neighbors(current)) {
        if (!visited[next] && isTransparent(next)) {
          visited[next] = 1;
          queue.push(next);
        }
      }

      if (component.length > maxArea) break;
    }

    if (component.length <= maxArea && !touchesEdge) {
      fillHoleFromBoundary(data, component, width, height, solidAlpha);
      repairedCount++;
    }
  }

  return repairedCount;
}

function fillHoleFromBoundary(data, component, width, height, solidAlpha) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let samples = 0;
  const inComponent = new Uint8Array(width * height);
  for (const index of component) inComponent[index] = 1;

  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    const candidates = [];
    if (x > 0) candidates.push(index - 1);
    if (x < width - 1) candidates.push(index + 1);
    if (y > 0) candidates.push(index - width);
    if (y < height - 1) candidates.push(index + width);

    for (const candidate of candidates) {
      if (inComponent[candidate]) continue;
      const offset = candidate * 4;
      if (data[offset + 3] >= solidAlpha) {
        r += data[offset];
        g += data[offset + 1];
        b += data[offset + 2];
        a += data[offset + 3];
        samples++;
      }
    }
  }

  if (!samples) return;
  const color = [r / samples, g / samples, b / samples, Math.max(180, a / samples)];
  for (const index of component) {
    const offset = index * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }
}

function inferTargetWidth(bgWidth, bgHeight, fgWidth, fgHeight) {
  const fgAspect = fgWidth / fgHeight;
  const sceneBase = Math.min(bgWidth, bgHeight);
  const portraitBias = fgAspect < 0.78 ? 0.22 : 0.3;
  return Math.max(sceneBase * 0.16, Math.min(bgWidth * 0.42, sceneBase * portraitBias));
}

function getPlacementCandidates(bgWidth, bgHeight, fgWidth, fgHeight) {
  const floorY = bgHeight - fgHeight * 1.05;
  return [
    { x: bgWidth * 0.5 - fgWidth * 0.5, y: floorY, reason: "center-floor" },
    { x: bgWidth * 0.18, y: bgHeight * 0.58, reason: "left-depth" },
    { x: bgWidth * 0.68, y: bgHeight * 0.56, reason: "right-depth" },
    { x: bgWidth * 0.5 - fgWidth * 0.5, y: bgHeight * 0.48, reason: "semantic-center" },
  ];
}

function scorePlacement(candidate, bgWidth, bgHeight, fgWidth, fgHeight) {
  const centerX = candidate.x + fgWidth / 2;
  const baseY = candidate.y + fgHeight;
  const horizontal = 1 - Math.abs(centerX / bgWidth - 0.5) * 0.72;
  const support = 1 - Math.abs(baseY / bgHeight - 0.88) * 1.2;
  const scale = 1 - Math.abs(Math.max(fgWidth / bgWidth, fgHeight / bgHeight) - 0.24) * 1.4;
  return Math.max(0.05, Math.min(0.98, horizontal * 0.34 + support * 0.42 + scale * 0.24));
}

function inferShadowStrength(candidate, bgWidth, bgHeight, fgWidth, fgHeight) {
  const baseY = (candidate.y + fgHeight) / bgHeight;
  const scale = Math.max(fgWidth / bgWidth, fgHeight / bgHeight);
  return Math.max(0.18, Math.min(0.58, baseY * 0.42 + scale * 0.3));
}

async function callModelPipeline(payload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MODEL_CONFIG.requestTimeoutMs);
  const response = await fetch(MODEL_CONFIG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  window.clearTimeout(timeout);
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
  return response.json();
}

async function composeWithOpaPlacement() {
  if (!window.OPAPlacement?.search) {
    throw new Error("OPA 放置搜索模块未加载");
  }

  const result = els.resultCanvas;
  drawImageToCanvas(result, state.backgroundImage);
  const foreground = state.foregroundCanvas || makeForegroundCanvas(state.selection);
  const baseForegroundWidth = inferTargetWidth(
    result.width,
    result.height,
    foreground.width,
    foreground.height,
  );

  if (els.placementStatus) {
    els.placementStatus.textContent = "正在生成候选位置...";
  }
  const best = await window.OPAPlacement.search({
    background: result,
    foreground,
    outputWidth: result.width,
    outputHeight: result.height,
    baseForegroundWidth,
    precisionLevel: state.placementAdjust.precision,
    sizeLevel: state.placementAdjust.size,
    endpoint: MODEL_CONFIG.opaPlacementEndpoint,
    timeoutMs: MODEL_CONFIG.opaPlacementTimeoutMs,
    onProgress(progress) {
      if (!els.placementStatus) return;
      if (progress.phase === "health") {
        els.placementStatus.textContent = "正在检查 OPA 模型服务...";
      } else if (progress.phase === "render") {
        els.placementStatus.textContent =
          `生成候选 ${progress.completed} / ${progress.total}`;
      } else if (progress.phase === "predict") {
        els.placementStatus.textContent =
          `OPA 正在评分 ${progress.total} 个候选位置`;
      } else if (progress.phase === "done") {
        els.placementStatus.textContent = "已找到最佳位置";
      }
    },
  });

  state.resultEdit = {
    fg: foreground,
    x: best.x,
    y: best.y,
    w: best.w,
    h: best.h,
    shadowStrength: inferShadowStrength(
      best,
      result.width,
      result.height,
      best.w,
      best.h,
    ),
    active: false,
  };
  await renderEditableResult();

  els.resultHint.textContent =
    `OPA 已搜索 ${best.searchedSizeCount} 种大小、${best.candidateCount} 个位置组合`;
  els.scoreValue.textContent = best.score.toFixed(2);
  els.scoreCard.hidden = false;
}

async function composeMock() {
  const result = els.resultCanvas;
  drawImageToCanvas(result, state.backgroundImage);

  const fg = state.foregroundCanvas || makeForegroundCanvas(state.selection);
  const targetWidth = inferTargetWidth(result.width, result.height, fg.width, fg.height);
  const ratio = targetWidth / fg.width;
  const fgWidth = Math.max(16, fg.width * ratio);
  const fgHeight = Math.max(16, fg.height * ratio);

  const candidates = getPlacementCandidates(result.width, result.height, fgWidth, fgHeight)
    .map((candidate) => ({
      ...candidate,
      score: scorePlacement(candidate, result.width, result.height, fgWidth, fgHeight),
    }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const shadowStrength = inferShadowStrength(best, result.width, result.height, fgWidth, fgHeight);

  state.resultEdit = {
    fg,
    x: best.x,
    y: best.y,
    w: fgWidth,
    h: fgHeight,
    shadowStrength,
    active: false,
  };
  await renderEditableResult();

  els.resultHint.textContent = `候选位置：${best.reason}`;
  els.scoreValue.textContent = best.score.toFixed(2);
  els.scoreCard.hidden = false;
}

function drawEditableResult() {
  if (!state.resultEdit || !state.backgroundImage) return;
  const result = els.resultCanvas;
  drawImageToCanvas(result, state.backgroundImage);
  const ctx = canvasContext(result);
  const { fg, x, y, w, h, shadowStrength } = state.resultEdit;

  ctx.save();
  ctx.globalAlpha = shadowStrength;
  ctx.filter = "blur(12px)";
  ctx.fillStyle = "#151b18";
  ctx.beginPath();
  ctx.ellipse(
    x + w / 2,
    y + h * 0.96,
    w * 0.34,
    h * 0.075,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = `rgba(16, 24, 20, ${0.12 + shadowStrength * 0.24})`;
  ctx.shadowBlur = 8;
  ctx.drawImage(fg, x, y, w, h);
  ctx.restore();

  updateResultEditBox();
}

async function renderEditableResult({ updateBlob = true } = {}) {
  drawEditableResult();
  if (updateBlob) await updateResultBlob();
}

function updateResultEditBox() {
  if (!state.resultEdit || !els.resultEditBox) return;
  if (!state.resultEdit.active) {
    els.resultEditBox.hidden = true;
    return;
  }
  const canvasRect = els.resultCanvas.getBoundingClientRect();
  const local = rectToLocalMetrics(canvasRect, els.resultCanvas.parentElement);
  const scaleX = local.width / els.resultCanvas.width;
  const scaleY = local.height / els.resultCanvas.height;
  const { x, y, w, h } = state.resultEdit;
  els.resultEditBox.hidden = false;
  els.resultEditBox.style.left = `${local.left + x * scaleX}px`;
  els.resultEditBox.style.top = `${local.top + y * scaleY}px`;
  els.resultEditBox.style.width = `${w * scaleX}px`;
  els.resultEditBox.style.height = `${h * scaleY}px`;
}

function clampResultEdit() {
  if (!state.resultEdit) return;
  const edit = state.resultEdit;
  const minSize = 24;
  edit.w = Math.max(minSize, Math.min(edit.w, els.resultCanvas.width * 1.35));
  edit.h = Math.max(minSize, Math.min(edit.h, els.resultCanvas.height * 1.35));
  edit.x = Math.max(-edit.w * 0.72, Math.min(edit.x, els.resultCanvas.width - edit.w * 0.28));
  edit.y = Math.max(-edit.h * 0.72, Math.min(edit.y, els.resultCanvas.height - edit.h * 0.18));
}

async function composeWithApi() {
  const payload = {
    endpointVersion: 1,
    selection: state.selection,
    stages: ["segment", "placement_assessment", "harmonize"],
  };
  await callModelPipeline(payload);
  await composeMock();
  els.resultHint.textContent = "模型接口已调用，当前使用本地画布回显";
}

async function updateResultBlob() {
  if (state.resultBlobUrl) URL.revokeObjectURL(state.resultBlobUrl);
  state.resultBlobUrl = null;
  const blob = await new Promise((resolve) => els.resultCanvas.toBlob(resolve, "image/png", 0.96));
  if (!blob) {
    throw new Error("合成图导出失败，请重新选择背景后再融合");
  }
  state.resultBlobUrl = URL.createObjectURL(blob);
  updateButtons();
}

function wireControls() {
  els.startButton.addEventListener("click", enterComposer);
  els.homeTab.addEventListener("click", returnHome);
  els.composeTab.addEventListener("click", enterComposer);
  els.tutorialTab.addEventListener("click", () => {
    enterComposer();
    setActiveTab("tutorial");
    els.stageHint.textContent = "教程预留：可在这里引导上传前景、框选主体、选择背景并生成成品";
  });

  els.subjectCanvasWrap.addEventListener("dblclick", (event) => {
    event.preventDefault();
    els.subjectInput.click();
  });
  els.subjectCanvasWrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.subjectInput.click();
    }
  });
  els.backgroundCanvasWrap.addEventListener("dblclick", (event) => {
    event.preventDefault();
    els.backgroundInput.click();
  });
  els.backgroundCanvasWrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.backgroundInput.click();
    }
  });

  els.runButton.addEventListener("click", async () => {
    if (!state.foregroundCanvas || !state.backgroundImage) {
      els.resultHint.textContent = "请先完成前景抠图并添加背景图";
      updateButtons();
      return;
    }
    els.runButton.disabled = true;
    goToStage(3);
    initEmptyCanvas(els.resultCanvas, "正在融合");
    els.resultHint.textContent = "正在生成...";
    els.serviceStatus.textContent = "生成中";
    setProcessing(true, "fusion");
    try {
      if (
        MODEL_CONFIG.useOpaPlacement &&
        state.placementAdjust.scheme === 1
      ) {
        await composeWithOpaPlacement();
      } else if (MODEL_CONFIG.useRemoteModel) {
        await composeWithApi();
      } else {
        await composeMock();
      }
      els.serviceStatus.textContent = "生成完成";
      advanceStage(3);
    } catch (error) {
      els.resultHint.textContent = `接口不可用：${error.message}`;
      if (els.placementStatus) {
        els.placementStatus.textContent = `OPA 不可用，已切换本地方案：${error.message}`;
      }
      if (MODEL_CONFIG.useRemoteModel || MODEL_CONFIG.useOpaPlacement) {
        try {
          await composeMock();
          els.serviceStatus.textContent = "已用本地回显";
          advanceStage(3);
        } catch (fallbackError) {
          els.resultHint.textContent = `生成失败：${fallbackError.message}`;
          els.serviceStatus.textContent = "生成失败";
        }
      } else {
        els.resultHint.textContent = `生成失败：${error.message}`;
        els.serviceStatus.textContent = "生成失败";
      }
    } finally {
      setProcessing(false);
      updateButtons();
    }
  });
  els.downloadMenuButton.addEventListener("click", () => {
    els.downloadDialog.hidden = false;
    updateButtons();
  });
  els.dialogCloseButton.addEventListener("click", () => {
    els.downloadDialog.hidden = true;
  });
  els.downloadDialog.addEventListener("click", (event) => {
    if (event.target === els.downloadDialog) els.downloadDialog.hidden = true;
  });
  els.dialogCutoutDownloadButton.addEventListener("click", () => {
    els.downloadDialog.hidden = true;
    els.cutoutDownloadButton.click();
  });
  els.dialogResultDownloadButton.addEventListener("click", () => {
    els.downloadDialog.hidden = true;
    els.downloadButton.click();
  });
  els.prevStageButton.addEventListener("click", () => goToStage(state.activeStage - 1));
  els.nextStageButton.addEventListener("click", () => goToStage(state.activeStage + 1));
  els.viewOriginalButton.addEventListener("click", viewOriginalSubject);
  els.resetSubjectViewButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetSubjectView();
  });
  els.resetCutoutViewButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetCutoutView();
  });
  els.viewCutoutButton.addEventListener("click", () => goToStage(1));
  els.viewBackgroundButton.addEventListener("click", () => goToStage(2));
  els.downloadButton.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = state.resultBlobUrl;
    a.download = "fusion-result.png";
    a.click();
  });
  els.cutoutDownloadButton.addEventListener("click", async () => {
    if (!state.foregroundCanvas) return;
    const blob = await new Promise((resolve) =>
      state.foregroundCanvas.toBlob(resolve, "image/png", 1),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "foreground-cutout.png";
    a.click();
    URL.revokeObjectURL(url);
  });
  els.restoreSubjectButton.addEventListener("click", () => {
    if (!state.subjectImage) return;
    drawImageToCanvas(els.subjectCanvas, state.subjectImage);
    state.selection = null;
    state.foregroundCanvas = null;
    state.foregroundBaseCanvas = null;
    els.selectionBox.hidden = true;
    els.selectionHint.textContent = "已返回原图，可重新框选主体";
    els.serviceStatus.textContent = "等待框选";
    initEmptyCanvas(els.cutoutCanvas, "等待抠图");
    goToStage(0);
    resetResult();
    updateButtons();
  });
}

function enterComposer() {
  document.body.classList.add("composer-started");
  setActiveTab("compose");
  goToStage(state.activeStage);
}

function returnHome() {
  document.body.classList.remove("composer-started");
  setActiveTab("home");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setActiveTab(tab) {
  els.homeTab.classList.toggle("active", tab === "home");
  els.composeTab.classList.toggle("active", tab === "compose");
  els.tutorialTab.classList.toggle("active", tab === "tutorial");
}

function shuffleItems(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createExampleCard(item) {
  const card = document.createElement("button");
  card.className = "example-card";
  card.type = "button";
  card.dataset.src = item.src;

  const image = document.createElement("img");
  image.src = item.src;
  image.alt = item.label;
  image.loading = "lazy";
  image.decoding = "async";

  card.append(image);
  card.addEventListener("click", async () => {
    enterComposer();
    els.backgroundHint.textContent = "正在载入示例背景...";
    try {
      await useExampleBackground(item.src);
    } catch (error) {
      els.backgroundHint.textContent = `示例背景载入失败：${error.message}`;
    }
  });
  return card;
}

function createRecommendCard(item, kind) {
  const card = document.createElement("button");
  card.className = "recommend-card";
  card.type = "button";
  card.dataset.src = item.src;

  const image = document.createElement("img");
  image.src = item.src;
  image.alt = item.label;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    if (item.fallbackSrc && !image.dataset.fallbackTried) {
      image.dataset.fallbackTried = "true";
      image.src = item.fallbackSrc;
      card.dataset.src = item.fallbackSrc;
      return;
    }
    card.remove();
  });

  card.appendChild(image);
  card.addEventListener("click", async () => {
    els.serviceStatus.textContent = kind === "foreground" ? "载入推荐前景" : "载入推荐背景";
    try {
      if (kind === "foreground") {
        await useExampleForeground(card.dataset.src);
      } else {
        await useExampleBackground(card.dataset.src);
      }
    } catch (error) {
      els.serviceStatus.textContent = `推荐图载入失败：${error.message}`;
      card.remove();
    }
  });
  return card;
}

function updateRecommendations() {
  const isBackgroundStage = state.activeStage === 2;
  const isResultStage = state.activeStage === 3;
  const isEditingSubjectView = state.activeStage === 0 && subjectViewChanged();
  const isEditingCutoutView = state.activeStage === 1 && cutoutViewChanged();
  const shouldHide =
    isResultStage ||
    isEditingSubjectView ||
    isEditingCutoutView;
  els.recommendPanel.hidden = shouldHide;
  els.composerApp?.classList.toggle("recommendations-collapsed", shouldHide);
  if (shouldHide) return;

  const kind = isBackgroundStage ? "background" : "foreground";
  const foregroundSource = HAS_LOCAL_FOREGROUND_RECOMMENDATIONS
    ? EXAMPLE_FOREGROUNDS.map((item, index) => ({
        ...item,
        fallbackSrc: EXAMPLE_BACKGROUNDS[index]?.src,
      }))
    : EXAMPLE_BACKGROUNDS.slice(0, 20);
  const source = isBackgroundStage ? EXAMPLE_BACKGROUNDS : foregroundSource;
  const items = shuffleItems(source).slice(0, 6);

  els.recommendTitle.textContent = isBackgroundStage ? "背景推荐" : "前景推荐";
  els.recommendTrack.replaceChildren();
  for (const item of [...items, ...items]) {
    els.recommendTrack.appendChild(createRecommendCard(item, kind));
  }
}

function initExampleShowcase() {
  const shuffled = shuffleItems(EXAMPLE_BACKGROUNDS);
  const groups = [
    shuffled.slice(0, 20),
    shuffled.slice(20, 40),
    shuffled.slice(40, 60),
  ];

  els.exampleTracks.forEach((track, index) => {
    const items = groups[index];
    const fragment = document.createDocumentFragment();
    for (const item of [...items, ...items]) {
      fragment.appendChild(createExampleCard(item));
    }
    track.appendChild(fragment);
  });
}

function wireLandingGesture() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("composer-started")) {
      returnHome();
    }
    if ((state.activeStage === 0 && state.subjectImage) || (state.activeStage === 1 && state.foregroundCanvas)) {
      const step = event.shiftKey ? 28 : 12;
      const keyPan = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      }[event.key];
      if (keyPan) {
        event.preventDefault();
        if (state.activeStage === 0) {
          panSubjectView(keyPan[0], keyPan[1]);
        } else {
          panCutoutView(keyPan[0], keyPan[1]);
        }
      }
    }
  });
  window.addEventListener("resize", updateResultEditBox);
}

function wireStageGesture() {
  let startX = null;
  let startY = null;
  let lastWheelAt = 0;

  const finishSwipe = (endX, endY) => {
    if (startX === null || startY === null) return;
    const dx = endX - startX;
    const dy = endY - startY;
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (state.isProcessing) return;
      goToStage(state.activeStage + (dx < 0 ? 1 : -1));
    }
    startX = null;
    startY = null;
  };

  els.stageViewport.addEventListener("pointerdown", (event) => {
    if (state.activeStage === 0 && event.target === els.subjectCanvas) return;
    if (state.activeStage === 1 && event.target === els.cutoutCanvas) return;
    if (state.activeStage === 3 && (event.target === els.resultCanvas || els.resultEditBox.contains(event.target))) return;
    startX = event.clientX;
    startY = event.clientY;
  });

  els.stageViewport.addEventListener("pointerup", (event) => {
    finishSwipe(event.clientX, event.clientY);
  });

  els.stageViewport.addEventListener("touchstart", (event) => {
    if (state.activeStage === 0 && event.target === els.subjectCanvas) return;
    startX = event.touches[0]?.clientX ?? null;
    startY = event.touches[0]?.clientY ?? null;
  });

  els.stageViewport.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    if (touch) finishSwipe(touch.clientX, touch.clientY);
  });

  els.stageViewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (state.isProcessing) return;
      if (Math.abs(event.deltaY) < 12) return;
      const now = Date.now();
      if (now - lastWheelAt < 420) return;
      lastWheelAt = now;
      goToStage(state.activeStage + (event.deltaY > 0 ? 1 : -1));
    },
    { passive: false },
  );
}

function initEmptyCanvas(canvas, text = "双击添加图片") {
  if (canvas === els.subjectCanvas) {
    els.subjectCanvasWrap.classList.remove("has-subject-image");
    els.subjectCanvasWrap.style.removeProperty("--subject-canvas-height");
  }
  canvas.width = 800;
  canvas.height = 520;
  const ctx = canvasContext(canvas);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#11293a");
  gradient.addColorStop(0.52, "#162238");
  gradient.addColorStop(1, "#251e37");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#bdefff";
  for (let x = 0; x <= canvas.width; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#eaf8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 30px Microsoft YaHei, sans-serif";
  ctx.shadowColor = "rgba(169, 242, 255, 0.32)";
  ctx.shadowBlur = 18;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function initEmptyCanvases() {
  initEmptyCanvas(els.subjectCanvas, "双击添加图片");
  initEmptyCanvas(els.cutoutCanvas, "等待抠图");
  initEmptyCanvas(els.backgroundCanvas, "双击添加图片");
  initEmptyCanvas(els.resultCanvas, "等待生成");
}

wireDropzone(els.subjectDrop, els.subjectInput, "subject");
wireDropzone(els.backgroundDrop, els.backgroundInput, "background");
wireSelection();
wireResultEditor();
wireAdjustWidget();
wireControls();
initExampleShowcase();
wireLandingGesture();
wireStageGesture();
initEmptyCanvases();
goToStage(0);

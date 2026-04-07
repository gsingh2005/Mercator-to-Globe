(function bootstrapMercatorGlobeStudio() {
  const ProjectionCore = window.ProjectionCore;
  const state = {
    file: null,
    sourceUrl: "",
    sourceImage: null,
    sourceWidth: 0,
    sourceHeight: 0,
    worker: null,
    activeJobId: 0,
    outputCanvasReady: false,
  };

  const elements = {
    fileInput: document.getElementById("fileInput"),
    dropzone: document.getElementById("dropzone"),
    inferSourceButton: document.getElementById("inferSourceButton"),
    sourceLatMin: document.getElementById("sourceLatMin"),
    sourceLatMax: document.getElementById("sourceLatMax"),
    scaleSlider: document.getElementById("scaleSlider"),
    scaleValue: document.getElementById("scaleValue"),
    statusText: document.getElementById("statusText"),
    sourceHint: document.getElementById("sourceHint"),
    outputEstimate: document.getElementById("outputEstimate"),
    sourceDimensions: document.getElementById("sourceDimensions"),
    targetDimensions: document.getElementById("targetDimensions"),
    globeTextureMeta: document.getElementById("globeTextureMeta"),
    sourceMeta: document.getElementById("sourceMeta"),
    outputMeta: document.getElementById("outputMeta"),
    globeMeta: document.getElementById("globeMeta"),
    previewMapButton: document.getElementById("previewMapButton"),
    downloadButton: document.getElementById("downloadButton"),
    previewDownloadButton: document.getElementById("previewDownloadButton"),
    downloadGlobeButton: document.getElementById("downloadGlobeButton"),
    outputCanvas: document.getElementById("outputCanvas"),
    globeCanvas: document.getElementById("globeCanvas"),
    outputEmpty: document.getElementById("outputEmpty"),
    globeEmpty: document.getElementById("globeEmpty"),
    autoSpinToggle: document.getElementById("autoSpinToggle"),
    spinSpeedSlider: document.getElementById("spinSpeedSlider"),
    resetViewButton: document.getElementById("resetViewButton"),
    previewModal: document.getElementById("previewModal"),
    closePreviewButton: document.getElementById("closePreviewButton"),
  };

  const globeRenderer = new window.GlobeRenderer(elements.globeCanvas);

  initializeDefaults();
  bindEvents();
  updateScaleLabel();
  updateEstimate();
  initializeWorker();
  globeRenderer.setAutoSpin(elements.autoSpinToggle.checked);
  globeRenderer.setSpinSpeed(elements.spinSpeedSlider.value);

  function initializeDefaults() {
    elements.sourceLatMin.value = formatDegrees(
      -ProjectionCore.DEFAULTS.mercatorLatitudeLimit
    );
    elements.sourceLatMax.value = formatDegrees(
      ProjectionCore.DEFAULTS.mercatorLatitudeLimit
    );
  }

  function bindEvents() {
    elements.fileInput.addEventListener("change", handleFileSelection);
    elements.dropzone.addEventListener("dragenter", handleDragState);
    elements.dropzone.addEventListener("dragover", handleDragState);
    elements.dropzone.addEventListener("dragleave", clearDragState);
    elements.dropzone.addEventListener("drop", handleDrop);
    elements.inferSourceButton.addEventListener("click", inferSourceBounds);
    elements.scaleSlider.addEventListener("input", () => {
      updateScaleLabel();
      updateEstimate();
    });
    elements.scaleSlider.addEventListener("change", convertMap);
    elements.sourceLatMin.addEventListener("input", updateEstimate);
    elements.sourceLatMax.addEventListener("input", updateEstimate);
    elements.sourceLatMin.addEventListener("change", convertMap);
    elements.sourceLatMax.addEventListener("change", convertMap);
    elements.previewMapButton.addEventListener("click", openPreviewModal);
    elements.downloadButton.addEventListener("click", downloadConvertedMap);
    elements.previewDownloadButton.addEventListener("click", downloadConvertedMap);
    elements.downloadGlobeButton.addEventListener("click", downloadGlobe);
    elements.autoSpinToggle.addEventListener("change", () => {
      globeRenderer.setAutoSpin(elements.autoSpinToggle.checked);
    });
    elements.spinSpeedSlider.addEventListener("input", () => {
      globeRenderer.setSpinSpeed(elements.spinSpeedSlider.value);
    });
    elements.resetViewButton.addEventListener("click", () => {
      globeRenderer.resetView();
    });
    elements.closePreviewButton.addEventListener("click", closePreviewModal);
    elements.previewModal.addEventListener("click", (event) => {
      const target = event.target;
      if (target && target.getAttribute("data-close-preview") === "true") {
        closePreviewModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.previewModal.classList.contains("hidden")) {
        closePreviewModal();
      }
    });
  }

  function initializeWorker() {
    if (!("Worker" in window)) {
      return;
    }

    try {
      state.worker = new Worker("./converter-worker.js");
      state.worker.addEventListener("message", handleWorkerMessage);
      state.worker.addEventListener("error", () => {
        setStatus("Worker setup failed. Falling back to main-thread conversion.");
        state.worker = null;
      });
    } catch (error) {
      setStatus("Worker setup failed. Falling back to main-thread conversion.");
      state.worker = null;
    }
  }

  function handleFileSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    loadSourceFile(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    clearDragState();
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) {
      return;
    }

    try {
      elements.fileInput.files = event.dataTransfer.files;
    } catch (error) {
      // Some browsers keep file inputs read-only for script assignment.
    }

    loadSourceFile(file);
  }

  function handleDragState(event) {
    event.preventDefault();
    elements.dropzone.classList.add("drag-active");
  }

  function clearDragState() {
    elements.dropzone.classList.remove("drag-active");
  }

  async function loadSourceFile(file) {
    if (state.sourceUrl) {
      URL.revokeObjectURL(state.sourceUrl);
    }

    state.file = file;
    state.sourceUrl = URL.createObjectURL(file);
    setStatus("Loading Mercator map...");
    resetOutputState();

    try {
      const image = await loadImage(state.sourceUrl);
      state.sourceImage = image;
      state.sourceWidth = image.naturalWidth;
      state.sourceHeight = image.naturalHeight;
      elements.sourceDimensions.textContent =
        state.sourceWidth + " × " + state.sourceHeight + " px";
      elements.sourceMeta.textContent =
        file.name +
        " · Mercator input";
      elements.sourceHint.textContent =
        "The upload is treated as a full-width Mercator world map. Adjust the latitude span if the source is vertically cropped.";
      inferSourceBounds();
    } catch (error) {
      state.sourceImage = null;
      state.sourceWidth = 0;
      state.sourceHeight = 0;
      setStatus("Could not read the selected image.");
      elements.sourceMeta.textContent =
        error && error.message ? error.message : "Image loading failed.";
    }
  }

  function resetOutputState() {
    state.activeJobId += 1;
    state.outputCanvasReady = false;
    closePreviewModal();
    elements.previewMapButton.disabled = true;
    elements.downloadButton.disabled = true;
    elements.previewDownloadButton.disabled = true;
    elements.downloadGlobeButton.disabled = true;
    elements.outputCanvas.classList.remove("is-visible");
    elements.outputEmpty.classList.remove("hidden");
    elements.targetDimensions.textContent = "Pending";
    elements.globeTextureMeta.textContent = "Pending";
    elements.outputMeta.textContent = "The converted texture will appear here.";
    elements.globeMeta.textContent =
      "The globe will activate after a Mercator map is converted into an Equirectangular texture.";
    globeRenderer.setTexture(null);
    elements.globeCanvas.classList.remove("is-visible");
    elements.globeEmpty.classList.remove("hidden");
  }

  function inferSourceBounds() {
    if (!state.sourceWidth || !state.sourceHeight) {
      return;
    }

    const bounds = ProjectionCore.inferLatitudeBounds(
      "mercator",
      state.sourceWidth,
      state.sourceHeight
    );
    elements.sourceLatMin.value = formatDegrees(bounds.min);
    elements.sourceLatMax.value = formatDegrees(bounds.max);
    updateEstimate();
    convertMap();
  }

  function buildOptions() {
    return ProjectionCore.normalizeOptions({
      sourceProjection: "mercator",
      targetProjection: "equirectangular",
      sourceLatMin: Number(elements.sourceLatMin.value),
      sourceLatMax: Number(elements.sourceLatMax.value),
      targetLatMin: -90,
      targetLatMax: 90,
      outOfBoundsMode: "clamp",
    });
  }

  function updateScaleLabel() {
    const scale = Number(elements.scaleSlider.value) || 1;
    elements.scaleValue.textContent = scale.toFixed(1) + "×";
  }

  function updateEstimate() {
    if (!state.sourceWidth || !state.sourceHeight) {
      elements.outputEstimate.textContent =
        "Estimated export size will appear here.";
      return;
    }

    const options = buildOptions();
    const size = ProjectionCore.suggestOutputSize(
      state.sourceWidth,
      state.sourceHeight,
      options,
      Number(elements.scaleSlider.value)
    );
    const limitedText = size.limited
      ? " Browser limits reduced the requested size slightly."
      : "";

    elements.outputEstimate.textContent =
      "Estimated Equirectangular texture: " +
      size.width +
      " × " +
      size.height +
      " px." +
      limitedText;
    elements.targetDimensions.textContent = size.width + " × " + size.height + " px";
  }

  async function convertMap() {
    if (!state.file || !state.sourceWidth || !state.sourceHeight) {
      return;
    }

    const options = buildOptions();
    const size = ProjectionCore.suggestOutputSize(
      state.sourceWidth,
      state.sourceHeight,
      options,
      Number(elements.scaleSlider.value)
    );

    elements.targetDimensions.textContent = size.width + " × " + size.height + " px";
    elements.outputMeta.textContent =
      "Generated Equirectangular texture · " +
      size.width +
      " × " +
      size.height +
      " px";
    setStatus("Generating Equirectangular texture...");

    const jobId = ++state.activeJobId;
    if (state.worker) {
      state.worker.postMessage({
        type: "convert",
        jobId,
        file: state.file,
        options,
        outputWidth: size.width,
        outputHeight: size.height,
      });
      return;
    }

    try {
      const result = await convertOnMainThread(jobId, options, size.width, size.height);
      if (!result || result.jobId !== state.activeJobId) {
        return;
      }

      renderOutput(result.bitmap, result.width, result.height);
    } catch (error) {
      setStatus(error && error.message ? error.message : "Projection conversion failed.");
    }
  }

  async function convertOnMainThread(jobId, options, outputWidth, outputHeight) {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = state.sourceWidth;
    sourceCanvas.height = state.sourceHeight;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });

    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(state.file);
      sourceContext.drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
    } else if (state.sourceImage) {
      sourceContext.drawImage(state.sourceImage, 0, 0);
    } else {
      throw new Error("The browser could not decode the source map for conversion.");
    }

    const sourceImageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const converted = ProjectionCore.convertImageData(
      sourceImageData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      options,
      outputWidth,
      outputHeight
    );
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = converted.width;
    outputCanvas.height = converted.height;
    outputCanvas.getContext("2d").putImageData(converted, 0, 0);

    return {
      jobId,
      width: converted.width,
      height: converted.height,
      bitmap: outputCanvas,
    };
  }

  function handleWorkerMessage(event) {
    const data = event.data || {};
    if (data.type === "error") {
      if (data.jobId !== state.activeJobId) {
        return;
      }

      setStatus(data.message || "Projection conversion failed.");
      return;
    }

    if (data.type !== "converted") {
      return;
    }

    if (data.jobId !== state.activeJobId) {
      if (data.bitmap && typeof data.bitmap.close === "function") {
        data.bitmap.close();
      }
      return;
    }

    renderOutput(data.bitmap, data.width, data.height);
  }

  function renderOutput(renderSource, width, height) {
    state.outputCanvasReady = true;
    elements.outputCanvas.width = width;
    elements.outputCanvas.height = height;
    const context = elements.outputCanvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.drawImage(renderSource, 0, 0);
    if (renderSource instanceof ImageBitmap && typeof renderSource.close === "function") {
      renderSource.close();
    }

    elements.outputCanvas.classList.add("is-visible");
    elements.outputEmpty.classList.add("hidden");
    elements.previewMapButton.disabled = false;
    elements.downloadButton.disabled = false;
    elements.previewDownloadButton.disabled = false;
    elements.downloadGlobeButton.disabled = false;
    elements.globeTextureMeta.textContent = width + " × " + height + " px";
    elements.globeMeta.textContent =
      "The globe is using the generated Equirectangular texture from the current Mercator upload.";
    globeRenderer.setTexture(elements.outputCanvas);
    elements.globeCanvas.classList.add("is-visible");
    elements.globeEmpty.classList.add("hidden");
    setStatus("Globe texture generated.");
  }

  function openPreviewModal() {
    if (!state.outputCanvasReady) {
      return;
    }

    elements.previewModal.classList.remove("hidden");
    elements.previewModal.setAttribute("aria-hidden", "false");
  }

  function closePreviewModal() {
    elements.previewModal.classList.add("hidden");
    elements.previewModal.setAttribute("aria-hidden", "true");
  }

  async function downloadConvertedMap() {
    if (!state.outputCanvasReady) {
      return;
    }

    const blob = await canvasToBlob(elements.outputCanvas);
    triggerDownload(blob, buildDownloadName("equirectangular"));
  }

  async function downloadGlobe() {
    const blob = await globeRenderer.download();
    if (!blob) {
      return;
    }

    triggerDownload(blob, buildDownloadName("globe-view"));
  }

  function buildDownloadName(suffix) {
    const stem = state.file ? state.file.name.replace(/\.[^.]+$/, "") : "world-map";
    return stem + "-" + suffix + ".png";
  }

  function setStatus(message) {
    elements.statusText.textContent = message;
  }

  function formatDegrees(value) {
    return value.toFixed(3).replace(/\.?0+$/, "");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = function handleLoad() {
        resolve(image);
      };
      image.onerror = function handleError() {
        reject(new Error("The browser could not decode this image."));
      };
      image.src = src;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
  }

  function triggerDownload(blob, filename) {
    if (!blob) {
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
})();

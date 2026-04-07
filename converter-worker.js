self.importScripts("./projection-core.js");

self.onmessage = async function handleMessage(event) {
  const data = event.data || {};
  if (data.type !== "convert") {
    return;
  }

  try {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is unavailable in this browser.");
    }

    const bitmap = await createImageBitmap(data.file);
    const sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceContext.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }

    const normalizedOptions = self.ProjectionCore.normalizeOptions(data.options || {});
    const sourceImageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const converted = self.ProjectionCore.convertImageData(
      sourceImageData.data,
      sourceCanvas.width,
      sourceCanvas.height,
      normalizedOptions,
      data.outputWidth,
      data.outputHeight
    );

    const outputCanvas = new OffscreenCanvas(converted.width, converted.height);
    const outputContext = outputCanvas.getContext("2d");
    outputContext.putImageData(converted, 0, 0);
    const resultBitmap = outputCanvas.transferToImageBitmap();

    self.postMessage(
      {
        type: "converted",
        jobId: data.jobId,
        width: converted.width,
        height: converted.height,
        bitmap: resultBitmap,
      },
      [resultBitmap]
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId: data.jobId,
      message: error && error.message ? error.message : "Projection conversion failed.",
    });
  }
};

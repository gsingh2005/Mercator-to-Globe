(function attachProjectionCore(globalScope) {
  const DEFAULTS = Object.freeze({
    mercatorLatitudeLimit: 85.051129,
    mercatorHardLimit: 89.9,
    maxOutputDimension: 12000,
    maxOutputPixels: 48000000,
    globeTextureWidth: 2048,
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function wrap01(value) {
    const wrapped = value % 1;
    return wrapped < 0 ? wrapped + 1 : wrapped;
  }

  function degToRad(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function radToDeg(radians) {
    return (radians * 180) / Math.PI;
  }

  function mercatorYFromLatDeg(latDeg) {
    const safeLat = clamp(latDeg, -DEFAULTS.mercatorHardLimit, DEFAULTS.mercatorHardLimit);
    const latRad = degToRad(safeLat);
    return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  }

  function latDegFromMercatorY(mercatorY) {
    return radToDeg(2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2);
  }

  function normalizeLatitudeBounds(projection, min, max) {
    const limit = projection === "mercator" ? DEFAULTS.mercatorHardLimit : 90;
    const fallback = projection === "mercator"
      ? { min: -DEFAULTS.mercatorLatitudeLimit, max: DEFAULTS.mercatorLatitudeLimit }
      : { min: -90, max: 90 };

    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      return fallback;
    }

    const normalizedMin = clamp(min, -limit, limit);
    const normalizedMax = clamp(max, -limit, limit);

    if (normalizedMin >= normalizedMax) {
      return fallback;
    }

    return { min: normalizedMin, max: normalizedMax };
  }

  function normalizeProjection(projection, fallback) {
    return projection === "mercator" || projection === "equirectangular"
      ? projection
      : fallback;
  }

  function normalizeOptions(options) {
    const sourceProjection = normalizeProjection(options.sourceProjection, "mercator");
    const targetProjection = normalizeProjection(options.targetProjection, "equirectangular");
    const sourceBounds = normalizeLatitudeBounds(
      sourceProjection,
      Number(options.sourceLatMin),
      Number(options.sourceLatMax)
    );
    const targetBounds = normalizeLatitudeBounds(
      targetProjection,
      Number(options.targetLatMin),
      Number(options.targetLatMax)
    );

    return {
      sourceProjection,
      targetProjection,
      sourceLatMin: sourceBounds.min,
      sourceLatMax: sourceBounds.max,
      targetLatMin: targetBounds.min,
      targetLatMax: targetBounds.max,
      sourceLonMin: -180,
      sourceLonMax: 180,
      targetLonMin: -180,
      targetLonMax: 180,
      outOfBoundsMode: options.outOfBoundsMode === "clamp" ? "clamp" : "transparent",
    };
  }

  function inferLatitudeBounds(projection, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return projection === "mercator"
        ? { min: -DEFAULTS.mercatorLatitudeLimit, max: DEFAULTS.mercatorLatitudeLimit }
        : { min: -90, max: 90 };
    }

    const aspect = width / height;
    if (projection === "mercator") {
      const mercatorHalfRange = Math.PI / Math.max(0.2, aspect);
      const inferredMax = clamp(
        latDegFromMercatorY(mercatorHalfRange),
        10,
        DEFAULTS.mercatorHardLimit
      );
      return {
        min: -inferredMax,
        max: inferredMax,
      };
    }

    const inferredMax = clamp(180 / Math.max(0.25, aspect), 1, 90);
    return {
      min: -inferredMax,
      max: inferredMax,
    };
  }

  function getProjectionAspect(projection, latMin, latMax, lonMin, lonMax) {
    const normalizedLonMin = Number.isFinite(lonMin) ? lonMin : -180;
    const normalizedLonMax = Number.isFinite(lonMax) ? lonMax : 180;
    const lonSpanDeg = normalizedLonMax - normalizedLonMin;
    if (lonSpanDeg <= 0) {
      return 2;
    }

    if (projection === "equirectangular") {
      const latSpanDeg = Math.max(0.1, latMax - latMin);
      return lonSpanDeg / latSpanDeg;
    }

    const mercatorTop = mercatorYFromLatDeg(latMax);
    const mercatorBottom = mercatorYFromLatDeg(latMin);
    const projectedHeight = Math.max(0.001, mercatorTop - mercatorBottom);
    return degToRad(lonSpanDeg) / projectedHeight;
  }

  function limitOutputSize(width, height) {
    const normalizedWidth = Math.max(1, Math.round(width));
    const normalizedHeight = Math.max(1, Math.round(height));
    let scaleFactor = 1;

    if (Math.max(normalizedWidth, normalizedHeight) > DEFAULTS.maxOutputDimension) {
      scaleFactor = Math.min(
        scaleFactor,
        DEFAULTS.maxOutputDimension / Math.max(normalizedWidth, normalizedHeight)
      );
    }

    if (normalizedWidth * normalizedHeight > DEFAULTS.maxOutputPixels) {
      scaleFactor = Math.min(
        scaleFactor,
        Math.sqrt(DEFAULTS.maxOutputPixels / (normalizedWidth * normalizedHeight))
      );
    }

    if (scaleFactor >= 1) {
      return {
        width: normalizedWidth,
        height: normalizedHeight,
        limited: false,
      };
    }

    return {
      width: Math.max(1, Math.floor(normalizedWidth * scaleFactor)),
      height: Math.max(1, Math.floor(normalizedHeight * scaleFactor)),
      limited: true,
    };
  }

  function suggestOutputSize(sourceWidth, sourceHeight, options, requestedScale) {
    const normalized = normalizeOptions(options);
    const aspect = getProjectionAspect(
      normalized.targetProjection,
      normalized.targetLatMin,
      normalized.targetLatMax,
      normalized.targetLonMin,
      normalized.targetLonMax
    );
    const scale = clamp(Number(requestedScale) || 1, 0.1, 16);
    const desiredWidth = Math.max(1, Math.round(sourceWidth * scale));
    const desiredHeight = Math.max(1, Math.round(desiredWidth / Math.max(0.05, aspect)));
    const limited = limitOutputSize(desiredWidth, desiredHeight);

    return {
      width: limited.width,
      height: limited.height,
      aspect,
      limited: limited.limited,
      requestedWidth: desiredWidth,
      requestedHeight: desiredHeight,
      requestedScale: scale,
      appliedScale: limited.width / Math.max(1, sourceWidth),
      sourceHeight,
    };
  }

  function buildHorizontalMap(sourceWidth, destWidth, options) {
    const sourceLonSpan = options.sourceLonMax - options.sourceLonMin;
    const targetLonSpan = options.targetLonMax - options.targetLonMin;
    const x0Map = new Uint32Array(destWidth);
    const x1Map = new Uint32Array(destWidth);
    const fxMap = new Float32Array(destWidth);

    for (let x = 0; x < destWidth; x += 1) {
      const normalizedX = (x + 0.5) / destWidth;
      const lon = options.targetLonMin + normalizedX * targetLonSpan;
      const sourceU = wrap01((lon - options.sourceLonMin) / sourceLonSpan);
      const sampleX = sourceU * sourceWidth - 0.5;
      const left = Math.floor(sampleX);
      const fraction = sampleX - left;

      if (sourceWidth === 1) {
        x0Map[x] = 0;
        x1Map[x] = 0;
        fxMap[x] = 0;
        continue;
      }

      const leftWrapped = ((left % sourceWidth) + sourceWidth) % sourceWidth;
      x0Map[x] = leftWrapped;
      x1Map[x] = (leftWrapped + 1) % sourceWidth;
      fxMap[x] = fraction;
    }

    return { x0Map, x1Map, fxMap };
  }

  function buildVerticalMap(sourceHeight, destHeight, options) {
    const y0Map = new Uint32Array(destHeight);
    const y1Map = new Uint32Array(destHeight);
    const fyMap = new Float32Array(destHeight);
    const validRows = new Uint8Array(destHeight);

    const sourceLatSpan = options.sourceLatMax - options.sourceLatMin;
    const targetLatSpan = options.targetLatMax - options.targetLatMin;
    const sourceMercatorTop = options.sourceProjection === "mercator"
      ? mercatorYFromLatDeg(options.sourceLatMax)
      : 0;
    const sourceMercatorBottom = options.sourceProjection === "mercator"
      ? mercatorYFromLatDeg(options.sourceLatMin)
      : 0;
    const sourceMercatorSpan = sourceMercatorTop - sourceMercatorBottom;
    const targetMercatorTop = options.targetProjection === "mercator"
      ? mercatorYFromLatDeg(options.targetLatMax)
      : 0;
    const targetMercatorBottom = options.targetProjection === "mercator"
      ? mercatorYFromLatDeg(options.targetLatMin)
      : 0;
    const targetMercatorSpan = targetMercatorTop - targetMercatorBottom;

    for (let y = 0; y < destHeight; y += 1) {
      const normalizedY = (y + 0.5) / destHeight;
      let latitude;

      if (options.targetProjection === "mercator") {
        const mercatorY = targetMercatorTop - normalizedY * targetMercatorSpan;
        latitude = latDegFromMercatorY(mercatorY);
      } else {
        latitude = options.targetLatMax - normalizedY * targetLatSpan;
      }

      if (latitude < options.sourceLatMin || latitude > options.sourceLatMax) {
        if (options.outOfBoundsMode === "clamp") {
          latitude = clamp(latitude, options.sourceLatMin, options.sourceLatMax);
        } else {
          continue;
        }
      }

      let sourceV;
      if (options.sourceProjection === "mercator") {
        const mercatorY = mercatorYFromLatDeg(latitude);
        sourceV = (sourceMercatorTop - mercatorY) / sourceMercatorSpan;
      } else {
        sourceV = (options.sourceLatMax - latitude) / sourceLatSpan;
      }

      if (!Number.isFinite(sourceV) || sourceV < 0 || sourceV > 1) {
        continue;
      }

      const sampleY = sourceV * sourceHeight - 0.5;
      const top = Math.floor(sampleY);
      const fraction = sampleY - top;
      const y0 = clamp(top, 0, Math.max(0, sourceHeight - 1));
      const y1 = clamp(top + 1, 0, Math.max(0, sourceHeight - 1));

      y0Map[y] = y0;
      y1Map[y] = sourceHeight === 1 ? y0 : y1;
      fyMap[y] = sourceHeight === 1 ? 0 : fraction;
      validRows[y] = 1;
    }

    return { y0Map, y1Map, fyMap, validRows };
  }

  function convertImageData(sourcePixels, sourceWidth, sourceHeight, options, destWidth, destHeight) {
    const normalizedOptions = normalizeOptions(options);
    const outputWidth = Math.max(1, Math.round(destWidth));
    const outputHeight = Math.max(1, Math.round(destHeight));
    const targetPixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);

    const { x0Map, x1Map, fxMap } = buildHorizontalMap(
      sourceWidth,
      outputWidth,
      normalizedOptions
    );
    const { y0Map, y1Map, fyMap, validRows } = buildVerticalMap(
      sourceHeight,
      outputHeight,
      normalizedOptions
    );
    const sourceStride = sourceWidth * 4;

    for (let y = 0; y < outputHeight; y += 1) {
      if (!validRows[y]) {
        continue;
      }

      const y0 = y0Map[y];
      const y1 = y1Map[y];
      const fy = fyMap[y];
      const inverseFy = 1 - fy;
      const sourceRow0 = y0 * sourceStride;
      const sourceRow1 = y1 * sourceStride;
      const outputRow = y * outputWidth * 4;

      for (let x = 0; x < outputWidth; x += 1) {
        const x0 = x0Map[x];
        const x1 = x1Map[x];
        const fx = fxMap[x];
        const inverseFx = 1 - fx;
        const outputIndex = outputRow + x * 4;
        const index00 = sourceRow0 + x0 * 4;
        const index10 = sourceRow0 + x1 * 4;
        const index01 = sourceRow1 + x0 * 4;
        const index11 = sourceRow1 + x1 * 4;
        const weight00 = inverseFx * inverseFy;
        const weight10 = fx * inverseFy;
        const weight01 = inverseFx * fy;
        const weight11 = fx * fy;

        targetPixels[outputIndex] =
          sourcePixels[index00] * weight00 +
          sourcePixels[index10] * weight10 +
          sourcePixels[index01] * weight01 +
          sourcePixels[index11] * weight11;
        targetPixels[outputIndex + 1] =
          sourcePixels[index00 + 1] * weight00 +
          sourcePixels[index10 + 1] * weight10 +
          sourcePixels[index01 + 1] * weight01 +
          sourcePixels[index11 + 1] * weight11;
        targetPixels[outputIndex + 2] =
          sourcePixels[index00 + 2] * weight00 +
          sourcePixels[index10 + 2] * weight10 +
          sourcePixels[index01 + 2] * weight01 +
          sourcePixels[index11 + 2] * weight11;
        targetPixels[outputIndex + 3] =
          sourcePixels[index00 + 3] * weight00 +
          sourcePixels[index10 + 3] * weight10 +
          sourcePixels[index01 + 3] * weight01 +
          sourcePixels[index11 + 3] * weight11;
      }
    }

    return new ImageData(targetPixels, outputWidth, outputHeight);
  }

  globalScope.ProjectionCore = {
    DEFAULTS,
    clamp,
    degToRad,
    radToDeg,
    mercatorYFromLatDeg,
    latDegFromMercatorY,
    normalizeOptions,
    inferLatitudeBounds,
    getProjectionAspect,
    suggestOutputSize,
    convertImageData,
  };
})(typeof self !== "undefined" ? self : window);

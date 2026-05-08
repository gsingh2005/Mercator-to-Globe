(function attachGlobeRenderer(globalScope) {
  class GlobeRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { alpha: true });
      this.textureCanvas = document.createElement("canvas");
      this.textureContext = this.textureCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      this.textureData = null;
      this.textureWidth = 0;
      this.textureHeight = 0;
      this.yaw = 0.2;
      this.pitch = -0.22;
      this.zoom = 1;
      this.showGraticule = false;
      this.graticuleSpacingRad = Math.PI / 6;
      this.graticuleThicknessScale = 1;
      this.graticuleColor = [242, 246, 252];
      this.needsRender = false;
      this.pointerState = null;
      this.animationFrame = 0;
      this.sphereCache = null;
      this.imageData = null;
      this.visible = false;

      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handlePointerMove = this.handlePointerMove.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.handleWheel = this.handleWheel.bind(this);
      this.handleDoubleClick = this.handleDoubleClick.bind(this);
      this.animate = this.animate.bind(this);

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          this.resize();
        });
        this.resizeObserver.observe(this.canvas);
      } else {
        window.addEventListener("resize", () => {
          this.resize();
        });
      }

      this.canvas.addEventListener("pointerdown", this.handlePointerDown);
      this.canvas.addEventListener("pointermove", this.handlePointerMove);
      this.canvas.addEventListener("pointerup", this.handlePointerUp);
      this.canvas.addEventListener("pointercancel", this.handlePointerUp);
      this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
      this.canvas.addEventListener("dblclick", this.handleDoubleClick);

      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const cssSize = Math.max(240, Math.min(rect.width || 520, 720));
      const deviceRatio = Math.min(window.devicePixelRatio || 1, 2);
      const targetSize = Math.round(cssSize * deviceRatio);

      if (this.canvas.width !== targetSize || this.canvas.height !== targetSize) {
        this.canvas.width = targetSize;
        this.canvas.height = targetSize;
        this.imageData = this.context.createImageData(targetSize, targetSize);
        this.prepareSphereCache();
      }

      this.requestRender();
    }

    prepareSphereCache() {
      const width = this.canvas.width;
      const height = this.canvas.height;
      const count = width * height;
      const nx = new Float32Array(count);
      const ny = new Float32Array(count);
      const nz = new Float32Array(count);
      const shade = new Float32Array(count);
      const mask = new Uint8Array(count);
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.44 * this.zoom;
      const light = normalizeVector([0.38, 0.32, 0.87]);
      const ambient = 0.48;
      const diffuse = 0.52;

      for (let y = 0; y < height; y += 1) {
        const dy = (centerY - (y + 0.5)) / radius;
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          const dx = ((x + 0.5) - centerX) / radius;
          const r2 = dx * dx + dy * dy;
          if (r2 > 1) {
            continue;
          }

          const dz = Math.sqrt(1 - r2);
          nx[index] = dx;
          ny[index] = dy;
          nz[index] = dz;
          mask[index] = 1;
          const brightness =
            ambient +
            diffuse * Math.max(0, dx * light[0] + dy * light[1] + dz * light[2]);
          shade[index] = brightness;
        }
      }

      this.sphereCache = {
        width,
        height,
        radius,
        nx,
        ny,
        nz,
        shade,
        mask,
      };
    }

    setTexture(source) {
      if (!source || !source.width || !source.height) {
        this.textureData = null;
        this.textureWidth = 0;
        this.textureHeight = 0;
        this.visible = false;
        this.requestRender();
        return;
      }

      const texture = createTextureSnapshot(
        source,
        this.textureCanvas,
        this.textureContext,
        globalScope.ProjectionCore
          ? globalScope.ProjectionCore.DEFAULTS.globeTextureWidth
          : 2048
      );
      this.textureData = texture.data;
      this.textureWidth = texture.width;
      this.textureHeight = texture.height;
      this.visible = true;
      this.requestRender();
    }

    setGraticuleVisible(enabled) {
      this.showGraticule = Boolean(enabled);
      this.requestRender();
    }

    setGraticuleColor(color) {
      this.graticuleColor = parseColor(color);
      this.requestRender();
    }

    setGraticuleSpacing(spacingDegrees) {
      const degrees = clamp(Number(spacingDegrees) || 30, 5, 90);
      this.graticuleSpacingRad = (degrees * Math.PI) / 180;
      this.requestRender();
    }

    setGraticuleThickness(thicknessScale) {
      this.graticuleThicknessScale = clamp(Number(thicknessScale) || 1, 0.25, 4);
      this.requestRender();
    }

    resetView() {
      this.yaw = 0.2;
      this.pitch = -0.22;
      this.zoom = 1;
      this.prepareSphereCache();
      this.requestRender();
    }

    download() {
      return new Promise((resolve) => {
        this.canvas.toBlob(resolve, "image/png");
      });
    }

    requestRender() {
      if (this.animationFrame) {
        return;
      }

      this.animationFrame = window.requestAnimationFrame(this.animate);
    }

    animate() {
      this.animationFrame = 0;
      if (this.needsRender || this.visible) {
        this.render();
      }
      this.needsRender = false;
    }

    render() {
      if (!this.imageData || !this.sphereCache) {
        return;
      }

      const pixels = this.imageData.data;
      pixels.fill(0);

      if (!this.visible || !this.textureData) {
        this.context.putImageData(this.imageData, 0, 0);
        return;
      }

      const { nx, ny, nz, shade, mask, radius } = this.sphereCache;
      const cosYaw = Math.cos(this.yaw);
      const sinYaw = Math.sin(this.yaw);
      const cosPitch = Math.cos(this.pitch);
      const sinPitch = Math.sin(this.pitch);
      const lineThreshold = radius > 0
        ? (1.4 * this.graticuleThicknessScale) / radius
        : 0.005 * this.graticuleThicknessScale;

      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) {
          continue;
        }

        const viewX = nx[index];
        const viewY = ny[index];
        const viewZ = nz[index];
        const pitchedY = cosPitch * viewY + sinPitch * viewZ;
        const pitchedZ = -sinPitch * viewY + cosPitch * viewZ;
        const globeX = cosYaw * viewX - sinYaw * pitchedZ;
        const globeY = pitchedY;
        const globeZ = sinYaw * viewX + cosYaw * pitchedZ;
        const longitude = Math.atan2(globeX, globeZ);
        const latitude = Math.asin(clamp(globeY, -1, 1));
        const sample = sampleTexture(
          this.textureData,
          this.textureWidth,
          this.textureHeight,
          longitude,
          latitude
        );
        const brightness = shade[index];
        const outputIndex = index * 4;
        let red = sample[0] * brightness;
        let green = sample[1] * brightness;
        let blue = sample[2] * brightness;

        if (this.showGraticule && sample[3] > 0) {
          const gridStrength = getGraticuleStrength(
            longitude,
            latitude,
            lineThreshold,
            this.graticuleSpacingRad
          );
          if (gridStrength > 0) {
            const overlayAlpha = 0.78 * gridStrength;
            red += (this.graticuleColor[0] - red) * overlayAlpha;
            green += (this.graticuleColor[1] - green) * overlayAlpha;
            blue += (this.graticuleColor[2] - blue) * overlayAlpha;
          }
        }

        pixels[outputIndex] = red;
        pixels[outputIndex + 1] = green;
        pixels[outputIndex + 2] = blue;
        pixels[outputIndex + 3] = sample[3];
      }

      this.context.putImageData(this.imageData, 0, 0);
    }

    handlePointerDown(event) {
      if (!this.visible) {
        return;
      }

      this.pointerState = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      this.canvas.setPointerCapture(event.pointerId);
    }

    handlePointerMove(event) {
      if (!this.pointerState || event.pointerId !== this.pointerState.pointerId) {
        return;
      }

      const deltaX = event.clientX - this.pointerState.x;
      const deltaY = event.clientY - this.pointerState.y;
      this.pointerState.x = event.clientX;
      this.pointerState.y = event.clientY;
      this.yaw += deltaX * 0.008;
      this.pitch = clamp(this.pitch + deltaY * 0.008, -1.35, 1.35);
      this.needsRender = true;
      this.requestRender();
    }

    handlePointerUp(event) {
      if (!this.pointerState || event.pointerId !== this.pointerState.pointerId) {
        return;
      }

      this.canvas.releasePointerCapture(event.pointerId);
      this.pointerState = null;
      this.needsRender = true;
      this.requestRender();
    }

    handleWheel(event) {
      if (!this.visible) {
        return;
      }

      event.preventDefault();
      this.zoom = clamp(this.zoom - event.deltaY * 0.0012, 0.74, 1.8);
      this.prepareSphereCache();
      this.needsRender = true;
      this.requestRender();
    }

    handleDoubleClick() {
      this.resetView();
    }
  }

  function normalizeVector(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function createTextureSnapshot(source, canvas, context, maxWidth) {
    const targetWidth = Math.min(maxWidth, source.width);
    const targetHeight = Math.max(2, Math.round((targetWidth / source.width) * source.height));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    return {
      data: context.getImageData(0, 0, targetWidth, targetHeight).data,
      width: targetWidth,
      height: targetHeight,
    };
  }

  function getGraticuleStrength(longitude, latitude, threshold, step) {
    const meridianDistance = distanceToAngularGrid(longitude, step);
    const parallelDistance = distanceToAngularGrid(latitude, step);
    const meridianStrength = distanceToLineStrength(meridianDistance, threshold);
    const parallelStrength = distanceToLineStrength(parallelDistance, threshold);
    const primeStrength = distanceToLineStrength(Math.abs(wrapAngle(longitude)), threshold * 1.25);
    const equatorStrength = distanceToLineStrength(Math.abs(latitude), threshold * 1.25);

    return Math.max(meridianStrength, parallelStrength, primeStrength, equatorStrength);
  }

  function distanceToAngularGrid(angle, step) {
    const normalized = ((angle % step) + step) % step;
    return Math.min(normalized, step - normalized);
  }

  function distanceToLineStrength(distance, threshold) {
    if (distance >= threshold || threshold <= 0) {
      return 0;
    }

    return 1 - distance / threshold;
  }

  function wrapAngle(angle) {
    return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  }

  function parseColor(value) {
    if (typeof value !== "string") {
      return [242, 246, 252];
    }

    const match = value.trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) {
      return [242, 246, 252];
    }

    const hex = match[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  function sampleTexture(textureData, width, height, longitude, latitude) {
    const wrappedU = ((longitude / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
    const v = clamp(0.5 - latitude / Math.PI, 0, 1);
    const sampleX = wrappedU * width - 0.5;
    const sampleY = v * height - 0.5;
    const x0 = ((Math.floor(sampleX) % width) + width) % width;
    const x1 = (x0 + 1) % width;
    const yBase = Math.floor(sampleY);
    const y0 = clamp(yBase, 0, height - 1);
    const y1 = clamp(yBase + 1, 0, height - 1);
    const fx = sampleX - Math.floor(sampleX);
    const fy = sampleY - yBase;
    const inverseFx = 1 - fx;
    const inverseFy = 1 - fy;
    const weight00 = inverseFx * inverseFy;
    const weight10 = fx * inverseFy;
    const weight01 = inverseFx * fy;
    const weight11 = fx * fy;
    const index00 = (y0 * width + x0) * 4;
    const index10 = (y0 * width + x1) * 4;
    const index01 = (y1 * width + x0) * 4;
    const index11 = (y1 * width + x1) * 4;

    return [
      textureData[index00] * weight00 +
        textureData[index10] * weight10 +
        textureData[index01] * weight01 +
        textureData[index11] * weight11,
      textureData[index00 + 1] * weight00 +
        textureData[index10 + 1] * weight10 +
        textureData[index01 + 1] * weight01 +
        textureData[index11 + 1] * weight11,
      textureData[index00 + 2] * weight00 +
        textureData[index10 + 2] * weight10 +
        textureData[index01 + 2] * weight01 +
        textureData[index11 + 2] * weight11,
      textureData[index00 + 3] * weight00 +
        textureData[index10 + 3] * weight10 +
        textureData[index01 + 3] * weight01 +
        textureData[index11 + 3] * weight11,
    ];
  }

  globalScope.GlobeRenderer = GlobeRenderer;
})(window);

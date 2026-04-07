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
      this.autoSpin = true;
      this.spinSpeedDeg = 8;
      this.needsRender = false;
      this.pointerState = null;
      this.animationFrame = 0;
      this.lastTimestamp = 0;
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

      const targetWidth = Math.min(
        globalScope.ProjectionCore
          ? globalScope.ProjectionCore.DEFAULTS.globeTextureWidth
          : 2048,
        source.width
      );
      const targetHeight = Math.max(
        2,
        Math.round((targetWidth / source.width) * source.height)
      );
      this.textureCanvas.width = targetWidth;
      this.textureCanvas.height = targetHeight;
      this.textureContext.clearRect(0, 0, targetWidth, targetHeight);
      this.textureContext.drawImage(source, 0, 0, targetWidth, targetHeight);
      this.textureData = this.textureContext.getImageData(0, 0, targetWidth, targetHeight).data;
      this.textureWidth = targetWidth;
      this.textureHeight = targetHeight;
      this.visible = true;
      this.requestRender();
    }

    setAutoSpin(enabled) {
      this.autoSpin = Boolean(enabled);
      this.requestRender();
    }

    setSpinSpeed(speedDeg) {
      this.spinSpeedDeg = Number(speedDeg) || 0;
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

    animate(timestamp) {
      this.animationFrame = 0;
      const deltaSeconds = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 1000 : 0;
      this.lastTimestamp = timestamp;

      if (this.autoSpin && this.visible && !this.pointerState) {
        this.yaw += ((this.spinSpeedDeg * Math.PI) / 180) * deltaSeconds;
        this.needsRender = true;
      }

      if (this.needsRender || this.visible) {
        this.render();
      }

      this.needsRender = false;

      if (this.autoSpin && this.visible) {
        this.requestRender();
      }
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

      const { nx, ny, nz, shade, mask } = this.sphereCache;
      const cosYaw = Math.cos(this.yaw);
      const sinYaw = Math.sin(this.yaw);
      const cosPitch = Math.cos(this.pitch);
      const sinPitch = Math.sin(this.pitch);

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

        pixels[outputIndex] = sample[0] * brightness;
        pixels[outputIndex + 1] = sample[1] * brightness;
        pixels[outputIndex + 2] = sample[2] * brightness;
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
      this.autoSpinDuringDrag = this.autoSpin;
      this.autoSpin = false;
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
      this.autoSpin = this.autoSpinDuringDrag;
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

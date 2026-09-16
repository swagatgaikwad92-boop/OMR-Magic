/**
 * image-processing.js
 * Low-level image utilities used by the OMR pipeline:
 *   grayscale -> marker detection -> homography -> perspective warp
 * No detection results are ever fabricated: if the four corner markers
 * cannot be found with reasonable confidence, `correctPerspective`
 * throws and the caller must ask the teacher to rescan.
 */

const ImageProcessor = (() => {
  /** Converts an ImageData to a plain Float32Array of luminance values. */
  function toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const out = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return { gray: out, width, height };
  }

  function averageBrightness(gray) {
    let sum = 0;
    for (let i = 0; i < gray.length; i++) sum += gray[i];
    return sum / gray.length;
  }

  /** Standard deviation of luminance - low value roughly means low contrast / blur. */
  function contrastScore(gray) {
    const mean = averageBrightness(gray);
    let variance = 0;
    for (let i = 0; i < gray.length; i++) variance += (gray[i] - mean) ** 2;
    return Math.sqrt(variance / gray.length);
  }

  /**
   * Reports scan quality before we try anything expensive. Never blocks
   * scanning, just informs the "scan-quality warning" UI.
   */
  function assessQuality(imageData) {
    const { gray } = toGrayscale(imageData);
    const brightness = averageBrightness(gray);
    const contrast = contrastScore(gray);
    const warnings = [];
    if (brightness < 60) warnings.push('The photo looks dark. Try better lighting.');
    if (brightness > 225) warnings.push('The photo looks washed out. Reduce glare or flash.');
    if (contrast < 25) warnings.push('Low contrast detected. Hold the camera steady and refocus.');
    return { brightness, contrast, warnings, ok: warnings.length === 0 };
  }

  /**
   * Searches one quadrant of the image for the darkest small square blob
   * (an alignment marker). `region` is {x0,y0,x1,y1} in pixel space.
   */
  function findMarkerInRegion(gray, width, height, region) {
    const win = Math.max(14, Math.round(Math.min(width, height) * 0.028));
    const step = Math.max(2, Math.round(win / 3));
    let best = null;

    for (let y = region.y0; y + win < region.y1; y += step) {
      for (let x = region.x0; x + win < region.x1; x += step) {
        let sum = 0;
        for (let wy = 0; wy < win; wy += 2) {
          const row = (y + wy) * width;
          for (let wx = 0; wx < win; wx += 2) {
            sum += gray[row + x + wx];
          }
        }
        const avg = sum / ((win / 2) * (win / 2));
        if (!best || avg < best.avg) best = { x, y, avg };
      }
    }
    if (!best || best.avg > 130) return null; // nothing dark enough to be a marker

    // Refine to the centroid of dark pixels inside the winning window for sub-pixel accuracy.
    const threshold = Math.min(150, best.avg + 40);
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let wy = -2; wy < win + 2; wy++) {
      const py = best.y + wy;
      if (py < 0 || py >= height) continue;
      const row = py * width;
      for (let wx = -2; wx < win + 2; wx++) {
        const px = best.x + wx;
        if (px < 0 || px >= width) continue;
        const v = gray[row + px];
        if (v <= threshold) {
          sx += px;
          sy += py;
          count++;
        }
      }
    }
    if (count < 8) return null;
    return { x: sx / count, y: sy / count, confidence: Math.max(0, Math.min(1, (130 - best.avg) / 130)) };
  }

  /**
   * Looks for all four corner markers within the expected quadrants of
   * the captured photo. Returns null (never guesses) if any is missing.
   */
  function detectMarkers(imageData) {
    const { gray, width, height } = toGrayscale(imageData);
    const midX = width / 2;
    const midY = height / 2;
    const pad = 0.12; // markers should sit within ~12% of each edge

    const quadrants = {
      topLeft: { x0: 0, y0: 0, x1: midX + width * pad, y1: midY + height * pad },
      topRight: { x0: midX - width * pad, y0: 0, x1: width, y1: midY + height * pad },
      bottomLeft: { x0: 0, y0: midY - height * pad, x1: midX + width * pad, y1: height },
      bottomRight: { x0: midX - width * pad, y0: midY - height * pad, x1: width, y1: height },
    };

    const found = {};
    for (const key of Object.keys(quadrants)) {
      const m = findMarkerInRegion(gray, width, height, quadrants[key]);
      if (!m) return null;
      found[key] = m;
    }
    return found;
  }

  /** Solves the 8-DOF homography mapping each `from` point to its `to` point. */
  function computeHomography(fromPts, toPts) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = fromPts[i];
      const { x: u, y: v } = toPts[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
      b.push(v);
    }
    const h = solveLinearSystem(A, b);
    if (!h) return null;
    return h; // [h11,h12,h13,h21,h22,h23,h31,h32]; h33 = 1
  }

  /** Gauss-Jordan elimination for an 8x8 system. Returns null if singular. */
  function solveLinearSystem(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-9) return null;
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const pivotVal = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= pivotVal;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map((row) => row[n]);
  }

  function applyHomography(h, x, y) {
    const denom = h[6] * x + h[7] * y + 1;
    return {
      x: (h[0] * x + h[1] * y + h[2]) / denom,
      y: (h[3] * x + h[4] * y + h[5]) / denom,
    };
  }

  function bilinearSample(imageData, x, y) {
    const { data, width, height } = imageData;
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return null;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const idx = (px, py) => (py * width + px) * 4;
    const out = [0, 0, 0, 255];
    for (let c = 0; c < 3; c++) {
      const v00 = data[idx(x0, y0) + c];
      const v10 = data[idx(x0 + 1, y0) + c];
      const v01 = data[idx(x0, y0 + 1) + c];
      const v11 = data[idx(x0 + 1, y0 + 1) + c];
      out[c] =
        v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
    }
    return out;
  }

  /**
   * Detects the four markers, solves the homography against the
   * canonical SheetLayout corners, and warps the photo into a clean,
   * upright canonical-size canvas ready for bubble sampling.
   * Throws if markers cannot be found - callers must surface that as
   * "couldn't find the sheet, try again", never a silent guess.
   */
  function correctPerspective(imageData) {
    const markers = detectMarkers(imageData);
    if (!markers) {
      const err = new Error('Could not find all four corner markers.');
      err.code = 'NO_MARKERS';
      throw err;
    }

    const canonical = SheetLayout.markerPositions();
    const canonicalByCorner = {
      topLeft: canonical.find((m) => m.corner === 'top-left'),
      topRight: canonical.find((m) => m.corner === 'top-right'),
      bottomLeft: canonical.find((m) => m.corner === 'bottom-left'),
      bottomRight: canonical.find((m) => m.corner === 'bottom-right'),
    };

    // Map canonical (output) coordinates -> captured (input) coordinates,
    // so the warp loop below can sample directly without inverting H.
    const fromCanonical = [
      canonicalByCorner.topLeft,
      canonicalByCorner.topRight,
      canonicalByCorner.bottomLeft,
      canonicalByCorner.bottomRight,
    ];
    const toCaptured = [markers.topLeft, markers.topRight, markers.bottomLeft, markers.bottomRight];

    const h = computeHomography(fromCanonical, toCaptured);
    if (!h) {
      const err = new Error('The sheet corners look degenerate. Try a flatter, more even photo.');
      err.code = 'BAD_HOMOGRAPHY';
      throw err;
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = SheetLayout.WIDTH;
    outCanvas.height = SheetLayout.HEIGHT;
    const outCtx = outCanvas.getContext('2d');
    const outData = outCtx.createImageData(SheetLayout.WIDTH, SheetLayout.HEIGHT);

    for (let oy = 0; oy < SheetLayout.HEIGHT; oy++) {
      for (let ox = 0; ox < SheetLayout.WIDTH; ox++) {
        const src = applyHomography(h, ox, oy);
        const sample = bilinearSample(imageData, src.x, src.y);
        const di = (oy * SheetLayout.WIDTH + ox) * 4;
        if (sample) {
          outData.data[di] = sample[0];
          outData.data[di + 1] = sample[1];
          outData.data[di + 2] = sample[2];
          outData.data[di + 3] = 255;
        } else {
          outData.data[di] = 255;
          outData.data[di + 1] = 255;
          outData.data[di + 2] = 255;
          outData.data[di + 3] = 255;
        }
      }
    }
    outCtx.putImageData(outData, 0, 0);
    const markerConfidence =
      (markers.topLeft.confidence + markers.topRight.confidence + markers.bottomLeft.confidence + markers.bottomRight.confidence) / 4;

    return { canvas: outCanvas, markerConfidence };
  }

  /**
   * Lightweight alignment check used by the live camera preview to drive
   * auto-capture: looks for four dark marker-like blobs near the corners
   * of the current guide-frame crop without doing the full warp.
   */
  function quickAlignmentScore(imageData) {
    try {
      const markers = detectMarkers(imageData);
      if (!markers) return 0;
      return (
        (markers.topLeft.confidence + markers.topRight.confidence + markers.bottomLeft.confidence + markers.bottomRight.confidence) / 4
      );
    } catch (_err) {
      return 0;
    }
  }

  return {
    toGrayscale,
    averageBrightness,
    contrastScore,
    assessQuality,
    detectMarkers,
    computeHomography,
    applyHomography,
    correctPerspective,
    quickAlignmentScore,
  };
})();

/**
 * omr-scanner.js
 * The mark-recognition stage of the pipeline, plus the orchestrator that
 * runs the full sequence:
 *   Image -> Detect sheet -> Correct perspective -> Detect bubbles ->
 *   Analyze marks -> Confidence -> Answers
 *
 * Every answer comes from an actual darkness measurement inside the
 * bubble region. If nothing is dark enough, the question is reported as
 * unanswered; if more than one bubble is dark, it's reported as multiple.
 * Nothing here is randomized or guessed.
 */

const OMRScanner = (() => {
  const FILL_THRESHOLD = 150; // luminance below this counts as "ink"
  const MULTI_MARK_GAP = 18; // if a 2nd-darkest bubble is within this of the darkest, call it "multiple"

  /** Average luminance inside a bubble's circular sampling area. */
  function sampleBubble(gray, width, height, bubble) {
    const r = bubble.r * 0.72; // sample inside the ring, not the ring itself
    let sum = 0;
    let count = 0;
    const minY = Math.max(0, Math.floor(bubble.y - r));
    const maxY = Math.min(height - 1, Math.ceil(bubble.y + r));
    const minX = Math.max(0, Math.floor(bubble.x - r));
    const maxX = Math.min(width - 1, Math.ceil(bubble.x + r));
    for (let y = minY; y <= maxY; y++) {
      const dy = y - bubble.y;
      const row = y * width;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - bubble.x;
        if (dx * dx + dy * dy <= r * r) {
          sum += gray[row + x];
          count++;
        }
      }
    }
    return count ? sum / count : 255;
  }

  /**
   * Analyzes every question in the layout against the corrected canvas.
   * Returns one entry per question: { value, status, confidence, fills }
   *   status: 'answered' | 'blank' | 'multiple'
   */
  function analyzeBubbles(correctedCanvas, layout) {
    const ctx = correctedCanvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, correctedCanvas.width, correctedCanvas.height);
    const { gray, width, height } = ImageProcessor.toGrayscale(imageData);

    return layout.questions.map((q) => {
      const fills = q.options.map((opt) => ({
        label: opt.label,
        darkness: 255 - sampleBubble(gray, width, height, opt),
      }));
      fills.sort((a, b) => b.darkness - a.darkness);

      const darkest = fills[0];
      const second = fills[1] || { darkness: 0 };
      const marked = fills.filter((f) => 255 - f.darkness < FILL_THRESHOLD);

      let status;
      let value = null;
      let confidence;

      if (marked.length === 0) {
        status = 'blank';
        confidence = 1 - darkest.darkness / (255 - FILL_THRESHOLD);
        confidence = Math.max(0, Math.min(1, 1 - confidence));
      } else if (marked.length > 1 && darkest.darkness - second.darkness < MULTI_MARK_GAP) {
        status = 'multiple';
        value = marked.map((f) => f.label).join('/');
        confidence = 0.2;
      } else {
        status = 'answered';
        value = darkest.label;
        const margin = darkest.darkness - second.darkness;
        confidence = Math.max(0.35, Math.min(1, margin / 90));
      }

      return { number: q.number, value, status, confidence: Number(confidence.toFixed(2)), fills };
    });
  }

  /** Simple perceptual hash of the corrected sheet, used for duplicate-scan warnings. */
  function hashCanvas(canvas) {
    const small = document.createElement('canvas');
    small.width = 16;
    small.height = 16;
    small.getContext('2d').drawImage(canvas, 0, 0, 16, 16);
    const data = small.getContext('2d').getImageData(0, 0, 16, 16).data;
    let hash = '';
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      hash += lum > 128 ? '1' : '0';
    }
    return hash;
  }

  /**
   * Runs the full pipeline on a captured photo (an ImageData or a
   * <canvas>/<img> source already drawn to a canvas). `test` supplies
   * optionCount/questionCount so the scanner samples the exact same
   * grid the printed template used.
   */
  async function scan(sourceCanvas, test) {
    const sourceCtx = sourceCanvas.getContext('2d');
    const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

    const quality = ImageProcessor.assessQuality(imageData);
    const { canvas: corrected, markerConfidence } = ImageProcessor.correctPerspective(imageData);
    const layout = SheetLayout.computeLayout(test.answerKey.length, test.optionCount);
    const answers = analyzeBubbles(corrected, layout);
    const sheetHash = hashCanvas(corrected);

    return { answers, quality, markerConfidence, sheetHash, correctedCanvas: corrected };
  }

  return { analyzeBubbles, sampleBubble, hashCanvas, scan, FILL_THRESHOLD };
})();

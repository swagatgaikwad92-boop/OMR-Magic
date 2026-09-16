/**
 * answer-key.js
 * Owns two things:
 *   1. SheetLayout - the deterministic geometry of an OMR Magic answer
 *      sheet (corner markers + bubble grid). image-processing.js warps a
 *      photographed sheet into this exact canvas size, and
 *      omr-scanner.js samples bubbles at these exact coordinates, so the
 *      printed template and the scanner always agree on where every
 *      bubble lives.
 *   2. AnswerKey - helpers for building, validating, and approving the
 *      teacher's answer key before any grading can happen.
 */

const SheetLayout = (() => {
  // Canonical corrected-sheet size (A4 portrait @ ~150dpi).
  const WIDTH = 1240;
  const HEIGHT = 1754;
  const MARGIN = 64;
  const MARKER_SIZE = 36;
  const HEADER_HEIGHT = 190;
  const MAX_COLUMNS = 5;
  const COLUMN_GAP = 24;
  const OPTION_GAP = 34;
  const BUBBLE_RADIUS = 12;
  const LABEL_GUTTER = 54;

  function markerPositions() {
    const half = MARKER_SIZE / 2;
    return [
      { corner: 'top-left', x: MARGIN + half, y: MARGIN + half },
      { corner: 'top-right', x: WIDTH - MARGIN - half, y: MARGIN + half },
      { corner: 'bottom-left', x: MARGIN + half, y: HEIGHT - MARGIN - half },
      { corner: 'bottom-right', x: WIDTH - MARGIN - half, y: HEIGHT - MARGIN - half },
    ];
  }

  /**
   * Lays out `questionCount` questions, each with `optionCount` bubbles,
   * into up to MAX_COLUMNS columns that fill the printable area between
   * the corner markers. Returns absolute pixel centers for every bubble.
   */
  function computeLayout(questionCount, optionCount) {
    const q = Math.max(0, questionCount | 0);
    const opts = Math.max(2, optionCount | 0);
    const contentTop = MARGIN + HEADER_HEIGHT;
    const contentBottom = HEIGHT - MARGIN - MARKER_SIZE - 20;
    const contentLeft = MARGIN + MARKER_SIZE + 20;
    const contentRight = WIDTH - MARGIN - MARKER_SIZE - 20;
    const usableWidth = contentRight - contentLeft;
    const usableHeight = contentBottom - contentTop;

    const columns = q === 0 ? 1 : Math.min(MAX_COLUMNS, Math.ceil(q / 22) || 1);
    const rows = Math.max(1, Math.ceil(q / columns));
    const columnWidth = (usableWidth - COLUMN_GAP * (columns - 1)) / columns;
    const rowHeight = Math.min(52, usableHeight / rows);

    const questions = [];
    for (let i = 0; i < q; i++) {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const colX = contentLeft + col * (columnWidth + COLUMN_GAP);
      const rowY = contentTop + row * rowHeight + rowHeight / 2;
      const bubbleAreaWidth = columnWidth - LABEL_GUTTER;
      const options = [];
      for (let o = 0; o < opts; o++) {
        const spacing = bubbleAreaWidth / opts;
        options.push({
          label: String.fromCharCode(65 + o),
          x: colX + LABEL_GUTTER + spacing * o + spacing / 2,
          y: rowY,
          r: BUBBLE_RADIUS,
        });
      }
      questions.push({ number: i + 1, labelX: colX, labelY: rowY, options });
    }

    return {
      width: WIDTH,
      height: HEIGHT,
      margin: MARGIN,
      markerSize: MARKER_SIZE,
      markers: markerPositions(),
      headerHeight: HEADER_HEIGHT,
      questions,
      columns,
      rows,
    };
  }

  return { WIDTH, HEIGHT, MARGIN, MARKER_SIZE, computeLayout, markerPositions };
})();

const AnswerKey = (() => {
  function blank(questionCount) {
    return QuestionParser.blankAnswerKey(questionCount);
  }

  function isComplete(answerKey) {
    return Array.isArray(answerKey) && answerKey.length > 0 && answerKey.every((a) => !!a);
  }

  function setAnswer(answerKey, index, value) {
    const next = answerKey.slice();
    next[index] = value;
    return next;
  }

  /**
   * Renders the printable answer sheet (header, corner markers, and the
   * full bubble grid) onto a canvas the teacher can download and hand
   * out. Returns the canvas element.
   */
  function renderTemplate({ testName, questionCount, optionCount }) {
    const layout = SheetLayout.computeLayout(questionCount, optionCount);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, layout.width, layout.height);

    // Corner alignment markers
    ctx.fillStyle = '#0b1c22';
    layout.markers.forEach((m) => {
      ctx.fillRect(m.x - layout.markerSize / 2, m.y - layout.markerSize / 2, layout.markerSize, layout.markerSize);
    });

    // Header
    ctx.fillStyle = '#0b1c22';
    ctx.font = '600 34px -apple-system, "SF Pro Display", Segoe UI, sans-serif';
    ctx.fillText('OMR Magic Answer Sheet', layout.margin + layout.markerSize + 30, layout.margin + 56);

    ctx.font = '400 22px -apple-system, "SF Pro Display", Segoe UI, sans-serif';
    ctx.fillText(`Test: ${testName || 'Untitled test'}`, layout.margin + layout.markerSize + 30, layout.margin + 96);

    ctx.strokeStyle = '#0b1c22';
    ctx.lineWidth = 1.4;
    ctx.font = '400 18px -apple-system, "SF Pro Display", Segoe UI, sans-serif';
    const fieldY = layout.margin + 140;
    ctx.fillText('Name:', layout.margin + layout.markerSize + 30, fieldY);
    ctx.beginPath();
    ctx.moveTo(layout.margin + layout.markerSize + 100, fieldY + 4);
    ctx.lineTo(layout.margin + layout.markerSize + 420, fieldY + 4);
    ctx.stroke();

    ctx.fillText('Roll No:', layout.margin + layout.markerSize + 460, fieldY);
    ctx.beginPath();
    ctx.moveTo(layout.margin + layout.markerSize + 550, fieldY + 4);
    ctx.lineTo(layout.margin + layout.markerSize + 780, fieldY + 4);
    ctx.stroke();

    // Bubble grid
    layout.questions.forEach((q) => {
      ctx.fillStyle = '#0b1c22';
      ctx.font = '600 18px -apple-system, "SF Pro Display", Segoe UI, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(q.number), q.labelX, q.labelY);

      q.options.forEach((opt) => {
        ctx.beginPath();
        ctx.arc(opt.x, opt.y, opt.r, 0, Math.PI * 2);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#0b1c22';
        ctx.stroke();
        ctx.font = '500 13px -apple-system, "SF Pro Display", Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(opt.label, opt.x, opt.y);
        ctx.textAlign = 'left';
      });
    });

    ctx.font = '400 14px -apple-system, "SF Pro Display", Segoe UI, sans-serif';
    ctx.fillStyle = '#5b6b70';
    ctx.fillText(
      'Fill each bubble completely with a dark pen or pencil. Keep the four corner squares fully visible when scanning.',
      layout.margin + layout.markerSize + 30,
      layout.height - layout.margin - 12
    );

    return canvas;
  }

  function downloadTemplate({ testName, questionCount, optionCount }) {
    const canvas = renderTemplate({ testName, questionCount, optionCount });
    const link = document.createElement('a');
    link.download = `${(testName || 'omr-magic-sheet').replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return { blank, isComplete, setAnswer, renderTemplate, downloadTemplate };
})();

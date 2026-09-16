/**
 * app.js
 * Screen routing and UI glue. Talks to the pipeline modules
 * (image-processing, omr-scanner, grading, answer-key, question-parser)
 * and to storage. Holds only transient UI state; persisted state lives
 * in OMRStorage.
 */

(() => {
  const screens = Array.from(document.querySelectorAll('.screen'));
  const history = ['home'];

  const state = {
    draftTest: null, // test being set up (before or during answer-key editing)
    activeTestId: null, // test currently being scanned against
    lastScan: null, // { answers, quality, markerConfidence, sheetHash, correctedCanvas }
    lastGraded: null, // graded result before saving
    lastStudent: { name: '', roll: '' },
    pendingResultId: null,
    cameraStream: null,
    alignTimer: null,
    autoCaptureArmed: false,
  };

  // ---------- Screen routing ----------
  function showScreen(name, { push = true } = {}) {
    screens.forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    if (push && history[history.length - 1] !== name) history.push(name);
    if (name !== 'scanner') stopCamera();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function goBack() {
    if (history.length > 1) history.pop();
    const target = history[history.length - 1] || 'home';
    showScreen(target, { push: false });
    if (target === 'home') renderHome();
  }

  document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', goBack));

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    el.classList.add('toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('toast-visible');
      setTimeout(() => (el.hidden = true), 250);
    }, 2600);
  }

  // ================= HOME =================
  function renderHome() {
    const list = document.getElementById('test-list');
    const empty = document.getElementById('test-list-empty');
    const tests = OMRStorage.listTests();
    list.innerHTML = '';
    empty.hidden = tests.length > 0;

    tests.forEach((test) => {
      const row = document.createElement('button');
      row.className = 'test-row glass-panel';
      const date = new Date(test.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      row.innerHTML = `
        <div class="test-row-main">
          <p class="test-row-name">${escapeHtml(test.name)}</p>
          <p class="test-row-meta">${test.answerKey.length} questions · ${test.results.length} checked · ${date}</p>
        </div>
        <span class="test-row-chevron">›</span>
      `;
      row.addEventListener('click', () => openTestDetail(test.id));
      list.appendChild(row);
    });
  }

  document.getElementById('btn-start-test').addEventListener('click', () => {
    document.getElementById('input-test-name').value = '';
    document.getElementById('input-question-count').value = 10;
    document.getElementById('input-option-count').value = '4';
    document.getElementById('input-marks').value = 1;
    document.getElementById('input-negative').value = 0;
    showScreen('new-test');
  });

  // ================= NEW TEST =================
  document.getElementById('btn-create-test').addEventListener('click', () => {
    const name = document.getElementById('input-test-name').value.trim() || 'Untitled test';
    const questionCount = clampInt(document.getElementById('input-question-count').value, 1, 120, 10);
    const optionCount = clampInt(document.getElementById('input-option-count').value, 2, 6, 4);
    const marksPerQuestion = Number(document.getElementById('input-marks').value) || 1;
    const negativeMarking = Number(document.getElementById('input-negative').value) || 0;

    const test = OMRStorage.createTest({ name, optionCount, marksPerQuestion, negativeMarking });
    OMRStorage.updateTest(test.id, { answerKey: AnswerKey.blank(questionCount) });
    state.activeTestId = test.id;
    openAnswerKeyEditor(test.id);
  });

  function clampInt(val, min, max, fallback) {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ================= ANSWER KEY =================
  function openAnswerKeyEditor(testId) {
    state.activeTestId = testId;
    const test = OMRStorage.getTest(testId);
    document.getElementById('answerkey-title').textContent = test.name;
    document.getElementById('question-paper-name').textContent = '';
    renderAnswerKeyList(test);
    showScreen('answerkey');
  }

  function renderAnswerKeyList(test) {
    const container = document.getElementById('answerkey-list');
    container.innerHTML = '';
    const optionLabels = Array.from({ length: test.optionCount }, (_, i) => String.fromCharCode(65 + i));

    test.answerKey.forEach((answer, index) => {
      const row = document.createElement('div');
      row.className = 'key-row glass-panel';
      const optionsHtml = optionLabels
        .map(
          (label) =>
            `<button type="button" class="option-chip ${answer === label ? 'selected' : ''}" data-index="${index}" data-label="${label}">${label}</button>`
        )
        .join('');
      row.innerHTML = `<span class="key-row-number">Q${index + 1}</span><div class="option-chip-row">${optionsHtml}</div>`;
      container.appendChild(row);
    });

    container.querySelectorAll('.option-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const idx = Number(chip.dataset.index);
        const label = chip.dataset.label;
        const t = OMRStorage.getTest(state.activeTestId);
        const current = t.answerKey[idx];
        const nextValue = current === label ? null : label;
        const nextKey = AnswerKey.setAnswer(t.answerKey, idx, nextValue);
        OMRStorage.updateTest(state.activeTestId, { answerKey: nextKey });
        renderAnswerKeyList(OMRStorage.getTest(state.activeTestId));
        updateKeyProgress();
      });
    });

    updateKeyProgress();
  }

  function updateKeyProgress() {
    const test = OMRStorage.getTest(state.activeTestId);
    if (!test) return;
    const filled = test.answerKey.filter(Boolean).length;
    document.getElementById('key-progress').textContent = `${filled} / ${test.answerKey.length}`;
    document.getElementById('btn-approve-key').disabled = !AnswerKey.isComplete(test.answerKey);
  }

  document.getElementById('input-question-paper').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!QuestionParser.isAccepted(file)) {
      showToast('Please upload a PNG, JPG, WEBP, or PDF.');
      return;
    }
    document.getElementById('question-paper-name').textContent = file.name;
    document.getElementById('parser-hint').textContent =
      'Uploaded. AI answer suggestions are coming in a future update — approve every answer manually below.';
    // Reserved for a future AI question-parsing backend; always null today.
    await QuestionParser.proposeAnswerKey(file, OMRStorage.getTest(state.activeTestId)?.answerKey.length || 0);
  });

  document.getElementById('btn-download-template').addEventListener('click', () => {
    const test = OMRStorage.getTest(state.activeTestId);
    if (!test) return;
    AnswerKey.downloadTemplate({
      testName: test.name,
      questionCount: test.answerKey.length,
      optionCount: test.optionCount,
    });
  });

  document.getElementById('btn-approve-key').addEventListener('click', () => {
    const test = OMRStorage.getTest(state.activeTestId);
    if (!AnswerKey.isComplete(test.answerKey)) {
      showToast('Fill in every answer before approving.');
      return;
    }
    OMRStorage.updateTest(state.activeTestId, { keyApproved: true });
    showToast('Answer key approved.');
    openScanner(state.activeTestId);
  });

  // ================= SCANNER =================
  function openScanner(testId) {
    state.activeTestId = testId;
    document.getElementById('input-student-name').value = '';
    document.getElementById('input-student-roll').value = '';
    document.getElementById('scan-quality-banner').hidden = true;
    showScreen('scanner');
    startCamera();
  }

  async function startCamera() {
    const video = document.getElementById('camera-feed');
    const fallback = document.getElementById('camera-fallback');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      state.cameraStream = stream;
      video.srcObject = stream;
      fallback.classList.remove('visible');
      state.autoCaptureArmed = true;
      runAlignmentLoop();
    } catch (err) {
      console.warn('Camera unavailable, falling back to file upload.', err);
      fallback.classList.add('visible');
      state.autoCaptureArmed = false;
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((t) => t.stop());
      state.cameraStream = null;
    }
    clearTimeout(state.alignTimer);
    state.autoCaptureArmed = false;
  }

  let consecutiveAligned = 0;
  function runAlignmentLoop() {
    if (!state.autoCaptureArmed) return;
    const video = document.getElementById('camera-feed');
    const meter = document.getElementById('align-meter-fill');
    if (video.readyState >= 2 && video.videoWidth) {
      const probe = document.createElement('canvas');
      probe.width = 260;
      probe.height = Math.round((260 * video.videoHeight) / video.videoWidth);
      probe.getContext('2d').drawImage(video, 0, 0, probe.width, probe.height);
      const data = probe.getContext('2d').getImageData(0, 0, probe.width, probe.height);
      const score = ImageProcessor.quickAlignmentScore(data);
      meter.style.width = `${Math.round(score * 100)}%`;
      meter.classList.toggle('align-good', score > 0.55);

      if (score > 0.55) {
        consecutiveAligned++;
        if (consecutiveAligned >= 6) {
          consecutiveAligned = 0;
          captureFromVideo();
          return;
        }
      } else {
        consecutiveAligned = 0;
      }
    }
    state.alignTimer = setTimeout(runAlignmentLoop, 220);
  }

  function captureFromVideo() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('capture-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    handleCapturedCanvas(canvas);
  }

  document.getElementById('btn-capture').addEventListener('click', () => {
    if (!state.cameraStream) {
      showToast('Camera is off — choose a photo instead.');
      return;
    }
    captureFromVideo();
  });

  document.getElementById('input-choose-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('capture-canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      handleCapturedCanvas(canvas);
    };
    img.src = URL.createObjectURL(file);
  });

  async function handleCapturedCanvas(canvas) {
    stopCamera();
    state.lastStudent = {
      name: document.getElementById('input-student-name').value.trim(),
      roll: document.getElementById('input-student-roll').value.trim(),
    };

    const test = OMRStorage.getTest(state.activeTestId);
    const banner = document.getElementById('scan-quality-banner');

    try {
      const scan = await OMRScanner.scan(canvas, test);
      state.lastScan = scan;

      if (scan.quality.warnings.length) {
        banner.hidden = false;
        banner.className = 'quality-banner warning';
        banner.textContent = scan.quality.warnings.join(' ');
      } else {
        banner.hidden = true;
      }

      runLiveCheck(test, scan);
    } catch (err) {
      console.error(err);
      banner.hidden = false;
      banner.className = 'quality-banner error';
      banner.textContent =
        err.code === 'NO_MARKERS'
          ? "Couldn't find all four corner markers. Keep the whole sheet in frame and try again."
          : 'Could not read this sheet. Try a flatter, better-lit photo.';
      startCamera();
    }
  }

  // ================= LIVE CHECK =================
  function runLiveCheck(test, scan) {
    showScreen('livecheck');
    const graded = GradingEngine.grade(scan.answers, test.answerKey, test);
    state.lastGraded = graded;

    const list = document.getElementById('live-check-list');
    list.innerHTML = '';
    document.getElementById('live-progress-total').textContent = graded.detail.length;
    document.getElementById('live-progress-current').textContent = '0';
    document.getElementById('live-progress-fill').style.width = '0%';

    let i = 0;
    const revealNext = () => {
      if (i >= graded.detail.length) {
        setTimeout(() => finishLiveCheck(test, scan, graded), 350);
        return;
      }
      const d = graded.detail[i];
      const row = document.createElement('div');
      row.className = `live-row live-row-${d.outcome}`;
      row.innerHTML = `<span class="live-q">Q${d.number}</span><span class="live-answer">${d.given || '—'}</span><span class="live-mark">${outcomeSymbol(d.outcome)}</span>`;
      list.appendChild(row);
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      i++;
      document.getElementById('live-progress-current').textContent = i;
      document.getElementById('live-progress-fill').style.width = `${(i / graded.detail.length) * 100}%`;
      setTimeout(revealNext, 55 + Math.random() * 45);
    };
    revealNext();
  }

  function outcomeSymbol(outcome) {
    if (outcome === 'correct') return '✓';
    if (outcome === 'wrong') return '✕';
    if (outcome === 'unanswered') return '—';
    return '?';
  }

  function finishLiveCheck(test, scan, graded) {
    const duplicate = OMRStorage.findDuplicate(test.id, scan.sheetHash);
    const result = {
      studentName: state.lastStudent.name,
      studentRoll: state.lastStudent.roll,
      answers: graded.detail.map((d) => ({ value: d.given, status: d.outcome, confidence: d.confidence })),
      correct: graded.correct,
      wrong: graded.wrong,
      unanswered: graded.unanswered,
      unclear: graded.unclear,
      score: graded.score,
      maxScore: graded.maxScore,
      percentage: graded.percentage,
      sheetHash: scan.sheetHash,
    };

    if (duplicate) {
      const saved = OMRStorage.addResult(test.id, result);
      state.pendingResultId = saved.id;
      openResult(test.id, saved.id, graded, {
        duplicateOf: duplicate.studentName || duplicate.studentRoll || 'a previous scan',
      });
    } else {
      const saved = OMRStorage.addResult(test.id, result);
      state.pendingResultId = saved.id;
      openResult(test.id, saved.id, graded, null);
    }
  }

  // ================= RESULT =================
  function openResult(testId, resultId, graded, duplicateInfo) {
    state.activeTestId = testId;
    const test = OMRStorage.getTest(testId);
    const result = test.results.find((r) => r.id === resultId);

    document.getElementById('result-score').textContent = `${result.score} / ${result.maxScore}`;
    document.getElementById('result-percentage').textContent = `${result.percentage}%`;
    document.getElementById('stat-correct').textContent = result.correct;
    document.getElementById('stat-wrong').textContent = result.wrong;
    document.getElementById('stat-unclear').textContent = result.unclear + result.unanswered;

    const dupBanner = document.getElementById('duplicate-banner');
    if (duplicateInfo) {
      dupBanner.hidden = false;
      dupBanner.className = 'quality-banner warning';
      dupBanner.textContent = `This sheet looks very similar to one already scanned (${escapeHtml(duplicateInfo.duplicateOf)}). Double-check it isn't a duplicate.`;
    } else {
      dupBanner.hidden = true;
    }

    renderResultList('result-list', test, result, true);
    showScreen('result');
  }

  function renderResultList(containerId, test, result, editable) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const optionLabels = Array.from({ length: test.optionCount }, (_, i) => String.fromCharCode(65 + i));

    result.answers.forEach((a, index) => {
      const correctAnswer = test.answerKey[index];
      const row = document.createElement('div');
      row.className = `result-row glass-panel result-row-${a.status}`;
      const givenLabel = a.value || '—';
      const showCorrection = a.status !== 'correct';
      row.innerHTML = `
        <div class="result-row-main">
          <span class="result-q">Q${index + 1}</span>
          <span class="result-given">${escapeHtml(givenLabel)}</span>
          <span class="result-symbol">${outcomeSymbol(a.status)}</span>
          ${showCorrection ? `<span class="result-correct-hint">Correct: ${escapeHtml(correctAnswer || '—')}</span>` : ''}
        </div>
        ${editable && showCorrection ? `<div class="result-correct-row" data-index="${index}">${optionLabels
          .map((l) => `<button type="button" class="option-chip small" data-label="${l}">${l}</button>`)
          .join('')}<button type="button" class="option-chip small ghost" data-label="">Blank</button></div>` : ''}
      `;
      container.appendChild(row);
    });

    if (editable) {
      container.querySelectorAll('.result-correct-row').forEach((rowEl) => {
        rowEl.querySelectorAll('.option-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            const index = Number(rowEl.dataset.index);
            const label = chip.dataset.label || null;
            correctAnswer(test.id, result.id, index, label);
          });
        });
      });
    }
  }

  function correctAnswer(testId, resultId, index, newValue) {
    const test = OMRStorage.getTest(testId);
    const result = test.results.find((r) => r.id === resultId);
    const pseudoGraded = {
      detail: result.answers.map((a, i) => ({
        number: i + 1,
        given: a.value,
        outcome: a.status,
        confidence: a.confidence,
      })),
    };
    const corrected = GradingEngine.applyCorrection(pseudoGraded, index, newValue, test.answerKey, test);
    const updatedResult = {
      ...result,
      answers: corrected.detail.map((d) => ({ value: d.given, status: d.outcome, confidence: d.confidence })),
      correct: corrected.correct,
      wrong: corrected.wrong,
      unanswered: corrected.unanswered,
      unclear: corrected.unclear,
      score: corrected.score,
      maxScore: corrected.maxScore,
      percentage: corrected.percentage,
    };
    const idx = test.results.findIndex((r) => r.id === resultId);
    test.results[idx] = updatedResult;
    OMRStorage.updateTest(testId, { results: test.results });
    showToast('Answer corrected.');
    openResult(testId, resultId, corrected, null);
  }

  document.getElementById('btn-scan-another').addEventListener('click', () => {
    openScanner(state.activeTestId);
  });

  document.getElementById('btn-new-test').addEventListener('click', () => {
    document.getElementById('input-test-name').value = '';
    showScreen('new-test');
  });

  // ================= TEST DETAIL =================
  function openTestDetail(testId) {
    state.activeTestId = testId;
    const test = OMRStorage.getTest(testId);
    document.getElementById('test-detail-title').textContent = test.name;
    const summary = document.getElementById('test-detail-summary');
    const avg = test.results.length
      ? Math.round((test.results.reduce((s, r) => s + r.percentage, 0) / test.results.length) * 10) / 10
      : 0;
    summary.innerHTML = `
      <p class="test-detail-line"><strong>${test.answerKey.length}</strong> questions · <strong>${test.optionCount}</strong> options · ${test.marksPerQuestion} mark(s) each${test.negativeMarking ? `, −${test.negativeMarking} for wrong` : ''}</p>
      <p class="test-detail-line">${test.results.length} sheet(s) checked${test.results.length ? ` · class average ${avg}%` : ''}</p>
      <p class="test-detail-line ${test.keyApproved ? 'ok' : 'warn'}">${test.keyApproved ? 'Answer key approved' : 'Answer key not yet approved'}</p>
    `;

    const list = document.getElementById('test-detail-results');
    list.innerHTML = '';
    if (!test.results.length) {
      list.innerHTML = '<p class="empty-hint">No sheets checked yet for this test.</p>';
    }
    test.results
      .slice()
      .reverse()
      .forEach((r) => {
        const row = document.createElement('button');
        row.className = 'test-row glass-panel';
        const who = r.studentName || r.studentRoll ? `${r.studentName || ''} ${r.studentRoll ? `#${r.studentRoll}` : ''}`.trim() : 'Unnamed sheet';
        row.innerHTML = `
          <div class="test-row-main">
            <p class="test-row-name">${escapeHtml(who)}</p>
            <p class="test-row-meta">${r.score} / ${r.maxScore} · ${r.percentage}%</p>
          </div>
          <span class="test-row-chevron">›</span>
        `;
        row.addEventListener('click', () => {
          openResult(test.id, r.id, { detail: [] }, null);
        });
        list.appendChild(row);
      });

    showScreen('test-detail');
  }

  document.getElementById('btn-detail-scan').addEventListener('click', () => openScanner(state.activeTestId));
  document.getElementById('btn-detail-template').addEventListener('click', () => {
    const test = OMRStorage.getTest(state.activeTestId);
    AnswerKey.downloadTemplate({ testName: test.name, questionCount: test.answerKey.length, optionCount: test.optionCount });
  });

  // ---------- utils ----------
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- init ----------
  renderHome();
  showScreen('home', { push: false });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('SW registration failed', err));
    });
  }
})();

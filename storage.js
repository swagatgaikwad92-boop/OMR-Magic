/**
 * storage.js
 * Thin wrapper around localStorage. Owns the on-device data model for
 * OMR Magic: tests, answer keys, and per-student results.
 *
 * Data shape
 * ----------
 * Test {
 *   id, name, createdAt,
 *   optionCount,            // e.g. 4 -> A B C D
 *   marksPerQuestion,       // positive marks for a correct answer
 *   negativeMarking,        // marks deducted for a wrong answer (>=0)
 *   answerKey: [ 'A', 'C', ... ] | null   // null until approved
 *   keyApproved: boolean,
 *   results: [ Result ]
 * }
 *
 * Result {
 *   id, testId, capturedAt,
 *   studentName, studentRoll,
 *   answers: [ { value, status, confidence } ],  // status: correct|wrong|unanswered|unclear
 *   correct, wrong, unanswered, unclear,
 *   score, maxScore, percentage,
 *   sheetHash        // used for duplicate-sheet detection
 * }
 */

const OMRStorage = (() => {
  const TESTS_KEY = 'omrmagic.tests.v1';

  function _readAll() {
    try {
      const raw = localStorage.getItem(TESTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('OMRStorage: failed to read tests', err);
      return [];
    }
  }

  function _writeAll(tests) {
    try {
      localStorage.setItem(TESTS_KEY, JSON.stringify(tests));
      return true;
    } catch (err) {
      console.error('OMRStorage: failed to persist tests', err);
      return false;
    }
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function listTests() {
    return _readAll().sort((a, b) => b.createdAt - a.createdAt);
  }

  function getTest(testId) {
    return _readAll().find((t) => t.id === testId) || null;
  }

  function createTest({ name, optionCount = 4, marksPerQuestion = 1, negativeMarking = 0 }) {
    const tests = _readAll();
    const test = {
      id: uid('test'),
      name: name || 'Untitled test',
      createdAt: Date.now(),
      optionCount,
      marksPerQuestion,
      negativeMarking,
      answerKey: [],
      keyApproved: false,
      results: [],
    };
    tests.push(test);
    _writeAll(tests);
    return test;
  }

  function updateTest(testId, patch) {
    const tests = _readAll();
    const idx = tests.findIndex((t) => t.id === testId);
    if (idx === -1) return null;
    tests[idx] = { ...tests[idx], ...patch };
    _writeAll(tests);
    return tests[idx];
  }

  function deleteTest(testId) {
    const tests = _readAll().filter((t) => t.id !== testId);
    _writeAll(tests);
  }

  function addResult(testId, result) {
    const tests = _readAll();
    const test = tests.find((t) => t.id === testId);
    if (!test) return null;
    const withId = { ...result, id: uid('res'), testId, capturedAt: Date.now() };
    test.results.push(withId);
    _writeAll(tests);
    return withId;
  }

  function findDuplicate(testId, sheetHash) {
    const test = getTest(testId);
    if (!test || !sheetHash) return null;
    return test.results.find((r) => r.sheetHash === sheetHash) || null;
  }

  return {
    listTests,
    getTest,
    createTest,
    updateTest,
    deleteTest,
    addResult,
    findDuplicate,
    uid,
  };
})();

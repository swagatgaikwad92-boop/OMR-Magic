/**
 * question-parser.js
 * Reads an uploaded question-paper file (image or PDF) and prepares an
 * empty answer key sized to the teacher's chosen question/option count.
 *
 * IMPORTANT: There is no on-device OCR/AI model in this build, so the
 * parser never invents answers. It is a real, working module for
 * ingesting and previewing the question paper, structured so an AI
 * question-parsing backend can be dropped in later behind the same
 * `QuestionParser.proposeAnswerKey()` call. Until then it always
 * returns `null`, and the UI is expected to fall back to manual entry.
 */

const QuestionParser = (() => {
  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

  function isAccepted(file) {
    return !!file && ACCEPTED_TYPES.includes(file.type);
  }

  /** Reads a file into a data URL for on-screen preview. */
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!isAccepted(file)) {
        reject(new Error('Unsupported file type. Upload a PNG, JPG, WEBP, or PDF.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Placeholder for a future AI-backed proposal step. Returns `null` today
   * so the caller always falls through to manual entry rather than ever
   * showing a fabricated answer.
   */
  async function proposeAnswerKey(_file, _questionCount) {
    return null;
  }

  /** Builds an empty, teacher-editable answer key of the given size. */
  function blankAnswerKey(questionCount) {
    return new Array(Math.max(0, questionCount)).fill(null);
  }

  return { ACCEPTED_TYPES, isAccepted, readAsDataURL, proposeAnswerKey, blankAnswerKey };
})();

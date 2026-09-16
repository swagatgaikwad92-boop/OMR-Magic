/**
 * grading.js
 * Pure functions that turn a scanned answer set + an approved answer key
 * into a graded result. No UI, no storage - easy to unit test.
 */

const GradingEngine = (() => {
  /**
   * @param {Array<{value:string|null,status:string,confidence:number}>} scanned
   * @param {Array<string>} answerKey
   * @param {{marksPerQuestion:number, negativeMarking:number}} settings
   */
  function grade(scanned, answerKey, settings) {
    const marksPerQuestion = settings.marksPerQuestion ?? 1;
    const negativeMarking = settings.negativeMarking ?? 0;

    let correct = 0;
    let wrong = 0;
    let unanswered = 0;
    let unclear = 0;
    let score = 0;

    const detail = scanned.map((entry, i) => {
      const keyAnswer = answerKey[i];
      let outcome;

      if (entry.status === 'blank') {
        outcome = 'unanswered';
        unanswered++;
      } else if (entry.status === 'multiple' || entry.confidence < 0.4) {
        outcome = 'unclear';
        unclear++;
      } else if (entry.value === keyAnswer) {
        outcome = 'correct';
        correct++;
        score += marksPerQuestion;
      } else {
        outcome = 'wrong';
        wrong++;
        score -= negativeMarking;
      }

      return {
        number: entry.number,
        given: entry.value,
        correctAnswer: keyAnswer,
        outcome,
        confidence: entry.confidence,
      };
    });

    const maxScore = answerKey.length * marksPerQuestion;
    score = Math.max(0, Number(score.toFixed(2)));
    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;

    return {
      detail,
      correct,
      wrong,
      unanswered,
      unclear,
      score,
      maxScore,
      percentage,
    };
  }

  /**
   * Applies a teacher's manual correction to a single question after
   * review (used in the "unclear" correction flow) and re-grades.
   */
  function applyCorrection(gradedResult, questionIndex, newValue, answerKey, settings) {
    const scannedLike = gradedResult.detail.map((d, i) =>
      i === questionIndex
        ? { number: d.number, value: newValue, status: newValue ? 'answered' : 'blank', confidence: 1 }
        : { number: d.number, value: d.given, status: d.outcome === 'unanswered' ? 'blank' : d.outcome === 'unclear' ? 'multiple' : 'answered', confidence: d.confidence }
    );
    return grade(scannedLike, answerKey, settings);
  }

  return { grade, applyCorrection };
})();

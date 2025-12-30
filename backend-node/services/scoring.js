const { Answer, Score, TestAttempt, Question, Section } = require('../models');

async function calculateRawScores(testAttemptId) {
  const testAttempt = await TestAttempt.findByPk(testAttemptId);
  if (!testAttempt) {
    throw new Error('Test attempt not found');
  }

  const answers = await Answer.findAll({
    where: { test_attempt_id: testAttemptId },
    include: [{ model: Question, as: 'question' }]
  });

  if (!answers || answers.length === 0) {
    return [];
  }

  // Group answers by category/dimension
  const dimensionScores = {};

  for (const answer of answers) {
    const question = answer.question;
    if (!question) continue;

    let dimension;
    if (question.section_id) {
      const section = await Section.findByPk(question.section_id);
      if (section) {
        dimension = `section_${section.order_index}`;
      } else {
        dimension = question.category || `section_unknown_${question.section_id}`;
      }
    } else {
      dimension = question.category || 'general';
    }

    if (!dimension.startsWith('section_') && question.category) {
      dimension = question.category;
    }

    if (!dimensionScores[dimension]) {
      dimensionScores[dimension] = {
        total: 0,
        count: 0,
        values: []
      };
    }

    // Parse answer value based on question type
    // Likert scale mapping: A=1, B=2, C=3, D=4, E=5
    const answerTextUpper = answer.answer_text.trim().toUpperCase();
    const likertMap = { A: 1, B: 2, C: 3, D: 4, E: 5 };

    let value;
    if (question.question_type === 'LIKERT_SCALE') {
      if (likertMap[answerTextUpper] !== undefined) {
        value = parseFloat(likertMap[answerTextUpper]);
      } else {
        console.log(`⚠️ Invalid Likert answer '${answer.answer_text}' for question ${question.id}, defaulting to 3 (C)`);
        value = 3.0;
      }
    } else if (question.question_type === 'MULTIPLE_CHOICE') {
      if (likertMap[answerTextUpper] !== undefined) {
        value = parseFloat(likertMap[answerTextUpper]);
      } else {
        try {
          value = parseFloat(answer.answer_text);
        } catch (e) {
          console.log(`⚠️ Invalid MCQ answer '${answer.answer_text}' for question ${question.id}, defaulting to 0`);
          value = 0.0;
        }
      }
    } else {
      value = 0.0;
    }

    dimensionScores[dimension].total += value;
    dimensionScores[dimension].count += 1;
    dimensionScores[dimension].values.push(value);
  }

  // Calculate scores for each dimension
  const scoresToStore = [];
  let totalAllScores = 0.0;
  let totalAllCount = 0;

  // Delete existing scores first
  await Score.destroy({ where: { test_attempt_id: testAttemptId } });

  for (const [dimension, data] of Object.entries(dimensionScores)) {
    if (data.count > 0) {
      const rawScore = data.total / data.count;

      await Score.create({
        test_attempt_id: testAttemptId,
        dimension: dimension,
        score_value: rawScore,
        percentile: null
      });

      scoresToStore.push({
        dimension: dimension,
        score_value: rawScore,
        count: data.count
      });

      totalAllScores += data.total;
      totalAllCount += data.count;
    }
  }

  // Calculate overall score (convert 1-5 average to 0-100 percentage)
  // IMPORTANT: This is the SINGLE source of truth for overall_percentage calculation
  if (totalAllCount > 0) {
    const averageScore = totalAllScores / totalAllCount;
    let overallScore = ((averageScore - 1) / 4) * 100.0; // Convert 1-5 scale to 0-100%
    overallScore = Math.min(100.0, Math.max(0.0, overallScore)); // Clamp to valid range

    const existingOverall = await Score.findOne({
      where: {
        test_attempt_id: testAttemptId,
        dimension: 'overall'
      }
    });

    if (existingOverall) {
      existingOverall.score_value = overallScore;
      await existingOverall.save();
    } else {
      await Score.create({
        test_attempt_id: testAttemptId,
        dimension: 'overall',
        score_value: overallScore,
        percentile: null
      });
    }

    scoresToStore.push({
      dimension: 'overall',
      score_value: overallScore,
      count: totalAllCount
    });
  }

  return scoresToStore;
}

async function storeScores(testAttemptId) {
  try {
    await calculateRawScores(testAttemptId);
    return true;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  calculateRawScores,
  storeScores
};


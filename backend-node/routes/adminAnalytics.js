const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const { User, UserRole, TestAttempt, TestStatus, Score, Career } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');

function calculateReadinessStatus(percentage) {
  if (percentage >= 80) {
    return 'READY';
  } else if (percentage >= 60) {
    return 'PARTIALLY READY';
  } else {
    return 'NOT READY';
  }
}

// GET /admin/analytics
router.get('', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    // Count users by role
    const totalStudents = await User.count({ where: { role: UserRole.STUDENT } });
    const totalCounsellors = await User.count({ where: { role: UserRole.COUNSELLOR } });

    // Count test attempts
    const totalAttempts = await TestAttempt.count();
    const completedAttempts = await TestAttempt.count({
      where: { status: TestStatus.COMPLETED }
    });

    // Calculate average score
    const avgScoreResult = await Score.findOne({
      where: { dimension: 'overall' },
      attributes: [[Sequelize.fn('AVG', Sequelize.col('score_value')), 'avg']],
      raw: true
    });

    const averageScore = avgScoreResult && avgScoreResult.avg ? parseFloat(avgScoreResult.avg) : 0.0;

    // Calculate readiness distribution from scores
    const readinessDistribution = {
      'READY': 0,
      'PARTIALLY READY': 0,
      'NOT READY': 0
    };

    // Get all completed test attempts with scores
    const completedAttemptsList = await TestAttempt.findAll({
      where: { status: TestStatus.COMPLETED }
    });

    for (const attempt of completedAttemptsList) {
      const score = await Score.findOne({
        where: {
          test_attempt_id: attempt.id,
          dimension: 'overall'
        }
      });

      if (score) {
        const readinessStatus = calculateReadinessStatus(score.score_value);
        readinessDistribution[readinessStatus] = (readinessDistribution[readinessStatus] || 0) + 1;
      }
    }

    // Get career cluster distribution from Career model
    const careerClusterDistribution = {};
    const careers = await Career.findAll();

    for (const career of careers) {
      // Use category if available, otherwise use career_name
      const clusterName = career.category || career.career_name || 'Other';
      careerClusterDistribution[clusterName] = (careerClusterDistribution[clusterName] || 0) + 1;
    }

    return res.json({
      total_students: totalStudents,
      total_counsellors: totalCounsellors,
      total_attempts: totalAttempts,
      completed_attempts: completedAttempts,
      average_score: Math.round(averageScore * 100) / 100,
      readiness_distribution: readinessDistribution,
      career_cluster_distribution: careerClusterDistribution
    });
  } catch (error) {
    console.error(`❌ Error in get_analytics: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get analytics'
    });
  }
});

module.exports = router;


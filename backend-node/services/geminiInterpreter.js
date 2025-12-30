const { Score, InterpretedResult, Section } = require('../models');
const { generateInterpretation } = require('./geminiService');

function calculateReadinessStatus(percentage) {
  if (percentage < 40) {
    return [
      'NOT READY',
      'The student is currently in an exploration stage. This means it is too early to finalize a career decision.'
    ];
  } else if (percentage < 60) {
    return [
      'PARTIALLY READY',
      'The student has begun developing career-related strengths but needs further clarity before committing.'
    ];
  } else {
    return [
      'READY',
      'The student shows sufficient clarity and readiness to start planning a career direction.'
    ];
  }
}

function calculateRiskLevel(readinessStatus) {
  if (readinessStatus === 'NOT READY') {
    return [
      'HIGH',
      'Making a career decision at this stage may increase the chances of course changes or loss of interest later. This is decision risk, not failure risk - it means the student needs more time to explore before committing.'
    ];
  } else if (readinessStatus === 'PARTIALLY READY') {
    return [
      'MEDIUM',
      'With guidance and preparation, career decisions can become more reliable over time. Early career locking may cause dissatisfaction if interests change. This is decision risk, not failure risk - it means the student should continue exploring before finalizing.'
    ];
  } else {
    return [
      'LOW',
      'The student is well prepared to make informed career decisions. This is decision risk, not failure risk - it means the student has developed sufficient clarity to explore career options with confidence.'
    ];
  }
}

function determineCareerDirection(sectionScores, sections, overallPercentage = 0.0) {
  if (!sectionScores || Object.keys(sectionScores).length === 0) {
    return [
      'Multi-domain Exploration',
      'The assessment shows balanced performance across areas. It\'s recommended to explore multiple career domains before specializing.'
    ];
  }

  const sectionNames = {
    1: 'Logical Reasoning',
    2: 'Numerical Ability',
    3: 'Verbal Ability',
    4: 'Learning Style',
    5: 'Interest Areas'
  };

  const sectionPercentages = {};
  for (const [dim, score] of Object.entries(sectionScores)) {
    if (dim.startsWith('section_')) {
      try {
        const sectionNum = parseInt(dim.split('_')[1], 10);
        sectionPercentages[sectionNum] = score;
      } catch (e) {
        continue;
      }
    }
  }

  if (Object.keys(sectionPercentages).length === 0) {
    return [
      'Multi-domain Exploration',
      'The assessment shows balanced performance across areas. It\'s recommended to explore multiple career domains before specializing.'
    ];
  }

  const sortedSections = Object.entries(sectionPercentages)
    .sort((a, b) => b[1] - a[1]);
  const maxSection = sortedSections[0];
  const secondMax = sortedSections[1] || null;
  const thirdMax = sortedSections[2] || null;
  const minSection = sortedSections[sortedSections.length - 1] || null;

  const [maxSectionNum, maxScore] = maxSection;
  const maxSectionName = sectionNames[maxSectionNum] || `Section ${maxSectionNum}`;

  let strengthText = `Your strongest area is ${maxSectionName}`;
  if (secondMax) {
    const [secondSectionNum, secondScore] = secondMax;
    const secondSectionName = sectionNames[secondSectionNum] || `Section ${secondSectionNum}`;
    strengthText += `, followed by ${secondSectionName}`;
  }
  let weaknessText;
  if (minSection) {
    const [minSectionNum, minScore] = minSection;
    const minSectionName = sectionNames[minSectionNum] || `Section ${minSectionNum}`;
    weaknessText = `Areas needing development include ${minSectionName}`;
  } else {
    weaknessText = 'Some areas need further development';
  }

  // If overall score < 60%, show primary + secondary exploration (no single-domain dominance)
  if (overallPercentage < 60) {
    if (secondMax) {
      const [secondSectionNum, secondScore] = secondMax;
      const secondSectionName = sectionNames[secondSectionNum] || `Section ${secondSectionNum}`;

      const domainMap = {
        1: 'Technology/Engineering',
        2: 'Technology/Engineering',
        3: 'Management/Commerce',
        4: 'Creative/Design',
        5: 'Creative/Design'
      };

      const primaryDomain = domainMap[maxSectionNum] || 'General';
      const secondaryDomain = domainMap[secondSectionNum] || 'General';

      if (primaryDomain === secondaryDomain) {
        return [
          `${primaryDomain} (Primary) + Multi-domain Exploration (Secondary)`,
          `${strengthText}. ${weaknessText}. This domain fits because your assessment shows stronger performance in analytical and logical areas. However, you should NOT finalize a career decision yet. You are still in the exploration phase and need to test your interests through courses, projects, or internships before committing. Continue exploring multiple domains to ensure you make an informed choice later.`
        ];
      } else {
        return [
          `${primaryDomain} (Primary) + ${secondaryDomain} (Secondary)`,
          `${strengthText}. ${weaknessText}. Your assessment indicates primary alignment with ${primaryDomain.toLowerCase()} (strongest in ${maxSectionName}) and secondary interest in ${secondaryDomain.toLowerCase()} (strong in ${secondSectionName}). This combination suggests you should explore both domains. However, you should NOT finalize a career decision yet. Test your interests in both areas through practical experience, courses, or projects before committing. This balanced exploration will help you make a more informed decision later.`
        ];
      }
    } else {
      return [
        'Multi-domain Exploration',
        `${strengthText}. ${weaknessText}. While you show some strengths, you are still in the exploration phase. You should NOT finalize a career decision yet. Take time to build awareness and skills across different fields, test your interests through various activities, and work with a counsellor to understand your options better before specializing.`
      ];
    }
  }

  // For scores >= 60%, can show single domain if clear dominance
  if ([1, 2].includes(maxSectionNum) && (!secondMax || [1, 2].includes(secondMax[0]))) {
    return [
      'Technology / Engineering',
      `${strengthText}, indicating stronger logical and problem-solving abilities. ${weaknessText}. This domain fits because your assessment shows strong analytical thinking and numerical skills. You can begin exploring specific career paths in this area, but continue testing your interests through courses or projects before making a final decision. Work with a counsellor to refine your options.`
    ];
  } else if ([2, 3].includes(maxSectionNum) && (!secondMax || [2, 3].includes(secondMax[0]))) {
    return [
      'Management / Commerce',
      `${strengthText}, showing communication ability and interest in people-oriented roles. ${weaknessText}. This domain fits because your assessment indicates strong analytical thinking combined with effective communication skills. You can begin exploring specific career paths in this area, but continue testing your interests through practical experience before making a final decision. Work with a counsellor to refine your options.`
    ];
  } else if ([4, 5].includes(maxSectionNum) && (!secondMax || [4, 5].includes(secondMax[0]))) {
    return [
      'Creative / Design',
      `${strengthText}, reflecting creative thinking, imagination, and interest-driven learning. ${weaknessText}. This domain fits because your assessment shows strong creative and interest-based abilities. You can begin exploring specific career paths in this area, but continue testing your interests through projects or creative work before making a final decision. Work with a counsellor to refine your options.`
    ];
  } else {
    return [
      'Multi-domain Exploration',
      `${strengthText}. ${weaknessText}. This suggests balanced abilities and the need to explore multiple fields. You should NOT finalize a career decision yet. Continue exploring different domains, testing your interests, and building skills across various areas before specializing.`
    ];
  }
}

function generateActionRoadmap(readinessStatus, percentage) {
  const roadmap = {
    phase1: {
      duration: '0-3 Months',
      title: 'Foundation',
      description: 'This phase is meant for self-discovery and strengthening basic aptitude. No career decision should be taken yet.',
      actions: []
    },
    phase2: {
      duration: '3-6 Months',
      title: 'Skill Build',
      description: 'This phase focuses on building skills in potential areas and testing interests through courses or practice.',
      actions: []
    },
    phase3: {
      duration: '6-12 Months',
      title: 'Decision',
      description: 'This phase helps finalize career direction and prepare for exams, courses, or skill tracks.',
      actions: []
    }
  };

  if (readinessStatus === 'NOT READY' || percentage < 40) {
    roadmap.phase1.description = 'This phase is meant for self-discovery and strengthening basic aptitude. No career decision should be taken yet. Strong warning: Making career decisions now may lead to dissatisfaction later.';
    roadmap.phase1.actions = [
      'Focus on aptitude improvement through practice and learning',
      'Attend career awareness sessions and counselling',
      'Explore different career domains without pressure to decide',
      'Build foundational skills in areas of interest',
      'Do NOT commit to any career path yet'
    ];
    roadmap.phase2.description = 'This phase focuses on building skills in potential areas and testing interests through courses or practice. Continue exploration - no irreversible decisions.';
    roadmap.phase2.actions = [
      'Continue skill development in identified weak areas',
      'Take entry-level courses or workshops in areas of interest',
      'Engage in mini projects or practical exercises',
      'Regular counselling sessions to track progress',
      'Test interests through various activities'
    ];
    roadmap.phase3.description = 'This phase helps finalize career direction and prepare for exams, courses, or skill tracks. Only after 12+ months of exploration.';
    roadmap.phase3.actions = [
      'Begin shortlisting 2-3 career domains based on progress',
      'Consider stream or course selection aligned with interests',
      'Start exam preparation or skill certification if applicable',
      'Finalize career direction with counsellor guidance'
    ];
  } else if (readinessStatus === 'PARTIALLY READY' || (percentage >= 40 && percentage < 60)) {
    roadmap.phase1.description = 'This phase is meant for self-discovery and strengthening basic aptitude. Guided exploration only - no career decisions yet.';
    roadmap.phase1.actions = [
      'Strengthen areas showing potential',
      'Attend career counselling to explore options',
      'Build awareness of career paths in strong areas',
      'No need to finalize career choice yet',
      'Warning: Making decisions now without exploration may lead to course dissatisfaction'
    ];
    roadmap.phase2.description = 'This phase focuses on building skills in potential areas and testing interests through courses or practice. Limited shortlisting only.';
    roadmap.phase2.actions = [
      'Focus on skill building in identified areas',
      'Take relevant entry-level courses',
      'Engage in practical projects or internships',
      'Continue career exploration with guidance',
      'Test interests before committing'
    ];
    roadmap.phase3.description = 'This phase helps finalize career direction and prepare for exams, courses, or skill tracks. After 6-12 months of preparation.';
    roadmap.phase3.actions = [
      'Shortlist 2-3 career domains based on strengths',
      'Select appropriate stream or course',
      'Begin exam or skill preparation',
      'Make informed career decision with support'
    ];
  } else {
    roadmap.phase1.description = 'This phase is meant for self-discovery and strengthening basic aptitude. Focused preparation allowed.';
    roadmap.phase1.actions = [
      'Build on existing strengths',
      'Attend career counselling for focused guidance',
      'Explore specific career paths in strong domains',
      'Begin narrowing down options'
    ];
    roadmap.phase2.description = 'This phase focuses on building skills in potential areas and testing interests through courses or practice.';
    roadmap.phase2.actions = [
      'Take advanced courses in chosen domains',
      'Engage in relevant projects or internships',
      'Build specialized skills',
      'Work with counsellor to refine choices'
    ];
    roadmap.phase3.description = 'This phase helps finalize career direction and prepare for exams, courses, or skill tracks.';
    roadmap.phase3.actions = [
      'Finalize career direction',
      'Select appropriate stream or course',
      'Begin exam preparation or skill certification',
      'Take concrete steps toward chosen career path'
    ];
  }

  return roadmap;
}

function generateCounsellorSummary(percentage, readinessStatus, careerDirection, sectionScores) {
  const sectionNames = {
    1: 'logical',
    2: 'numerical',
    3: 'verbal',
    4: 'learning style',
    5: 'interest'
  };
  
  let strongestAreas = [];
  if (sectionScores && Object.keys(sectionScores).length > 0) {
    const sorted = Object.entries(sectionScores)
      .filter(([dim]) => dim.startsWith('section_'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    strongestAreas = sorted.map(([dim]) => {
      const num = parseInt(dim.split('_')[1], 10);
      return sectionNames[num] || 'general';
    });
  }

  if (readinessStatus === 'NOT READY') {
    const areas = strongestAreas.length > 0 ? strongestAreas.join(' and ') : 'multiple areas';
    return `The student shows low readiness with developing aptitude. Career decisions should be delayed for 12-18 months while strengthening ${areas} skills through guided preparation and exploration.`;
  } else if (readinessStatus === 'PARTIALLY READY') {
    const areas = strongestAreas.length > 0 ? strongestAreas.join(' and ') : 'multiple areas';
    return `The student shows moderate readiness with developing aptitude. Career decisions should be delayed for 6-12 months while strengthening ${areas} skills through guided preparation.`;
  } else {
    const areas = strongestAreas.length > 0 ? strongestAreas.join(' and ') : 'identified areas';
    return `The student shows good readiness with developed aptitude in ${areas}. Career exploration can begin with guidance, but final decisions should be made after 3-6 months of practical testing.`;
  }
}

function generateReadinessActionGuidance(readinessStatus) {
  if (readinessStatus === 'NOT READY') {
    return [
      'Avoid final career decisions at this stage',
      'Focus on exploration and foundation skills',
      'Career counselling is strongly recommended',
      'Competitive exam preparation should be delayed',
      'Build awareness before specialization'
    ];
  } else if (readinessStatus === 'PARTIALLY READY') {
    return [
      'Avoid rushing into career decisions',
      'Continue building skills in strong areas',
      'Career counselling is recommended',
      'Test interests through courses or projects',
      'Wait 6-12 months before finalizing choices'
    ];
  } else {
    return [
      'Begin exploring specific career paths',
      'Test interests through practical experience',
      'Work with counsellor to refine options',
      'Consider shortlisting 2-3 domains',
      'Make decisions after 3-6 months of exploration'
    ];
  }
}

function calculateCareerConfidence(percentage, readinessStatus) {
  if (readinessStatus === 'NOT READY') {
    return [
      'LOW',
      'This direction is based on early aptitude patterns and should be treated as a starting point for exploration, not a final decision. The student needs more time to develop clarity before committing to any career path.'
    ];
  } else if (readinessStatus === 'PARTIALLY READY') {
    return [
      'MODERATE',
      'This direction reflects current strengths but should be validated through practical experience and continued skill building. The student should explore this domain while keeping other options open for the next 6-12 months.'
    ];
  } else {
    return [
      'HIGH',
      'This direction aligns well with demonstrated strengths and can serve as a solid foundation for career planning. However, the student should still test interests through practical experience before making final commitments.'
    ];
  }
}

function generateDoNowDoLater(readinessStatus, roadmap) {
  let doNow = [];
  let doLater = [];

  if (readinessStatus === 'NOT READY') {
    doNow = [
      'Skill building in foundational areas',
      'Domain exploration through counselling',
      'Career awareness sessions',
      'Basic aptitude improvement activities'
    ];
    doLater = [
      'Stream selection',
      'Competitive exam preparation',
      'Final specialization',
      'Career commitment decisions'
    ];
  } else if (readinessStatus === 'PARTIALLY READY') {
    doNow = [
      'Strengthen skills in identified strong areas',
      'Attend career counselling sessions',
      'Take entry-level courses in potential domains',
      'Engage in practical projects or mini internships'
    ];
    doLater = [
      'Shortlist 2-3 career domains',
      'Stream or course selection',
      'Exam preparation',
      'Final career decision'
    ];
  } else {
    doNow = [
      'Explore specific career paths in strong domains',
      'Take relevant courses to test interests',
      'Work with counsellor to refine options',
      'Begin narrowing down to 2-3 domains'
    ];
    doLater = [
      'Finalize career direction',
      'Select appropriate stream or course',
      'Begin exam preparation or certification',
      'Take concrete steps toward chosen path'
    ];
  }

  return { doNow, doLater };
}

function generateHumanRiskExplanation(riskLevel, readinessStatus) {
  if (riskLevel === 'HIGH') {
    return 'Making a career decision without guidance at this stage may increase the risk of course changes or dissatisfaction later. This is decision risk, not failure risk - it means the student needs more time to explore before committing.';
  } else if (riskLevel === 'MEDIUM') {
    return 'Making a career decision too early without proper exploration may cause dissatisfaction if interests change. This is decision risk, not failure risk - it means the student should continue exploring before finalizing.';
  } else {
    return 'The student is well prepared to make informed career decisions. This is decision risk, not failure risk - it means the student has developed sufficient clarity to explore career options with confidence.';
  }
}

function generateCounsellorStyleSummary(percentage, readinessStatus, careerDirection, totalQuestions, correctAnswers) {
  if (readinessStatus === 'NOT READY') {
    return (
      `Based on the assessment results, the student is currently in an exploration phase. ` +
      `The results indicate developing aptitude across multiple areas, but no strong specialization yet. ` +
      `This is a normal and healthy stage of career development - many students need time to explore before making career decisions. ` +
      `The focus at this stage should be on building awareness, developing foundational skills, and exploring different career domains through counselling and practical activities. ` +
      `It is recommended to focus on understanding strengths and interests before making any career commitments. ` +
      `With continued exploration and skill building over the next 12-18 months, the student will be better positioned to make an informed career decision.`
    );
  } else if (readinessStatus === 'PARTIALLY READY') {
    return (
      `Based on the assessment results, the student is in a preparation stage. ` +
      `The results show developing career-related strengths in certain areas while other areas need further development. ` +
      `This balanced development is actually positive - it means the student is building a solid foundation while identifying natural strengths. ` +
      `The student should continue exploring and building skills before finalizing any career choice. ` +
      `Making a career decision too early without proper exploration may lead to dissatisfaction or course changes later. ` +
      `The focus should be on continuing to develop skills, attending career counselling sessions, taking relevant courses, and testing interests through practical projects or activities. ` +
      `With continued effort and guidance over the next 6-12 months, the student will be well-positioned to make an informed career decision.`
    );
  } else {
    return (
      `Based on the assessment results, the student shows good readiness for career planning. ` +
      `The results indicate strong aptitude in certain areas, particularly those aligned with ${careerDirection.toLowerCase()} domains. ` +
      `The student has clear strengths to build upon and has developed skills that will be valuable in their future career path. ` +
      `While the student can begin exploring specific career paths, it is still important to test interests through practical experience before making final decisions. ` +
      `The focus should be on working with a career counsellor to refine options, taking relevant courses to build specialized skills, and testing interests through projects, internships, or other practical activities. ` +
      `Over the next 3-6 months, with proper exploration and guidance, the student can begin making career decisions and taking concrete steps toward their chosen path.`
    );
  }
}

async function generateGeminiInterpretation(totalQuestions, correctAnswers, percentage, categoryScores) {
  const readinessStatus = calculateReadinessStatus(percentage)[0];
  
  const context = {
    total_questions: totalQuestions,
    correct_answers: correctAnswers,
    percentage: percentage,
    readiness_status: readinessStatus,
    category_scores: categoryScores
  };

  const { interpretation, error } = await generateInterpretation(context);
  return { interpretation, error };
}

async function generateFallbackInterpretation(testAttemptId, totalQuestions, correctAnswers, percentage, sectionScores) {
  const [readinessStatus, readinessExplanation] = calculateReadinessStatus(percentage);
  const [riskLevel, riskExplanation] = calculateRiskLevel(readinessStatus);

  const sections = {};
  const sectionObjs = await Section.findAll();
  for (const section of sectionObjs) {
    sections[section.order_index] = section.name;
  }

  const [careerDirection, careerDirectionReason] = determineCareerDirection(sectionScores, sections, percentage);
  const roadmap = generateActionRoadmap(readinessStatus, percentage);
  const summary = generateCounsellorStyleSummary(percentage, readinessStatus, careerDirection, totalQuestions, correctAnswers);
  
  // Generate new fields
  const counsellorSummary = generateCounsellorSummary(percentage, readinessStatus, careerDirection, sectionScores);
  const readinessActionGuidance = generateReadinessActionGuidance(readinessStatus);
  const [careerConfidenceLevel, careerConfidenceExplanation] = calculateCareerConfidence(percentage, readinessStatus);
  const { doNow, doLater } = generateDoNowDoLater(readinessStatus, roadmap);
  const riskExplanationHuman = generateHumanRiskExplanation(riskLevel, readinessStatus);

  let strengths, weaknesses;
  if (readinessStatus === 'NOT READY') {
    strengths = [
      'Willingness to take assessment and explore options',
      'Opportunity to identify growth areas early',
      'Time available for skill development'
    ];
    weaknesses = [
      'Need for foundational skill development',
      'Requires focused preparation in multiple areas',
      'Career awareness needs to be built'
    ];
  } else if (readinessStatus === 'PARTIALLY READY') {
    strengths = [
      'Solid foundation in certain areas',
      'Good potential for development',
      'Shows interest in career exploration'
    ];
    weaknesses = [
      'Some areas need further strengthening',
      'Requires continued skill building',
      'Career direction needs refinement'
    ];
  } else {
    strengths = [
      'Strong performance in assessment',
      'Good readiness for career exploration',
      'Clear areas of strength identified'
    ];
    weaknesses = [
      'Continue building on strengths',
      'Explore advanced opportunities',
      'Refine career direction with guidance'
    ];
  }

  return {
    summary: summary,
    strengths: strengths,
    weaknesses: weaknesses,
    career_clusters: [careerDirection],
    risk_level: riskLevel,
    readiness_status: readinessStatus,
    action_plan: [
      roadmap.phase1.title + ': ' + roadmap.phase1.actions.slice(0, 2).join(', '),
      roadmap.phase2.title + ': ' + roadmap.phase2.actions.slice(0, 2).join(', '),
      roadmap.phase3.title + ': ' + roadmap.phase3.actions.slice(0, 2).join(', ')
    ],
    readiness_explanation: readinessExplanation,
    risk_explanation: riskExplanation,
    career_direction: careerDirection,
    career_direction_reason: careerDirectionReason,
    roadmap: roadmap,
    counsellor_summary: counsellorSummary,
    readiness_action_guidance: readinessActionGuidance,
    career_confidence_level: careerConfidenceLevel,
    career_confidence_explanation: careerConfidenceExplanation,
    do_now_actions: doNow,
    do_later_actions: doLater,
    risk_explanation_human: riskExplanationHuman
  };
}

async function generateAndSaveInterpretation(testAttemptId, totalQuestions, correctAnswers, percentage) {
  const scores = await Score.findAll({ where: { test_attempt_id: testAttemptId } });
  const sectionScores = {};
  let categoryScores = null;
  
  if (scores && scores.length > 0) {
    for (const score of scores) {
      if (score.dimension.startsWith('section_')) {
        sectionScores[score.dimension] = score.score_value;
      }
    }
    categoryScores = {};
    for (const score of scores) {
      categoryScores[score.dimension] = score.score_value;
    }
  }

  const { interpretation: interpretationData, error } = await generateGeminiInterpretation(
    totalQuestions, correctAnswers, percentage, categoryScores
  );

  const isAiUsed = interpretationData !== null && error === null;

  let finalInterpretationData;
  if (!interpretationData) {
    if (error) {
      console.log(`⚠️ Using fallback interpretation: ${error}`);
    } else {
      console.log('⚠️ Using fallback interpretation (Gemini unavailable)');
    }
    finalInterpretationData = await generateFallbackInterpretation(
      testAttemptId, totalQuestions, correctAnswers, percentage, sectionScores
    );
  } else {
    const [readinessStatus, readinessExplanation] = calculateReadinessStatus(percentage);
    const [riskLevel, riskExplanation] = calculateRiskLevel(readinessStatus);

    const sections = {};
    const sectionObjs = await Section.findAll();
    for (const section of sectionObjs) {
      sections[section.order_index] = section.name;
    }

    const [careerDirection, careerDirectionReason] = determineCareerDirection(sectionScores, sections, percentage);
    const roadmap = generateActionRoadmap(readinessStatus, percentage);

    finalInterpretationData = {
      ...interpretationData,
      readiness_explanation: readinessExplanation,
      risk_explanation: riskExplanation,
      career_direction: careerDirection,
      career_direction_reason: careerDirectionReason,
      roadmap: roadmap
    };
  }

  let interpretedResult = await InterpretedResult.findOne({
    where: { test_attempt_id: testAttemptId }
  });

  // Extract readiness and risk data from final interpretation
  const [readinessStatus, readinessExplanation] = calculateReadinessStatus(percentage);
  const [riskLevel, riskExplanation] = calculateRiskLevel(readinessStatus);
  
  const sections = {};
  const sectionObjs = await Section.findAll();
  for (const section of sectionObjs) {
    sections[section.order_index] = section.name;
  }
  
  const [careerDirection, careerDirectionReason] = determineCareerDirection(sectionScores, sections, percentage);
  const roadmap = generateActionRoadmap(readinessStatus, percentage);
  
  // Generate new fields
  const counsellorSummary = generateCounsellorSummary(percentage, readinessStatus, careerDirection, sectionScores);
  const readinessActionGuidance = generateReadinessActionGuidance(readinessStatus);
  const [careerConfidenceLevel, careerConfidenceExplanation] = calculateCareerConfidence(percentage, readinessStatus);
  const { doNow, doLater } = generateDoNowDoLater(readinessStatus, roadmap);
  const riskExplanationHuman = generateHumanRiskExplanation(riskLevel, readinessStatus);

  if (!interpretedResult) {
    interpretedResult = await InterpretedResult.create({
      test_attempt_id: testAttemptId,
      interpretation_text: finalInterpretationData.summary || '',
      strengths: JSON.stringify(finalInterpretationData.strengths || []),
      areas_for_improvement: JSON.stringify(finalInterpretationData.weaknesses || []),
      is_ai_generated: isAiUsed,
      readiness_status: readinessStatus,
      readiness_explanation: readinessExplanation,
      risk_level: riskLevel,
      risk_explanation: riskExplanation,
      career_direction: careerDirection,
      career_direction_reason: careerDirectionReason,
      roadmap: JSON.stringify(roadmap),
      counsellor_summary: counsellorSummary,
      readiness_action_guidance: JSON.stringify(readinessActionGuidance),
      career_confidence_level: careerConfidenceLevel,
      career_confidence_explanation: careerConfidenceExplanation,
      do_now_actions: JSON.stringify(doNow),
      do_later_actions: JSON.stringify(doLater),
      risk_explanation_human: riskExplanationHuman
    });
  } else {
    interpretedResult.interpretation_text = finalInterpretationData.summary || interpretedResult.interpretation_text;
    interpretedResult.strengths = JSON.stringify(finalInterpretationData.strengths || []);
    interpretedResult.areas_for_improvement = JSON.stringify(finalInterpretationData.weaknesses || []);
    interpretedResult.is_ai_generated = isAiUsed;
    interpretedResult.readiness_status = readinessStatus;
    interpretedResult.readiness_explanation = readinessExplanation;
    interpretedResult.risk_level = riskLevel;
    interpretedResult.risk_explanation = riskExplanation;
    interpretedResult.career_direction = careerDirection;
    interpretedResult.career_direction_reason = careerDirectionReason;
    interpretedResult.roadmap = JSON.stringify(roadmap);
    interpretedResult.counsellor_summary = counsellorSummary;
    interpretedResult.readiness_action_guidance = JSON.stringify(readinessActionGuidance);
    interpretedResult.career_confidence_level = careerConfidenceLevel;
    interpretedResult.career_confidence_explanation = careerConfidenceExplanation;
    interpretedResult.do_now_actions = JSON.stringify(doNow);
    interpretedResult.do_later_actions = JSON.stringify(doLater);
    interpretedResult.risk_explanation_human = riskExplanationHuman;
    await interpretedResult.save();
  }

  return { interpretedResult, interpretationData: finalInterpretationData };
}

module.exports = {
  calculateReadinessStatus,
  calculateRiskLevel,
  determineCareerDirection,
  generateActionRoadmap,
  generateCounsellorStyleSummary,
  generateAndSaveInterpretation,
  generateCounsellorSummary,
  generateReadinessActionGuidance,
  calculateCareerConfidence,
  generateDoNowDoLater,
  generateHumanRiskExplanation
};


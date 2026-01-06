const axios = require('axios');
const config = require('../config');

async function generateInterpretation(context) {
  const apiKey = config.gemini.apiKey;
  
  if (!apiKey || !apiKey.trim()) {
    return { interpretation: null, error: 'GEMINI_API_KEY environment variable is not set' };
  }

  const totalQuestions = context.total_questions || 0;
  const correctAnswers = context.correct_answers || 0;
  const percentage = context.percentage || 0.0;
  const readinessBand = context.readiness_status || 'Medium';
  const categoryScores = context.category_scores;

  let categoryInfo = '';
  if (categoryScores) {
    categoryInfo = '\nCategory Breakdown:\n';
    for (const [cat, score] of Object.entries(categoryScores)) {
      categoryInfo += `- ${cat}: ${score}%\n`;
    }
  }

  const prompt = `You are a career guidance AI. Provide guidance only. No medical or psychological diagnosis.

ASSESSMENT RESULTS:
- Total Questions: ${totalQuestions}
- Correct Answers: ${correctAnswers}
- Percentage Score: ${percentage}%
- Readiness Band: ${readinessBand}
${categoryInfo}

TASK:
Generate a structured JSON response with the following exact structure:

{
  "summary": "A 2-3 sentence overview of the assessment results focusing on career readiness",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["area for improvement 1", "area for improvement 2"],
  "career_clusters": ["cluster 1", "cluster 2", "cluster 3"],
  "risk_level": "LOW" or "MEDIUM" or "HIGH",
  "readiness_status": "READY" or "PARTIALLY READY" or "NOT READY",
  "action_plan": [
    "Step 1 for next 6 months",
    "Step 2 for 6-12 months",
    "Step 3 for 12-24 months"
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown, no code blocks
- risk_level should be LOW if percentage >= 70, MEDIUM if 50-69, HIGH if < 50
- readiness_status should align with readiness_band
- Use positive, encouraging language throughout
- Focus on career development, not diagnosis

Return the JSON now:`;

  try {
    // Use Gemini API via REST (Google Generative AI SDK alternative)
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    let responseText = response.data.candidates[0].content.parts[0].text.trim();

    // Remove markdown code blocks if present
    if (responseText.startsWith('```json')) {
      responseText = responseText.substring(7);
    }
    if (responseText.startsWith('```')) {
      responseText = responseText.substring(3);
    }
    if (responseText.endsWith('```')) {
      responseText = responseText.substring(0, responseText.length - 3);
    }
    responseText = responseText.trim();

    const interpretation = JSON.parse(responseText);

    // Validate required fields
    const requiredFields = ['summary', 'strengths', 'weaknesses', 'career_clusters',
      'risk_level', 'readiness_status', 'action_plan'];
    for (const field of requiredFields) {
      if (!(field in interpretation)) {
        return { interpretation: null, error: `Gemini response missing required field: ${field}` };
      }
    }

    return { interpretation, error: null };
  } catch (error) {
    let errorMsg = error.message;
    if (error.response) {
      errorMsg = error.response.data?.error?.message || error.message;
    }
    
    // Sanitize error message
    if (errorMsg.toLowerCase().includes('api key') || errorMsg.toLowerCase().includes('authentication')) {
      errorMsg = 'Gemini API authentication failed';
    } else if (errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('rate limit')) {
      errorMsg = 'Gemini API rate limit exceeded';
    }
    
    return { interpretation: null, error: `Gemini API error: ${errorMsg}` };
  }
}

module.exports = {
  generateInterpretation
};


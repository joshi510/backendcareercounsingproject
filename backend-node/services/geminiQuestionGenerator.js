const axios = require('axios');
const config = require('../config');

/**
 * Generate questions using Gemini API
 * @param {Object} params - Generation parameters
 * @param {string} params.sectionName - Name of the section
 * @param {string} params.sectionDescription - Description of the section
 * @param {string} params.difficulty - Difficulty level (Easy, Medium, Hard)
 * @param {number} params.count - Number of questions to generate
 * @returns {Promise<{questions: Array, error: string|null}>}
 */
async function generateQuestions({ sectionName, sectionDescription, difficulty, count }) {
  const apiKey = config.gemini.apiKey;
  
  if (!apiKey || !apiKey.trim()) {
    return { questions: null, error: 'GEMINI_API_KEY environment variable is not set' };
  }

  if (!sectionName || !difficulty || !count || count < 1 || count > 10) {
    return { questions: null, error: 'Invalid parameters: sectionName, difficulty, and count (1-10) are required' };
  }

  // Calculate question type distribution: 70% LIKERT_SCALE, 30% MULTIPLE_CHOICE
  const likertCount = Math.round(count * 0.7);
  const mcqCount = count - likertCount;

  const prompt = `You are an expert career assessment question writer. Generate ${count} high-quality questions for a career profiling test.

SECTION INFORMATION:
- Section Name: ${sectionName}
${sectionDescription ? `- Section Description: ${sectionDescription}` : ''}
- Difficulty Level: ${difficulty}

QUESTION TYPE DISTRIBUTION:
- Generate ${likertCount} LIKERT_SCALE questions (70%)
- Generate ${mcqCount} MULTIPLE_CHOICE questions (30%)

REQUIREMENTS FOR LIKERT_SCALE QUESTIONS:
1. Question text should be a statement (e.g., "I enjoy working in teams")
2. NO options field (do not include options)
3. NO correct_answer field (do not include correct_answer)
4. Use keywords like "enjoy", "like", "prefer", "comfortable", "always", "sometimes" in question text
5. Questions assess attitudes, preferences, or behaviors

REQUIREMENTS FOR MULTIPLE_CHOICE QUESTIONS:
1. Question text should be a question (e.g., "Which work environment do you prefer?")
2. Must have exactly 4 options (A, B, C, D)
3. Must include correct_answer field (one of: A, B, C, or D)
4. Options should be distinct career-related choices
5. Questions assess knowledge or specific preferences

GENERAL REQUIREMENTS:
- Each question must be relevant to career assessment and the section topic
- Questions should assess career interests, skills, preferences, or readiness
- Difficulty: ${difficulty} (Easy = straightforward, Medium = moderate complexity, Hard = requires deeper thinking)
- Questions must be clear, unbiased, and appropriate for students
- No medical, psychological, or sensitive personal questions
- Focus on career-related topics only

OUTPUT FORMAT:
Return a valid JSON array with this exact structure:
[
  {
    "question_type": "LIKERT_SCALE",
    "question_text": "I enjoy solving complex problems"
  },
  {
    "question_type": "MULTIPLE_CHOICE",
    "question_text": "Which work environment do you prefer?",
    "options": [
      {"label": "A", "text": "Remote work"},
      {"label": "B", "text": "Office work"},
      {"label": "C", "text": "Hybrid work"},
      {"label": "D", "text": "Field work"}
    ],
    "correct_answer": "C"
  },
  ...
]

IMPORTANT:
- Return ONLY valid JSON array, no markdown, no code blocks, no explanations
- Generate exactly ${count} questions (${likertCount} LIKERT_SCALE, ${mcqCount} MULTIPLE_CHOICE)
- Each question must be unique and relevant to the section
- LIKERT_SCALE questions: NO options, NO correct_answer
- MULTIPLE_CHOICE questions: MUST have 4 options and correct_answer
- Ensure questions are professional and appropriate

Return the JSON array now:`;

  try {
    // Use gemini-2.5-flash (verified compatible with API key)
    // API version: v1 (stable)
    const modelName = 'gemini-2.5-flash';
    const apiVersion = 'v1';
    
    const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
    
    console.log(`🤖 Calling Gemini API: ${modelName} (${apiVersion})`);
    
    const response = await axios.post(
      apiUrl,
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
        timeout: 60000 // 60 seconds for question generation
      }
    );

    // Validate response structure
    if (!response.data || !response.data.candidates || !Array.isArray(response.data.candidates) || response.data.candidates.length === 0) {
      console.error('❌ Invalid Gemini API response structure:', JSON.stringify(response.data, null, 2));
      return { questions: null, error: 'Invalid response from AI service. Please try again.' };
    }

    const candidate = response.data.candidates[0];
    if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
      console.error('❌ Invalid Gemini API response content:', JSON.stringify(candidate, null, 2));
      return { questions: null, error: 'AI service returned empty content. Please try again.' };
    }

    // Check for safety ratings or blocked content
    if (candidate.safetyRatings && candidate.safetyRatings.some(rating => rating.blocked)) {
      console.error('❌ Content blocked by safety filters:', JSON.stringify(candidate.safetyRatings, null, 2));
      return { questions: null, error: 'Content was blocked by safety filters. Please try again with different parameters.' };
    }

    let responseText = candidate.content.parts[0].text;
    if (!responseText || typeof responseText !== 'string') {
      console.error('❌ Invalid response text:', responseText);
      return { questions: null, error: 'AI service returned invalid response. Please try again.' };
    }

    responseText = responseText.trim();

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

    if (!responseText || responseText.length === 0) {
      console.error('❌ Empty response text after processing');
      return { questions: null, error: 'AI service returned empty response. Please try again.' };
    }

    let questions;
    try {
      questions = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError.message);
      console.error('❌ Response text (first 500 chars):', responseText.substring(0, 500));
      return { questions: null, error: 'Failed to parse AI response. Please try again.' };
    }

    // Validate structure
    if (!Array.isArray(questions)) {
      return { questions: null, error: 'Gemini response is not an array' };
    }

    if (questions.length !== count) {
      console.warn(`⚠️ Generated ${questions.length} questions, expected ${count}`);
    }

    // Validate and process each question based on type
    const validatedQuestions = [];
    for (const q of questions) {
      if (!q.question_text) {
        console.warn(`⚠️ Skipping invalid question (missing question_text): ${JSON.stringify(q)}`);
        continue;
      }

      // Fallback: if question_type is missing or invalid, determine from presence of options
      let questionType = q.question_type ? q.question_type.toUpperCase() : null;
      
      // Convert TEXT to LIKERT_SCALE (TEXT is not supported in backend)
      if (questionType === 'TEXT') {
        console.log(`ℹ️ Converting TEXT question to LIKERT_SCALE: ${q.question_text.substring(0, 50)}...`);
        questionType = 'LIKERT_SCALE';
      }
      
      // If question_type is missing, infer from structure:
      // - Has options array with 4 items → MULTIPLE_CHOICE
      // - No options or empty options → LIKERT_SCALE
      if (!questionType || (questionType !== 'LIKERT_SCALE' && questionType !== 'MULTIPLE_CHOICE')) {
        if (q.options && Array.isArray(q.options) && q.options.length === 4) {
          questionType = 'MULTIPLE_CHOICE';
        } else {
          questionType = 'LIKERT_SCALE';
        }
        console.log(`ℹ️ Inferred question_type as ${questionType} for question: ${q.question_text.substring(0, 50)}...`);
      }
      
      if (questionType === 'LIKERT_SCALE') {
        // LIKERT_SCALE: no options, no correct_answer
        validatedQuestions.push({
          question_type: 'LIKERT_SCALE',
          question_text: q.question_text.trim()
        });
      } else if (questionType === 'MULTIPLE_CHOICE') {
        // MULTIPLE_CHOICE: must have 4 options and correct_answer
        if (!q.options || !Array.isArray(q.options) || q.options.length !== 4) {
          console.warn(`⚠️ Skipping invalid MULTIPLE_CHOICE question (must have 4 options): ${JSON.stringify(q)}`);
          continue;
        }
        
        if (!q.correct_answer || !['A', 'B', 'C', 'D'].includes(q.correct_answer.toUpperCase())) {
          console.warn(`⚠️ Skipping invalid MULTIPLE_CHOICE question (missing or invalid correct_answer): ${JSON.stringify(q)}`);
          continue;
        }
        
        // Ensure all options have label and text
        const validOptions = q.options.map((opt, idx) => ({
          label: opt.label || String.fromCharCode(65 + idx),
          text: opt.text || opt
        }));

        validatedQuestions.push({
          question_type: 'MULTIPLE_CHOICE',
          question_text: q.question_text.trim(),
          options: validOptions,
          correct_answer: q.correct_answer.toUpperCase()
        });
      } else {
        console.warn(`⚠️ Skipping question with invalid question_type: ${questionType}`);
        continue;
      }
    }

    if (validatedQuestions.length === 0) {
      return { questions: null, error: 'No valid questions generated' };
    }

    return { questions: validatedQuestions, error: null };
  } catch (error) {
    console.error('❌ Error in generateQuestions:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    let errorMsg = error.message;
    
    // Handle axios errors
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      console.error(`❌ Gemini API error (${status}):`, JSON.stringify(data, null, 2));
      
      // Check for model not found error
      const errorMessage = data?.error?.message || '';
      if (errorMessage.includes('not found') || errorMessage.includes('not supported')) {
        errorMsg = `Model not available. Please check your API key has access to gemini-2.5-flash model. Error: ${errorMessage}`;
      } else if (status === 401 || status === 403) {
        errorMsg = 'Gemini API authentication failed. Please check your API key.';
      } else if (status === 429) {
        errorMsg = 'Gemini API rate limit exceeded. Please try again later.';
      } else if (status >= 500) {
        errorMsg = 'Gemini API server error. Please try again later.';
      } else {
        errorMsg = errorMessage || `API error (${status}). Please try again.`;
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error('❌ No response from Gemini API (timeout or network error)');
      errorMsg = 'Network error: Could not reach AI service. Please check your connection and try again.';
    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMsg = 'Request timeout: AI service took too long to respond. Please try again.';
    } else if (error.message.toLowerCase().includes('api key') || error.message.toLowerCase().includes('authentication')) {
      errorMsg = 'Gemini API authentication failed. Please check your API key.';
    } else if (error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('rate limit')) {
      errorMsg = 'Gemini API rate limit exceeded. Please try again later.';
    } else {
      errorMsg = `AI question generation failed: ${error.message}. Please try again.`;
    }
    
    return { questions: null, error: errorMsg };
  }
}

module.exports = {
  generateQuestions
};


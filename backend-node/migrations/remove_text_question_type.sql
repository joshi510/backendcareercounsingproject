-- Migration: Remove TEXT question type from system
-- This migration deletes all existing TEXT questions and updates the ENUM

-- Step 1: Delete all existing TEXT questions
DELETE FROM questions WHERE question_type = 'TEXT';

-- Step 2: Update question_type ENUM to remove TEXT
-- Note: MySQL requires dropping and recreating the column to modify ENUM values
ALTER TABLE questions
MODIFY COLUMN `question_type` ENUM('MULTIPLE_CHOICE', 'LIKERT_SCALE') NOT NULL;

-- Step 3: Verify no TEXT questions remain
SELECT COUNT(*) as remaining_text_questions 
FROM questions 
WHERE question_type = 'TEXT';

-- Expected result: 0


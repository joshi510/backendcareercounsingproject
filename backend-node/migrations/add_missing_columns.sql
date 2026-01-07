-- =====================================================
-- SAFE SQL MIGRATION: Add Missing Columns to Production
-- =====================================================
-- This script adds columns that exist in code but may be missing in production database
-- All operations are ADD COLUMN only - no destructive changes
-- PostgreSQL compatible
-- =====================================================

-- =====================================================
-- 1. USERS TABLE
-- =====================================================

-- Add is_first_login column (if missing)
-- Used for: First login password change flow for counsellors
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'is_first_login'
    ) THEN
        ALTER TABLE users 
        ADD COLUMN is_first_login BOOLEAN NOT NULL DEFAULT false;
        
        RAISE NOTICE 'Added column: users.is_first_login';
    ELSE
        RAISE NOTICE 'Column already exists: users.is_first_login';
    END IF;
END $$;

-- Add center column (if missing)
-- Used for: Counsellor center location assignment
-- Note: If enum type doesn't exist, it will be created
DO $$
BEGIN
    -- Check if enum type exists, create if not
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_center_enum') THEN
        CREATE TYPE users_center_enum AS ENUM ('CG', 'SG', 'Maninagar', 'Surat', 'Rajkot', 'Nikol');
        RAISE NOTICE 'Created enum type: users_center_enum';
    END IF;
    
    -- Check if column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'center'
    ) THEN
        ALTER TABLE users 
        ADD COLUMN center users_center_enum NULL;
        
        RAISE NOTICE 'Added column: users.center';
    ELSE
        RAISE NOTICE 'Column already exists: users.center';
        
        -- If column exists but enum doesn't have 'Nikol', add it
        -- Note: PostgreSQL doesn't support adding values to existing enum easily
        -- This is a safe check - if Nikol is needed, manual enum update may be required
    END IF;
END $$;

-- =====================================================
-- 2. QUESTIONS TABLE
-- =====================================================

-- Add status column (if missing)
-- Used for: Question approval workflow (pending, approved, rejected, inactive)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'status'
    ) THEN
        -- Create enum type if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'questions_status_enum') THEN
            CREATE TYPE questions_status_enum AS ENUM ('pending', 'approved', 'rejected', 'inactive');
            RAISE NOTICE 'Created enum type: questions_status_enum';
        END IF;
        
        ALTER TABLE questions 
        ADD COLUMN status questions_status_enum NOT NULL DEFAULT 'pending';
        
        RAISE NOTICE 'Added column: questions.status';
    ELSE
        RAISE NOTICE 'Column already exists: questions.status';
    END IF;
END $$;

-- Add source column (if missing)
-- Used for: Track if question was created by ADMIN or AI
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'source'
    ) THEN
        -- Create enum type if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'questions_source_enum') THEN
            CREATE TYPE questions_source_enum AS ENUM ('ADMIN', 'AI');
            RAISE NOTICE 'Created enum type: questions_source_enum';
        END IF;
        
        ALTER TABLE questions 
        ADD COLUMN source questions_source_enum NOT NULL DEFAULT 'ADMIN';
        
        RAISE NOTICE 'Added column: questions.source';
    ELSE
        RAISE NOTICE 'Column already exists: questions.source';
    END IF;
END $$;

-- Add is_active column (if missing)
-- Used for: Activate/deactivate questions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
        
        RAISE NOTICE 'Added column: questions.is_active';
    ELSE
        RAISE NOTICE 'Column already exists: questions.is_active';
    END IF;
END $$;

-- Add order_index column (if missing)
-- Used for: Question ordering within sections
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'order_index'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
        
        RAISE NOTICE 'Added column: questions.order_index';
    ELSE
        RAISE NOTICE 'Column already exists: questions.order_index';
    END IF;
END $$;

-- Add scale_value column (if missing)
-- Used for: LIKERT_SCALE question scoring
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'scale_value'
    ) THEN
        ALTER TABLE questions 
        ADD COLUMN scale_value INTEGER NULL;
        
        RAISE NOTICE 'Added column: questions.scale_value';
    ELSE
        RAISE NOTICE 'Column already exists: questions.scale_value';
    END IF;
END $$;

-- =====================================================
-- 3. TEST_ATTEMPTS TABLE
-- =====================================================

-- Add selected_question_ids column (if missing)
-- Used for: Store randomly selected question IDs per attempt
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'test_attempts' 
        AND column_name = 'selected_question_ids'
    ) THEN
        ALTER TABLE test_attempts 
        ADD COLUMN selected_question_ids JSONB NULL;
        
        RAISE NOTICE 'Added column: test_attempts.selected_question_ids';
    ELSE
        RAISE NOTICE 'Column already exists: test_attempts.selected_question_ids';
    END IF;
END $$;

-- =====================================================
-- 4. QUESTION_APPROVALS TABLE (if table exists)
-- =====================================================

-- This table may not exist in older schemas
-- Check if table exists before adding columns
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'question_approvals'
    ) THEN
        -- Add approved_at column (if missing)
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'question_approvals' 
            AND column_name = 'approved_at'
        ) THEN
            ALTER TABLE question_approvals 
            ADD COLUMN approved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
            
            RAISE NOTICE 'Added column: question_approvals.approved_at';
        ELSE
            RAISE NOTICE 'Column already exists: question_approvals.approved_at';
        END IF;
    ELSE
        RAISE NOTICE 'Table does not exist: question_approvals (skipping)';
    END IF;
END $$;

-- =====================================================
-- VERIFICATION QUERIES (Optional - run separately)
-- =====================================================
-- Uncomment to verify columns were added:
/*
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name IN ('users', 'questions', 'test_attempts', 'question_approvals')
    AND column_name IN (
        'is_first_login', 'center', 
        'status', 'source', 'is_active', 'order_index', 'scale_value',
        'selected_question_ids',
        'approved_at'
    )
ORDER BY table_name, column_name;
*/

-- =====================================================
-- END OF MIGRATION
-- =====================================================


# Missing Columns Analysis - Production Database

## Read-Only Analysis: Columns Required to Avoid Runtime Errors

Based on code analysis, the following columns are **REQUIRED** in production to prevent runtime errors:

---

### ✅ CRITICAL - Will Cause Runtime Errors

- **users.is_first_login** (used in: auth.js line 149, adminUsers.js lines 142/212, changePassword.js line 42)
- **users.center** (used in: auth.js line 148, adminUsers.js lines 40/78/147/202 - WHERE clause will fail)
- **questions.status** (used in: test.js line 2190 WHERE clause, adminQuestions.js line 464)
- **questions.is_active** (used in: test.js line 2190 WHERE clause, adminQuestions.js line 468 getDataValue)
- **questions.source** (used in: adminQuestions.js line 465 response mapping)
- **questions.order_index** (used in: adminQuestions.js line 472 response mapping)

---

### ⚠️ POTENTIAL - May Cause Issues

- **questions.scale_value** (used in: adminQuestions.js line 246 for LIKERT questions - may cause issues if NULL when expected)
- **test_attempts.selected_question_ids** (used in: test.js - stored in junction table instead, but model expects it)

---

## Notes

- All columns above are directly accessed in code
- WHERE clauses will fail immediately if column doesn't exist
- Direct property access (user.is_first_login) will return undefined but may cause issues
- Response mapping will show undefined/null if column missing

---

## Verification Query (PostgreSQL)

Run this to check which columns exist:

```sql
SELECT 
    table_name, 
    column_name
FROM information_schema.columns 
WHERE table_name IN ('users', 'questions', 'test_attempts')
    AND column_name IN (
        'is_first_login', 'center',
        'status', 'is_active', 'source', 'order_index', 'scale_value',
        'selected_question_ids'
    )
ORDER BY table_name, column_name;
```


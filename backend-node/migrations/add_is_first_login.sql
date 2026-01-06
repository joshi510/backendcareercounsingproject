-- Add is_first_login column to users table
ALTER TABLE users
ADD COLUMN is_first_login TINYINT(1) NOT NULL DEFAULT 0
COMMENT 'Flag to indicate if user needs to change password on first login'
AFTER role;


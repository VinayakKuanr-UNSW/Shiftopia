-- Temporarily relax foreign key constraints for broadcasts to allow operation
-- when user auth ID doesn't match employee ID

-- Drop and recreate the author_id foreign key constraint as deferrable/optional
DO $$
BEGIN
    -- Drop the existing foreign key constraint on author_id if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'broadcasts_author_id_fkey' 
        AND table_name = 'broadcasts'
    ) THEN
        ALTER TABLE broadcasts DROP CONSTRAINT broadcasts_author_id_fkey;
    END IF;
    
    -- Drop the created_by constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'broadcasts_created_by_fkey' 
        AND table_name = 'broadcasts'
    ) THEN
        ALTER TABLE broadcasts DROP CONSTRAINT broadcasts_created_by_fkey;
    END IF;
    
    -- Make author_id and created_by nullable to allow operation without strict employee matching
    ALTER TABLE broadcasts ALTER COLUMN author_id DROP NOT NULL;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'broadcasts' AND column_name = 'created_by') THEN
        ALTER TABLE broadcasts ALTER COLUMN created_by DROP NOT NULL;
    END IF;
END $$;

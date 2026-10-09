```sql
CREATE TABLE categories (
  category_id SERIAL PRIMARY KEY,
  category_title TEXT NOT NULL UNIQUE,
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  u_id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('super', 'admin', 'manager', 'caller', 'account')),
  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  parent_user_id INTEGER REFERENCES users(u_id) ON DELETE RESTRICT,
  email TEXT,
  address TEXT,
  sex TEXT,
  birthday DATE,
  phone TEXT,
  country TEXT,
  city TEXT,
  blocked_date TIMESTAMPTZ,
  category_id INTEGER REFERENCES categories(category_id) ON DELETE RESTRICT,
  CHECK (
    (role = 'super' AND parent_user_id IS NULL) OR
    (role <> 'super' AND parent_user_id IS NOT NULL)
  ),
  CHECK (
    (role = 'account' AND password_hash IS NULL AND category_id IS NOT NULL
      AND email IS NOT NULL AND address IS NOT NULL AND sex IS NOT NULL
      AND birthday IS NOT NULL AND phone IS NOT NULL AND country IS NOT NULL
      AND city IS NOT NULL) OR
    (role <> 'account' AND password_hash IS NOT NULL AND category_id IS NULL)
  )
);

CREATE TABLE job_list (
  j_id SERIAL PRIMARY KEY,
  u_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
  url TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  category_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  selected_account_u_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('processing', 'todo', 'did', 'failed')),
  get_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bids (
  b_id SERIAL PRIMARY KEY,
  u_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
  j_id INTEGER NOT NULL,
  manager_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  job_url TEXT NOT NULL,
  job_status TEXT NOT NULL DEFAULT 'did'
    CHECK (job_status IN ('processing', 'todo', 'did', 'failed')),
  resume_path TEXT NOT NULL,
  applied_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (u_id, j_id)
);

CREATE TABLE interviews (
  i_id SERIAL PRIMARY KEY,
  b_id INTEGER NOT NULL REFERENCES bids(b_id) ON DELETE CASCADE,
  interview_time TIME NOT NULL,
  interview_date DATE NOT NULL,
  caller_user_id INTEGER NOT NULL REFERENCES users(u_id) ON DELETE RESTRICT,
  interviewer TEXT NOT NULL,
  step TEXT NOT NULL
    CHECK (step IN ('intro', 'tech-1', 'tech-2', 'final')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'did', 'failed', 'respond_waiting')),
  outcome TEXT CHECK (outcome IN ('good', 'bad', 'normal')),
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comment TEXT
);

CREATE TABLE app_settings (
  setting_name TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(u_id) ON DELETE SET NULL,
  created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_parent ON users(parent_user_id);
CREATE INDEX idx_users_role_parent ON users(role, parent_user_id);
CREATE INDEX idx_users_category ON users(category_id);
CREATE INDEX idx_job_list_manager ON job_list(u_id);
CREATE INDEX idx_job_list_categories ON job_list USING GIN(category_ids);
CREATE INDEX idx_job_list_selected_accounts
  ON job_list USING GIN(selected_account_u_ids);
CREATE INDEX idx_bids_user ON bids(u_id);
CREATE INDEX idx_bids_job ON bids(j_id);
CREATE INDEX idx_bids_manager ON bids(manager_user_id);
CREATE INDEX idx_bids_manager_url ON bids(manager_user_id, job_url);
CREATE INDEX idx_interviews_bid ON interviews(b_id);
CREATE INDEX idx_interviews_caller ON interviews(caller_user_id);
CREATE INDEX idx_interviews_outcome_date ON interviews(outcome, interview_date);
```

-- =====================================================================
-- Kargo Hiring Dashboard - schema
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: it drops and recreates every table (all data is lost).
-- =====================================================================

drop table if exists emails cascade;
drop table if exists briefs cascade;
drop table if exists score_totals cascade;
drop table if exists scores cascade;
drop table if exists candidate_content cascade;
drop table if exists candidate_pii cascade;
drop table if exists candidates cascade;
drop table if exists rubric_meta cascade;
drop table if exists rubric_criteria cascade;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rubric (seeded from rubric.txt by `npm run seed`)
-- ---------------------------------------------------------------------
create table rubric_criteria (
  id             uuid primary key default gen_random_uuid(),
  role           text not null check (role in ('PM', 'SPM')),
  criterion_name text not null,
  description    text not null,
  weight         integer not null check (weight > 0 and weight <= 100),
  sort_order     integer not null,
  unique (role, criterion_name),
  unique (role, sort_order)
);

-- Weights per role must sum to 100 (or the role must be empty, e.g. mid-reseed).
-- Deferred so a multi-row insert is checked once, at commit.
create or replace function check_rubric_weights() returns trigger
language plpgsql as $$
declare
  r text;
  total integer;
  n integer;
begin
  r := coalesce(new.role, old.role);
  select coalesce(sum(weight), 0), count(*) into total, n
    from rubric_criteria where role = r;
  if n > 0 and total <> 100 then
    raise exception 'Rubric weights for % sum to %, expected 100', r, total;
  end if;
  return null;
end $$;

create constraint trigger rubric_weights_sum_to_100
  after insert or update or delete on rubric_criteria
  deferrable initially deferred
  for each row execute function check_rubric_weights();

-- SCORING and USAGE RULES text from rubric.txt, used verbatim in prompts.
create table rubric_meta (
  key   text primary key,          -- 'scoring' | 'usage_rules'
  value text not null
);

-- ---------------------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------------------
create table candidates (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  applied_role     text not null check (applied_role in ('PM', 'SPM')),
  file_name        text not null,
  status           text not null default 'uploaded'
                   check (status in ('uploaded', 'extracted', 'scored', 'drafted', 'sent', 'error')),
  error_message    text,
  -- Arjun's manual Invite/Reject switch. Overrides the system recommendation.
  founder_decision text check (founder_decision in ('invite', 'reject'))
);

-- Personal details. NEVER sent to Gemini.
create table candidate_pii (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  full_name    text,
  email        text,
  phone        text,
  location     text,
  links        jsonb not null default '[]'::jsonb
);
create index candidate_pii_email_idx on candidate_pii (lower(email));

-- Anonymised CV. The only thing Gemini sees.
create table candidate_content (
  candidate_id     uuid primary key references candidates(id) on delete cascade,
  cv_text_redacted text not null,
  extracted_json   jsonb   -- work history, achievements, education (no institution names)
);

-- One row per candidate x role x criterion.
create table scores (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references candidates(id) on delete cascade,
  role               text not null check (role in ('PM', 'SPM')),
  criterion_id       uuid not null references rubric_criteria(id) on delete cascade,
  score              integer not null check (score between 0 and 5),
  evidence_quote     text not null,
  reasoning          text not null,
  quote_verified     boolean not null default true,
  unique (candidate_id, role, criterion_id)
);

-- Weighted totals are computed in code, never by the model.
create table score_totals (
  candidate_id   uuid not null references candidates(id) on delete cascade,
  role           text not null check (role in ('PM', 'SPM')),
  weighted_total numeric(4, 1) not null check (weighted_total between 0 and 100),
  rank_in_role   integer,        -- only set for the candidate's applied role
  recommended    text check (recommended in ('invite', 'reject', 'review')),
  primary key (candidate_id, role)
);

create table briefs (
  candidate_id    uuid not null references candidates(id) on delete cascade,
  role            text not null check (role in ('PM', 'SPM')),
  brief_text      text not null,
  probe_questions jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  primary key (candidate_id, role)
);

create table emails (
  id                     uuid primary key default gen_random_uuid(),
  candidate_id           uuid not null references candidates(id) on delete cascade,
  role                   text not null check (role in ('PM', 'SPM')),
  email_type             text not null check (email_type in ('invite', 'rejection')),
  subject                text not null,
  body_with_placeholders text not null,
  -- 'sending' is a short-lived lock so a double click can never send twice.
  status                 text not null default 'draft'
                         check (status in ('draft', 'sending', 'sent', 'failed')),
  error_message          text,
  sent_at                timestamptz,
  resend_message_id      text,
  edited_by_founder      boolean not null default false,
  updated_at             timestamptz not null default now(),
  unique (candidate_id, role)
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- DEMO ONLY: these policies let the anon key read and write everything.
-- In production, put the app behind Supabase Auth, restrict every policy
-- to the founder's user id, and move writes to a service-role key held
-- only on the server.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'rubric_criteria', 'rubric_meta', 'candidates', 'candidate_pii',
    'candidate_content', 'scores', 'score_totals', 'briefs', 'emails'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "demo_all_%s" on %I for all to anon using (true) with check (true)', t, t);
  end loop;
end $$;

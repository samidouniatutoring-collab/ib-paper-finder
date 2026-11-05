-- IB Paper Finder schema. Paste this whole file into the Supabase SQL Editor and click Run. Safe to re-run.
select set_config('pf.owner_email', lower('samidouniatutoring@gmail.com'), false); -- OWNER_EMAIL: change this address if needed

-- ---------------------------------------------------------------------------
-- Private config (not exposed through the API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (key text primary key, value text not null);
insert into private.config (key, value) values ('owner_email', current_setting('pf.owner_email'))
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'removed')),
  role text not null default 'student' check (role in ('student', 'owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  allowed_domain text,                       -- e.g. "school.org"; null = any email may request
  allow_downloads boolean not null default true
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_hash text not null unique,
  original_name text not null,
  subject text,
  level text check (level in ('HL', 'SL', 'HL/SL')),
  year int,
  session text check (session in ('May', 'November')),
  timezone text check (timezone in ('TZ0', 'TZ1', 'TZ2', 'TZ3')),
  paper_number int,
  kind text not null default 'paper' check (kind in ('paper', 'markscheme', 'prerelease')),
  page_count int not null default 0,
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers (id) on delete cascade,
  number int not null,
  label text not null,
  start_page int not null,
  end_page int not null,
  marks int,
  page_level boolean not null default false, -- true = split by page because numbering was unclear
  unique (paper_id, number)
);
create index if not exists questions_paper_idx on public.questions (paper_id);

create table if not exists public.question_tags (
  question_id uuid not null references public.questions (id) on delete cascade,
  topic text not null,
  confidence real not null default 1,
  source text not null default 'auto' check (source in ('auto', 'owner')),
  primary key (question_id, topic)
);
create index if not exists question_tags_topic_idx on public.question_tags (topic);

create table if not exists public.progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  done boolean not null default false,
  score int,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can read profiles)
-- ---------------------------------------------------------------------------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner' and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- Signup: create the profile; refuse emails outside the allowed domain.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_email text := (select value from private.config where key = 'owner_email');
  domain text := (select nullif(trim(lower(allowed_domain)), '') from public.app_settings where id = 1);
  is_owner_user boolean := lower(new.email) = owner_email;
begin
  if not is_owner_user and domain is not null and split_part(lower(new.email), '@', 2) <> domain then
    raise exception 'Only % email addresses can request access', domain;
  end if;
  insert into public.profiles (id, email, full_name, status, role)
  values (
    new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when is_owner_user then 'approved' else 'pending' end,
    case when is_owner_user then 'owner' else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- If the owner already signed up before this script ran (or the email changed), promote them.
update public.profiles set role = 'owner', status = 'approved'
where email = (select value from private.config where key = 'owner_email');

-- Owners cannot lock themselves out; students cannot change status/role.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' then
    new.role := 'owner';
    new.status := 'approved';
  end if;
  new.email := old.email;
  return new;
end;
$$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
for each row execute function public.protect_profile();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.papers enable row level security;
alter table public.questions enable row level security;
alter table public.question_tags enable row level security;
alter table public.progress enable row level security;

revoke all on public.papers, public.questions, public.question_tags, public.progress from anon;

-- profiles
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
drop policy if exists "profiles: owner updates" on public.profiles;
create policy "profiles: owner updates" on public.profiles for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "profiles: owner deletes" on public.profiles;
create policy "profiles: owner deletes" on public.profiles for delete to authenticated
  using (public.is_owner() and role <> 'owner');

-- app_settings (signed-in users read; signup domain comes from public.signup_domain())
drop policy if exists "settings: read" on public.app_settings;
create policy "settings: read" on public.app_settings for select to authenticated using (true);
drop policy if exists "settings: owner writes" on public.app_settings;
create policy "settings: owner writes" on public.app_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create or replace function public.signup_domain() returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(lower(allowed_domain)), '') from public.app_settings where id = 1;
$$;
grant execute on function public.signup_domain() to anon, authenticated;

-- library tables: approved users read, owner writes
drop policy if exists "papers: approved read" on public.papers;
create policy "papers: approved read" on public.papers for select to authenticated using (public.is_approved());
drop policy if exists "papers: owner write" on public.papers;
create policy "papers: owner write" on public.papers for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "questions: approved read" on public.questions;
create policy "questions: approved read" on public.questions for select to authenticated using (public.is_approved());
drop policy if exists "questions: owner write" on public.questions;
create policy "questions: owner write" on public.questions for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "tags: approved read" on public.question_tags;
create policy "tags: approved read" on public.question_tags for select to authenticated using (public.is_approved());
drop policy if exists "tags: owner write" on public.question_tags;
create policy "tags: owner write" on public.question_tags for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- progress: each person only sees and edits their own rows
drop policy if exists "progress: own rows" on public.progress;
create policy "progress: own rows" on public.progress for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- ---------------------------------------------------------------------------
-- Storage: private bucket "papers"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('papers', 'papers', false)
on conflict (id) do update set public = false;

drop policy if exists "papers bucket: approved read" on storage.objects;
create policy "papers bucket: approved read" on storage.objects for select to authenticated
  using (bucket_id = 'papers' and public.is_approved());
drop policy if exists "papers bucket: owner insert" on storage.objects;
create policy "papers bucket: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'papers' and public.is_owner());
drop policy if exists "papers bucket: owner update" on storage.objects;
create policy "papers bucket: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'papers' and public.is_owner());
drop policy if exists "papers bucket: owner delete" on storage.objects;
create policy "papers bucket: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'papers' and public.is_owner());

-- ---------------------------------------------------------------------------
-- Homework (tutor mode): student groups, sets, assignments, answers
-- ---------------------------------------------------------------------------
create table if not exists public.student_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.student_group_members (
  group_id uuid not null references public.student_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);

create table if not exists public.homework_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  due_date date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.homework_items (
  set_id uuid not null references public.homework_sets (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  position int not null,
  primary key (set_id, question_id)
);

create table if not exists public.homework_assignments (
  set_id uuid not null references public.homework_sets (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.student_groups (id) on delete set null,
  assigned_at timestamptz not null default now(),
  owner_comment text not null default '',
  owner_comment_at timestamptz,
  primary key (set_id, user_id)
);
create index if not exists homework_assignments_user_idx on public.homework_assignments (user_id);

create table if not exists public.homework_answers (
  set_id uuid not null references public.homework_sets (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  done boolean not null default false,
  score int,
  comment text not null default '',
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (set_id, question_id, user_id)
);

-- True when the signed-in, approved user is assigned to this set (security definer: avoids policy recursion).
create or replace function public.is_assigned(p_set uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.homework_assignments where set_id = p_set and user_id = auth.uid()
  );
$$;

alter table public.student_groups enable row level security;
alter table public.student_group_members enable row level security;
alter table public.homework_sets enable row level security;
alter table public.homework_items enable row level security;
alter table public.homework_assignments enable row level security;
alter table public.homework_answers enable row level security;
revoke all on public.student_groups, public.student_group_members, public.homework_sets, public.homework_items,
  public.homework_assignments, public.homework_answers from anon;

drop policy if exists "groups: owner" on public.student_groups;
create policy "groups: owner" on public.student_groups for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "group members: owner" on public.student_group_members;
create policy "group members: owner" on public.student_group_members for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "hw sets: owner" on public.homework_sets;
create policy "hw sets: owner" on public.homework_sets for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "hw sets: assigned read" on public.homework_sets;
create policy "hw sets: assigned read" on public.homework_sets for select to authenticated
  using (public.is_assigned(id));

drop policy if exists "hw items: owner" on public.homework_items;
create policy "hw items: owner" on public.homework_items for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "hw items: assigned read" on public.homework_items;
create policy "hw items: assigned read" on public.homework_items for select to authenticated
  using (public.is_assigned(set_id));

drop policy if exists "hw assignments: owner" on public.homework_assignments;
create policy "hw assignments: owner" on public.homework_assignments for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "hw assignments: own read" on public.homework_assignments;
create policy "hw assignments: own read" on public.homework_assignments for select to authenticated
  using (user_id = auth.uid() and public.is_approved());

drop policy if exists "hw answers: owner" on public.homework_answers;
create policy "hw answers: owner" on public.homework_answers for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "hw answers: own rows" on public.homework_answers;
create policy "hw answers: own rows" on public.homework_answers for all to authenticated
  using (user_id = auth.uid() and public.is_assigned(set_id))
  with check (user_id = auth.uid() and public.is_assigned(set_id));


-- ---------------------------------------------------------------------------
-- Search: each question's extracted text + full-text indexes (English stemming + "simple" for Spanish)
-- ---------------------------------------------------------------------------
alter table public.questions add column if not exists body text not null default '';
alter table public.questions add column if not exists search_en tsvector
  generated always as (to_tsvector('english', body)) stored;
alter table public.questions add column if not exists search_simple tsvector
  generated always as (to_tsvector('simple', body)) stored;
create index if not exists questions_search_en_idx on public.questions using gin (search_en);
create index if not exists questions_search_simple_idx on public.questions using gin (search_simple);

-- Security invoker: the questions/papers RLS policies decide what each person can find.
drop function if exists public.search_questions(text, text, int, int, int);
create or replace function public.search_questions(
  p_query text, p_subject text default null, p_paper int default null, p_year int default null, p_limit int default 50
) returns table (
  question_id uuid, paper_id uuid, subject text, level text, year int, session text, timezone text,
  paper_number int, number int, label text, page_level boolean, start_page int, marks int, snippet text, rank real
)
language sql stable security invoker set search_path = public as $$
  with q as (
    select websearch_to_tsquery('english', p_query) as en, websearch_to_tsquery('simple', p_query) as si
  )
  select qu.id, p.id, p.subject, p.level, p.year, p.session, p.timezone, p.paper_number, qu.number, qu.label,
    qu.page_level, qu.start_page, qu.marks,
    case when qu.search_en @@ q.en
      then ts_headline('english', qu.body, q.en, 'StartSel=⟦, StopSel=⟧, MaxWords=28, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "')
      else ts_headline('simple', qu.body, q.si, 'StartSel=⟦, StopSel=⟧, MaxWords=28, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "')
    end,
    greatest(ts_rank(qu.search_en, q.en), ts_rank(qu.search_simple, q.si))
  from public.questions qu
  join public.papers p on p.id = qu.paper_id
  cross join q
  where p.kind = 'paper'
    and (qu.search_en @@ q.en or qu.search_simple @@ q.si)
    and (p_subject is null or p.subject = p_subject)
    and (p_paper is null or p.paper_number = p_paper)
    and (p_year is null or p.year = p_year)
  order by 15 desc, p.year desc nulls last, qu.number
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke all on function public.search_questions(text, text, int, int, int) from public, anon;
grant execute on function public.search_questions(text, text, int, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Practice mode settings (owner edits the JSON in People → Settings)
-- {"minutesPerMark": 1.5, "subjects": {"math-ai": 1.2}}
-- ---------------------------------------------------------------------------
alter table public.app_settings add column if not exists practice_settings jsonb not null
  default '{"minutesPerMark": 1.5, "subjects": {}}'::jsonb;

-- ---------------------------------------------------------------------------
-- Exact markscheme jump: page range of each paper question inside its markscheme
-- ---------------------------------------------------------------------------
create table if not exists public.markscheme_ranges (
  question_id uuid primary key references public.questions (id) on delete cascade, -- the paper's question
  markscheme_id uuid not null references public.papers (id) on delete cascade,
  start_page int not null,
  end_page int not null,
  source text not null default 'auto' check (source in ('auto', 'owner')), -- owner = corrected by hand
  updated_at timestamptz not null default now(),
  check (end_page >= start_page and start_page >= 1)
);
alter table public.markscheme_ranges enable row level security;
revoke all on public.markscheme_ranges from anon;
drop policy if exists "ms ranges: approved read" on public.markscheme_ranges;
create policy "ms ranges: approved read" on public.markscheme_ranges for select to authenticated using (public.is_approved());
drop policy if exists "ms ranges: owner write" on public.markscheme_ranges;
create policy "ms ranges: owner write" on public.markscheme_ranges for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Pre-release statements (Business Management Paper 1): a third file kind
-- ---------------------------------------------------------------------------
alter table public.papers drop constraint if exists papers_kind_check;
alter table public.papers add constraint papers_kind_check check (kind in ('paper', 'markscheme', 'prerelease'));

-- Timezone 3 (e.g. Math AI papers)
alter table public.papers drop constraint if exists papers_timezone_check;
alter table public.papers add constraint papers_timezone_check check (timezone in ('TZ0', 'TZ1', 'TZ2', 'TZ3'));

-- ---------------------------------------------------------------------------
-- Homework submissions: students upload photos of their answers, the owner marks them and then deletes them.
-- Files live in the private "submissions" bucket under <student id>/<set id>/...
-- ---------------------------------------------------------------------------
create table if not exists public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.homework_sets (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  files text[] not null default '{}',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists homework_submissions_set_idx on public.homework_submissions (set_id);
alter table public.homework_submissions enable row level security;
revoke all on public.homework_submissions from anon;
drop policy if exists "submissions: owner" on public.homework_submissions;
create policy "submissions: owner" on public.homework_submissions for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "submissions: own" on public.homework_submissions;
create policy "submissions: own" on public.homework_submissions for all to authenticated
  using (user_id = auth.uid() and public.is_assigned(set_id))
  with check (user_id = auth.uid() and public.is_assigned(set_id));

alter table public.homework_assignments add column if not exists owner_score numeric;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists "submissions bucket: owner" on storage.objects;
create policy "submissions bucket: owner" on storage.objects for all to authenticated
  using (bucket_id = 'submissions' and public.is_owner()) with check (bucket_id = 'submissions' and public.is_owner());
drop policy if exists "submissions bucket: own" on storage.objects;
create policy "submissions bucket: own" on storage.objects for all to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved()
    and public.is_assigned(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved()
    and public.is_assigned(((storage.foldername(name))[2])::uuid));

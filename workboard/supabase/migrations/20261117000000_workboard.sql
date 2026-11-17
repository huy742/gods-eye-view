-- WorkBoard database for Supabase.
--
-- Everything belongs to a workspace (a company or a team). Only people who
-- joined that workspace can read or change its data; Row Level Security
-- below enforces that for every request, whatever the browser sends.
--
-- Run this once on a new project: Supabase dashboard → SQL Editor → paste → Run.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  title text not null default '' check (char_length(title) <= 120),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

-- A profile is made for everyone who signs up.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, color)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), ''), 120),
    (array['#2563eb', '#e5484d', '#27ae60', '#f2994a', '#8b5cf6', '#0891b2', '#db2777', '#64748b'])[1 + floor(random() * 8)::int]
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Workspaces and who belongs to them
-- ---------------------------------------------------------------------------
create function private.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  invite_code text not null unique default private.new_invite_code(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Work
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create index departments_ws_idx on public.departments (workspace_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null default 'project' check (kind in ('project', 'team')),
  name text not null check (char_length(name) between 1 and 200),
  dept_id uuid references public.departments (id) on delete set null,
  admin_id uuid references public.profiles (id) on delete set null,
  member_ids uuid[] not null default '{}',
  type text not null default 'internal' check (type in ('internal', 'customer')),
  review boolean not null default false,
  private boolean not null default false,
  start_date date,
  end_date date,
  stage text not null default 'plan'
    check (stage in ('plan', 'adjust', 'urgent', 'closed_done', 'closed_unfinished', 'closed_paused')),
  description text not null default '' check (char_length(description) <= 5000),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index projects_ws_idx on public.projects (workspace_id);

create table public.tasklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index tasklists_ws_idx on public.tasklists (workspace_id);
create index tasklists_project_idx on public.tasklists (project_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  due_date date,
  created_at timestamptz not null default now()
);
create index milestones_ws_idx on public.milestones (workspace_id);
create index milestones_project_idx on public.milestones (project_id);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  type text not null default 'text' check (type in ('text', 'textarea', 'number', 'date', 'select')),
  options text[] not null default '{}',
  required boolean not null default false,
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index custom_fields_ws_idx on public.custom_fields (workspace_id);
create index custom_fields_project_idx on public.custom_fields (project_id);

create table public.repeat_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  tasklist_id uuid references public.tasklists (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  assignee_id uuid references public.profiles (id) on delete set null,
  follower_ids uuid[] not null default '{}',
  freq text not null default 'week' check (freq in ('day', 'week', 'month', 'year')),
  every integer not null default 1 check (every between 1 and 99),
  weekdays integer[] not null default '{}',
  month_day text not null default '1' check (month_day ~ '^([1-9]|[12][0-9]|3[01]|last)$'),
  start_date date not null,
  end_date date,
  due_time time,
  important boolean not null default false,
  urgent boolean not null default false,
  checklist text[] not null default '{}',
  subtasks text[] not null default '{}',
  enabled boolean not null default true,
  last_run date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index repeat_rules_ws_idx on public.repeat_rules (workspace_id);
create index repeat_rules_project_idx on public.repeat_rules (project_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  tasklist_id uuid references public.tasklists (id) on delete cascade,
  parent_id uuid references public.tasks (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 500),
  description text not null default '' check (char_length(description) <= 20000),
  assignee_id uuid references public.profiles (id) on delete set null,
  follower_ids uuid[] not null default '{}',
  start_date date,
  due_date date,
  due_time time,
  important boolean not null default false,
  urgent boolean not null default false,
  milestone_id uuid references public.milestones (id) on delete set null,
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  depends_on uuid[] not null default '{}',
  result text not null default '' check (char_length(result) <= 20000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  done_at timestamptz,
  submitted_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  position double precision not null default 0,
  custom jsonb not null default '{}' check (jsonb_typeof(custom) = 'object'),
  repeat_id uuid references public.repeat_rules (id) on delete set null,
  repeat_date date,
  check (due_time is null or due_date is not null)
);
create index tasks_ws_idx on public.tasks (workspace_id);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_assignee_idx on public.tasks (assignee_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index comments_ws_idx on public.comments (workspace_id);
create index comments_task_idx on public.comments (task_id);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  text text not null check (char_length(text) between 1 and 600),
  created_at timestamptz not null default now()
);
create index activity_ws_idx on public.activity (workspace_id);
create index activity_task_idx on public.activity (task_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind text not null check (kind in ('assign', 'comment', 'mention', 'review', 'approved', 'returned', 'done')),
  text text not null default '' check (char_length(text) <= 200),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, workspace_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  kind text not null default 'project' check (kind in ('project', 'team')),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 500000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index templates_ws_idx on public.templates (workspace_id);

-- ---------------------------------------------------------------------------
-- Helper checks used by the security rules. They live in a schema the API
-- does not expose, and run with the owner's rights so they can look up
-- membership without being blocked by the rules they implement.
-- ---------------------------------------------------------------------------
create function private.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create function private.is_ws_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;

create function private.ws_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.workspace_members m
  where m.workspace_id = ws and m.user_id = (select auth.uid());
$$;

-- Someone can see a project when they belong to its workspace and the
-- project is not private, or they are its admin, a member, or a workspace admin.
create function private.can_see_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.workspace_members m
      on m.workspace_id = p.workspace_id and m.user_id = (select auth.uid())
    where p.id = pid
      and (not p.private or p.admin_id = m.user_id or m.user_id = any (p.member_ids) or m.role in ('owner', 'admin'))
  );
$$;

create function private.is_project_admin(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.workspace_members m
      on m.workspace_id = p.workspace_id and m.user_id = (select auth.uid())
    where p.id = pid and (p.admin_id = m.user_id or m.role in ('owner', 'admin'))
  );
$$;

create function private.can_see_task(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.can_see_project(t.project_id) from public.tasks t where t.id = tid), false);
$$;

create function private.shares_workspace(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other = (select auth.uid()) or exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;

grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Rules kept by the database itself
-- ---------------------------------------------------------------------------

-- Rows inside a project always carry that project's workspace.
create function private.set_workspace_from_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.workspace_id into new.workspace_id from public.projects p where p.id = new.project_id;
  if new.workspace_id is null then
    raise exception 'Không tìm thấy dự án.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create function private.set_workspace_from_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.workspace_id into new.workspace_id from public.tasks t where t.id = new.task_id;
  if new.workspace_id is null then
    raise exception 'Không tìm thấy công việc.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger tasklists_workspace before insert or update of project_id on public.tasklists
  for each row execute function private.set_workspace_from_project();
create trigger milestones_workspace before insert or update of project_id on public.milestones
  for each row execute function private.set_workspace_from_project();
create trigger custom_fields_workspace before insert or update of project_id on public.custom_fields
  for each row execute function private.set_workspace_from_project();
create trigger repeat_rules_workspace before insert or update of project_id on public.repeat_rules
  for each row execute function private.set_workspace_from_project();
create trigger tasks_workspace before insert or update of project_id on public.tasks
  for each row execute function private.set_workspace_from_project();
create trigger comments_workspace before insert on public.comments
  for each row execute function private.set_workspace_from_task();
create trigger activity_workspace before insert on public.activity
  for each row execute function private.set_workspace_from_task();
create trigger notifications_workspace before insert on public.notifications
  for each row execute function private.set_workspace_from_task();

-- Projects: stay in their workspace; admin, members and department must belong to it.
create function private.project_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce((select auth.uid()), new.created_by);
  end if;
  new.member_ids := coalesce(array(
    select distinct x from unnest(new.member_ids) as x
    where exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = x)
  ), '{}');
  if new.admin_id is not null and not exists (
    select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.admin_id
  ) then
    raise exception 'Người quản trị phải là thành viên của không gian làm việc.' using errcode = '23514';
  end if;
  if new.dept_id is not null and not exists (
    select 1 from public.departments d where d.id = new.dept_id and d.workspace_id = new.workspace_id
  ) then
    new.dept_id := null;
  end if;
  return new;
end;
$$;

create trigger projects_rules before insert or update on public.projects
  for each row execute function private.project_rules();

-- Tasks: who created a task never changes, and in a project with review
-- only the person who gave the task or a project admin can mark it done.
create function private.task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  needs_review boolean;
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  if (select auth.uid()) is not null
     and new.status = 'done'
     and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    select p.review into needs_review from public.projects p where p.id = new.project_id;
    if needs_review
       and new.created_by is distinct from (select auth.uid())
       and not private.is_project_admin(new.project_id) then
      raise exception 'Công việc này cần người giao việc hoặc quản trị dự án duyệt.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from public.custom_fields f
      where f.project_id = new.project_id and f.required
        and coalesce(trim(new.custom ->> f.id::text), '') = ''
    ) then
      raise exception 'Còn trường bắt buộc chưa điền.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_rules before insert or update on public.tasks
  for each row execute function private.task_rules();

-- Comments and history keep their author and time.
create function private.keep_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.task_id := old.task_id;
  new.workspace_id := old.workspace_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger comments_keep_author before update on public.comments
  for each row execute function private.keep_author();

-- ---------------------------------------------------------------------------
-- Actions that need more than one table: create, join and manage a workspace
-- ---------------------------------------------------------------------------
create function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ws uuid;
begin
  if uid is null then
    raise exception 'Bạn cần đăng nhập.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Hãy đặt tên cho không gian làm việc.' using errcode = '23514';
  end if;
  if (select count(*) from public.workspace_members m where m.user_id = uid and m.role = 'owner') >= 20 then
    raise exception 'Bạn đã tạo quá nhiều không gian làm việc.' using errcode = '54000';
  end if;
  insert into public.workspaces (name, created_by) values (left(trim(p_name), 120), uid) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner');
  return ws;
end;
$$;

create function public.join_workspace(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ws uuid;
begin
  if uid is null then
    raise exception 'Bạn cần đăng nhập.' using errcode = '42501';
  end if;
  select w.id into ws from public.workspaces w where w.invite_code = upper(trim(p_code));
  if ws is null then
    raise exception 'Mã mời không đúng hoặc đã được đổi.' using errcode = 'P0002';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, uid, 'member')
  on conflict (workspace_id, user_id) do nothing;
  return ws;
end;
$$;

create function public.reset_invite_code(p_workspace uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if not private.is_ws_admin(p_workspace) then
    raise exception 'Chỉ chủ sở hữu hoặc quản trị mới đổi được mã mời.' using errcode = '42501';
  end if;
  update public.workspaces set invite_code = private.new_invite_code()
  where id = p_workspace returning invite_code into code;
  return code;
end;
$$;

revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.join_workspace(text) from public, anon;
revoke execute on function public.reset_invite_code(uuid) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.join_workspace(text) to authenticated;
grant execute on function public.reset_invite_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: who may read and change what
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.departments enable row level security;
alter table public.projects enable row level security;
alter table public.tasklists enable row level security;
alter table public.milestones enable row level security;
alter table public.custom_fields enable row level security;
alter table public.repeat_rules enable row level security;
alter table public.tasks enable row level security;
alter table public.comments enable row level security;
alter table public.activity enable row level security;
alter table public.notifications enable row level security;
alter table public.templates enable row level security;

-- Nobody signed out can reach any of it.
revoke all on all tables in schema public from anon;

-- profiles: see people you share a workspace with; edit only yourself.
create policy "profiles: see co-workers" on public.profiles for select to authenticated
  using (private.shares_workspace(id));
create policy "profiles: edit yourself" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (name, title, color) on public.profiles to authenticated;

-- workspaces: members see it; owner and admins rename it; owner deletes it.
create policy "workspaces: members see" on public.workspaces for select to authenticated
  using (private.is_member(id));
create policy "workspaces: admins rename" on public.workspaces for update to authenticated
  using (private.is_ws_admin(id)) with check (private.is_ws_admin(id));
create policy "workspaces: owner deletes" on public.workspaces for delete to authenticated
  using (private.ws_role(id) = 'owner');
revoke insert, update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;

-- workspace_members: members see each other; admins change roles and remove
-- people (never the owner); anyone but the owner can leave.
create policy "members: see each other" on public.workspace_members for select to authenticated
  using (private.is_member(workspace_id));
create policy "members: admins set roles" on public.workspace_members for update to authenticated
  using (private.is_ws_admin(workspace_id) and role <> 'owner')
  with check (role in ('admin', 'member'));
create policy "members: remove or leave" on public.workspace_members for delete to authenticated
  using (role <> 'owner' and (private.is_ws_admin(workspace_id) or user_id = (select auth.uid())));
revoke insert, update on public.workspace_members from authenticated;
grant update (role) on public.workspace_members to authenticated;

-- departments: members see; owner and admins manage.
create policy "departments: members see" on public.departments for select to authenticated
  using (private.is_member(workspace_id));
create policy "departments: admins add" on public.departments for insert to authenticated
  with check (private.is_ws_admin(workspace_id));
create policy "departments: admins edit" on public.departments for update to authenticated
  using (private.is_ws_admin(workspace_id)) with check (private.is_ws_admin(workspace_id));
create policy "departments: admins delete" on public.departments for delete to authenticated
  using (private.is_ws_admin(workspace_id));

-- projects: seen by those allowed; any member creates; the project admin manages.
create policy "projects: see" on public.projects for select to authenticated
  using (private.can_see_project(id));
create policy "projects: members create" on public.projects for insert to authenticated
  with check (private.is_member(workspace_id));
create policy "projects: admin edits" on public.projects for update to authenticated
  using (private.is_project_admin(id)) with check (private.is_member(workspace_id));
create policy "projects: admin deletes" on public.projects for delete to authenticated
  using (private.is_project_admin(id));

-- tasklists, milestones, repeat rules: anyone who can see the project works with them;
-- removing a tasklist (and its tasks) is for the project admin.
create policy "tasklists: see" on public.tasklists for select to authenticated
  using (private.can_see_project(project_id));
create policy "tasklists: add" on public.tasklists for insert to authenticated
  with check (private.can_see_project(project_id));
create policy "tasklists: edit" on public.tasklists for update to authenticated
  using (private.can_see_project(project_id)) with check (private.can_see_project(project_id));
create policy "tasklists: admin deletes" on public.tasklists for delete to authenticated
  using (private.is_project_admin(project_id));

create policy "milestones: see" on public.milestones for select to authenticated
  using (private.can_see_project(project_id));
create policy "milestones: add" on public.milestones for insert to authenticated
  with check (private.can_see_project(project_id));
create policy "milestones: edit" on public.milestones for update to authenticated
  using (private.can_see_project(project_id)) with check (private.can_see_project(project_id));
create policy "milestones: delete" on public.milestones for delete to authenticated
  using (private.can_see_project(project_id));

create policy "repeat rules: see" on public.repeat_rules for select to authenticated
  using (private.can_see_project(project_id));
create policy "repeat rules: add" on public.repeat_rules for insert to authenticated
  with check (private.can_see_project(project_id));
create policy "repeat rules: edit" on public.repeat_rules for update to authenticated
  using (private.can_see_project(project_id)) with check (private.can_see_project(project_id));
create policy "repeat rules: delete" on public.repeat_rules for delete to authenticated
  using (private.can_see_project(project_id));

-- custom fields: everyone in the project sees them; only the project admin changes them.
create policy "fields: see" on public.custom_fields for select to authenticated
  using (private.can_see_project(project_id));
create policy "fields: admin adds" on public.custom_fields for insert to authenticated
  with check (private.is_project_admin(project_id));
create policy "fields: admin edits" on public.custom_fields for update to authenticated
  using (private.is_project_admin(project_id)) with check (private.is_project_admin(project_id));
create policy "fields: admin deletes" on public.custom_fields for delete to authenticated
  using (private.is_project_admin(project_id));

-- tasks: anyone who can see the project works on them; deleting is for the
-- person who gave the task or the project admin.
create policy "tasks: see" on public.tasks for select to authenticated
  using (private.can_see_project(project_id));
create policy "tasks: add" on public.tasks for insert to authenticated
  with check (private.can_see_project(project_id));
create policy "tasks: edit" on public.tasks for update to authenticated
  using (private.can_see_project(project_id)) with check (private.can_see_project(project_id));
create policy "tasks: delete" on public.tasks for delete to authenticated
  using (created_by = (select auth.uid()) or private.is_project_admin(project_id));

-- comments: seen with the task; written as yourself; edited or removed only by their author.
create policy "comments: see" on public.comments for select to authenticated
  using (private.can_see_task(task_id));
create policy "comments: write as yourself" on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_see_task(task_id));
create policy "comments: author edits" on public.comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "comments: author deletes" on public.comments for delete to authenticated
  using (user_id = (select auth.uid()));

-- history: seen with the task; added as yourself; never edited.
create policy "activity: see" on public.activity for select to authenticated
  using (private.can_see_task(task_id));
create policy "activity: add as yourself" on public.activity for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_see_task(task_id));
revoke update on public.activity from authenticated;

-- notifications: only the person they are for reads them; they are sent by
-- yourself, about a task you can see, to someone in the same workspace.
create policy "notifications: read your own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: mark your own" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: clear your own" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: send" on public.notifications for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and private.can_see_task(task_id)
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = notifications.workspace_id and m.user_id = notifications.user_id
    )
  );
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- templates: shared in the workspace; removed by their author or an admin.
create policy "templates: members see" on public.templates for select to authenticated
  using (private.is_member(workspace_id));
create policy "templates: members add" on public.templates for insert to authenticated
  with check (private.is_member(workspace_id) and created_by = (select auth.uid()));
create policy "templates: author or admin edits" on public.templates for update to authenticated
  using (created_by = (select auth.uid()) or private.is_ws_admin(workspace_id))
  with check (private.is_member(workspace_id));
create policy "templates: author or admin deletes" on public.templates for delete to authenticated
  using (created_by = (select auth.uid()) or private.is_ws_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Live updates: changes to these tables are pushed to open browsers
-- (each person only receives rows the rules above let them read).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.departments,
  public.projects,
  public.tasklists,
  public.milestones,
  public.custom_fields,
  public.repeat_rules,
  public.tasks,
  public.comments,
  public.activity,
  public.notifications,
  public.templates;

create extension if not exists pgcrypto with schema extensions;

create table public.shared_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  share_token_hash bytea not null unique,
  created_at timestamptz not null default now()
);

create table public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.shared_projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.shared_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 240),
  note text not null default '' check (char_length(note) <= 2000),
  completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index shared_lists_order_idx on public.shared_lists(project_id, position, created_at);
create index shared_list_items_order_idx on public.shared_list_items(list_id, position, created_at);

alter table public.shared_projects enable row level security;
alter table public.shared_lists enable row level security;
alter table public.shared_list_items enable row level security;
revoke all on public.shared_projects, public.shared_lists, public.shared_list_items from public, anon, authenticated;

create or replace function public.create_shared_project(p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_title text := btrim(p_title);
begin
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Project name must be between 1 and 120 characters';
  end if;
  insert into public.shared_projects (id, title, share_token_hash)
  values (v_id, v_title, extensions.digest(v_token, 'sha256'));
  return jsonb_build_object('id', v_id, 'title', v_title, 'token', v_token, 'lists', '[]'::jsonb);
end;
$$;

create or replace function public.get_shared_project(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'text', i.text,
            'note', i.note,
            'completed', i.completed
          ) order by i.position, i.created_at)
          from public.shared_list_items i where i.list_id = l.id
        ), '[]'::jsonb)
      ) order by l.position, l.created_at)
      from public.shared_lists l where l.project_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.shared_projects p
  where p.share_token_hash = extensions.digest(p_token, 'sha256');

  if v_result is null then raise exception 'This sharing link is invalid or has been replaced'; end if;
  return v_result;
end;
$$;

create or replace function public.rename_shared_project(p_token text, p_title text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'Project name is required'; end if;
  update public.shared_projects set title = btrim(p_title)
  where share_token_hash = extensions.digest(p_token, 'sha256');
  if not found then raise exception 'Invalid sharing link'; end if;
  return true;
end;
$$;

create or replace function public.delete_shared_project(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if not found then raise exception 'Invalid sharing link'; end if;
  return true;
end;
$$;

create or replace function public.add_shared_list(p_token text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_list public.shared_lists%rowtype;
begin
  select id into v_project_id from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if v_project_id is null then raise exception 'Invalid sharing link'; end if;
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'List name is required'; end if;
  insert into public.shared_lists (project_id, title, position)
  values (v_project_id, btrim(p_title), coalesce((select max(position) + 1 from public.shared_lists where project_id = v_project_id), 0))
  returning * into v_list;
  return jsonb_build_object('id', v_list.id, 'title', v_list.title, 'items', '[]'::jsonb);
end;
$$;

create or replace function public.rename_shared_list(p_token text, p_list_id uuid, p_title text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if v_project_id is null then raise exception 'Invalid sharing link'; end if;
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'List name is required'; end if;
  update public.shared_lists set title = btrim(p_title) where id = p_list_id and project_id = v_project_id;
  if not found then raise exception 'List not found'; end if;
  return true;
end;
$$;

create or replace function public.delete_shared_list(p_token text, p_list_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if v_project_id is null then raise exception 'Invalid sharing link'; end if;
  delete from public.shared_lists where id = p_list_id and project_id = v_project_id;
  if not found then raise exception 'List not found'; end if;
  return true;
end;
$$;

create or replace function public.add_shared_item(p_token text, p_list_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_item public.shared_list_items%rowtype;
begin
  select id into v_project_id from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if v_project_id is null then raise exception 'Invalid sharing link'; end if;
  if not exists (select 1 from public.shared_lists where id = p_list_id and project_id = v_project_id) then raise exception 'List not found'; end if;
  insert into public.shared_list_items (list_id, text, position)
  values (p_list_id, btrim(p_text), coalesce((select max(position) + 1 from public.shared_list_items where list_id = p_list_id), 0))
  returning * into v_item;
  return jsonb_build_object('id', v_item.id, 'text', v_item.text, 'note', v_item.note, 'completed', v_item.completed);
end;
$$;

create or replace function public.update_shared_item(
  p_token text, p_list_id uuid, p_item_id uuid,
  p_text text default null, p_note text default null, p_completed boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if v_project_id is null then raise exception 'Invalid sharing link'; end if;
  update public.shared_list_items i
  set text = coalesce(btrim(p_text), i.text), note = coalesce(p_note, i.note), completed = coalesce(p_completed, i.completed)
  from public.shared_lists l
  where i.id = p_item_id and i.list_id = p_list_id and l.id = i.list_id and l.project_id = v_project_id;
  if not found then raise exception 'List item not found'; end if;
  return true;
end;
$$;

create or replace function public.delete_shared_item(p_token text, p_list_id uuid, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id from public.shared_projects where share_token_hash = extensions.digest(p_token, 'sha256');
  if v_project_id is null then raise exception 'Invalid sharing link'; end if;
  delete from public.shared_list_items i using public.shared_lists l
  where i.id = p_item_id and i.list_id = p_list_id and l.id = i.list_id and l.project_id = v_project_id;
  if not found then raise exception 'List item not found'; end if;
  return true;
end;
$$;

create or replace function public.rotate_shared_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
begin
  update public.shared_projects set share_token_hash = extensions.digest(v_token, 'sha256')
  where share_token_hash = extensions.digest(p_token, 'sha256');
  if not found then raise exception 'Invalid sharing link'; end if;
  return jsonb_build_object('token', v_token);
end;
$$;

revoke all on function public.create_shared_project(text) from public;
revoke all on function public.get_shared_project(text) from public;
revoke all on function public.rename_shared_project(text, text) from public;
revoke all on function public.delete_shared_project(text) from public;
revoke all on function public.add_shared_list(text, text) from public;
revoke all on function public.rename_shared_list(text, uuid, text) from public;
revoke all on function public.delete_shared_list(text, uuid) from public;
revoke all on function public.add_shared_item(text, uuid, text) from public;
revoke all on function public.update_shared_item(text, uuid, uuid, text, text, boolean) from public;
revoke all on function public.delete_shared_item(text, uuid, uuid) from public;
revoke all on function public.rotate_shared_link(text) from public;

grant execute on function public.create_shared_project(text) to anon;
grant execute on function public.get_shared_project(text) to anon;
grant execute on function public.rename_shared_project(text, text) to anon;
grant execute on function public.delete_shared_project(text) to anon;
grant execute on function public.add_shared_list(text, text) to anon;
grant execute on function public.rename_shared_list(text, uuid, text) to anon;
grant execute on function public.delete_shared_list(text, uuid) to anon;
grant execute on function public.add_shared_item(text, uuid, text) to anon;
grant execute on function public.update_shared_item(text, uuid, uuid, text, text, boolean) to anon;
grant execute on function public.delete_shared_item(text, uuid, uuid) to anon;
grant execute on function public.rotate_shared_link(text) to anon;
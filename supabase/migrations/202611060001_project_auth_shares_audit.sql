create schema if not exists private;

alter table public.shared_projects
  add column owner_id uuid references auth.users(id) on delete set null,
  alter column share_token_hash drop not null;

create table public.project_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.shared_projects(id) on delete cascade,
  token_hash bytea not null unique,
  permission text not null check (permission in ('read', 'items', 'lists')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index project_share_links_project_idx on public.project_share_links(project_id, created_at desc);

create table public.project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.shared_projects(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null check (char_length(btrim(actor_name)) between 1 and 60),
  actor_session_id text,
  action text not null,
  list_id uuid,
  item_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index project_activity_recent_idx on public.project_activity(project_id, created_at desc);

alter table public.project_share_links enable row level security;
alter table public.project_activity enable row level security;
revoke all on public.project_share_links, public.project_activity from public, anon, authenticated;

insert into public.project_share_links (project_id, token_hash, permission, label)
select id, share_token_hash, 'lists', '旧分享链接'
from public.shared_projects
where share_token_hash is not null;

update public.shared_projects set share_token_hash = null;

create or replace function private.resolve_project_access(p_project_id uuid, p_token text, p_required text)
returns table(resolved_project_id uuid, access_level text, is_owner boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_permission text;
  v_owner boolean := false;
  v_required_rank integer;
  v_permission_rank integer;
begin
  if auth.uid() is not null and p_project_id is not null then
    select p.id into v_project_id
    from public.shared_projects p
    where p.id = p_project_id and p.owner_id = auth.uid();
    if v_project_id is not null then
      v_owner := true;
      v_permission := 'owner';
    end if;
  end if;

  if v_project_id is null and p_token is not null then
    select p.id, l.permission into v_project_id, v_permission
    from public.project_share_links l
    join public.shared_projects p on p.id = l.project_id
    where l.token_hash = extensions.digest(p_token, 'sha256') and l.revoked_at is null;
  end if;

  if v_project_id is null then raise exception 'Project access link is invalid or revoked'; end if;

  v_required_rank := case p_required when 'read' then 1 when 'items' then 2 when 'lists' then 3 when 'owner' then 4 else 99 end;
  v_permission_rank := case v_permission when 'read' then 1 when 'items' then 2 when 'lists' then 3 when 'owner' then 4 else 0 end;
  if v_permission_rank < v_required_rank then raise exception 'This link does not allow that action'; end if;

  return query select v_project_id, v_permission, v_owner;
end;
$$;
revoke all on function private.resolve_project_access(uuid, text, text) from public, anon, authenticated;

create or replace function private.activity_actor_name(p_actor_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is not null
    then coalesce(nullif(split_part(coalesce(auth.jwt()->>'email',''), '@', 1), ''), 'Owner')
    else coalesce(nullif(left(btrim(p_actor_name),60),''),'Collaborator')
  end;
$$;
revoke all on function private.activity_actor_name(text) from public, anon, authenticated;

create or replace function public.list_my_projects()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'lists_count', (select count(*) from public.shared_lists l where l.project_id = p.id),
      'owner', true
    ) order by p.created_at desc)
    from public.shared_projects p where p.owner_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_shared_project(p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_title text := btrim(p_title);
begin
  if auth.uid() is null then raise exception 'Sign in to create a project'; end if;
  if char_length(v_title) not between 1 and 120 then raise exception 'Project name must be between 1 and 120 characters'; end if;
  insert into public.shared_projects(id, owner_id, title, share_token_hash)
  values (v_id, auth.uid(), v_title, null);
  return jsonb_build_object('id', v_id, 'title', v_title, 'lists', '[]'::jsonb, 'owner', true, 'access_level', 'owner');
end;
$$;

create or replace function public.get_shared_project(p_project_id uuid default null, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_access text;
  v_owner boolean;
  v_result jsonb;
begin
  select a.resolved_project_id, a.access_level, a.is_owner into v_project_id, v_access, v_owner
  from private.resolve_project_access(p_project_id, p_token, 'read') a;

  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'owner', v_owner,
    'access_level', v_access,
    'can_claim', p.owner_id is null and auth.uid() is not null,
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('id', i.id, 'text', i.text, 'note', i.note, 'completed', i.completed) order by i.position, i.created_at)
          from public.shared_list_items i where i.list_id = l.id
        ), '[]'::jsonb)
      ) order by l.position, l.created_at)
      from public.shared_lists l where l.project_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.shared_projects p where p.id = v_project_id;
  return v_result;
end;
$$;

create or replace function public.claim_legacy_project(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to claim this project'; end if;
  select l.project_id into v_project_id
  from public.project_share_links l
  join public.shared_projects p on p.id = l.project_id
  where l.token_hash = extensions.digest(p_token, 'sha256') and l.revoked_at is null and p.owner_id is null;
  if v_project_id is null then raise exception 'This legacy project is already claimed or the link is invalid'; end if;
  update public.shared_projects set owner_id = auth.uid() where id = v_project_id and owner_id is null;
  if not found then raise exception 'This project was claimed by another account'; end if;
  return jsonb_build_object('id', v_project_id, 'claimed', true);
end;
$$;

create or replace function public.create_project_share(p_project_id uuid, p_permission text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_label text := btrim(p_label);
begin
  if auth.uid() is null or not exists(select 1 from public.shared_projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'Only the project owner can create share links';
  end if;
  if p_permission not in ('read', 'items', 'lists') then raise exception 'Invalid share permission'; end if;
  if char_length(v_label) not between 1 and 80 then raise exception 'Link name must be between 1 and 80 characters'; end if;
  insert into public.project_share_links(id, project_id, token_hash, permission, label, created_by)
  values(v_id, p_project_id, extensions.digest(v_token, 'sha256'), p_permission, v_label, auth.uid());
  return jsonb_build_object('id', v_id, 'token', v_token, 'permission', p_permission, 'label', v_label);
end;
$$;

create or replace function public.list_project_shares(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.shared_projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'Only the project owner can manage share links';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'permission', permission, 'label', label, 'created_at', created_at, 'revoked', revoked_at is not null) order by created_at desc)
    from public.project_share_links where project_id = p_project_id), '[]'::jsonb);
end;
$$;

create or replace function public.revoke_project_share(p_project_id uuid, p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.shared_projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'Only the project owner can revoke share links';
  end if;
  update public.project_share_links set revoked_at = now() where id = p_link_id and project_id = p_project_id and revoked_at is null;
  if not found then raise exception 'Share link not found'; end if;
  return true;
end;
$$;

create or replace function public.rename_shared_project(p_project_id uuid, p_token text, p_title text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_old_title text;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id, p_token, 'owner');
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'Project name is required'; end if;
  update public.shared_projects set title = btrim(p_title) where id = v_project_id returning title into v_old_title;
  insert into public.project_activity(project_id, actor_user_id, actor_name, action, details)
  values(v_project_id, auth.uid(), coalesce(nullif(split_part(coalesce(auth.jwt()->>'email',''), '@', 1), ''), 'Owner'), 'project_renamed', jsonb_build_object('title', v_old_title));
  return true;
end;
$$;

create or replace function public.delete_shared_project(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Only the project owner can delete a project'; end if;
  delete from public.shared_projects where id = p_project_id and owner_id = auth.uid();
  if not found then raise exception 'Project not found or access denied'; end if;
  return true;
end;
$$;

create or replace function public.add_shared_list(p_project_id uuid, p_token text, p_title text, p_actor_name text default 'Collaborator', p_actor_session_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_list public.shared_lists%rowtype;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id, p_token, 'lists');
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'List name is required'; end if;
  insert into public.shared_lists(project_id, title, position)
  values(v_project_id, btrim(p_title), coalesce((select max(position) + 1 from public.shared_lists where project_id = v_project_id), 0)) returning * into v_list;
  insert into public.project_activity(project_id, actor_user_id, actor_name, actor_session_id, action, list_id, details)
  values(v_project_id, auth.uid(), private.activity_actor_name(p_actor_name), p_actor_session_id, 'list_created', v_list.id, jsonb_build_object('title',v_list.title));
  return jsonb_build_object('id',v_list.id,'title',v_list.title,'items','[]'::jsonb);
end;
$$;

create or replace function public.rename_shared_list(p_project_id uuid, p_token text, p_list_id uuid, p_title text, p_actor_name text default 'Collaborator', p_actor_session_id text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_old_title text;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id,p_token,'lists');
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'List name is required'; end if;
  update public.shared_lists set title=btrim(p_title) where id=p_list_id and project_id=v_project_id returning title into v_old_title;
  if not found then raise exception 'List not found'; end if;
  insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,details)
  values(v_project_id,auth.uid(),private.activity_actor_name(p_actor_name),p_actor_session_id,'list_renamed',p_list_id,jsonb_build_object('title',v_old_title));
  return true;
end;
$$;

create or replace function public.delete_shared_list(p_project_id uuid, p_token text, p_list_id uuid, p_actor_name text default 'Collaborator', p_actor_session_id text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_title text;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id,p_token,'lists');
  select title into v_title from public.shared_lists where id=p_list_id and project_id=v_project_id;
  if v_title is null then raise exception 'List not found'; end if;
  insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,details)
  values(v_project_id,auth.uid(),private.activity_actor_name(p_actor_name),p_actor_session_id,'list_deleted',p_list_id,jsonb_build_object('title',v_title));
  delete from public.shared_lists where id=p_list_id and project_id=v_project_id;
  return true;
end;
$$;

create or replace function public.add_shared_item(p_project_id uuid, p_token text, p_list_id uuid, p_text text, p_actor_name text default 'Collaborator', p_actor_session_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_item public.shared_list_items%rowtype;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id,p_token,'lists');
  if not exists(select 1 from public.shared_lists where id=p_list_id and project_id=v_project_id) then raise exception 'List not found'; end if;
  insert into public.shared_list_items(list_id,text,position)
  values(p_list_id,btrim(p_text),coalesce((select max(position)+1 from public.shared_list_items where list_id=p_list_id),0)) returning * into v_item;
  insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,item_id,details)
  values(v_project_id,auth.uid(),private.activity_actor_name(p_actor_name),p_actor_session_id,'item_created',p_list_id,v_item.id,jsonb_build_object('text',v_item.text));
  return jsonb_build_object('id',v_item.id,'text',v_item.text,'note',v_item.note,'completed',v_item.completed);
end;
$$;

create or replace function public.update_shared_item(p_project_id uuid, p_token text, p_list_id uuid, p_item_id uuid, p_text text default null, p_note text default null, p_completed boolean default null, p_actor_name text default 'Collaborator', p_actor_session_id text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_old_text text; v_old_note text; v_old_completed boolean; v_actor text;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id,p_token,'items');
  if p_text is not null and exists(
    select 1 from public.project_share_links l
    where l.token_hash=extensions.digest(p_token,'sha256') and l.permission='items' and l.revoked_at is null
  ) then raise exception 'This link can only change notes and completion status'; end if;
  select i.text, i.note, i.completed into v_old_text, v_old_note, v_old_completed
  from public.shared_list_items i join public.shared_lists l on l.id=i.list_id
  where i.id=p_item_id and i.list_id=p_list_id and l.project_id=v_project_id;
  if not found then raise exception 'List item not found'; end if;
  update public.shared_list_items i set text=coalesce(btrim(p_text),i.text), note=coalesce(p_note,i.note), completed=coalesce(p_completed,i.completed)
  from public.shared_lists l where i.id=p_item_id and i.list_id=p_list_id and l.id=i.list_id and l.project_id=v_project_id;
  v_actor := private.activity_actor_name(p_actor_name);
  if p_text is not null and btrim(p_text) is distinct from v_old_text then
    insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,item_id,details)
    values(v_project_id,auth.uid(),v_actor,p_actor_session_id,'item_renamed',p_list_id,p_item_id,jsonb_build_object('text',left(btrim(p_text),240)));
  end if;
  if p_note is not null and p_note is distinct from v_old_note then
    insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,item_id,details)
    values(v_project_id,auth.uid(),v_actor,p_actor_session_id,'item_note_changed',p_list_id,p_item_id,jsonb_build_object('item_text',left(coalesce(p_text,v_old_text),240)));
  end if;
  if p_completed is not null and p_completed is distinct from v_old_completed then
    insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,item_id,details)
    values(v_project_id,auth.uid(),v_actor,p_actor_session_id,'item_completion_changed',p_list_id,p_item_id,jsonb_build_object('completed',p_completed,'item_text',left(coalesce(p_text,v_old_text),240)));
  end if;
  return true;
end;
$$;

create or replace function public.delete_shared_item(p_project_id uuid, p_token text, p_list_id uuid, p_item_id uuid, p_actor_name text default 'Collaborator', p_actor_session_id text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid; v_text text;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id,p_token,'lists');
  select i.text into v_text from public.shared_list_items i join public.shared_lists l on l.id=i.list_id where i.id=p_item_id and i.list_id=p_list_id and l.project_id=v_project_id;
  if v_text is null then raise exception 'List item not found'; end if;
  insert into public.project_activity(project_id,actor_user_id,actor_name,actor_session_id,action,list_id,item_id,details)
  values(v_project_id,auth.uid(),private.activity_actor_name(p_actor_name),p_actor_session_id,'item_deleted',p_list_id,p_item_id,jsonb_build_object('text',v_text));
  delete from public.shared_list_items where id=p_item_id and list_id=p_list_id;
  return true;
end;
$$;

create or replace function public.get_project_activity(p_project_id uuid, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_project_id uuid;
begin
  select resolved_project_id into v_project_id from private.resolve_project_access(p_project_id,p_token,'read');
  return coalesce((select jsonb_agg(jsonb_build_object('actor_name',actor_name,'action',action,'list_id',list_id,'item_id',item_id,'details',details,'created_at',created_at) order by created_at desc)
    from (select * from public.project_activity where project_id=v_project_id order by created_at desc limit 50) recent),'[]'::jsonb);
end;
$$;

create or replace function public.delete_owned_project(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.shared_projects where id=p_project_id and owner_id=auth.uid();
  if not found then raise exception 'Project not found or access denied'; end if;
  return true;
end;
$$;

-- Remove legacy anon RPCs that granted full project administration to any bearer link.
drop function public.get_shared_project(text);
drop function public.rename_shared_project(text,text);
drop function public.delete_shared_project(text);
drop function public.add_shared_list(text,text);
drop function public.rename_shared_list(text,uuid,text);
drop function public.delete_shared_list(text,uuid);
drop function public.add_shared_item(text,uuid,text);
drop function public.update_shared_item(text,uuid,uuid,text,text,boolean);
drop function public.delete_shared_item(text,uuid,uuid);
drop function public.rotate_shared_link(text);

revoke all on function public.list_my_projects() from public;
revoke all on function public.create_shared_project(text) from public;
revoke all on function public.get_shared_project(uuid,text) from public;
revoke all on function public.claim_legacy_project(text) from public;
revoke all on function public.create_project_share(uuid,text,text) from public;
revoke all on function public.list_project_shares(uuid) from public;
revoke all on function public.revoke_project_share(uuid,uuid) from public;
revoke all on function public.rename_shared_project(uuid,text,text) from public;
revoke all on function public.delete_shared_project(uuid) from public;
revoke all on function public.add_shared_list(uuid,text,text,text,text) from public;
revoke all on function public.rename_shared_list(uuid,text,uuid,text,text,text) from public;
revoke all on function public.delete_shared_list(uuid,text,uuid,text,text) from public;
revoke all on function public.add_shared_item(uuid,text,uuid,text,text,text) from public;
revoke all on function public.update_shared_item(uuid,text,uuid,uuid,text,text,boolean,text,text) from public;
revoke all on function public.delete_shared_item(uuid,text,uuid,uuid,text,text) from public;
revoke all on function public.get_project_activity(uuid,text) from public;
revoke all on function public.delete_owned_project(uuid) from public;

-- Replacing create_shared_project(text) preserves prior direct grants unless they are explicitly revoked.
revoke all on function public.list_my_projects() from anon, authenticated;
revoke all on function public.create_shared_project(text) from anon, authenticated;
revoke all on function public.get_shared_project(uuid,text) from anon, authenticated;
revoke all on function public.claim_legacy_project(text) from anon, authenticated;
revoke all on function public.create_project_share(uuid,text,text) from anon, authenticated;
revoke all on function public.list_project_shares(uuid) from anon, authenticated;
revoke all on function public.revoke_project_share(uuid,uuid) from anon, authenticated;
revoke all on function public.rename_shared_project(uuid,text,text) from anon, authenticated;
revoke all on function public.delete_shared_project(uuid) from anon, authenticated;
revoke all on function public.delete_owned_project(uuid) from anon, authenticated;
revoke all on function public.add_shared_list(uuid,text,text,text,text) from anon, authenticated;
revoke all on function public.rename_shared_list(uuid,text,uuid,text,text,text) from anon, authenticated;
revoke all on function public.delete_shared_list(uuid,text,uuid,text,text) from anon, authenticated;
revoke all on function public.add_shared_item(uuid,text,uuid,text,text,text) from anon, authenticated;
revoke all on function public.update_shared_item(uuid,text,uuid,uuid,text,text,boolean,text,text) from anon, authenticated;
revoke all on function public.delete_shared_item(uuid,text,uuid,uuid,text,text) from anon, authenticated;
revoke all on function public.get_project_activity(uuid,text) from anon, authenticated;

-- Share-link reads and writes work for both anonymous visitors and authenticated collaborators.
grant execute on function public.get_shared_project(uuid,text) to anon, authenticated;
grant execute on function public.claim_legacy_project(text) to authenticated;
grant execute on function public.add_shared_list(uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.rename_shared_list(uuid,text,uuid,text,text,text) to anon, authenticated;
grant execute on function public.delete_shared_list(uuid,text,uuid,text,text) to anon, authenticated;
grant execute on function public.add_shared_item(uuid,text,uuid,text,text,text) to anon, authenticated;
grant execute on function public.update_shared_item(uuid,text,uuid,uuid,text,text,boolean,text,text) to anon, authenticated;
grant execute on function public.delete_shared_item(uuid,text,uuid,uuid,text,text) to anon, authenticated;
grant execute on function public.get_project_activity(uuid,text) to anon, authenticated;

-- Project ownership and share-link management require a Supabase Auth session.
grant execute on function public.list_my_projects() to authenticated;
grant execute on function public.create_shared_project(text) to authenticated;
grant execute on function public.create_project_share(uuid,text,text) to authenticated;
grant execute on function public.list_project_shares(uuid) to authenticated;
grant execute on function public.revoke_project_share(uuid,uuid) to authenticated;
grant execute on function public.rename_shared_project(uuid,text,text) to authenticated;
grant execute on function public.delete_shared_project(uuid) to authenticated;
grant execute on function public.delete_owned_project(uuid) to authenticated;

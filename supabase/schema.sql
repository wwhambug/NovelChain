create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  host_key text not null,
  host_name text not null,
  max_lines_per_player integer not null default 1 check (max_lines_per_player between 1 and 99),
  allow_edits boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.rooms add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.rooms add column if not exists host_key text;
alter table public.rooms add column if not exists host_name text;
alter table public.rooms add column if not exists max_lines_per_player integer not null default 1;
alter table public.rooms add column if not exists allow_edits boolean not null default false;
alter table public.rooms add column if not exists status text not null default 'draft';
alter table public.rooms add column if not exists updated_at timestamptz not null default now();
alter table public.rooms add column if not exists completed_at timestamptz;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

alter table public.players add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.players add column if not exists client_id text;

create table if not exists public.lines (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  content text not null check (char_length(content) <= 240),
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, position)
);

alter table public.lines add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.lines add column if not exists updated_at timestamptz not null default now();

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  content text not null check (char_length(content) between 1 and 180),
  created_at timestamptz not null default now()
);

create index if not exists players_room_id_idx on public.players(room_id);
create index if not exists lines_room_id_position_idx on public.lines(room_id, position);
create index if not exists chat_messages_room_id_created_at_idx on public.chat_messages(room_id, created_at);
create index if not exists rooms_status_completed_at_idx on public.rooms(status, completed_at desc);

create or replace function public.enforce_line_rules()
returns trigger
language plpgsql
as $$
declare
  room_record public.rooms%rowtype;
  player_line_count integer;
  player_count integer;
  last_player_id uuid;
  expected_player_id uuid;
begin
  select * into room_record from public.rooms where id = new.room_id;

  if room_record.id is null then
    raise exception 'room not found';
  end if;

  if room_record.status = 'completed' then
    raise exception 'completed rooms cannot be changed';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into player_count
    from public.players
    where room_id = new.room_id;

    if player_count < 2 then
      raise exception 'at least two players are required';
    end if;

    select count(*) into player_line_count
    from public.lines
    where room_id = new.room_id
      and player_id = new.player_id;

    if player_line_count >= room_record.max_lines_per_player then
      raise exception 'player line limit reached';
    end if;

    select player_id into last_player_id
    from public.lines
    where room_id = new.room_id
    order by position desc
    limit 1;

    if player_count > 1 and last_player_id is not null and new.player_id = last_player_id then
      raise exception 'players must take turns';
    end if;

    with ordered_players as (
      select
        p.id,
        row_number() over (order by p.created_at, p.id) as rn,
        coalesce(line_counts.line_count, 0) as line_count
      from public.players p
      left join (
        select player_id, count(*) as line_count
        from public.lines
        where room_id = new.room_id
        group by player_id
      ) line_counts on line_counts.player_id = p.id
      where p.room_id = new.room_id
    ),
    last_player as (
      select rn from ordered_players where id = last_player_id
    ),
    next_player as (
      select id
      from ordered_players
      where line_count < room_record.max_lines_per_player
      order by
        case
          when last_player_id is null then rn
          when rn > (select rn from last_player) then rn
          else rn + 100000
        end
      limit 1
    )
    select id into expected_player_id from next_player;

    if expected_player_id is not null and new.player_id <> expected_player_id then
      raise exception 'not this player turn';
    end if;
  end if;

  if tg_op = 'UPDATE' and room_record.allow_edits = false then
    raise exception 'line edits are disabled';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.lines
    where room_id = old.room_id
      and position > old.position
  ) then
    raise exception 'line cannot be edited after the story has continued';
  end if;

  return new;
end $$;

drop trigger if exists enforce_line_rules_before_insert_or_update on public.lines;
create trigger enforce_line_rules_before_insert_or_update
before insert or update on public.lines
for each row execute function public.enforce_line_rules();

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.lines enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "rooms are readable" on public.rooms;
drop policy if exists "rooms are insertable" on public.rooms;
drop policy if exists "rooms are updateable" on public.rooms;
drop policy if exists "rooms are deleteable by owner" on public.rooms;
drop policy if exists "players are readable" on public.players;
drop policy if exists "players are insertable" on public.players;
drop policy if exists "players are updateable" on public.players;
drop policy if exists "lines are readable" on public.lines;
drop policy if exists "lines are insertable" on public.lines;
drop policy if exists "lines are updateable" on public.lines;
drop policy if exists "chat messages are readable" on public.chat_messages;
drop policy if exists "chat messages are insertable" on public.chat_messages;

create policy "rooms are readable" on public.rooms for select to authenticated using (true);
create policy "rooms are insertable" on public.rooms for insert to authenticated with check (owner_id = auth.uid());
create policy "rooms are updateable" on public.rooms for update to authenticated using (true) with check (true);
create policy "rooms are deleteable by owner" on public.rooms for delete to authenticated using (owner_id = auth.uid() and status = 'completed');

create policy "players are readable" on public.players for select to authenticated using (true);
create policy "players are insertable" on public.players for insert to authenticated with check (user_id = auth.uid());
create policy "players are updateable" on public.players for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "lines are readable" on public.lines for select to authenticated using (true);
create policy "lines are insertable" on public.lines for insert to authenticated with check (user_id = auth.uid());
create policy "lines are updateable" on public.lines for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "chat messages are readable" on public.chat_messages for select to authenticated using (true);
create policy "chat messages are insertable" on public.chat_messages for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.players p
    where p.id = player_id
      and p.room_id = chat_messages.room_id
      and p.user_id = auth.uid()
  )
);

create or replace function public.delete_completed_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rooms
  where id = target_room_id
    and owner_id = auth.uid()
    and status = 'completed';
end $$;

grant execute on function public.delete_completed_room(uuid) to authenticated;

alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.lines replica identity full;
alter table public.chat_messages replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lines'
  ) then
    alter publication supabase_realtime add table public.lines;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

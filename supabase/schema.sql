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

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique check (char_length(nickname) between 2 and 24),
  anonymous_token_length integer not null default 6 check (anonymous_token_length between 3 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists anonymous_token_length integer not null default 6;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

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
  needs_revision boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, position)
);

alter table public.lines add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.lines add column if not exists needs_revision boolean not null default false;
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

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(user_id) on delete cascade,
  addressee_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create table if not exists public.line_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  line_id uuid not null references public.lines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (char_length(reaction) between 1 and 40),
  count integer not null default 1 check (count between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, user_id, reaction)
);

create table if not exists public.line_reviews (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  line_id uuid not null references public.lines(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  agrees boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, voter_id)
);

create index if not exists friendships_requester_id_idx on public.friendships(requester_id);
create index if not exists friendships_addressee_id_idx on public.friendships(addressee_id);
create index if not exists players_room_id_idx on public.players(room_id);
create index if not exists lines_room_id_position_idx on public.lines(room_id, position);
create index if not exists chat_messages_room_id_created_at_idx on public.chat_messages(room_id, created_at);
create index if not exists line_reactions_room_id_idx on public.line_reactions(room_id);
create index if not exists line_reviews_room_id_idx on public.line_reviews(room_id);
create index if not exists rooms_status_completed_at_idx on public.rooms(status, completed_at desc);

create or replace function public.enforce_reaction_limit()
returns trigger
language plpgsql
as $$
declare
  total_count integer;
begin
  select coalesce(sum(count), 0) into total_count
  from public.line_reactions
  where line_id = new.line_id
    and user_id = new.user_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if total_count + new.count > 50 then
    raise exception 'reaction limit reached';
  end if;

  return new;
end $$;

drop trigger if exists enforce_reaction_limit_before_insert_or_update on public.line_reactions;
create trigger enforce_reaction_limit_before_insert_or_update
before insert or update on public.line_reactions
for each row execute function public.enforce_reaction_limit();

create or replace function public.enforce_line_rules()
returns trigger
language plpgsql
as $$
declare
  room_record public.rooms%rowtype;
  player_count integer;
  last_player_id uuid;
  expected_player_id uuid;
  current_streak integer;
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

    select player_id into last_player_id
    from public.lines
    where room_id = new.room_id
    order by position desc
    limit 1;

    if last_player_id is not null and new.player_id = last_player_id then
      with previous_lines as (
        select player_id
        from public.lines
        where room_id = new.room_id
        order by position desc
      ),
      numbered as (
        select
          player_id,
          row_number() over () as rn
        from previous_lines
      ),
      boundary as (
        select min(rn) as rn
        from numbered
        where player_id <> last_player_id
      )
      select count(*) into current_streak
      from numbered
      where player_id = last_player_id
        and rn < coalesce((select rn from boundary), 1000000);

      if current_streak >= room_record.max_lines_per_player then
        raise exception 'turn line limit reached';
      end if;

      return new;
    end if;

    with ordered_players as (
      select
        p.id,
        row_number() over (order by p.created_at, p.id) as rn
      from public.players p
      where p.room_id = new.room_id
    ),
    last_player as (
      select rn from ordered_players where id = last_player_id
    ),
    next_player as (
      select id
      from ordered_players
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

  if tg_op = 'UPDATE' and new.content = old.content and new.needs_revision <> old.needs_revision then
    return new;
  end if;

  if tg_op = 'UPDATE' and room_record.allow_edits = false and old.needs_revision = false then
    raise exception 'line edits are disabled';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.lines
    where room_id = old.room_id
      and position > old.position
  ) and old.needs_revision = false then
    raise exception 'line cannot be edited after the story has continued';
  end if;

  if tg_op = 'UPDATE' and old.needs_revision = true and new.content <> old.content then
    new.needs_revision = false;
    delete from public.line_reviews where line_id = old.id;
  end if;

  return new;
end $$;

drop trigger if exists enforce_line_rules_before_insert_or_update on public.lines;
create trigger enforce_line_rules_before_insert_or_update
before insert or update on public.lines
for each row execute function public.enforce_line_rules();

alter table public.rooms enable row level security;
alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.lines enable row level security;
alter table public.chat_messages enable row level security;
alter table public.friendships enable row level security;
alter table public.line_reactions enable row level security;
alter table public.line_reviews enable row level security;

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
drop policy if exists "profiles are readable" on public.profiles;
drop policy if exists "profiles are insertable by owner" on public.profiles;
drop policy if exists "profiles are updateable by owner" on public.profiles;
drop policy if exists "friendships are readable by members" on public.friendships;
drop policy if exists "friendships are insertable by requester" on public.friendships;
drop policy if exists "friendships are updateable by addressee" on public.friendships;
drop policy if exists "line reactions are readable" on public.line_reactions;
drop policy if exists "line reactions are insertable by owner" on public.line_reactions;
drop policy if exists "line reactions are updateable by owner" on public.line_reactions;
drop policy if exists "line reactions are deleteable by owner" on public.line_reactions;
drop policy if exists "line reviews are readable" on public.line_reviews;
drop policy if exists "line reviews are insertable by voter" on public.line_reviews;
drop policy if exists "line reviews are updateable by voter" on public.line_reviews;

create policy "rooms are readable" on public.rooms for select to authenticated using (true);
create policy "rooms are insertable" on public.rooms for insert to authenticated with check (owner_id = auth.uid());
create policy "rooms are updateable" on public.rooms for update to authenticated using (true) with check (true);
create policy "rooms are deleteable by owner" on public.rooms for delete to authenticated using (owner_id = auth.uid() and status = 'completed');

create policy "profiles are readable" on public.profiles for select to authenticated using (true);
create policy "profiles are insertable by owner" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles are updateable by owner" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

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

create policy "friendships are readable by members" on public.friendships for select to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "friendships are insertable by requester" on public.friendships for insert to authenticated with check (requester_id = auth.uid());
create policy "friendships are updateable by addressee" on public.friendships for update to authenticated using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());

create policy "line reactions are readable" on public.line_reactions for select to authenticated using (true);
create policy "line reactions are insertable by owner" on public.line_reactions for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.players p
    where p.room_id = line_reactions.room_id
      and p.user_id = auth.uid()
  )
);
create policy "line reactions are updateable by owner" on public.line_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "line reactions are deleteable by owner" on public.line_reactions for delete to authenticated using (user_id = auth.uid());

create policy "line reviews are readable" on public.line_reviews for select to authenticated using (true);
create policy "line reviews are insertable by voter" on public.line_reviews for insert to authenticated with check (voter_id = auth.uid());
create policy "line reviews are updateable by voter" on public.line_reviews for update to authenticated using (voter_id = auth.uid()) with check (voter_id = auth.uid());

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

create or replace function public.vote_line_revision(target_line_id uuid, agrees_vote boolean default true)
returns table(agree_count integer, player_count integer, needs_revision boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  line_record public.lines%rowtype;
  voter_player public.players%rowtype;
  room_player_count integer;
  total_agree integer;
begin
  select * into line_record from public.lines where id = target_line_id;
  if line_record.id is null then
    raise exception 'line not found';
  end if;

  select * into voter_player
  from public.players
  where room_id = line_record.room_id
    and user_id = auth.uid()
  limit 1;

  if voter_player.id is null then
    raise exception 'only room players can vote';
  end if;

  if line_record.user_id = auth.uid() then
    raise exception 'cannot review your own line';
  end if;

  select count(*) into room_player_count
  from public.players
  where room_id = line_record.room_id;

  if room_player_count < 3 then
    raise exception 'at least three players are required';
  end if;

  insert into public.line_reviews(room_id, line_id, voter_id, target_user_id, agrees, updated_at)
  values (line_record.room_id, line_record.id, auth.uid(), line_record.user_id, agrees_vote, now())
  on conflict (line_id, voter_id)
  do update set agrees = excluded.agrees, updated_at = now();

  select count(*) into total_agree
  from public.line_reviews
  where line_id = line_record.id
    and agrees = true;

  if total_agree > room_player_count / 2 then
    update public.lines
    set needs_revision = true,
        updated_at = now()
    where id = line_record.id;
  end if;

  return query select total_agree, room_player_count, (total_agree > room_player_count / 2);
end $$;

grant execute on function public.vote_line_revision(uuid, boolean) to authenticated;

alter table public.profiles replica identity full;
alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.lines replica identity full;
alter table public.chat_messages replica identity full;
alter table public.friendships replica identity full;
alter table public.line_reactions replica identity full;
alter table public.line_reviews replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;

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

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'line_reactions'
  ) then
    alter publication supabase_realtime add table public.line_reactions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'line_reviews'
  ) then
    alter publication supabase_realtime add table public.line_reviews;
  end if;
end $$;

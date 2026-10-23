-- =========================================================
-- crate. — Supabase schema (public)
-- 방문자는 익명 로그인(Anonymous Sign-in)으로 auth.users 계정을 받고,
-- 가입 트리거가 profiles 행을 만든다. 시드용 더미 유저는 auth 계정 없이 profiles에만 존재한다.
-- =========================================================

-- ---------- 프로필 ----------
create table public.profiles (
  id         uuid primary key default gen_random_uuid(),
  handle     text not null unique check (handle ~ '^[a-z0-9._]{2,24}$'),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, handle)
  values (new.id, 'digger.' || left(replace(new.id::text, '-', ''), 6));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 감정 저널 ----------
create table public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  artist     text not null check (char_length(artist) between 1 and 80),
  mood       text not null check (mood in ('happy', 'calm', 'excited', 'nostalgic', 'sad', 'hype')),
  intensity  smallint not null default 3 check (intensity between 1 and 5),
  note       text not null default '' check (char_length(note) <= 200),
  is_public  boolean not null default true,
  created_at timestamptz not null default now()
);
create index journal_entries_user_idx on public.journal_entries (user_id, created_at desc);
create index journal_entries_public_idx on public.journal_entries (created_at desc) where is_public;

-- ---------- 커뮤니티 피드 ----------
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  type         text not null check (type in ('recommend', 'question', 'talk')),
  body         text not null check (char_length(body) between 1 and 500),
  track_title  text,
  track_artist text,
  track_mood   text check (track_mood in ('happy', 'calm', 'excited', 'nostalgic', 'sad', 'hype')),
  like_count   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index posts_created_idx on public.posts (created_at desc);
create index posts_user_idx on public.posts (user_id);

create table public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 140),
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_user_idx on public.comments (user_id);

-- 좋아요 수는 post_likes 변화에 맞춰 posts.like_count에 반영 (클라이언트는 직접 수정 불가)
create or replace function public.sync_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.sync_like_count();

-- ---------- 권한 / RLS ----------
-- 트리거 전용 함수가 /rest/v1/rpc 로 호출되지 않도록 (트리거는 EXECUTE 권한 없이도 동작)
revoke execute on function public.handle_new_user(), public.sync_like_count() from public, anon, authenticated;

grant select on public.profiles, public.journal_entries, public.posts, public.post_likes, public.comments to anon, authenticated;
grant update (handle) on public.profiles to authenticated;
grant insert, delete on public.journal_entries, public.post_likes to authenticated;
grant insert (type, body, track_title, track_artist, track_mood), delete on public.posts to authenticated;
grant insert (post_id, body), delete on public.comments to authenticated;

alter table public.profiles        enable row level security;
alter table public.journal_entries enable row level security;
alter table public.posts           enable row level security;
alter table public.post_likes      enable row level security;
alter table public.comments        enable row level security;

create policy "profiles: 누구나 조회" on public.profiles
  for select to anon, authenticated using (true);
create policy "profiles: 본인만 수정" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "journal: 공개 기록 또는 본인 기록 조회" on public.journal_entries
  for select to anon, authenticated using (is_public or user_id = (select auth.uid()));
create policy "journal: 본인만 작성" on public.journal_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "journal: 본인만 삭제" on public.journal_entries
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "posts: 누구나 조회" on public.posts
  for select to anon, authenticated using (true);
create policy "posts: 본인만 작성" on public.posts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "posts: 본인만 삭제" on public.posts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "post_likes: 누구나 조회" on public.post_likes
  for select to anon, authenticated using (true);
create policy "post_likes: 본인만 추가" on public.post_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "post_likes: 본인만 취소" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "comments: 누구나 조회" on public.comments
  for select to anon, authenticated using (true);
create policy "comments: 본인만 작성" on public.comments
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "comments: 본인만 삭제" on public.comments
  for delete to authenticated using (user_id = (select auth.uid()));

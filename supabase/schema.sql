-- =========================================================
-- crate. — Supabase schema (public)
-- 방문자는 이메일 + 비밀번호로 가입해 auth.users 계정을 받고, 가입 트리거가 profiles 행을 만든다.
-- 로그아웃 상태(anon)는 읽기만 가능. 익명 로그인 세션은 restrictive 정책으로 모든 접근이 막힌다.
-- 시드용 더미 유저는 auth 계정 없이 profiles에만 존재한다.
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
declare
  wanted text := lower(new.raw_user_meta_data ->> 'handle');
begin
  -- 회원가입 때 넘긴 handle을 쓰고, 형식이 틀리거나 이미 쓰이면 digger.xxxxxx로 대체
  if wanted is null or wanted !~ '^[a-z0-9._]{2,24}$'
     or exists (select 1 from public.profiles where handle = wanted) then
    wanted := 'digger.' || left(replace(new.id::text, '-', ''), 6);
  end if;
  insert into public.profiles (id, handle) values (new.id, wanted);
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

-- 익명 로그인 세션(is_anonymous)은 읽기·쓰기 모두 차단 (이메일 계정만 허용)
create policy "profiles: 익명 세션 차단" on public.profiles as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "journal: 익명 세션 차단" on public.journal_entries as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "posts: 익명 세션 차단" on public.posts as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "post_likes: 익명 세션 차단" on public.post_likes as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "comments: 익명 세션 차단" on public.comments as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));

-- =========================================================
-- 디깅 AI (RAG) — Edge Function dig-chat이 service role로만 읽고 쓴다
-- Upstage solar-embedding-2 (1024차원) 벡터를 pgvector에 저장하고 OpenAI로 답을 만든다.
-- 클라이언트(anon/authenticated)는 아래 테이블·뷰·함수에 접근할 수 없다.
-- =========================================================
create extension if not exists vector with schema extensions;

-- 디깅 AI가 검색하는 문서: 곡(track) · 디거(user) · 사이트 안내(page). dig-chat이 dig_sources와 맞춰 갱신한다.
create table public.dig_documents (
  id         text primary key,
  kind       text not null check (kind in ('track', 'user', 'page')),
  content    text not null,
  metadata   jsonb not null default '{}',
  embedding  extensions.vector(1024) not null,
  updated_at timestamptz not null default now()
);
create index dig_documents_embedding_idx on public.dig_documents
  using hnsw (embedding extensions.vector_cosine_ops);
create index dig_documents_kind_idx on public.dig_documents (kind);

-- 사용량 제한용 호출 기록 (dig-chat이 service role로 쓴다)
create table public.dig_chat_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index dig_chat_log_user_idx on public.dig_chat_log (user_id, created_at desc);

-- 색인할 원문: 커뮤니티 글 + 공개 감정 기록을 곡 단위, 디거 단위로 묶는다
create view public.dig_sources with (security_invoker = true) as
with moods (id, label) as (values
  ('happy', '행복'), ('calm', '평온'), ('excited', '설렘'),
  ('nostalgic', '그리움'), ('sad', '슬픔'), ('hype', '신남')
),
acts as (
  select pr.handle, p.body as note, p.track_title as title, p.track_artist as artist,
         p.track_mood as mood, p.like_count as likes, p.created_at
  from public.posts p join public.profiles pr on pr.id = p.user_id
  union all
  select pr.handle, nullif(j.note, ''), j.title, j.artist, j.mood, 0, j.created_at
  from public.journal_entries j join public.profiles pr on pr.id = j.user_id
  where j.is_public
),
tracks as (
  select lower(a.title) || '|' || lower(a.artist) as key,
         min(a.title) as title, min(a.artist) as artist,
         coalesce(array_agg(distinct m.label) filter (where m.label is not null), '{}') as moods,
         array_agg(distinct a.handle) as handles,
         string_agg(a.note, ' / ' order by a.likes desc) filter (where a.note is not null) as notes,
         sum(a.likes)::int as likes
  from acts a left join moods m on m.id = a.mood
  where a.title is not null and a.artist is not null
  group by 1
),
users as (
  select a.handle,
         coalesce(array_agg(distinct m.label) filter (where m.label is not null), '{}') as moods,
         string_agg(distinct a.title || ' — ' || a.artist, ', ') filter (where a.title is not null) as tracks,
         string_agg(a.note, ' / ' order by a.created_at desc) filter (where a.note is not null) as notes,
         count(*)::int as acts
  from acts a left join moods m on m.id = a.mood
  group by a.handle
)
select 'track:' || key as id, 'track' as kind,
       left(format(E'곡: %s — %s\n감정: %s\n디거들의 한마디: %s\n올린 디거: %s',
              title, artist, array_to_string(moods, ', '), coalesce(notes, '-'),
              (select string_agg('@' || h, ', ') from unnest(handles) h)), 2000) as content,
       jsonb_build_object('title', title, 'artist', artist, 'moods', moods, 'handles', handles, 'likes', likes) as metadata
from tracks
union all
select 'user:' || handle, 'user',
       left(format(E'디거 @%s\n자주 남긴 감정: %s\n올린 곡: %s\n남긴 글: %s',
              handle, array_to_string(moods, ', '), coalesce(tracks, '-'), coalesce(notes, '-')), 2000),
       jsonb_build_object('handle', handle, 'moods', moods, 'acts', acts)
from users;

-- 쿼리 벡터와 가까운 문서 (kind별). Edge Function(service role)에서만 호출한다
create or replace function public.match_dig_documents(
  query_embedding extensions.vector(1024), match_kind text, match_count int default 6
)
returns table (id text, kind text, content text, metadata jsonb, similarity float)
language sql stable
set search_path = ''
as $$
  select d.id, d.kind, d.content, d.metadata,
         1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.dig_documents d
  where d.kind = match_kind
  order by d.embedding operator(extensions.<=>) query_embedding
  limit least(match_count, 20);
$$;

revoke all on public.dig_documents, public.dig_chat_log, public.dig_sources from anon, authenticated;
revoke execute on function public.match_dig_documents(extensions.vector, text, int) from public, anon, authenticated;

alter table public.dig_documents enable row level security;
alter table public.dig_chat_log  enable row level security;

create policy "dig_documents: 익명 세션 차단" on public.dig_documents as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "dig_chat_log: 익명 세션 차단" on public.dig_chat_log as restrictive
  for all to authenticated
  using (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check (not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));

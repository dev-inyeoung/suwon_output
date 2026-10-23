-- crate. 시드 데이터: auth 계정이 없는 더미 디거들과 그들의 글/댓글/공개 기록
with u as (
  insert into public.profiles (handle) values
    ('lofi.min'), ('jae.digs'), ('neon_cat'), ('rainy.day'), ('indie.kim'), ('beat.park'), ('vinyl.ha')
  returning id, handle
),
p as (
  insert into public.posts (user_id, type, body, track_title, track_artist, track_mood, like_count, created_at)
  select u.id, v.type, v.body, v.tt, v.ta, v.tm, v.likes, now() - v.ago
  from (values
    ('lofi.min', 'recommend', '요즘 출근길에 무한반복 중인 앨범. 첫 곡 인트로 신스 듣자마자 바로 저장함. 시티팝 좋아하시는 분들 꼭 들어보세요!',
      'Mayonaka no Door', '松原みき', 'nostalgic', 42, interval '12 minutes'),
    ('rainy.day', 'question', '카페에서 들은 노래인데 제목을 모르겠어요 😭 여자 보컬이고 기타랑 피아노만 나오는 잔잔한 곡... 가사에 "blue hour"가 들어갔던 것 같아요.',
      null, null, null, 8, interval '47 minutes'),
    ('beat.park', 'talk', '노래 들을 때 가사부터 들으세요, 멜로디부터 들으세요? 저는 완전 멜로디파라 3년 들은 노래 가사도 모름 ㅋㅋ',
      null, null, null, 27, interval '3 hours')
  ) as v(handle, type, body, tt, ta, tm, likes, ago)
  join u on u.handle = v.handle
  returning id, user_id
),
c as (
  insert into public.comments (post_id, user_id, body, created_at)
  select p.id, cu.id, v.body, now() - v.ago
  from (values
    ('lofi.min', 'jae.digs', '이거 원곡 LP로 들으면 진짜 미쳐요', interval '10 minutes'),
    ('lofi.min', 'neon_cat', '저장 완료 🙏', interval '8 minutes'),
    ('rainy.day', 'indie.kim', '혹시 Phoebe Bridgers 쪽 느낌인가요?', interval '40 minutes')
  ) as v(post_by, handle, body, ago)
  join u pu on pu.handle = v.post_by
  join p on p.user_id = pu.id
  join u cu on cu.handle = v.handle
  returning id
)
insert into public.journal_entries (user_id, title, artist, mood, intensity, note, is_public, created_at)
select u.id, v.title, v.artist, v.mood, v.intensity, v.note, true, now() - v.ago
from (values
  ('neon_cat', 'Hype Boy', 'NewJeans', 'excited', 4, '버스 창밖으로 벚꽃 날리는데 이게 나옴', interval '5 hours'),
  ('vinyl.ha', 'Plastic Love', '竹内まりや', 'nostalgic', 3, '가본 적 없는 80년대 도쿄가 그리운 기분', interval '50 hours')
) as v(handle, title, artist, mood, intensity, note, ago)
join u on u.handle = v.handle;

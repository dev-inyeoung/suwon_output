/* =========================================================
   crate. — interactions (Supabase, 연결 불가 시 localStorage 더미 데이터)
   ========================================================= */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (str) => String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 무시 */ }
    }
  };

  const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
  };

  const hue = (str) => [...str].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

  /* ---------- Supabase ---------- */
  const cfg = window.CRATE_SUPABASE || {};
  let db = null; // 연결 실패 시 null → localStorage 모드
  let me = { id: null, handle: 'me.digger' }; // Supabase 모드에서 로그아웃 상태면 null

  const fetchProfile = async (client, userId) => {
    const { data, error } = await client.from('profiles').select('id, handle').eq('id', userId).single();
    if (error) throw error;
    return data;
  };

  const connect = async () => {
    if (!cfg.url || !cfg.key || !window.supabase) return;
    try {
      const client = window.supabase.createClient(cfg.url, cfg.key);
      let { data: { session } } = await client.auth.getSession();
      // 예전 익명 로그인 세션은 정리하고 로그아웃 상태로 시작한다
      if (session?.user.is_anonymous) {
        await client.auth.signOut({ scope: 'local' });
        session = null;
      }
      const profile = session ? await fetchProfile(client, session.user.id) : null;
      db = client;
      me = profile;
    } catch (err) {
      console.warn('[crate] Supabase 연결 실패 — localStorage로 동작합니다.', err);
    }
  };

  // 로그아웃 상태에서 쓰기를 시도하면 로그인 창을 띄운다 (localStorage 모드는 항상 통과)
  const needAuth = () => {
    if (!db || me) return false;
    openAuth('signin');
    toast('로그인이 필요해요');
    return true;
  };

  const fail = (err) => {
    console.error('[crate]', err);
    toast('저장하지 못했어요. 잠시 후 다시 시도해주세요');
  };

  /* ---------- 감정 정의 ---------- */
  const MOODS = [
    { id: 'happy',    label: '행복',   emoji: '😊', color: '#ffd45c' },
    { id: 'calm',     label: '평온',   emoji: '😌', color: '#5fd3c4' },
    { id: 'excited',  label: '설렘',   emoji: '💓', color: '#f7a1c4' },
    { id: 'nostalgic',label: '그리움', emoji: '🌙', color: '#b9a4ff' },
    { id: 'sad',      label: '슬픔',   emoji: '🌧️', color: '#6aa8ff' },
    { id: 'hype',     label: '신남',   emoji: '🔥', color: '#ff8a6b' }
  ];
  const moodOf = (id) => MOODS.find((m) => m.id === id) || MOODS[0];
  const coverBg = (mood) => `linear-gradient(135deg, ${mood.color}, ${mood.color}55)`;

  /* ---------- Toast ---------- */
  const toastEl = $('#toast');
  let toastTimer;
  const toast = (msg, ms = 2200) => {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), ms);
  };

  /* ---------- Header ---------- */
  const header = $('.header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const navToggle = $('#navToggle');
  const nav = $('#nav');
  const setNav = (open) => {
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  };
  navToggle.addEventListener('click', () => setNav(!nav.classList.contains('is-open')));
  $$('a', nav).forEach((a) => a.addEventListener('click', () => setNav(false)));

  /* ---------- Hero 카운터 ---------- */
  const countUp = (el) => {
    const target = +el.dataset.count;
    const start = performance.now();
    const dur = 1400;
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString('ko-KR');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* ---------- Scroll reveal ---------- */
  const revealTargets = $$('.feature, .crate, .faq details, .section__head, .stats');
  revealTargets.forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      $$('[data-count]', e.target).forEach(countUp);
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });

  /* =========================================================
     감정 저널
     ========================================================= */
  const JOURNAL_KEY = 'crate.journal';
  const seedJournal = [
    { id: 'j1', title: 'Hype Boy', artist: 'NewJeans', mood: 'excited', intensity: 4, note: '버스 창밖으로 벚꽃 날리는데 이게 나옴', isPublic: true, ts: Date.now() - 1000 * 60 * 60 * 5 },
    { id: 'j2', title: '아무노래', artist: '지코', mood: 'hype', intensity: 5, note: '', isPublic: false, ts: Date.now() - 1000 * 60 * 60 * 26 },
    { id: 'j3', title: 'Plastic Love', artist: '竹内まりや', mood: 'nostalgic', intensity: 3, note: '가본 적 없는 80년대 도쿄가 그리운 기분', isPublic: true, ts: Date.now() - 1000 * 60 * 60 * 50 }
  ];
  let journal = store.get(JOURNAL_KEY, seedJournal);
  let journalFilter = 'all';

  const toEntry = (r) => ({
    id: r.id, title: r.title, artist: r.artist, mood: r.mood, intensity: r.intensity,
    note: r.note, isPublic: r.is_public, ts: Date.parse(r.created_at)
  });
  const loadJournal = async () => {
    if (!me) { journal = []; return; }
    const { data, error } = await db.from('journal_entries').select('*').eq('user_id', me.id);
    if (error) throw error;
    journal = data.map(toEntry);
  };
  let selectedMood = null;

  const moodPicker = $('#moodPicker');
  moodPicker.innerHTML = MOODS.map((m) => `
    <button type="button" class="mood" role="radio" aria-checked="false" data-mood="${m.id}" style="--mood:${m.color}">
      <span aria-hidden="true">${m.emoji}</span>${m.label}
    </button>`).join('');

  moodPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.mood');
    if (!btn) return;
    selectedMood = btn.dataset.mood;
    $$('.mood', moodPicker).forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
  });

  const intensity = $('#intensity');
  intensity.addEventListener('input', () => { $('#intensityOut').textContent = intensity.value; });

  const noteEl = $('#songNote');
  noteEl.addEventListener('input', () => { $('#noteCount').textContent = noteEl.value.length; });

  /* ---------- 노래 찾기 (iTunes Search API, 키 없이 CORS 허용) ----------
     country=KR 스토어는 결과가 비어서 기본(US) 스토어를 쓴다. 한국 곡도 한글로 검색되지만
     제목은 영문 표기로 올 수 있다 (예: 밤편지 → Through the Night). 고른 뒤 직접 고칠 수 있다. */
  const searchEl = $('#songSearch');
  const resultsEl = $('#songResults');
  let songResults = [];
  let activeIdx = -1;
  let searchTimer;
  let searchSeq = 0; // 늦게 도착한 이전 검색 결과는 버린다

  const searchSongs = async (term) => {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'music', entity: 'song', limit: 8 })}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iTunes ${res.status}`);
    const { results } = await res.json();
    return results.map((r) => ({
      title: r.trackName, artist: r.artistName, album: r.collectionName,
      art: (r.artworkUrl100 || r.artworkUrl60 || '').replace(/^http:/, 'https:')
    }));
  };

  const setResultsOpen = (open) => {
    resultsEl.hidden = !open;
    searchEl.setAttribute('aria-expanded', String(open));
    if (!open) { activeIdx = -1; searchEl.removeAttribute('aria-activedescendant'); }
  };
  const showSearchMsg = (msg) => {
    songResults = [];
    resultsEl.innerHTML = `<li class="song-search__msg" role="presentation">${msg}</li>`;
    setResultsOpen(true);
  };
  const renderResults = () => {
    if (!songResults.length) return showSearchMsg('검색 결과가 없어요. 아래에 직접 입력해도 돼요');
    resultsEl.innerHTML = songResults.map((s, i) => `
      <li id="song-opt-${i}" role="option" data-idx="${i}" aria-selected="${i === activeIdx}" class="${i === activeIdx ? 'is-active' : ''}">
        <img src="${esc(s.art)}" alt="" loading="lazy" />
        <div><strong>${esc(s.title)}</strong><span>${esc(s.artist)}${s.album ? ` · ${esc(s.album)}` : ''}</span></div>
      </li>`).join('');
    setResultsOpen(true);
    if (activeIdx >= 0) {
      searchEl.setAttribute('aria-activedescendant', `song-opt-${activeIdx}`);
      $(`#song-opt-${activeIdx}`).scrollIntoView({ block: 'nearest' });
    }
  };

  const pickSong = (s) => {
    $('#songTitle').value = s.title;
    $('#songArtist').value = s.artist;
    $('#songTitle').classList.remove('is-invalid');
    $('#songArtist').classList.remove('is-invalid');
    searchEl.value = '';
    setResultsOpen(false);
    toast(`🎵 ${s.title} · ${s.artist}`);
  };

  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const term = searchEl.value.trim();
    const seq = ++searchSeq;
    if (term.length < 2) { setResultsOpen(false); return; }
    searchTimer = setTimeout(async () => {
      showSearchMsg('찾는 중…');
      try {
        const found = await searchSongs(term);
        if (seq !== searchSeq) return;
        songResults = found;
        activeIdx = -1;
        renderResults();
      } catch (err) {
        if (seq !== searchSeq) return;
        console.warn('[crate] 노래 검색 실패', err);
        showSearchMsg('검색하지 못했어요. 아래에 직접 입력해주세요');
      }
    }, 300);
  });

  searchEl.addEventListener('keydown', (e) => {
    if (resultsEl.hidden || e.isComposing) return; // 한글 조합 중의 키 입력은 무시
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!songResults.length) return;
      e.preventDefault();
      const n = songResults.length;
      activeIdx = e.key === 'ArrowDown' ? (activeIdx + 1) % n : (activeIdx - 1 + n) % n;
      renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // 검색창에서 Enter로 기록이 제출되지 않게
      if (songResults[activeIdx]) pickSong(songResults[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setResultsOpen(false);
    }
  });
  // mousedown 기본 동작을 막아 blur보다 클릭이 먼저 처리되게 한다
  resultsEl.addEventListener('mousedown', (e) => e.preventDefault());
  resultsEl.addEventListener('click', (e) => {
    const li = e.target.closest('[data-idx]');
    if (li) pickSong(songResults[+li.dataset.idx]);
  });
  searchEl.addEventListener('blur', () => setResultsOpen(false));
  searchEl.addEventListener('focus', () => { if (songResults.length && searchEl.value.trim().length >= 2) renderResults(); });

  const filterWrap = $('#journalFilter');
  const renderFilter = () => {
    const used = MOODS.filter((m) => journal.some((j) => j.mood === m.id));
    filterWrap.innerHTML = [`<button data-f="all" class="${journalFilter === 'all' ? 'is-active' : ''}">전체</button>`]
      .concat(used.map((m) => `<button data-f="${m.id}" class="${journalFilter === m.id ? 'is-active' : ''}">${m.emoji} ${m.label}</button>`))
      .join('');
  };
  filterWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    journalFilter = b.dataset.f;
    renderJournal();
  });

  const renderSummary = () => {
    const total = journal.length;
    $('#entryTotal').textContent = `${total}곡`;
    const counts = MOODS.map((m) => ({ ...m, n: journal.filter((j) => j.mood === m.id).length })).filter((m) => m.n);
    $('#moodBar').innerHTML = counts.map((m) =>
      `<span style="flex-grow:${m.n};background:${m.color}" title="${m.label} ${m.n}곡"></span>`).join('');
    $('#moodLegend').innerHTML = counts.length
      ? counts.map((m) => `<li style="--mood:${m.color}"><i></i>${m.label} <b>${Math.round((m.n / total) * 100)}%</b></li>`).join('')
      : '<li>기록이 쌓이면 감정 분포가 보여요</li>';
  };

  const renderJournal = () => {
    const list = journal
      .filter((j) => journalFilter === 'all' || j.mood === journalFilter)
      .sort((a, b) => b.ts - a.ts);

    $('#timeline').innerHTML = list.map((j) => {
      const m = moodOf(j.mood);
      return `
        <li class="entry" style="--mood:${m.color}">
          <div class="cover" style="background:${coverBg(m)}" aria-hidden="true">${m.emoji}</div>
          <div>
            <div class="entry__title">${esc(j.title)}<small>${esc(j.artist)}</small></div>
            ${j.note ? `<p class="entry__note">${esc(j.note)}</p>` : ''}
            <div class="entry__meta">
              <span class="entry__tag">${m.label}</span>
              <span class="dots" aria-label="세기 ${j.intensity}/5">${'●'.repeat(j.intensity)}${'○'.repeat(5 - j.intensity)}</span>
              <span>${timeAgo(j.ts)}</span>
              <span>${j.isPublic ? '🌐 공개' : '🔒 나만 보기'}</span>
            </div>
          </div>
          <button class="icon-btn" data-del="${j.id}" aria-label="${esc(j.title)} 기록 삭제">✕</button>
        </li>`;
    }).join('');
    $('#timelineEmpty').hidden = list.length > 0;
    $('#timelineEmpty').textContent = db && !me ? '로그인하면 내 기록이 여기에 쌓여요 🎧' : '아직 기록이 없어요. 첫 곡을 남겨보세요 🎧';
    renderFilter();
    renderSummary();
  };

  $('#timeline').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const id = b.dataset.del;
    if (db) {
      b.disabled = true;
      const { error } = await db.from('journal_entries').delete().eq('id', id);
      if (error) { b.disabled = false; return fail(error); }
    }
    journal = journal.filter((j) => j.id !== id);
    if (!db) store.set(JOURNAL_KEY, journal);
    if (journalFilter !== 'all' && !journal.some((j) => j.mood === journalFilter)) journalFilter = 'all';
    renderJournal();
    renderFeed();
    toast('기록을 삭제했어요');
  });

  $('#journalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (needAuth()) return;
    const titleEl = $('#songTitle');
    const artistEl = $('#songArtist');
    const errEl = $('#formError');
    const title = titleEl.value.trim();
    const artist = artistEl.value.trim();

    titleEl.classList.toggle('is-invalid', !title);
    artistEl.classList.toggle('is-invalid', !artist);
    if (!title || !artist) { errEl.textContent = '곡 제목과 아티스트를 입력해주세요.'; return; }
    if (!selectedMood) { errEl.textContent = '그때의 감정을 하나 골라주세요.'; return; }
    errEl.textContent = '';

    let entry = {
      id: `j${Date.now()}`,
      title, artist,
      mood: selectedMood,
      intensity: +intensity.value,
      note: noteEl.value.trim(),
      isPublic: $('#isPublic').checked,
      ts: Date.now()
    };
    if (db) {
      const submitBtn = $('[type="submit"]', e.target);
      submitBtn.disabled = true;
      const { data, error } = await db.from('journal_entries').insert({
        title, artist, mood: entry.mood, intensity: entry.intensity, note: entry.note, is_public: entry.isPublic
      }).select().single();
      submitBtn.disabled = false;
      if (error) return fail(error);
      entry = toEntry(data);
    }
    journal.push(entry);
    if (!db) store.set(JOURNAL_KEY, journal);

    e.target.reset();
    selectedMood = null;
    $$('.mood', moodPicker).forEach((b) => b.setAttribute('aria-checked', 'false'));
    $('#intensityOut').textContent = '3';
    $('#noteCount').textContent = '0';
    journalFilter = 'all';

    renderJournal();
    renderFeed();
    toast(entry.isPublic ? `${moodOf(entry.mood).emoji} 기록 완료 · 라운지에 공유됐어요` : '🔒 나만 보는 기록으로 저장했어요');
  });

  /* =========================================================
     무드 크레이트
     ========================================================= */
  const CRATES = [
    { mood: 'calm', title: '새벽 산책', desc: '1,204명의 평온', badge: '오늘의 픽',
      tracks: [['Snooze', 'SZA'], ['우주를 줄게', '볼빨간사춘기'], ['Sunday Morning', 'Maroon 5'], ['Ghost', 'Justin Bieber']] },
    { mood: 'nostalgic', title: '그 시절 우리', desc: '892명의 그리움', badge: '급상승',
      tracks: [['Plastic Love', '竹内まりや'], ['응급실', 'izi'], ['너의 의미', '아이유'], ['Stay With Me', '松原みき']] },
    { mood: 'hype', title: '심박수 120', desc: '2,310명의 신남', badge: '인기',
      tracks: [['Supernova', 'aespa'], ['Levitating', 'Dua Lipa'], ['Ditto', 'NewJeans'], ['Blinding Lights', 'The Weeknd']] },
    { mood: 'sad', title: '비 오는 창가', desc: '1,077명의 슬픔', badge: '새 크레이트',
      tracks: [['밤편지', '아이유'], ['Someone Like You', 'Adele'], ['사건의 지평선', '윤하'], ['Liability', 'Lorde']] }
  ];
  $('#crates-list').innerHTML = CRATES.map((c) => {
    const m = moodOf(c.mood);
    return `
      <article class="crate" style="--mood:${m.color}">
        <div class="crate__head">
          <span class="crate__badge">${c.badge}</span>
          <span class="crate__emoji" aria-hidden="true">${m.emoji}</span>
          <h3>${c.title}</h3>
          <p>${c.desc}</p>
        </div>
        <div class="crate__body">
          <ol class="crate__list">
            ${c.tracks.map(([t, a], i) => `<li><span class="num">${i + 1}</span><span>${t}<small>${a}</small></span></li>`).join('')}
          </ol>
          <button class="btn btn--block" data-crate="${c.title}">크레이트 열기</button>
        </div>
      </article>`;
  }).join('');
  $('#crates-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-crate]');
    if (b) toast(`📦 '${b.dataset.crate}' 크레이트를 담았어요`);
  });

  /* =========================================================
     커뮤니티 피드
     ========================================================= */
  const FEED_KEY = 'crate.feed';
  const TYPE_LABEL = { recommend: '🎧 추천', question: '❓ 질문', talk: '💬 잡담', journal: '✍️ 감정 기록' };

  const seedPosts = [
    { id: 'p1', user: 'lofi.min', type: 'recommend', ts: Date.now() - 1000 * 60 * 12,
      text: '요즘 출근길에 무한반복 중인 앨범. 첫 곡 인트로 신스 듣자마자 바로 저장함. 시티팝 좋아하시는 분들 꼭 들어보세요!',
      track: { title: 'Mayonaka no Door', artist: '松原みき', mood: 'nostalgic' }, likes: 42, liked: false,
      comments: [{ user: 'jae.digs', text: '이거 원곡 LP로 들으면 진짜 미쳐요' }, { user: 'neon_cat', text: '저장 완료 🙏' }] },
    { id: 'p2', user: 'rainy.day', type: 'question', ts: Date.now() - 1000 * 60 * 47,
      text: '카페에서 들은 노래인데 제목을 모르겠어요 😭 여자 보컬이고 기타랑 피아노만 나오는 잔잔한 곡... 가사에 "blue hour"가 들어갔던 것 같아요.',
      likes: 8, liked: false, comments: [{ user: 'indie.kim', text: '혹시 Phoebe Bridgers 쪽 느낌인가요?' }] },
    { id: 'p3', user: 'beat.park', type: 'talk', ts: Date.now() - 1000 * 60 * 60 * 3,
      text: '노래 들을 때 가사부터 들으세요, 멜로디부터 들으세요? 저는 완전 멜로디파라 3년 들은 노래 가사도 모름 ㅋㅋ',
      likes: 27, liked: false, comments: [] }
  ];
  let posts = store.get(FEED_KEY, seedPosts);
  let othersJournal = []; // 다른 디거들의 공개 감정 기록 (Supabase 모드에서만)
  let feedFilter = 'all';
  const openComments = new Set();

  const journalPost = (j, user) => ({
    id: `jp-${j.id}`, user, type: 'journal', ts: j.ts,
    text: j.note || `${moodOf(j.mood).label}한 순간에 들은 노래`,
    track: { title: j.title, artist: j.artist, mood: j.mood },
    likes: 0, liked: false, comments: [], fromJournal: true
  });
  const journalPosts = () => journal.filter((j) => j.isPublic).map((j) => journalPost(j, me.handle)).concat(othersJournal);

  const loadFeed = async () => {
    const othersQuery = db.from('journal_entries').select('*, author:profiles(handle)').eq('is_public', true);
    const [postRes, likeRes, journalRes] = await Promise.all([
      db.from('posts')
        .select('id, type, body, track_title, track_artist, track_mood, like_count, created_at, author:profiles!posts_user_id_fkey(handle), comments(body, created_at, author:profiles!comments_user_id_fkey(handle))')
        .order('created_at', { ascending: false })
        .order('created_at', { referencedTable: 'comments', ascending: true })
        .limit(50),
      me ? db.from('post_likes').select('post_id').eq('user_id', me.id) : { data: [] },
      (me ? othersQuery.neq('user_id', me.id) : othersQuery)
        .order('created_at', { ascending: false })
        .limit(30)
    ]);
    const err = postRes.error || likeRes.error || journalRes.error;
    if (err) throw err;
    const liked = new Set(likeRes.data.map((l) => l.post_id));
    posts = postRes.data.map((r) => ({
      id: r.id, user: r.author.handle, type: r.type, ts: Date.parse(r.created_at), text: r.body,
      track: r.track_title ? { title: r.track_title, artist: r.track_artist, mood: r.track_mood } : undefined,
      likes: r.like_count, liked: liked.has(r.id),
      comments: r.comments.map((c) => ({ user: c.author.handle, text: c.body }))
    }));
    othersJournal = journalRes.data.map((r) => journalPost(toEntry(r), r.author.handle));
  };

  const trackHTML = (t) => {
    const m = moodOf(t.mood);
    return `
      <div class="track" style="--mood:${m.color}">
        <div class="cover" style="background:${coverBg(m)}" aria-hidden="true">${m.emoji}</div>
        <div><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span></div>
        <span class="entry__tag">${m.emoji} ${m.label}</span>
      </div>`;
  };

  const postHTML = (p) => {
    const isOpen = openComments.has(p.id);
    return `
      <article class="card post" data-id="${p.id}">
        <header class="post__head">
          <div class="avatar" style="--h:${hue(p.user)}">${esc(p.user.slice(0, 1).toUpperCase())}</div>
          <div class="post__who"><strong>@${esc(p.user)}</strong><span>${timeAgo(p.ts)}</span></div>
          <span class="post__type">${TYPE_LABEL[p.type]}</span>
        </header>
        <p class="post__body">${esc(p.text)}</p>
        ${p.track ? trackHTML(p.track) : ''}
        ${p.fromJournal ? '' : `
        <div class="post__actions">
          <button class="act ${p.liked ? 'is-on' : ''}" data-act="like" aria-pressed="${p.liked}">
            <span class="heart" aria-hidden="true">${p.liked ? '♥' : '♡'}</span> ${p.likes}
          </button>
          <button class="act" data-act="toggle" aria-expanded="${isOpen}">💬 ${p.comments.length}</button>
          <button class="act" data-act="share">↗ 공유</button>
        </div>
        <div class="comments" ${isOpen ? '' : 'hidden'}>
          ${p.comments.map((c) => `
            <div class="comment">
              <div class="avatar" style="--h:${hue(c.user)}">${esc(c.user.slice(0, 1).toUpperCase())}</div>
              <p><b>@${esc(c.user)}</b>${esc(c.text)}</p>
            </div>`).join('')}
          <form class="comment-form" data-act="comment">
            <input type="text" placeholder="댓글 달기" maxlength="140" aria-label="댓글 입력" />
            <button class="btn btn--accent btn--sm" type="submit">등록</button>
          </form>
        </div>`}
      </article>`;
  };

  const renderFeed = () => {
    const all = [...posts, ...journalPosts()]
      .filter((p) => feedFilter === 'all' || p.type === feedFilter)
      .sort((a, b) => b.ts - a.ts);
    $('#feed').innerHTML = all.length
      ? all.map(postHTML).join('')
      : '<p class="empty">아직 글이 없어요. 첫 이야기를 남겨보세요.</p>';
  };

  const savePosts = () => { if (!db) store.set(FEED_KEY, posts); };

  const toggleLike = (post) => {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
  };

  $('#feed').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'FORM') return;
    const id = btn.closest('.post').dataset.id;
    const post = posts.find((p) => p.id === id);
    if (!post) return;

    if (btn.dataset.act === 'like') {
      if (needAuth()) return;
      // 낙관적 업데이트 후 실패하면 되돌린다
      toggleLike(post);
      savePosts();
      renderFeed();
      if (!db) return;
      const { error } = post.liked
        ? await db.from('post_likes').insert({ post_id: id })
        : await db.from('post_likes').delete().eq('post_id', id).eq('user_id', me.id);
      if (error) { toggleLike(post); renderFeed(); fail(error); }
    } else if (btn.dataset.act === 'toggle') {
      openComments.has(id) ? openComments.delete(id) : openComments.add(id);
      renderFeed();
      if (openComments.has(id)) $(`.post[data-id="${id}"] .comment-form input`)?.focus();
    } else if (btn.dataset.act === 'share') {
      toast('🔗 링크를 복사했어요');
    }
  });

  $('#feed').addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-act="comment"]');
    if (!form) return;
    e.preventDefault();
    if (needAuth()) return;
    const input = $('input', form);
    const text = input.value.trim();
    if (!text) return;
    const id = form.closest('.post').dataset.id;
    const post = posts.find((p) => p.id === id);
    if (db) {
      input.disabled = true;
      const { error } = await db.from('comments').insert({ post_id: id, body: text });
      input.disabled = false;
      if (error) return fail(error);
    }
    post.comments.push({ user: me.handle, text });
    savePosts();
    renderFeed();
    $(`.post[data-id="${id}"] .comment-form input`)?.focus();
  });

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (needAuth()) return;
    const ta = $('#postText');
    const text = ta.value.trim();
    if (!text) { ta.focus(); toast('내용을 입력해주세요'); return; }
    const post = { id: `p${Date.now()}`, user: me.handle, type: $('#postType').value, ts: Date.now(), text, likes: 0, liked: false, comments: [] };
    if (db) {
      const submitBtn = $('[type="submit"]', e.target);
      submitBtn.disabled = true;
      const { data, error } = await db.from('posts').insert({ type: post.type, body: text }).select('id, created_at').single();
      submitBtn.disabled = false;
      if (error) return fail(error);
      post.id = data.id;
      post.ts = Date.parse(data.created_at);
    }
    posts.push(post);
    savePosts();
    ta.value = '';
    feedFilter = 'all';
    syncTabs();
    renderFeed();
    toast('라운지에 글을 올렸어요');
  });

  const tabs = $$('#feedTabs .tab');
  const syncTabs = () => tabs.forEach((t) => {
    const on = t.dataset.filter === feedFilter;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  tabs.forEach((t) => t.addEventListener('click', () => {
    feedFilter = t.dataset.filter;
    syncTabs();
    renderFeed();
  }));

  /* ---------- 지금 듣는 중 ---------- */
  const LISTENING = [
    ['neon_cat', 'Magnetic', 'ILLIT'],
    ['jae.digs', 'Cupid', 'FIFTY FIFTY'],
    ['vinyl.ha', 'Fly Me to the Moon', 'Frank Sinatra'],
    ['indie.kim', '혜화', '검정치마']
  ];
  $('#listening').innerHTML = LISTENING.map(([u, t, a]) => `
    <li>
      <div class="avatar" style="--h:${hue(u)}">${u[0].toUpperCase()}</div>
      <div><strong>${t}</strong><span>@${u} · ${a}</span></div>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    </li>`).join('');

  /* ---------- 실시간 채팅 (더미) ---------- */
  const chatLog = $('#chatLog');
  // 더미 대화: 아래 재료를 템플릿에 무작위로 끼워 넣어 매번 다른 줄을 만든다
  const CHAT_USERS = ['vinyl.ha', 'neon_cat', 'beat.park', 'rainy.day', 'lofi.min', 'jae.digs', 'indie.kim',
    'citypop.yu', 'late.night.j', 'bass.lee', 'jazz.cafe', 'synth.wave', 'dawn.walker', 'track.hunter',
    'kpop.daily', 'cassette.yoon', 'dream.pop', 'chill.mode', 'b_side', 'playlist.mia'];
  const CHAT_SONGS = [
    ...CRATES.flatMap((c) => c.tracks),
    ...LISTENING.map(([, t, a]) => [t, a]),
    ['Hype Boy', 'NewJeans'], ['밤양갱', '비비'], ['Love wins all', '아이유'], ['Mayonaka no Door', '松原みき'],
    ['Get You', 'Daniel Caesar'], ['Nightcall', 'Kavinsky'], ['Space Song', 'Beach House'], ['So What', 'Miles Davis'],
    ['나의 사춘기에게', '볼빨간사춘기'], ['Aruarian Dance', 'Nujabes'], ['Super Shy', 'NewJeans'], ['Kiss Me More', 'Doja Cat']
  ];
  const CHAT_ARTISTS = [...new Set(CHAT_SONGS.map(([, a]) => a))];
  const CHAT_TAGS = ['#시티팝', '#새벽감성', '#인디발굴', '#비오는날', '#90s', '#공부BGM', '#재즈힙합', '#이별후'];
  const CHAT_PLACES = ['출근길', '퇴근길', '카페', '도서관', '헬스장', '버스 안', '한강', '새벽 산책', '드라이브', '주말 아침'];
  const CHAT_TEMPLATES = [
    '지금 {song} 듣는 중인데 {mood} 그 자체…',
    '{place}에서 {song} 틀었더니 분위기 완성',
    '{artist} 노래 중에 제일 좋아하는 거 뭐예요?',
    '{artist} 신보 들어보신 분?',
    '{crate} 크레이트 지금 딱이다',
    '{crate} 크레이트에 {song} 있는 거 실화냐',
    '{tag} 태그 요즘 너무 좋음',
    '{tag} 태그 둘러보다가 인생곡 찾음',
    '오늘 기분 {emoji} {mood}. 추천 받아요!',
    '방금 {song} {mood}으로 감정 기록 남김 ㅎㅎ',
    '{song} 이거 {place}용으로 완벽함',
    '{place}에 들을 노래 추천 좀요 🙏',
    '{song} 처음 들은 날 아직도 기억남',
    '{artist} 라이브 영상 보고 왔는데 미쳤어요',
    '디깅 AI한테 {mood} 무드 노래 물어봤는데 꽤 괜찮네',
    '오늘 LP 바 가는데 {artist} 앨범 있으려나',
    '{song} 베이스 라인 들어보세요 진짜',
    'ㅋㅋㅋ 다들 {place}에서 뭐 들어요?',
    '@{user} 님 추천해준 {song} 저장했어요 👍',
    '@{user} 그거 {artist} 맞죠?'
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const recentChat = []; // 같은 템플릿·같은 사람이 연달아 나오지 않게
  const makeChatLine = () => {
    let tpl, user;
    do { tpl = pick(CHAT_TEMPLATES); } while (recentChat.includes(tpl));
    do { user = pick(CHAT_USERS); } while (recentChat.includes(user));
    recentChat.push(tpl, user);
    if (recentChat.length > 8) recentChat.splice(0, 2);
    const [song, songArtist] = pick(CHAT_SONGS);
    const mood = pick(MOODS);
    const text = tpl
      .replace('{song}', `'${song}'`)
      .replace('{artist}', tpl.includes('{song}') ? songArtist : pick(CHAT_ARTISTS))
      .replace('{mood}', mood.label)
      .replace('{emoji}', mood.emoji)
      .replace('{crate}', `'${pick(CRATES).title}'`)
      .replace('{tag}', pick(CHAT_TAGS))
      .replace('{place}', pick(CHAT_PLACES))
      .replace('{user}', pick(CHAT_USERS.filter((u) => u !== user)));
    return [user, text];
  };
  const addMsg = (user, text, isMe = false) => {
    const div = document.createElement('div');
    div.className = `chat__msg${isMe ? ' is-me' : ''}`;
    div.style.setProperty('--h', hue(user));
    div.innerHTML = `<b>${esc(user)}</b>${esc(text)}`;
    chatLog.appendChild(div);
    while (chatLog.children.length > 40) chatLog.firstChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  };
  for (let i = 0; i < 4; i++) addMsg(...makeChatLine());
  // 3~10초 간격으로 올라오고, 가끔은 두 사람이 연달아 말한다. 접속자 수도 조금씩 오르내린다
  let chatters = 214;
  const tickChat = () => {
    addMsg(...makeChatLine());
    if (Math.random() < 0.25) setTimeout(() => addMsg(...makeChatLine()), 900 + Math.random() * 1500);
    chatters = Math.max(150, chatters + Math.round((Math.random() - 0.45) * 6));
    $('#chatCount').textContent = `· ${chatters}명`;
    setTimeout(tickChat, 3000 + Math.random() * 7000);
  };
  setTimeout(tickChat, 4000);

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (needAuth()) return;
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    addMsg(me.handle, text, true);
    input.value = '';
  });

  /* =========================================================
     디깅 AI (Edge Function dig-chat: Upstage 임베딩 → pgvector 검색 → OpenAI)
     ========================================================= */
  const digFab = $('#digFab');
  const digPanel = $('#digPanel');
  const digLog = $('#digLog');
  const digInput = $('#digInput');
  const DIG_SUGGEST = ['비 오는 밤에 들을 잔잔한 노래', '출근길 텐션 올려줄 시티팝', '나랑 취향 비슷한 디거 찾아줘', '무드 크레이트가 뭐예요?'];
  let digHistory = []; // 서버로 보내는 대화 ({ role, content })
  let digTracks = [];  // 추천된 곡 — "기록하기" 버튼이 data-pick 인덱스로 찾는다
  let digBusy = false;

  const addDig = (html, cls = '') => {
    const div = document.createElement('div');
    div.className = `dig__msg ${cls}`;
    div.innerHTML = html;
    digLog.appendChild(div);
    digLog.scrollTop = digLog.scrollHeight;
    return div;
  };

  const digTrackHTML = (t) => {
    const m = t.mood ? moodOf(t.mood) : null;
    const idx = digTracks.push(t) - 1;
    return `
      <li class="dig-track">
        <div class="cover" style="background:${m ? coverBg(m) : 'var(--line)'}" aria-hidden="true">${m ? m.emoji : '🎵'}</div>
        <div class="dig-track__info">
          <strong>${esc(t.title)}</strong>
          <span>${esc(t.artist)}${t.inCrate ? ' · <b class="dig-badge">crate.</b>' : ''}</span>
          <p>${esc(t.reason)}${t.diggers.length ? ` <em>${t.diggers.map((h) => `@${esc(h)}`).join(' ')}</em>` : ''}</p>
        </div>
        <button type="button" class="btn btn--outline btn--sm" data-pick="${idx}">기록하기</button>
      </li>`;
  };

  const digUserHTML = (u) => `
    <li class="dig-user">
      <div class="avatar" style="--h:${hue(u.handle)}">${esc(u.handle.slice(0, 1).toUpperCase())}</div>
      <div>
        <strong>@${esc(u.handle)}</strong>${u.moods.length ? `<span>${u.moods.map(esc).join(' · ')}</span>` : ''}
        <p>${esc(u.reason)}</p>
      </div>
    </li>`;

  const resetDig = () => {
    digHistory = [];
    digTracks = [];
    digLog.innerHTML = '';
    addDig(esc(me
      ? `안녕하세요 @${me.handle}님! 지금 기분이나 상황, 듣고 싶은 장르를 말해주세요. 디거들이 기록한 곡과 취향이 닮은 디거를 찾아드릴게요.`
      : '지금 기분이나 듣고 싶은 장르를 말해주세요. 디거들이 기록한 곡과 취향이 닮은 디거를 찾아드릴게요.'));
    $('#digChips').hidden = false;
  };

  const askDig = async (text) => {
    if (digBusy || !text) return;
    if (!db) { addDig(esc('디깅 AI는 서버에 연결됐을 때만 쓸 수 있어요.')); return; }
    if (needAuth()) return;
    digBusy = true;
    $('#digChips').hidden = true;
    addDig(esc(text), 'is-me');
    digHistory.push({ role: 'user', content: text });
    const typing = addDig('<span class="dig__typing" aria-label="답변 준비 중"><i></i><i></i><i></i></span>');
    try {
      const { data, error } = await db.functions.invoke('dig-chat', { body: { messages: digHistory } });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error || '디깅 AI가 잠깐 멈췄어요. 잠시 후 다시 시도해주세요.');
      }
      typing.remove();
      addDig(`
        <p>${esc(data.reply)}</p>
        ${data.tracks.length ? `<ul class="dig__list">${data.tracks.map(digTrackHTML).join('')}</ul>` : ''}
        ${data.users.length ? `<p class="dig__sub">취향이 닮은 디거</p><ul class="dig__list">${data.users.map(digUserHTML).join('')}</ul>` : ''}`);
      // 다음 질문("더 신나는 걸로")이 앞의 추천을 알 수 있게 목록을 같이 넘긴다
      const picked = data.tracks.map((t) => `${t.title} — ${t.artist}`).concat(data.users.map((u) => `@${u.handle}`));
      digHistory.push({ role: 'assistant', content: picked.length ? `${data.reply}\n(추천: ${picked.join(', ')})` : data.reply });
    } catch (err) {
      console.warn('[crate] 디깅 AI', err);
      typing.remove();
      digHistory.pop(); // 답을 못 받은 질문은 대화에서 뺀다
      addDig(esc(err.message), 'is-error');
    } finally {
      digBusy = false;
    }
  };

  const setDig = (open) => {
    digPanel.hidden = !open;
    digFab.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!digLog.children.length) resetDig();
      digInput.focus();
    }
  };
  digFab.addEventListener('click', () => setDig(digPanel.hidden));
  $('#digClose').addEventListener('click', () => { setDig(false); digFab.focus(); });
  digPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setDig(false); digFab.focus(); } });

  $('#digChips').innerHTML = DIG_SUGGEST.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  $('#digChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (b) askDig(b.dataset.q);
  });

  $('#digForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = digInput.value.trim();
    if (!text || digBusy) return;
    digInput.value = '';
    askDig(text);
  });

  // 추천 곡을 감정 저널 폼에 채운다
  digLog.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const t = digTracks[+b.dataset.pick];
    $('#songTitle').value = t.title;
    $('#songArtist').value = t.artist;
    $('#songTitle').classList.remove('is-invalid');
    $('#songArtist').classList.remove('is-invalid');
    if (t.mood) $(`.mood[data-mood="${t.mood}"]`, moodPicker)?.click();
    if (window.matchMedia('(max-width: 560px)').matches) setDig(false);
    $('#journal').scrollIntoView({ behavior: 'smooth' });
    toast(`🎵 ${t.title} · 감정 저널에 채웠어요`);
  });

  /* =========================================================
     로그인 / 회원가입 (이메일 + 비밀번호, Supabase 모드에서만)
     ========================================================= */
  const authBtn = $('#authBtn');
  const userHandle = $('#userHandle');
  const authDialog = $('#authDialog');
  const authForm = $('#authForm');
  const authErr = $('#authError');
  let authMode = 'signin';

  const renderAuth = () => {
    authBtn.hidden = !db;
    authBtn.textContent = me ? '로그아웃' : '로그인';
    userHandle.hidden = !(db && me);
    userHandle.textContent = db && me ? `@${me.handle}` : '';
  };

  const setAuthMode = (mode) => {
    authMode = mode;
    const signup = mode === 'signup';
    $$('[data-mode]', authForm).forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $('#handleField').hidden = !signup;
    $('#authTitle').textContent = signup ? 'crate.에 오신 걸 환영해요' : '다시 만나서 반가워요';
    $('#authSubmit').textContent = signup ? '가입하기' : '로그인';
    $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    authErr.textContent = '';
  };

  const openAuth = (mode = 'signin') => {
    setAuthMode(mode);
    if (!authDialog.open) authDialog.showModal();
    $('#authEmail').focus();
  };

  const AUTH_ERRORS = {
    invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요.',
    email_not_confirmed: '메일 인증을 아직 마치지 않았어요. 받은 편지함을 확인해주세요.',
    user_already_exists: '이미 가입된 이메일이에요. 로그인해주세요.',
    weak_password: '비밀번호가 너무 약해요. 더 길고 복잡하게 만들어주세요.',
    over_email_send_rate_limit: '메일을 너무 자주 보냈어요. 잠시 후 다시 시도해주세요.',
    over_request_rate_limit: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.'
  };

  // 로그인 상태가 바뀌면 내 기록·좋아요를 다시 불러온다
  const reload = async () => {
    journal = [];
    posts = [];
    journalFilter = 'all';
    try {
      await Promise.all([loadJournal(), loadFeed()]);
    } catch (err) {
      console.error('[crate]', err);
      toast('데이터를 불러오지 못했어요');
    }
    renderAuth();
    renderJournal();
    renderFeed();
    if (digLog.children.length) resetDig(); // 계정이 바뀌면 AI 대화도 새로 시작
  };

  authBtn.addEventListener('click', async () => {
    if (!me) return openAuth('signin');
    authBtn.disabled = true;
    await db.auth.signOut(); // SIGNED_OUT 이벤트에서 화면을 갱신한다
    authBtn.disabled = false;
    toast('로그아웃했어요');
  });

  $('.auth__tabs', authForm).addEventListener('click', (e) => {
    const t = e.target.closest('[data-mode]');
    if (t) setAuthMode(t.dataset.mode);
  });
  $('#authClose').addEventListener('click', () => authDialog.close());
  // 폼 바깥(backdrop)을 누르면 닫기
  authDialog.addEventListener('click', (e) => { if (e.target === authDialog) authDialog.close(); });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const handle = $('#authHandle').value.trim().toLowerCase();
    const signup = authMode === 'signup';

    if (!/^\S+@\S+\.\S+$/.test(email)) { authErr.textContent = '이메일 주소를 확인해주세요.'; return; }
    if (password.length < 6) { authErr.textContent = '비밀번호는 6자 이상이어야 해요.'; return; }
    if (signup && handle && !/^[a-z0-9._]{2,24}$/.test(handle)) {
      authErr.textContent = '닉네임은 영문 소문자, 숫자, 마침표(.), 밑줄(_)로 2~24자예요.';
      return;
    }
    authErr.textContent = '';

    const submitBtn = $('#authSubmit');
    submitBtn.disabled = true;
    try {
      if (signup && handle) {
        const { data: taken } = await db.from('profiles').select('id').eq('handle', handle).maybeSingle();
        if (taken) { authErr.textContent = '이미 쓰이는 닉네임이에요.'; return; }
      }
      const { data, error } = signup
        ? await db.auth.signUp({ email, password, options: { data: { handle }, emailRedirectTo: location.href.split('#')[0] } })
        : await db.auth.signInWithPassword({ email, password });
      if (error) {
        console.warn('[crate]', error);
        authErr.textContent = AUTH_ERRORS[error.code] || error.message;
        return;
      }
      // 메일 인증이 켜져 있으면 세션 없이 돌아온다 (이미 가입된 이메일이면 identities가 비어 있음)
      if (!data.session) {
        if (data.user && data.user.identities?.length === 0) { authErr.textContent = AUTH_ERRORS.user_already_exists; return; }
        authDialog.close();
        authForm.reset();
        toast('📧 인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요', 5000);
        return;
      }
      me = await fetchProfile(db, data.session.user.id);
      authDialog.close();
      authForm.reset();
      await reload();
      toast(`@${me.handle}님, 반가워요 👋`);
    } catch (err) {
      console.error('[crate]', err);
      authErr.textContent = '잠시 후 다시 시도해주세요.';
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* ---------- Init ---------- */
  revealTargets.forEach((el) => io.observe(el));
  // 새로 렌더링된 크레이트 카드도 reveal 대상에 포함
  $$('.crate').forEach((el) => { el.classList.add('reveal'); io.observe(el); });

  (async () => {
    await connect();
    if (db) {
      // 로그아웃 버튼, 세션 만료, 다른 탭에서의 로그아웃 모두 여기로 온다
      db.auth.onAuthStateChange((event) => {
        if (event !== 'SIGNED_OUT' || !me) return;
        me = null;
        setTimeout(reload); // 콜백 안에서 바로 Supabase를 호출하면 교착될 수 있다
      });
      await reload();
    } else {
      renderAuth();
      renderJournal();
      renderFeed();
    }
  })();

  // "n분 전" 표기 갱신 (Supabase 모드에서는 다른 디거들의 새 글도 다시 불러온다)
  setInterval(async () => {
    if ($('#feed').contains(document.activeElement)) return;
    if (db) {
      try { await loadFeed(); } catch (err) { console.error('[crate]', err); }
    }
    renderFeed();
  }, 60000);
})();

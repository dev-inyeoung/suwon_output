# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**crate.** — a music-digging community site (Korean UI). Plain HTML/CSS/JS, no build step, no framework, no tests, no linter. The backend is Supabase (project `crate`, ref `cxxwdevqmncysxymxgxe`, ap-northeast-2), called straight from the browser with supabase-js (UMD from jsDelivr). The design takes cues from the Spotify Premium page (dark background, bold type, pill buttons, color-headed plan cards) without copying it; the accent is coral `#ff6a3d`, not Spotify green.

Files: `index.html` (all markup, single page), `css/style.css`, `js/main.js`, `js/config.js` (Supabase URL + publishable key; empty values = offline mode), `supabase/schema.sql` + `supabase/seed.sql` + `supabase/seed_feed.sql` (what was applied to the project — keep them in sync with any migration), `supabase/functions/dig-chat/index.ts` (the 디깅 AI Edge Function).

## Running

Opening `index.html` directly works. For a local server (also defined in `.claude/launch.json` as `crate-static`):

```bash
npx --yes http-server . -p 5173 -c-1
```

Clear localStorage (`crate.journal`, `crate.feed`) to get back to the seed data in offline mode. Clearing the `sb-*` auth key logs you out in Supabase mode.

## Changing the database

Apply schema changes to the project as a migration (Supabase MCP `apply_migration` on ref `cxxwdevqmncysxymxgxe`), then mirror them in `supabase/schema.sql`. Run the security advisors afterwards. `seed.sql` is plain data and runs once on an empty DB. It is not idempotent.

- RLS alone isn't enough. Privileges are granted explicitly and **per column** for writes: clients may insert only `posts(type, body, track_*)` and `comments(post_id, body)`, and update only `profiles(handle)`. A new column the browser writes needs a `grant`, or the insert fails with a permission error.
- The client never sends `user_id`. Inserts rely on `default auth.uid()`, and the RLS `with check` compares it to the caller.
- Trigger-only `security definer` functions have `EXECUTE` revoked from `public, anon, authenticated` so they aren't callable via `/rest/v1/rpc`. Do the same for new ones.
- Every table has a restrictive `"<table>: 익명 세션 차단"` policy that blocks sessions whose JWT has `is_anonymous`. Add one to any new table. The advisor still reports `auth_allow_anonymous_sign_ins` for the permissive policies because it doesn't recognize the restrictive ones; that warning is expected.
- Auth settings live in the dashboard, not in SQL: anonymous sign-ins are off, and email confirmation links go back to the Site URL / Redirect URLs (which must include `http://localhost:5173` for local testing).

## Architecture

- **Mostly JS-rendered content.** `index.html` holds the static shell (hero, features, FAQ, footer) plus empty containers. `js/main.js` (one IIFE) renders the mood picker, journal timeline, mood summary bar, mood crate cards, community feed, "지금 듣는 중" list and chat. To change those sections, edit the data and template functions in `main.js`, not the HTML.
- **`MOODS` is the single source of truth** on the front end for the six emotions (id, Korean label, emoji, color). The journal, filters, crates, feed track cards, summary bar and 디깅 AI cards all look moods up through `moodOf(id)`. A mood's color gets to CSS through the inline custom property `--mood`, so styles like `.entry__tag`, `.crate__head` and `.mood[aria-checked="true"]` read `var(--mood)`. To add a mood, add it to `MOODS`, then to the `check` constraints and the `dig_sources` view in the DB and to `MOODS` in the `dig-chat` function.
- **Journal → feed link.** Journal entries saved with `isPublic: true` aren't stored as posts. `journalPosts()` turns them into read-only feed posts (`type: 'journal'`, `fromJournal: true`, no like/comment actions) each time `renderFeed()` runs. Any change to `journal` has to call both `renderJournal()` and `renderFeed()`.
- **Two data modes.** On load `connect()` creates a Supabase client and restores any existing session. If config is empty or the connection fails, `db` stays `null` and everything runs on localStorage seed data (`me.digger`, no auth UI). Every mutation is `if (db) await db…; else store.set(…)`.
- **Auth (Supabase mode only).** Email + password through the `<dialog id="authDialog">` modal; an old anonymous session is signed out on load. `signUp` passes the chosen handle as user metadata, and the trigger `handle_new_user` uses it for the `profiles` row (falling back to `digger.xxxxxx` if invalid or taken). With email confirmation on, `signUp` returns no session (and `user.identities` is empty if the email already exists). Logged out, `me` is `null`, the feed is read-only, and every write handler starts with `if (needAuth()) return;`, which opens the modal. Login goes through `reload()`; sign-out (button, expiry, other tab) is handled by the `SIGNED_OUT` listener, which defers its Supabase calls with `setTimeout` to avoid deadlocking inside the callback.
- **Schema.** `profiles` (seed users have no auth account), `journal_entries`, `posts` (`like_count` kept by the `post_likes` trigger), `post_likes`, `comments`. RLS: everyone reads; you write/delete only your own rows; non-public journal entries are visible only to their owner. Posts→profiles embeds must name the FK (`profiles!posts_user_id_fkey`) because `post_likes` makes the relationship ambiguous. In Supabase mode the feed also shows other users' public journal entries (`othersJournal`) and refetches every minute.
- **Render-from-state.** Every interaction mutates the `journal` / `posts` arrays, persists them (Supabase or `store`, a try/catch localStorage wrapper), then re-renders the whole list with `innerHTML`. Clicks are handled by event delegation on the containers (`#feed`, `#timeline`, `#moodPicker`) using `data-act` / `data-del` / `data-mood` attributes. Open comment threads persist across re-renders through the `openComments` Set.
- **Escape all user text** with `esc()` before it goes into a template string. User input only ever reaches the DOM through `innerHTML`.
- **Song search.** The journal form's "노래 찾기" box queries the iTunes Search API from the browser (no key, CORS allowed) and picking a result only fills `#songTitle` / `#songArtist`; nothing extra is stored. The `country=KR` storefront returns nothing, so it uses the default store, where Korean songs may come back with romanized titles.
- **디깅 AI (RAG chatbot).** The floating `#digFab` / `#digPanel` calls the Edge Function `dig-chat` through `db.functions.invoke`, sending the in-memory `digHistory`. Logged-in only (`needAuth()`); offline mode just shows a notice. The function (deployed with `verify_jwt: false`; it checks the token itself with `auth.getUser` and rejects anonymous sessions) rate-limits to 30 calls/hour via `dig_chat_log`, then syncs the index: rows of the `dig_sources` view (tracks and diggers aggregated from posts + public journal entries) plus the hard-coded `PAGE_DOCS` (site guide; keep in line with `index.html`) are compared with `dig_documents` and only changed text is re-embedded (Upstage `solar-embedding-2-passage`, 1024 dims). This runs at most every 5 minutes per isolate, so new posts show up in the AI within minutes. It embeds the last two user messages (`-query` model), pulls the top tracks/users/page docs through `match_dig_documents`, adds the caller's 10 latest journal entries, and asks OpenAI Chat Completions (`OPENAI_MODEL`, default `gpt-5-mini`) for a structured `{ reply, tracks, users }`. The function drops users not in the retrieved candidates and marks tracks found in crate. as `inCrate`. The front end renders the reply and wires "기록하기" to fill the journal form. Secrets `OPENAI_API_KEY` and `UPSTAGE_API_KEY` live in Supabase Edge Function secrets, not in this repo; without them the function answers 503. To redeploy after editing, deploy `supabase/functions/dig-chat/index.ts` with `verify_jwt: false`. The mood labels in `dig_sources` and the function's `MOODS` duplicate `MOODS` in `main.js`, so update all three when adding a mood.
- Chat bot lines, "listening" users, counter numbers and crates are still hard-coded dummy data. The current user is `me` (`{ id, handle }`; `null` when logged out; `me.digger` in offline mode).
- Some static copy in `index.html` (journal section description, FAQ) describes where data is stored and who can see it. Keep it in line with the data layer.

## CSS conventions

- Design tokens live on `:root` (`--bg`, `--surface`, `--accent`, `--c-*` palette, `--radius*`, `--pill`, `--ease`). Use these instead of new literal values.
- BEM-style class names (`block__element`, `block--modifier`); state classes are `is-*` (`is-active`, `is-open`, `is-show`, `is-in`, `is-on`).
- Breakpoints: 1080px (journal and community collapse to one column), 860px (hamburger nav), 560px (phone).
- Scroll-reveal: `main.js` adds `.reveal` and an IntersectionObserver sets `.is-in`. Elements rendered later must be registered with `io.observe` (as the crate cards are).
- `prefers-reduced-motion` turns off all animations and transitions.
- Form input styles are keyed on `input[type="text"|"email"|"password"]`, `textarea` and `select`. A new input type needs to be added to those selectors or it renders unstyled.

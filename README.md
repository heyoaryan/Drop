<div align="center">

# Drop

**Instantly share text, photos, and PDFs — no accounts, no apps, no WhatsApp.**

A zero-friction, room-based sharing tool that works in any browser.  
Open a session, share a 4-digit code, and everything syncs in real time.

</div>

---

## How It Works

Drop uses 4-digit **session codes** as shared rooms. Anyone with the same code sees the same feed, live. There's no login, no account, no install — just open the link and go.

When you send a message or file, it goes to Supabase (Postgres + Storage). Supabase Realtime pushes the change to every other device in that session over a WebSocket — so the feed updates instantly without polling.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser  (Static Site)                   │
│                                                              │
│   ┌─────────────┐   ┌──────────────┐   ┌────────────────┐   │
│   │ Home Screen  │   │ Session Feed │   │    Composer    │   │
│   │             │   │              │   │                │   │
│   │ • New session│   │ • Text cards │   │ • Text input   │   │
│   │ • Join code  │   │ • Image cards│   │ • Photo picker │   │
│   │ • Deep link  │   │ • File cards │   │ • File picker  │   │
│   └──────┬──────┘   └──────┬───────┘   └───────┬────────┘   │
│          └─────────────────┼───────────────────┘            │
│                            │                                 │
│               supabase-js SDK (v2)                           │
└────────────────────────────┼────────────────────────────────┘
                             │
             ┌───────────────▼───────────────┐
             │            Supabase            │
             │                               │
             │  ┌────────────────────────┐   │
             │  │      Postgres DB        │   │
             │  │    drop_items table     │   │
             │  │  (text / image / file)  │   │
             │  └───────────┬────────────┘   │
             │              │                │
             │  ┌───────────▼────────────┐   │
             │  │    Realtime Engine      │   │
             │  │  WebSocket pub/sub      │   │
             │  │  filtered by session    │   │
             │  └────────────────────────┘   │
             │                               │
             │  ┌────────────────────────┐   │
             │  │    Storage Bucket       │   │
             │  │      drop_files         │   │
             │  │  (images, PDFs, docs)   │   │
             │  └────────────────────────┘   │
             └───────────────────────────────┘
```

---

## Data Flow Diagrams

### Text Message — Send & Sync

```
User A types & hits Send
        │
        ▼
supabase-js .insert()
  into drop_items
  { session_code, kind: 'text', text }
        │
        ▼
   Postgres DB
   row created
        │
        ▼
  Realtime Engine
  broadcasts INSERT event
  on channel  session-XXXX
        │
   ┌────┴────┐
   │         │
   ▼         ▼
Device B   Device C
feed live  feed live
updates    updates
```

### File / Image — Upload & Sync

```
User A selects photo or file
        │
        ▼ (images only)
Client-side compression
  Canvas API — JPEG 75%, max 1400px
  result: ~80% smaller file
        │
        ▼
Supabase Storage
  bucket: drop_files
  path:   sessions/{code}/{timestamp}_{name}
  returns: public URL
        │
        ▼
supabase-js .insert()
  into drop_items
  { kind, name, url, storage_path, size }
        │
        ▼
  Realtime Engine
  broadcasts INSERT event
        │
   ┌────┴────┐
   │         │
   ▼         ▼
Device B   Device C
image/file image/file
card shown card shown
```

### Session Lifecycle

```
User opens Drop.html
        │
        ├─ URL has #XXXX? ──────────────► auto-join session XXXX
        │
        └─ No hash
                │
                ├─ "New session" ────────► random 4-digit code
                │                          ↓
                └─ "Join with code" ─────► user types code
                                           ↓
                                      enter(code)
                                           │
                          ┌────────────────┼────────────────┐
                          │                │                │
                          ▼                ▼                ▼
                  initSupabase()   loadInitial()   subscribeRealtime()
                  create SDK       fetch last       open WebSocket
                  from config.js   80 items         channel
                  or localStorage  for code         session-{code}
                          │                │                │
                          └────────────────┴────────────────┘
                                           │
                                    on SUBSCRIBED
                                           │
                                           ▼
                                   reveal feed UI
                                   status: Live
```

---

## Database Schema

```sql
create table public.drop_items (
  id           uuid primary key default gen_random_uuid(),
  session_code text not null,
  kind         text not null check (kind in ('text', 'image', 'file')),
  text         text,
  name         text,
  url          text,
  storage_path text,
  size         bigint default 0,
  created_at   timestamptz default now()
);

-- Index for fast per-session queries
create index idx_drop_items_session
  on public.drop_items(session_code, created_at asc);
```

RLS Policies — fully public, no auth required:

| Policy | Rule |
|---|---|
| SELECT | `using (true)` — anyone can read |
| INSERT | `with check (true)` — anyone can insert |
| DELETE | `using (true)` — anyone can delete |

---

## Feature Overview

| Feature | How |
|---|---|
| 4-digit session codes | Randomly generated (`Math.random`) or typed manually |
| Deep link routing | `Drop.html#1234` auto-joins session 1234 on load |
| Realtime sync | Supabase WebSocket channel, sub-50ms latency |
| Image compression | HTML5 Canvas, JPEG 75%, max 1400px — ~80% size reduction |
| File sharing | PDFs, docs, ZIPs up to 50 MB via Supabase Storage |
| Drag and drop | Drop files anywhere on the window while in a session |
| Native share | iOS/Android share sheet via Web Share API |
| Clipboard copy | Text, file links, session invite URL |
| Dark mode | Auto via `prefers-color-scheme`, manual toggle available |
| Zero backend | 100% static — deploy to any CDN or static host |
| No accounts | Zero login, zero signup, zero tracking |

---

## File Structure

```
Drop/
├── Drop.html           # Entire app — single self-contained HTML file
├── config.js           # Your Supabase credentials  ← gitignored
├── config.example.js   # Safe template to copy from
├── schema.sql          # Run once in Supabase SQL Editor
├── privacy.html        # Privacy & security info page
├── working.html        # How it works page
├── .gitignore          # Keeps config.js out of git
└── README.md           # This file
```

---

## Setup

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) and create a free project.

### 2. Run the schema
Open **SQL Editor** in your Supabase dashboard, paste in `schema.sql`, and click **Run**.  
This creates the `drop_items` table, enables Realtime, and sets up the `drop_files` storage bucket.

### 3. Add your credentials

```bash
cp config.example.js config.js
```

Fill in values from **Supabase Dashboard → Project Settings → API**:

```javascript
window.SUPABASE_CONFIG = {
  url: "https://your-project-id.supabase.co",
  anonKey: "your-anon-public-key"
};
```

> `config.js` is gitignored and will never be committed.  
> You can also skip this file and enter credentials via the in-app **Setup** modal — they save to localStorage.

---

## Deploying

Drop is a fully static site — no build step, no server.

**Netlify / Vercel (recommended)**
1. Push the repo to GitHub — `config.js` stays out of git automatically
2. Connect on Netlify or Vercel, set publish directory to `/`
3. On first load, enter credentials via the in-app Setup modal

**GitHub Pages**
1. Push to GitHub
2. Settings → Pages → Deploy from branch → main / root
3. Open at `https://<you>.github.io/<repo>/Drop.html`

**Any static host (S3, Cloudflare Pages, etc.)**  
Upload everything except `config.js`. Configure credentials via the in-app modal on first load.

---

## Credential Security

| File | Committed to git | Contains secrets |
|---|---|---|
| `config.js` | No — gitignored | Yes — your real keys |
| `config.example.js` | Yes | No — placeholders only |

---

## Privacy

- Sessions are ephemeral — no user accounts, no tracking, no analytics
- Data is tied only to a 4-digit code, not to any identity
- Files are stored in a public Supabase Storage bucket — anyone with the URL can access them
- You can delete any item from the feed at any time
- Full details on the [Privacy & Security](privacy.html) page

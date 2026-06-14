# NovelChain

NovelChain is a small web-based party writing game. Players join the same room with a room code, write a shared novel one line at a time, and watch updates arrive through Supabase Realtime.

## Features

- Room creation and joining by short room code
- Supabase email/password accounts
- Host-controlled rules:
  - lines allowed per player
  - whether existing lines can be edited
- Realtime player and story updates through Supabase
- Completed-room History view
- TXT and PDF downloads
- `.env` based Supabase client configuration

## Setup

1. Create a Supabase project.
2. In Supabase Auth, enable the Email provider. For quick local testing, you can disable email confirmation.
3. Open Supabase SQL Editor and run `supabase/schema.sql`.
4. Copy `.env.example` to `.env` and fill in:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
```

5. Generate the browser env file:

```bash
npm run env
```

6. Open `index.html` in a browser, or run a static server:

```bash
npm install
npm start
```

The default local URL for `npm start` is `http://localhost:4173`.

## Notes

The Supabase anon key is intentionally used on the client. The schema stores `owner_id` on rooms and `user_id` on players and lines so later features like story sharing, profiles, and a personal archive can build on top of account ownership.

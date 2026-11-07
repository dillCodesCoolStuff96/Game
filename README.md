# Game

Mobile-first game web app. React + Vite, Supabase (login + database), deployed on Vercel.

- `npm run dev` — local dev server (also reachable from a phone on the same Wi-Fi)
- Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key.
- Database changes live in `supabase/migrations/`, run in order in the Supabase SQL Editor.

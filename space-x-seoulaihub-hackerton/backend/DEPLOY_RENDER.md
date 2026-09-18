# Render deployment handoff

This repository already contains the youth chat API at `/api/chat/*` and the teacher Case API at `/api/cases/*`.

## Team lead steps

1. In Render, choose **New → Blueprint** and select this repository and branch.
2. Render reads the root `render.yaml` and creates `itda-youth-chat-api`.
3. Set these secrets in the service environment:
   - `GEMINI_API_KEY`: Google AI Studio key.
   - `DATABASE_URL`: shared Supabase PostgreSQL connection string.
4. Deploy, then confirm `https://YOUR-RENDER-URL/api/health` responds with JSON.
5. Share `https://YOUR-RENDER-URL/api` with the frontend owner. The frontend sets `window.ITDA_CHAT_API_BASE` to this value.

Do not paste API keys into GitHub, pull requests, or chat messages.

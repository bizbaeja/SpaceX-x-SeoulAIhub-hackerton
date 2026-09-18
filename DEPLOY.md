# Netlify 배포 — PR마다 Preview 링크

## UI Build settings

| 항목 | 값 |
|---|---|
| Branch | `main` (또는 배포할 브랜치) |
| Base directory | `ai` |
| Build command | `npm install` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

## 환경변수

- `GOOGLE_API_KEY` = Gemini 키
- `AI_MIN_GAP_MS` = `13000`

## 404 날 때

1. `ai/netlify.toml`, `ai/netlify/functions/` 가 **배포된 커밋**에 있는지 확인
2. Deploys → **Clear cache and deploy site**
3. Functions 탭에 `server` 함수가 있는지 확인
4. `https://<사이트>/api/health` 가 `{"ok":true}` 인지 확인

## GitHub Secrets (Actions 선택)

- `NETLIFY_AUTH_TOKEN`
- `NETLIFY_SITE_ID`

import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { AiService } from './ai/index.js';
import type { ChatService } from './chat/service.js';
import type { Db } from './db.js';
import { errorHandler } from './http.js';
import { casesRouter } from './routes/cases.js';
import { chatRouter } from './routes/chat.js';
import { metaRouter } from './routes/meta.js';

export interface AppContext {
  db: Db;
  ai: AiService;
  chat: ChatService;
}

export function createApp(ctx: AppContext, opts: { logRequests?: boolean } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  if (opts.logRequests) {
    // 메서드/경로/상태만 남긴다. 요청 본문(상담 메모·채팅)은 로그에 남기지 않는다.
    app.use((req, res, next) => {
      const startedAt = performance.now();
      res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(performance.now() - startedAt)}ms`);
      });
      next();
    });
  }

  app.use('/api', metaRouter(ctx));
  app.use('/api/cases', casesRouter(ctx));
  app.use('/api/chat', chatRouter(ctx));
  // Referral 파트: app.use('/api/referrals', referralsRouter(ctx)) 를 여기에 추가 (docs 4.7 ~ 4.10)

  // 테스트용 데모 화면 (public/chat-demo.html). 실제 화면은 FE에서 만든다.
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `${req.method} ${req.path} 경로가 없습니다.` } });
  });
  app.use(errorHandler);
  return app;
}

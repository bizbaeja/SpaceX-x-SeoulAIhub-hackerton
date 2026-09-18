import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';

// 에러 형식: { error: { code, message, details? } }
// 400 VALIDATION_ERROR / 403 FORBIDDEN / 404 NOT_FOUND / 409 INVALID_STATE / 422 CONFIRMATION_REQUIRED
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new HttpError(400, 'VALIDATION_ERROR', '요청 값이 올바르지 않습니다.', issues);
  }
  return result.data;
}

// student: 청소년 AI 채팅 화면 (추가 기능)
export const ROLES = ['teacher', 'organization', 'student'] as const;
export type Role = (typeof ROLES)[number];

const DEMO_USER: Record<Role, string> = {
  teacher: 'demo-teacher-001',
  organization: 'demo-org-staff-001',
  student: 'demo-student',
};
const ROLE_LABEL: Record<Role, string> = { teacher: '교사', organization: '기관 담당자', student: '학생' };

/** 데모 역할. 인증 대신 `X-Demo-Role: teacher | organization | student` 헤더를 쓴다. 없으면 teacher. */
export function currentRole(req: Request): Role {
  const role = req.header('x-demo-role')?.trim().toLowerCase() || 'teacher';
  if ((ROLES as readonly string[]).includes(role)) return role as Role;
  throw new HttpError(400, 'VALIDATION_ERROR', `X-Demo-Role 헤더는 ${ROLES.join(' | ')} 중 하나여야 합니다.`);
}

export function requireRole(req: Request, ...allowed: Role[]): { role: Role; id: string } {
  const role = currentRole(req);
  if (!allowed.includes(role)) {
    throw new HttpError(403, 'FORBIDDEN', `${allowed.map((r) => ROLE_LABEL[r]).join('·')} 역할만 가능한 작업입니다.`);
  }
  return { role, id: DEMO_USER[role] };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'JSON 형식이 올바르지 않습니다.' } });
    return;
  }
  // 요청 본문(상담 메모)은 로그에 남기지 않는다.
  console.error('[error]', err instanceof Error ? err.stack : err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' } });
};

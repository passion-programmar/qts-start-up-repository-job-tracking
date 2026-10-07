import { queryOne } from '../database/connection';
import { AuthRequest } from './auth';

export function isAdmin(req: AuthRequest): boolean {
  return req.role === 'admin';
}

export function isBidder(req: AuthRequest): boolean {
  return req.role === 'bidder';
}

export function isCaller(req: AuthRequest): boolean {
  return req.role === 'caller';
}

export function isManager(req: AuthRequest): boolean {
  return req.role === 'manager';
}

export function candidateBidderFilter(
  req: AuthRequest,
  alias = 'c',
  paramIndex = 1
): { clause: string; params: unknown[]; nextIndex: number } {
  if (isAdmin(req)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }
  if (isManager(req) && req.userId) {
    return {
      clause: `${alias}.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $${paramIndex})`,
      params: [req.userId],
      nextIndex: paramIndex + 1,
    };
  }
  if (isBidder(req) && req.bidderId) {
    return {
      clause: `${alias}.bidder_id = $${paramIndex}`,
      params: [req.bidderId],
      nextIndex: paramIndex + 1,
    };
  }
  return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}

export function jobBidderFilter(
  req: AuthRequest,
  alias = 'j',
  paramIndex = 1
): { clause: string; params: unknown[]; nextIndex: number } {
  if (isAdmin(req)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }
  if (isManager(req) && req.userId) {
    const managerParam = `$${paramIndex}`;
    const clause = `(
      ${alias}.bidder_id IN (SELECT id FROM bidders WHERE manager_id = ${managerParam})
      OR ${alias}.id IN (
        SELECT DISTINCT cj.job_id FROM candidate_jobs cj
        JOIN candidates c ON c.id = cj.candidate_id
        WHERE c.bidder_id IN (SELECT id FROM bidders WHERE manager_id = ${managerParam})
      )
    )`;
    return { clause, params: [req.userId], nextIndex: paramIndex + 1 };
  }
  if (isBidder(req) && req.bidderId) {
    const bidderParam = `$${paramIndex}`;
    const clause = `(
      ${alias}.bidder_id = ${bidderParam}
      OR ${alias}.id IN (
        SELECT DISTINCT cj.job_id FROM candidate_jobs cj
        JOIN candidates c ON c.id = cj.candidate_id
        WHERE c.bidder_id = ${bidderParam}
      )
      OR EXISTS (
        SELECT 1 FROM bidder_job_sites bjs
        JOIN job_sites js ON js.id = bjs.job_site_id AND js.is_active = TRUE
        WHERE bjs.bidder_id = ${bidderParam} AND bjs.is_active = TRUE
        AND (
          LOWER(COALESCE(${alias}.source, '')) = LOWER(js.platform_key)
          OR (
            js.url_host IS NOT NULL AND js.url_host <> ''
            AND ${alias}.url ILIKE '%' || js.url_host || '%'
          )
        )
      )
    )`;
    return { clause, params: [req.bidderId], nextIndex: paramIndex + 1 };
  }
  return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}

export async function jobAccessible(req: AuthRequest, jobId: number): Promise<boolean> {
  const scope = jobBidderFilter(req, 'j', 2);
  let query = 'SELECT j.id FROM jobs j WHERE j.id = $1';
  const params: unknown[] = [jobId];
  if (scope.clause) {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  const row = await queryOne<{ id: number }>(query, params);
  return Boolean(row);
}

export function interviewCallerFilter(
  req: AuthRequest,
  alias = 'ip',
  paramIndex = 1
): { clause: string; params: unknown[]; nextIndex: number } {
  if (isAdmin(req)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }
  if (isCaller(req) && req.userId) {
    return {
      clause: `${alias}.caller_user_id = $${paramIndex}`,
      params: [req.userId],
      nextIndex: paramIndex + 1,
    };
  }
  if (isManager(req) && req.userId) {
    return {
      clause: `${alias}.bidder_id IN (SELECT id FROM bidders WHERE manager_id = $${paramIndex})`,
      params: [req.userId],
      nextIndex: paramIndex + 1,
    };
  }
  if (isBidder(req) && req.bidderId) {
    return {
      clause: `${alias}.bidder_id = $${paramIndex}`,
      params: [req.bidderId],
      nextIndex: paramIndex + 1,
    };
  }
  return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}

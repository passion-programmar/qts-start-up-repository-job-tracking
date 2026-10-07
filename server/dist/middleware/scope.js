"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdmin = isAdmin;
exports.isAccount = isAccount;
exports.isCaller = isCaller;
exports.isManager = isManager;
exports.candidateAccountFilter = candidateAccountFilter;
exports.jobAccountFilter = jobAccountFilter;
exports.jobAccessible = jobAccessible;
exports.interviewCallerFilter = interviewCallerFilter;
const connection_1 = require("../database/connection");
function isAdmin(req) {
    return req.role === 'admin' || req.role === 'super';
}
function isAccount(req) {
    return req.role === 'account' || (req.role === 'manager' && req.extensionAccountScope === true && Boolean(req.accountId));
}
function isCaller(req) {
    return req.role === 'caller';
}
function isManager(req) {
    return req.role === 'manager' && req.extensionAccountScope !== true;
}
function candidateAccountFilter(req, alias = 'c', paramIndex = 1) {
    if (isAdmin(req)) {
        return { clause: '', params: [], nextIndex: paramIndex };
    }
    if (isManager(req) && req.userId && req.accountId) {
        return {
            clause: `${alias}.account_id = $${paramIndex}`,
            params: [req.accountId],
            nextIndex: paramIndex + 1,
        };
    }
    if (isManager(req) && req.userId) {
        return {
            clause: `${alias}.account_id IN (SELECT id FROM accounts WHERE manager_id = $${paramIndex})`,
            params: [req.userId],
            nextIndex: paramIndex + 1,
        };
    }
    if (isAccount(req) && req.accountId) {
        return {
            clause: `${alias}.account_id = $${paramIndex}`,
            params: [req.accountId],
            nextIndex: paramIndex + 1,
        };
    }
    return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}
function jobAccountFilter(req, alias = 'j', paramIndex = 1) {
    if (isAdmin(req)) {
        return { clause: '', params: [], nextIndex: paramIndex };
    }
    if (isManager(req) && req.userId && req.accountId) {
        return {
            clause: `${alias}.account_id = $${paramIndex}`,
            params: [req.accountId],
            nextIndex: paramIndex + 1,
        };
    }
    if (isManager(req) && req.userId) {
        const managerParam = `$${paramIndex}`;
        const clause = `(
      ${alias}.account_id IN (SELECT id FROM accounts WHERE manager_id = ${managerParam})
      OR ${alias}.id IN (
        SELECT DISTINCT cj.job_id FROM candidate_jobs cj
        JOIN candidates c ON c.id = cj.candidate_id
        WHERE c.account_id IN (SELECT id FROM accounts WHERE manager_id = ${managerParam})
      )
    )`;
        return { clause, params: [req.userId], nextIndex: paramIndex + 1 };
    }
    if (isAccount(req) && req.accountId) {
        const accountParam = `$${paramIndex}`;
        const clause = `(
      ${alias}.account_id = ${accountParam}
      OR ${alias}.id IN (
        SELECT DISTINCT cj.job_id FROM candidate_jobs cj
        JOIN candidates c ON c.id = cj.candidate_id
        WHERE c.account_id = ${accountParam}
      )
      OR EXISTS (
        SELECT 1 FROM account_job_sites bjs
        JOIN job_sites js ON js.id = bjs.job_site_id AND js.is_active = TRUE
        WHERE bjs.account_id = ${accountParam} AND bjs.is_active = TRUE
        AND (
          LOWER(COALESCE(${alias}.source, '')) = LOWER(js.platform_key)
          OR (
            js.url_host IS NOT NULL AND js.url_host <> ''
            AND ${alias}.url ILIKE '%' || js.url_host || '%'
          )
        )
      )
    )`;
        return { clause, params: [req.accountId], nextIndex: paramIndex + 1 };
    }
    return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}
async function jobAccessible(req, jobId) {
    const scope = jobAccountFilter(req, 'j', 2);
    let query = 'SELECT j.id FROM jobs j WHERE j.id = $1';
    const params = [jobId];
    if (scope.clause) {
        query += ` AND ${scope.clause}`;
        params.push(...scope.params);
    }
    const row = await (0, connection_1.queryOne)(query, params);
    return Boolean(row);
}
function interviewCallerFilter(req, alias = 'ip', paramIndex = 1) {
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
    if (isManager(req) && req.userId && req.accountId) {
        return {
            clause: `${alias}.account_id = $${paramIndex}`,
            params: [req.accountId],
            nextIndex: paramIndex + 1,
        };
    }
    if (isManager(req) && req.userId) {
        return {
            clause: `${alias}.account_id IN (SELECT id FROM accounts WHERE manager_id = $${paramIndex})`,
            params: [req.userId],
            nextIndex: paramIndex + 1,
        };
    }
    if (isAccount(req) && req.accountId) {
        return {
            clause: `${alias}.account_id = $${paramIndex}`,
            params: [req.accountId],
            nextIndex: paramIndex + 1,
        };
    }
    return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}
//# sourceMappingURL=scope.js.map
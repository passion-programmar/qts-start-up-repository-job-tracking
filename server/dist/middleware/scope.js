"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdmin = isAdmin;
exports.isBidder = isBidder;
exports.isCaller = isCaller;
exports.isManager = isManager;
exports.candidateBidderFilter = candidateBidderFilter;
exports.jobBidderFilter = jobBidderFilter;
exports.jobAccessible = jobAccessible;
exports.interviewCallerFilter = interviewCallerFilter;
const connection_1 = require("../database/connection");
function isAdmin(req) {
    return req.role === 'admin';
}
function isBidder(req) {
    return req.role === 'bidder';
}
function isCaller(req) {
    return req.role === 'caller';
}
function isManager(req) {
    return req.role === 'manager';
}
function candidateBidderFilter(req, alias = 'c', paramIndex = 1) {
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
function jobBidderFilter(req, alias = 'j', paramIndex = 1) {
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
    )`;
        return { clause, params: [req.bidderId], nextIndex: paramIndex + 1 };
    }
    return { clause: 'FALSE', params: [], nextIndex: paramIndex };
}
async function jobAccessible(req, jobId) {
    const scope = jobBidderFilter(req, 'j', 2);
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
//# sourceMappingURL=scope.js.map
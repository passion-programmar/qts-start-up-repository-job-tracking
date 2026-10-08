"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
const PeriodSchema = zod_1.z.enum(['day', 'week', 'month', 'year']);
const PERIODS = {
    day: { interval: '30 days', buckets: 'day' },
    week: { interval: '12 weeks', buckets: 'week' },
    month: { interval: '12 months', buckets: 'month' },
    year: { interval: '5 years', buckets: 'year' },
};
function managerScope(user) {
    if (user.role === 'super')
        return { clause: '', params: [] };
    if (user.role === 'admin') {
        return { clause: 'manager.parent_user_id = $1', params: [user.id] };
    }
    if (user.role === 'manager') {
        return { clause: 'manager.u_id = $1', params: [user.id] };
    }
    return null;
}
router.get('/', async (req, res) => {
    const user = req.newSchemaUser;
    const scope = managerScope(user);
    if (!scope) {
        res.status(403).json({ success: false, message: 'Analytics are not available for this role.' });
        return;
    }
    const parsedPeriod = PeriodSchema.safeParse(req.query.period ?? 'month');
    if (!parsedPeriod.success) {
        res.status(400).json({ success: false, message: 'Period must be day, week, month, or year.' });
        return;
    }
    const period = PERIODS[parsedPeriod.data];
    const where = scope.clause ? `AND ${scope.clause}` : '';
    const params = scope.params;
    const [bidsByPeriod, interviewsByPeriod, bidsByStatus, interviewsByOutcome, byManager, byAccount] = await Promise.all([
        (0, connection_1.queryAll)(`SELECT date_trunc('${period.buckets}', b.applied_date) AS bucket, count(*)::int AS count
         FROM bids b
         JOIN job_list j ON j.j_id = b.j_id
         JOIN users manager ON manager.u_id = j.u_id AND manager.role = 'manager'
         WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}' ${where}
         GROUP BY bucket ORDER BY bucket ASC`, params),
        (0, connection_1.queryAll)(`SELECT date_trunc('${period.buckets}', i.interview_date::timestamp) AS bucket,
                count(*)::int AS count
         FROM interviews i
         JOIN bids b ON b.b_id = i.b_id
         JOIN job_list j ON j.j_id = b.j_id
         JOIN users manager ON manager.u_id = j.u_id AND manager.role = 'manager'
         WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}' ${where}
         GROUP BY bucket ORDER BY bucket ASC`, params),
        (0, connection_1.queryAll)(`SELECT j.status, count(*)::int AS count
         FROM bids b
         JOIN job_list j ON j.j_id = b.j_id
         JOIN users manager ON manager.u_id = j.u_id AND manager.role = 'manager'
         WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}' ${where}
         GROUP BY j.status ORDER BY j.status`, params),
        (0, connection_1.queryAll)(`SELECT COALESCE(i.outcome, 'pending') AS outcome, count(*)::int AS count
         FROM interviews i
         JOIN bids b ON b.b_id = i.b_id
         JOIN job_list j ON j.j_id = b.j_id
         JOIN users manager ON manager.u_id = j.u_id AND manager.role = 'manager'
         WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}' ${where}
         GROUP BY COALESCE(i.outcome, 'pending') ORDER BY outcome`, params),
        (0, connection_1.queryAll)(`WITH scoped_managers AS (
           SELECT manager.u_id AS manager_id, manager.name AS manager_name
           FROM users manager
           WHERE manager.role = 'manager' ${scope.clause ? `AND ${scope.clause}` : ''}
         ), bid_counts AS (
           SELECT j.u_id AS manager_id, count(*)::int AS bids
           FROM bids b JOIN job_list j ON j.j_id = b.j_id
           WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}'
           GROUP BY j.u_id
         ), interview_counts AS (
           SELECT j.u_id AS manager_id, count(*)::int AS interviews
           FROM interviews i
           JOIN bids b ON b.b_id = i.b_id
           JOIN job_list j ON j.j_id = b.j_id
           WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}'
           GROUP BY j.u_id
         )
         SELECT m.manager_id, m.manager_name, COALESCE(b.bids, 0)::int AS bids,
                COALESCE(i.interviews, 0)::int AS interviews
         FROM scoped_managers m
         LEFT JOIN bid_counts b ON b.manager_id = m.manager_id
         LEFT JOIN interview_counts i ON i.manager_id = m.manager_id
         ORDER BY bids DESC, interviews DESC, m.manager_name ASC
         LIMIT 20`, params),
        (0, connection_1.queryAll)(`WITH bid_counts AS (
           SELECT b.u_id AS account_user_id, count(*)::int AS bids
           FROM bids b
           JOIN job_list j ON j.j_id = b.j_id
           JOIN users manager ON manager.u_id = j.u_id AND manager.role = 'manager'
           WHERE b.applied_date >= NOW() - INTERVAL '${period.interval}' ${where}
           GROUP BY b.u_id
         ), interview_counts AS (
           SELECT b.u_id AS account_user_id, count(*)::int AS interviews
           FROM interviews i
           JOIN bids b ON b.b_id = i.b_id
           JOIN job_list j ON j.j_id = b.j_id
           JOIN users manager ON manager.u_id = j.u_id AND manager.role = 'manager'
           WHERE i.interview_date >= CURRENT_DATE - INTERVAL '${period.interval}' ${where}
           GROUP BY b.u_id
         )
         SELECT account.u_id AS account_user_id, account.name AS account_name,
                COALESCE(b.bids, 0)::int AS bids, COALESCE(i.interviews, 0)::int AS interviews
         FROM users account
         LEFT JOIN bid_counts b ON b.account_user_id = account.u_id
         LEFT JOIN interview_counts i ON i.account_user_id = account.u_id
         WHERE account.role = 'account' AND (b.account_user_id IS NOT NULL OR i.account_user_id IS NOT NULL)
         ORDER BY bids DESC, interviews DESC, account.name ASC
         LIMIT 20`, params),
    ]);
    const asCount = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'count' || key === 'bids' || key === 'interviews'
            ? Number(value)
            : value])));
    res.json({
        success: true,
        analytics: {
            period: parsedPeriod.data,
            bidsByPeriod: bidsByPeriod.map((row) => ({ bucket: row.bucket, count: Number(row.count) })),
            interviewsByPeriod: interviewsByPeriod.map((row) => ({ bucket: row.bucket, count: Number(row.count) })),
            bidsByStatus: asCount(bidsByStatus),
            interviewsByOutcome: asCount(interviewsByOutcome),
            byManager: asCount(byManager),
            byAccount: asCount(byAccount),
        },
    });
});
exports.default = router;
//# sourceMappingURL=analytics.routes.js.map
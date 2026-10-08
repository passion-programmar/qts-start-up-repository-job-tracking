"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireNewSchemaAuth = requireNewSchemaAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = require("../database/connection");
const env_1 = require("../config/env");
async function requireNewSchemaAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'Authentication required.' });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(header.slice(7), env_1.config.jwtSecret);
        if (payload.schema !== 'new') {
            res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
            return;
        }
        const user = await (0, connection_1.queryOne)(`WITH RECURSIVE user_tree AS (
         SELECT u_id, parent_user_id, blocked_date
         FROM users
         WHERE u_id = $1
         UNION
         SELECT parent.u_id, parent.parent_user_id, parent.blocked_date
         FROM users parent
         JOIN user_tree child ON child.parent_user_id = parent.u_id
       )
       SELECT u.u_id, u.username, u.name, u.role, u.parent_user_id,
              EXISTS (SELECT 1 FROM user_tree WHERE blocked_date IS NOT NULL) AS blocked
       FROM users u
       WHERE u.u_id = $1`, [payload.id]);
        if (!user || user.blocked) {
            res.status(401).json({ success: false, message: 'This account is unavailable. Contact your administrator.' });
            return;
        }
        req.userId = user.u_id;
        req.username = user.username;
        req.role = user.role;
        req.newSchemaUser = {
            id: user.u_id,
            username: user.username,
            name: user.name,
            role: user.role,
            parentUserId: user.parent_user_id,
        };
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError || error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
            return;
        }
        next(error);
    }
}
//# sourceMappingURL=new-schema-auth.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRole = normalizeRole;
function normalizeRole(role) {
    if (role === 'super')
        return 'super';
    if (role === 'admin')
        return 'admin';
    if (role === 'manager')
        return 'manager';
    if (role === 'caller')
        return 'caller';
    return 'account';
}
//# sourceMappingURL=roles.js.map
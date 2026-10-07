"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const logger_1 = require("../utilities/logger");
function errorHandler(err, req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({
            success: false,
            message: 'Validation error.',
            errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
    }
    logger_1.logger.error('Unhandled error', err);
    res.status(500).json({ success: false, message: 'An internal server error occurred.' });
}
//# sourceMappingURL=error-handler.js.map
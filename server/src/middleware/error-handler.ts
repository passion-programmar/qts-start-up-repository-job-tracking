import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utilities/logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  logger.error('Unhandled error', err);
  res.status(500).json({ success: false, message: 'An internal server error occurred.' });
}

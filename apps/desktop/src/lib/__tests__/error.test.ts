import { AppError, ErrorCode, isAppError, formatError } from '@/lib/error';

describe('Error Handling', () => {
  describe('AppError', () => {
    it('should create error with code and message', () => {
      const error = new AppError('Test error', ErrorCode.INVALID_INPUT);
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.INVALID_INPUT);
      expect(error.statusCode).toBe(400);
    });

    it('should include details when provided', () => {
      const error = new AppError('Validation failed', ErrorCode.VALIDATION_ERROR, {
        field: 'email',
        reason: 'Invalid format'
      });
      
      expect(error.details).toEqual({
        field: 'email',
        reason: 'Invalid format'
      });
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      const error = new AppError('Test', ErrorCode.INTERNAL_ERROR);
      expect(isAppError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('Regular error');
      expect(isAppError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError('string')).toBe(false);
      expect(isAppError({})).toBe(false);
    });
  });

  describe('formatError', () => {
    it('should format AppError correctly', () => {
      const error = new AppError('Not found', ErrorCode.NOT_FOUND, { resource: 'lesson' });
      const formatted = formatError(error);
      
      expect(formatted).toEqual({
        error: 'Not found',
        code: ErrorCode.NOT_FOUND,
        statusCode: 404,
        details: { resource: 'lesson' }
      });
    });

    it('should format regular Error', () => {
      const error = new Error('Something went wrong');
      const formatted = formatError(error);
      
      expect(formatted).toEqual({
        error: 'Something went wrong',
        code: ErrorCode.INTERNAL_ERROR,
        statusCode: 500
      });
    });

    it('should handle unknown error types', () => {
      const formatted = formatError('random string');
      
      expect(formatted).toEqual({
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
        statusCode: 500
      });
    });
  });

  describe('ErrorCode', () => {
    it('should have all required error codes', () => {
      const requiredCodes = [
        'INVALID_INPUT',
        'VALIDATION_ERROR',
        'NOT_FOUND',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'RATE_LIMITED',
        'EXTERNAL_API_ERROR',
        'INTERNAL_ERROR'
      ];
      
      requiredCodes.forEach(code => {
        expect(ErrorCode[code]).toBeDefined();
      });
    });
  });
});
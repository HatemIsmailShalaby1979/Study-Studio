export enum ErrorCode {
  INVALID_INPUT = 'INVALID_INPUT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export interface AppErrorDetails {
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: AppErrorDetails;
  public readonly timestamp: string;

  constructor(message: string, code: ErrorCode, details?: AppErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    switch (code) {
      case ErrorCode.INVALID_INPUT:
      case ErrorCode.VALIDATION_ERROR:
        this.statusCode = 400;
        break;
      case ErrorCode.UNAUTHORIZED:
        this.statusCode = 401;
        break;
      case ErrorCode.FORBIDDEN:
        this.statusCode = 403;
        break;
      case ErrorCode.NOT_FOUND:
        this.statusCode = 404;
        break;
      case ErrorCode.RATE_LIMITED:
        this.statusCode = 429;
        break;
      case ErrorCode.EXTERNAL_API_ERROR:
        this.statusCode = 502;
        break;
      case ErrorCode.INTERNAL_ERROR:
      default:
        this.statusCode = 500;
        break;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function formatError(error: unknown): {
  error: string;
  code: ErrorCode;
  statusCode: number;
  details?: AppErrorDetails;
} {
  if (isAppError(error)) {
    return {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details
    };
  }
  
  if (error instanceof Error) {
    return {
      error: error.message,
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: 500
    };
  }
  
  return {
    error: 'An unexpected error occurred',
    code: ErrorCode.INTERNAL_ERROR,
    statusCode: 500
  };
}

export function createErrorResponse(error: unknown): Response {
  const formatted = formatError(error);
  return new Response(JSON.stringify(formatted), {
    status: formatted.statusCode,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR,
  errorMessage?: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    
    const message = errorMessage || (error instanceof Error ? error.message : 'Unknown error');
    throw new AppError(message, errorCode);
  }
}

export function validateRequired<T extends Record<string, unknown>>(
  data: T,
  requiredFields: (keyof T)[]
): void {
  const missing = requiredFields.filter(field => 
    data[field] === undefined || data[field] === null || data[field] === ''
  );
  
  if (missing.length > 0) {
    throw new AppError(
      `Missing required fields: ${missing.join(', ')}`,
      ErrorCode.VALIDATION_ERROR,
      { missingFields: missing }
    );
  }
}

export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', ErrorCode.VALIDATION_ERROR, { field: 'email' });
  }
}

export function validateStringLength(
  value: string,
  fieldName: string,
  minLength: number = 1,
  maxLength: number = 1000
): void {
  if (value.length < minLength) {
    throw new AppError(
      `${fieldName} must be at least ${minLength} characters`,
      ErrorCode.VALIDATION_ERROR,
      { field: fieldName, minLength }
    );
  }
  
  if (value.length > maxLength) {
    throw new AppError(
      `${fieldName} must not exceed ${maxLength} characters`,
      ErrorCode.VALIDATION_ERROR,
      { field: fieldName, maxLength }
    );
  }
}
// Domain errors thrown from src/lib/services/* — caught at the transport
// boundary (server actions map to FormState; /api/v1/* routes map to JSON
// status codes). Carrying a stable `code` lets each transport translate to
// its own error vocabulary without string matching the message.

export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'CATEGORY_INVALID'
  | 'LIMIT_REACHED'
  | 'CONFLICT'
  | 'BAD_INPUT';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: DomainErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.name = 'DomainError';
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export function statusForCode(code: DomainErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'CATEGORY_INVALID':
    case 'BAD_INPUT':
      return 400;
    case 'LIMIT_REACHED':
    case 'CONFLICT':
      return 409;
  }
}

import type { ErrorCode } from "@app/shared";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Throw a typed, user-presentable error. */
export function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}

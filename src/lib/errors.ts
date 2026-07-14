/**
 * Application error carrying a stable machine code and HTTP status. The global
 * error handler renders it as `{ error: { code, message } }`.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  notFound: (what = "Resource") => new AppError("NOT_FOUND", 404, `${what} not found`),
  unauthorized: (msg = "Authentication required") =>
    new AppError("UNAUTHORIZED", 401, msg),
  forbidden: (msg = "Forbidden") => new AppError("FORBIDDEN", 403, msg),
  conflict: (code: string, msg: string) => new AppError(code, 409, msg),
  unprocessable: (code: string, msg: string) => new AppError(code, 422, msg),
  badRequest: (msg: string) => new AppError("BAD_REQUEST", 400, msg),
};

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) {
    super(message);
  }
}

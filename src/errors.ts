/** wow-origin 私有接口和上游调用使用的 HTTP 错误。 */
export class APIError extends Error {
  public readonly status: number;

  constructor(message: string, status: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class BadRequestError extends APIError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class NotFoundError extends APIError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class UnplayableError extends APIError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class UpstreamError extends APIError {
  constructor(message: string) {
    super(message, 502);
  }
}

export class UnsupportedPlatformError extends APIError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class UnsupportedFeatureError extends APIError {
  constructor(message: string) {
    super(message, 400);
  }
}

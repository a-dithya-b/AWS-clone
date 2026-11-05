import type { ApiErrorBody, EvaluationSummary } from "@cloudlearn/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error that becomes an AWS-style JSON response: { code, message }. */
export class AwsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: ContentfulStatusCode = 400,
    public readonly evaluation?: EvaluationSummary,
  ) {
    super(message);
    this.name = "AwsError";
  }

  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.evaluation ? { evaluation: this.evaluation } : {}),
    };
  }
}

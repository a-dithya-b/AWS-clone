import type {
  ApiErrorBody,
  EvaluationSummary,
  SessionInfo,
  SessionResponse,
  SignInInput,
  SignUpInput,
} from "@cloudlearn/shared";

/** An error from the CloudLearn API, with the AWS error code (e.g. "AccessDenied"). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly evaluation?: EvaluationSummary;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.evaluation = body.evaluation;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, {
      code: "InvalidResponse",
      message: `The server returned an unexpected response (HTTP ${res.status}). Is the CloudLearn server running?`,
    });
  }
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  return data as T;
}

export const api = {
  session: () => request<SessionResponse>("/api/auth/session"),
  signUp: (input: SignUpInput) => request<{ session: SessionInfo }>("/api/auth/signup", input),
  signIn: (input: SignInInput) => request<{ session: SessionInfo }>("/api/auth/signin", input),
  signOut: () => request<SessionResponse>("/api/auth/signout", {}),
  /** Calls a simulated AWS API action, e.g. action("sqs", "SendMessage", {...}). */
  action: <T>(service: string, action: string, input: object = {}) =>
    request<T>(`/api/services/${service}/${action}`, input),
};

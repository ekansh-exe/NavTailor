// One error type for every LLM failure, whatever the provider said.
// `kind` is the only thing the router looks at. The message is just the kind, so no response body,
// URL, header or key can ever end up in a log line or a stack trace.
//
// kinds: timeout | rate_limit | server | auth | bad_request | network | empty
//        | invalid_json | schema | unexpected | all_failed | no_provider | unknown_task
export class LLMError extends Error {
  constructor(kind, { route, status, causes } = {}) {
    super(kind);
    this.name = 'LLMError';
    this.kind = kind;
    this.route = route;
    this.status = status;
    this.causes = causes;
  }
}

// Shared by the provider adapters: turn an HTTP status into our kind.
export function httpError(status) {
  let kind = 'bad_request';
  if (status === 429) kind = 'rate_limit';
  else if (status >= 500) kind = 'server';
  else if (status === 401 || status === 403) kind = 'auth';
  return new LLMError(kind, { status });
}

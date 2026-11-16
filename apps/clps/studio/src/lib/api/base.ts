export class ApiError extends Error {
  readonly status: number;
  /** Optional machine code some routes add next to `error` (e.g. `search_limit`). */
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

export type QueryValue = string | number | boolean;
export type Query = Record<string, QueryValue | undefined>;

function url(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return `${API_BASE}${path}${text ? `?${text}` : ''}`;
}

async function failure(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status}).`;
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const record = body as { error?: unknown; code?: unknown };
      if (typeof record.error === 'string') message = record.error;
      if (typeof record.code === 'string') code = record.code;
    }
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError(message, response.status, code);
}

async function send(path: string, init: RequestInit, query?: Query): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url(path, query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('Cannot reach the calculation server. Check that it is running.', 0);
  }
  if (!response.ok) throw await failure(response);
  return response;
}

export async function getJson<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const response = await send(path, { signal }, query);
  return (await response.json()) as T;
}

export async function getFloat32(path: string, query?: Query, signal?: AbortSignal): Promise<Float32Array> {
  const response = await send(path, { signal }, query);
  return new Float32Array(await response.arrayBuffer());
}

/** POST JSON and receive a file (for example a PDF). */
export async function postForBlob(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const response = await send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return response.blob();
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return (await response.json()) as T;
}

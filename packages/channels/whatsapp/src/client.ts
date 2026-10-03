import { buildMessagePayload, type OutboundContent } from './content'

/**
 * A Graph API error. `retryable` says whether sending the same request later
 * could succeed (Meta hiccup, throttling) or never will (policy, bad input,
 * expired token), which decides between BullMQ retry and marking it failed.
 */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
    readonly details?: string,
    readonly fbtraceId?: string,
  ) {
    super(message)
    this.name = 'GraphError'
  }

  // 4 / 80007 / 130429 / 131056: app, account, throughput and pair rate limits.
  static readonly THROTTLE_CODES = new Set([4, 80007, 130429, 131056])
  // 190: access token expired or revoked. Retrying won't help; a person must reconnect.
  static readonly AUTH_CODES = new Set([190])

  get retryable() {
    return (
      this.status >= 500 ||
      this.status === 429 ||
      (this.code !== undefined && GraphError.THROTTLE_CODES.has(this.code))
    )
  }

  get isAuthError() {
    return this.status === 401 || (this.code !== undefined && GraphError.AUTH_CODES.has(this.code))
  }
}

export interface GraphClientOptions {
  baseUrl: string
  version: string
  accessToken: string
  phoneNumberId: string
  fetch?: typeof fetch
  /** Per-request timeout. Meta usually answers in well under a second. */
  timeoutMs?: number
}

export interface MediaInfo {
  url: string
  mimeType: string
  fileSize?: number
  sha256?: string
}

export class GraphClient {
  constructor(private readonly options: GraphClientOptions) {}

  // Looked up per call, not stored: test mocks and instrumentation patch the
  // global after this client may already exist.
  private get fetch(): typeof fetch {
    return this.options.fetch ?? globalThis.fetch
  }

  private url(path: string) {
    return `${this.options.baseUrl.replace(/\/$/, '')}/${this.options.version}/${path}`
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response
    try {
      res = await this.fetch(this.url(path), {
        ...init,
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          'content-type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      })
    } catch (err) {
      // Network failure or timeout: worth retrying.
      throw new GraphError(503, undefined, `Graph API unreachable: ${(err as Error).message}`)
    }
    const body = (await res.json().catch(() => null)) as
      | (T & { error?: undefined })
      | {
          error?: {
            code?: number
            message?: string
            error_data?: { details?: string }
            fbtrace_id?: string
          }
        }
      | null
    if (!res.ok || body?.error) {
      const e = body?.error
      throw new GraphError(
        res.status,
        e?.code,
        e?.message ?? `Graph API ${res.status}`,
        e?.error_data?.details,
        e?.fbtrace_id,
      )
    }
    return body as T
  }

  /** Sends a message and returns Meta's id for it (`wamid.…`). */
  async send(to: string, content: OutboundContent, replyTo?: string): Promise<string> {
    const payload = buildMessagePayload(to, content, replyTo)
    const res = await this.request<{ messages?: { id: string }[] }>(
      `${this.options.phoneNumberId}/messages`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
    const id = res.messages?.[0]?.id
    if (!id)
      throw new GraphError(502, undefined, 'Graph API accepted the message but returned no id')
    return id
  }

  /**
   * Marks an inbound message read (blue ticks). With `typing`, also shows
   * "typing…" to the contact for up to 25 seconds or until we reply.
   */
  async markRead(waMessageId: string, options: { typing?: boolean } = {}): Promise<void> {
    await this.request(`${this.options.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
        ...(options.typing ? { typing_indicator: { type: 'text' } } : {}),
      }),
    })
  }

  /** The number's public details, reading only: proves the token works without messaging anyone. */
  async getPhoneNumber(): Promise<{
    displayPhone?: string
    verifiedName?: string
    qualityRating?: string
  }> {
    const res = await this.request<{
      display_phone_number?: string
      verified_name?: string
      quality_rating?: string
    }>(`${this.options.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`)
    return {
      displayPhone: res.display_phone_number,
      verifiedName: res.verified_name,
      qualityRating: res.quality_rating,
    }
  }

  /** Looks up a media id from a webhook. The returned URL is short-lived (about 5 minutes). */
  async getMedia(mediaId: string): Promise<MediaInfo> {
    const res = await this.request<{
      url: string
      mime_type: string
      file_size?: number | string
      sha256?: string
    }>(mediaId)
    return {
      url: res.url,
      mimeType: res.mime_type,
      fileSize: res.file_size === undefined ? undefined : Number(res.file_size),
      sha256: res.sha256,
    }
  }

  /** Downloads media bytes. The URL only works with the same access token. */
  async downloadMedia(url: string): Promise<Response> {
    let res: Response
    try {
      res = await this.fetch(url, {
        headers: { authorization: `Bearer ${this.options.accessToken}` },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (err) {
      throw new GraphError(503, undefined, `Media download failed: ${(err as Error).message}`)
    }
    if (!res.ok || !res.body)
      throw new GraphError(res.status, undefined, `Media download ${res.status}`)
    return res
  }
}

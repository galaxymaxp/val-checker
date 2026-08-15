import "server-only";

import { request as httpsRequest } from "node:https";

/**
 * A `fetch` shaped around `node:https` so the TLS cipher order can be set.
 *
 * Riot's auth host sits behind Cloudflare, which fingerprints the TLS
 * ClientHello. Node's default cipher order is recognisably not a browser, and
 * requests from datacenter ranges are challenged with a 403 before Riot ever
 * sees them. Presenting a browser-like cipher order avoids that in practice.
 *
 * This is best-effort and explicitly fragile: Cloudflare can change what it
 * accepts at any time, which is precisely why the roadmap keeps the admin-only
 * cookie-paste path as a fallback (Version 2.4). `RIOT_TLS_CIPHERS` allows the
 * order to be retuned by configuration rather than a code change.
 *
 * Only the subset of `fetch` this codebase uses is implemented: string URL,
 * method, plain-object headers, string body, and an AbortSignal.
 */

const DEFAULT_CIPHER_ORDER = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...headers };
}

function toResponse(
  status: number,
  rawHeaders: NodeJS.Dict<string | string[]>,
  body: Buffer,
): Response {
  const headers = new Headers();

  for (const [name, value] of Object.entries(rawHeaders)) {
    if (value === undefined) {
      continue;
    }

    // Multiple Set-Cookie values must stay separate for getSetCookie().
    for (const entry of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, entry);
      } catch {
        // Skip header names Node accepted but the Headers guard rejects.
      }
    }
  }

  // 1xx/204/205/304 must not carry a body per the Response constructor.
  const bodyless = status === 204 || status === 205 || status === 304 || status < 200;
  return new Response(bodyless ? null : new Uint8Array(body), {
    headers,
    status,
  });
}

export function createTlsTunedFetch(
  ciphers: string = process.env.RIOT_TLS_CIPHERS?.trim() || DEFAULT_CIPHER_ORDER,
): typeof fetch {
  return function tlsTunedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : String(input));

    if (url.protocol !== "https:") {
      throw new TypeError("The Riot auth transport requires https.");
    }

    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;

      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }

      const body =
        typeof init.body === "string" ? Buffer.from(init.body, "utf8") : undefined;
      const headers = headerRecord(init.headers);

      if (body) {
        headers["Content-Length"] = String(body.byteLength);
      }

      const clientRequest = httpsRequest(
        {
          ciphers,
          headers,
          host: url.hostname,
          method: init.method ?? "GET",
          minVersion: "TLSv1.2",
          path: `${url.pathname}${url.search}`,
          port: url.port ? Number(url.port) : 443,
          // Cloudflare reads the order as sent; do not let Node reprioritise.
          honorCipherOrder: false,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () => {
            resolve(
              toResponse(
                incoming.statusCode ?? 502,
                incoming.headers,
                Buffer.concat(chunks),
              ),
            );
          });
          incoming.on("error", reject);
        },
      );

      const abort = () => {
        clientRequest.destroy();
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });

      clientRequest.on("error", reject);
      clientRequest.on("close", () =>
        signal?.removeEventListener("abort", abort),
      );

      if (body) {
        clientRequest.write(body);
      }

      clientRequest.end();
    });
  } as typeof fetch;
}

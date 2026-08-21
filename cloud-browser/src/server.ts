import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import { WebSocketServer, WebSocket } from "ws";

import {
  cloudBrowserSessionSchema,
  type CloudBrowserSessionInput,
} from "./session-schema.js";
import {
  MAX_SESSION_TTL_MS,
  VIEWER_DISCONNECT_GRACE_MS,
  VIEWER_HEARTBEAT_INTERVAL_MS,
} from "./session-limits.js";
import {
  normalizeContainedPoint,
  shouldForwardViewerKey,
  viewerPrintableText,
} from "./viewer-geometry.js";

const REAUTH_URL =
  "https://auth.riotgames.com/authorize" +
  "?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod" +
  "&response_type=token%20id_token&nonce=1&scope=account%20openid";
const SUCCESS_PREFIX = "https://playvalorant.com/opt_in";
const MAX_BODY_BYTES = 16 * 1024;
const PORT = Number(process.env.PORT ?? 8080);
const API_KEY = process.env.CLOUD_BROWSER_API_KEY ?? "";
const PUBLIC_URL = process.env.CLOUD_BROWSER_PUBLIC_URL ?? "";

type SessionState =
  | "starting"
  | "waiting_for_user"
  | "authenticating"
  | "captured"
  | "failed"
  | "expired";

type Session = {
  browser: Browser;
  captchaObserved: boolean;
  cdp: CDPSession;
  context: BrowserContext;
  cookies?: unknown[];
  disconnectTimer?: ReturnType<typeof setTimeout>;
  expiresAt: number;
  id: string;
  mfaRequested: boolean;
  page: Page;
  state: SessionState;
  viewerToken: string;
  viewerTokenHash: Buffer;
  viewers: number;
  viewport: { height: number; width: number };
};

type SessionCreationPhase =
  | "browser_launch"
  | "browser_context"
  | "riot_navigation";

class SessionCreationError extends Error {
  constructor(readonly phase: SessionCreationPhase) {
    super("Cloud browser session creation failed");
    this.name = "SessionCreationError";
  }
}

const sessions = new Map<string, Session>();
function hash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equalToken(value: string, expected: Buffer): boolean {
  const actual = hash(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function controlAuthorized(request: IncomingMessage): boolean {
  const value = request.headers.authorization;
  return (
    Boolean(API_KEY) &&
    typeof value === "string" &&
    value.startsWith("Bearer ") &&
    equalToken(value.slice(7), hash(API_KEY))
  );
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    length += value.length;
    if (length > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicOrigin(request: IncomingMessage): string {
  if (PUBLIC_URL) return new URL(PUBLIC_URL).origin;
  const host = request.headers.host;
  if (!host) throw new Error("host unavailable");
  const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

function status(session: Session) {
  return {
    captchaObserved: session.captchaObserved,
    mfaRequested: session.mfaRequested,
    state: session.state,
  };
}

function completedLogin(url: string): boolean {
  try {
    return url.startsWith(SUCCESS_PREFIX) && new URL(url).hash.includes("access_token=");
  } catch {
    return false;
  }
}

async function observe(session: Session): Promise<void> {
  if (["captured", "failed", "expired"].includes(session.state)) return;
  try {
    if (completedLogin(session.page.url())) {
      session.cookies = await session.context.cookies();
      session.state = session.cookies.length > 0 ? "captured" : "failed";
      return;
    }
    session.mfaRequested ||=
      (await session.page
        .locator('input[autocomplete="one-time-code"], input[inputmode="numeric"]')
        .count()) > 0;
    session.captchaObserved ||=
      (await session.page
        .locator('iframe[src*="captcha" i], iframe[title*="captcha" i], [class*="captcha" i]')
        .count()) > 0;
  } catch {
    if (!session.page.isClosed()) session.state = "failed";
  }
}

async function createBrowserSession(
  input: CloudBrowserSessionInput,
): Promise<Session> {
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt - Date.now() > MAX_SESSION_TTL_MS
  ) {
    throw new Error("invalid expiry");
  }
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let phase: SessionCreationPhase = "browser_launch";
  try {
    // One process plus one incognito context per connection. No profile path is
    // supplied, so nothing survives process destruction.
    browser = await chromium.launch({ headless: true });
    phase = "browser_context";
    context = await browser.newContext({
      acceptDownloads: false,
      locale: "en-US",
      serviceWorkers: "block",
      viewport: input.viewport,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const viewerToken = randomBytes(32).toString("base64url");
    const session: Session = {
      browser,
      captchaObserved: false,
      cdp,
      context,
      expiresAt,
      id: randomUUID(),
      mfaRequested: false,
      page,
      state: "starting",
      viewerToken,
      viewerTokenHash: hash(viewerToken),
      viewers: 0,
      viewport: input.viewport,
    };
    browser.on("disconnected", () => {
      if (!session.cookies && session.state !== "expired") session.state = "failed";
    });
    page.on("framenavigated", () => void observe(session));
    phase = "riot_navigation";
    await page.goto(REAUTH_URL, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    session.state = "waiting_for_user";
    return session;
  } catch (error) {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    console.error(
      JSON.stringify({
        event: "cloud_browser_session_create_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        phase,
      }),
    );
    throw new SessionCreationError(phase);
  }
}

async function destroy(id: string, terminalState?: SessionState): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (terminalState) session.state = terminalState;
  session.cookies = undefined;
  await session.context.clearCookies().catch(() => undefined);
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
}

const viewer = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050505}canvas{width:100%;height:100%;object-fit:contain;touch-action:none;outline:none;cursor:default}textarea{position:fixed;left:50%;bottom:0;width:1px;height:1px;opacity:.01}</style></head><body><canvas tabindex="-1" aria-label="Riot login browser"></canvas><textarea aria-label="Keyboard input for Riot login" autocapitalize="none" autocomplete="off" spellcheck="false"></textarea><script>
const id=location.pathname.split('/').pop(),token=new URLSearchParams(location.hash.slice(1)).get('token'),canvas=document.querySelector('canvas'),input=document.querySelector('textarea'),ctx=canvas.getContext('2d');let ws;
function connect(){ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/v1/stream/'+encodeURIComponent(id));ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token}));ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='frame'){const image=new Image();image.onload=()=>{canvas.width=m.width;canvas.height=m.height;ctx.drawImage(image,0,0)};image.src='data:image/jpeg;base64,'+m.data}};ws.onclose=()=>setTimeout(connect,1000)}connect();setInterval(()=>send({type:'ping'}),${VIEWER_HEARTBEAT_INTERVAL_MS});
${normalizeContainedPoint.toString()}
${shouldForwardViewerKey.toString()}
${viewerPrintableText.toString()}
function send(value){if(ws?.readyState===1)ws.send(JSON.stringify(value))}function focusInput(){input.focus({preventScroll:true})}function point(e,kind){const r=canvas.getBoundingClientRect(),p=normalizeContainedPoint({containerHeight:r.height,containerWidth:r.width,contentHeight:canvas.height||r.height,contentWidth:canvas.width||r.width,localX:e.clientX-r.left,localY:e.clientY-r.top});send({type:'pointer',kind,x:p.x,y:p.y,button:e.button});if(kind==='down'){e.preventDefault();canvas.setPointerCapture(e.pointerId)}if(kind==='down'||kind==='up')focusInput()}
function keyValue(e){return {altKey:e.altKey,ctrlKey:e.ctrlKey,key:e.key,metaKey:e.metaKey}}function forwardKey(e,kind){if(shouldForwardViewerKey(keyValue(e))){send({type:'key',kind,key:e.key});e.preventDefault()}}function canvasKey(e,kind){const text=viewerPrintableText(keyValue(e));if(kind==='down'&&text!==null){send({type:'text',text});e.preventDefault();return}forwardKey(e,kind)}
canvas.onpointerdown=e=>point(e,'down');canvas.onpointermove=e=>{if(e.buttons)point(e,'move')};canvas.onpointerup=e=>point(e,'up');canvas.onkeydown=e=>canvasKey(e,'down');canvas.onkeyup=e=>canvasKey(e,'up');input.onkeydown=e=>forwardKey(e,'down');input.onkeyup=e=>forwardKey(e,'up');input.oninput=()=>{if(input.value){send({type:'text',text:input.value});input.value=''}};
</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true });
    }
    if (request.method === "GET" && /^\/session\/[0-9a-f-]+$/.test(url.pathname)) {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; style-src 'unsafe-inline'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
      });
      return response.end(viewer);
    }
    if (!controlAuthorized(request)) {
      return json(response, 401, { error: "unauthorized" });
    }
    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const input = cloudBrowserSessionSchema.parse(await readBody(request));
      const session = await createBrowserSession(input);
      sessions.set(session.id, session);
      return json(response, 201, {
        ...status(session),
        providerSessionId: session.id,
        streamUrl: `${publicOrigin(request)}/session/${session.id}#token=${session.viewerToken}`,
      });
    }
    const match = /^\/v1\/sessions\/([0-9a-f-]+)(?:\/(stream|cookies))?$/.exec(
      url.pathname,
    );
    if (!match) return json(response, 404, { error: "not found" });
    const id = match[1]!;
    const session = sessions.get(id);
    if (request.method === "DELETE") {
      await destroy(id);
      response.writeHead(204, { "Cache-Control": "no-store" });
      return response.end();
    }
    if (!session) return json(response, 404, { error: "not found" });
    await observe(session);
    if (request.method === "GET" && !match[2]) {
      return json(response, 200, status(session));
    }
    if (request.method === "POST" && match[2] === "stream") {
      return json(response, 200, {
        streamUrl: `${publicOrigin(request)}/session/${id}#token=${session.viewerToken}`,
      });
    }
    if (
      request.method === "POST" &&
      match[2] === "cookies" &&
      session.state === "captured" &&
      session.cookies
    ) {
      return json(response, 200, { cookies: session.cookies });
    }
    return json(response, 409, { error: "not ready" });
  } catch (error) {
    return json(response, 503, {
      error: "unavailable",
      ...(error instanceof SessionCreationError ? { phase: error.phase } : {}),
    });
  }
});

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const match = /^\/v1\/stream\/([0-9a-f-]+)$/.exec(url.pathname);
  if (!match || !sessions.has(match[1]!)) return socket.destroy();
  sockets.handleUpgrade(request, socket, head, (ws) => {
    sockets.emit("connection", ws, match[1]!);
  });
});

sockets.on("connection", (ws: WebSocket, id: string) => {
  const session = sessions.get(id);
  if (!session) return ws.close(1008);
  let authenticated = false;
  const timeout = setTimeout(() => ws.close(1008), 5_000);
  const frame = async (event: {
    data: string;
    metadata: { deviceHeight: number; deviceWidth: number };
    sessionId: number;
  }) => {
    await session.cdp
      .send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(() => undefined);
    if (authenticated && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "frame",
          data: event.data,
          height: event.metadata.deviceHeight,
          width: event.metadata.deviceWidth,
        }),
      );
    }
  };
  ws.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!authenticated) {
        if (
          message.type !== "auth" ||
          typeof message.token !== "string" ||
          !equalToken(message.token, session.viewerTokenHash)
        ) {
          return ws.close(1008);
        }
        authenticated = true;
        clearTimeout(timeout);
        if (session.disconnectTimer) {
          clearTimeout(session.disconnectTimer);
          session.disconnectTimer = undefined;
        }
        session.viewers += 1;
        session.cdp.on("Page.screencastFrame", frame);
        await session.cdp.send("Page.startScreencast", {
          format: "jpeg",
          maxHeight: session.viewport.height,
          maxWidth: session.viewport.width,
          quality: 65,
        });
        return;
      }
      if (message.type === "ping") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
        return;
      }
      if (session.state === "waiting_for_user") session.state = "authenticating";
      if (
        message.type === "pointer" &&
        typeof message.x === "number" &&
        typeof message.y === "number"
      ) {
        const x = Math.max(0, Math.min(1, message.x)) * session.viewport.width;
        const y = Math.max(0, Math.min(1, message.y)) * session.viewport.height;
        await session.page.mouse.move(x, y);
        const button = message.button === 2 ? "right" : "left";
        if (message.kind === "down") await session.page.mouse.down({ button });
        if (message.kind === "up") await session.page.mouse.up({ button });
      } else if (
        message.type === "text" &&
        typeof message.text === "string" &&
        message.text.length <= 256
      ) {
        await session.page.keyboard.insertText(message.text);
      } else if (
        message.type === "key" &&
        typeof message.key === "string" &&
        message.key.length <= 32
      ) {
        if (message.kind === "down") await session.page.keyboard.down(message.key);
        if (message.kind === "up") await session.page.keyboard.up(message.key);
      }
      await observe(session);
    } catch {
      ws.close(1003);
    }
  });
  ws.on("close", async () => {
    clearTimeout(timeout);
    session.cdp.off("Page.screencastFrame", frame);
    await session.cdp.send("Page.stopScreencast").catch(() => undefined);
    if (authenticated) {
      session.viewers = Math.max(0, session.viewers - 1);
      if (session.viewers === 0 && sessions.has(session.id)) {
        // CAPTCHA and mobile network transitions can briefly interrupt the
        // viewer. The absolute session TTL still bounds browser lifetime.
        session.disconnectTimer = setTimeout(
          () => void destroy(session.id, "failed"),
          VIEWER_DISCONNECT_GRACE_MS,
        );
        session.disconnectTimer.unref();
      }
    }
  });
});

setInterval(() => {
  for (const session of sessions.values()) {
    void observe(session);
    if (session.expiresAt <= Date.now()) void destroy(session.id, "expired");
  }
}, 1_000).unref();

server.listen(PORT);

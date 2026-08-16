import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSkinMorphRenderer,
  type SkinMorphRendererOptions,
} from "@/src/lib/webgl/skin-morph-renderer";

type StubImage = TexImageSource & { height: number; width: number };

interface StubResource {
  readonly id: number;
  readonly kind: "buffer" | "program" | "shader" | "texture";
}

function createStubGl() {
  let nextId = 1;
  const created: StubResource[] = [];
  const deleted: StubResource[] = [];
  const make = (kind: StubResource["kind"]): StubResource => {
    const resource = { id: nextId, kind };
    nextId += 1;
    created.push(resource);
    return resource;
  };
  const remove = (resource: StubResource) => {
    deleted.push(resource);
  };

  const gl = {
    ARRAY_BUFFER: 0x8892,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8b82,
    RGBA: 0x1908,
    STATIC_DRAW: 0x88e4,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8b31,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    bufferData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => make("buffer")),
    createProgram: vi.fn(() => make("program")),
    createShader: vi.fn(() => make("shader")),
    createTexture: vi.fn(() => make("texture")),
    deleteBuffer: vi.fn(remove),
    deleteProgram: vi.fn(remove),
    deleteShader: vi.fn(remove),
    deleteTexture: vi.fn(remove),
    drawArrays: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getExtension: vi.fn(() => null),
    getProgramParameter: vi.fn(() => true),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => ({}) as WebGLUniformLocation),
    linkProgram: vi.fn(),
    pixelStorei: vi.fn(),
    shaderSource: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
  };

  return { created, deleted, gl: gl as unknown as WebGLRenderingContext };
}

function createStubCanvas(
  getContext: (contextId: string) => WebGLRenderingContext | null = () => null,
) {
  const stub = {
    addEventListener: vi.fn(),
    getContext: vi.fn(getContext),
    height: 0,
    removeEventListener: vi.fn(),
    width: 0,
  };

  return { canvas: stub as unknown as HTMLCanvasElement, stub };
}

function createScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, FrameRequestCallback>();

  return {
    cancelFrame: vi.fn((handle: number) => {
      pending.delete(handle);
    }),
    pending,
    requestFrame: vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    }),
    step: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

function createImageLoader() {
  const rejecters: ((error: unknown) => void)[] = [];
  const resolvers: ((image: StubImage) => void)[] = [];
  const loadImage = vi.fn(
    () =>
      new Promise<StubImage>((resolve, reject) => {
        rejecters.push(reject);
        resolvers.push(resolve);
      }),
  );

  return {
    loadImage,
    reject: (index: number, error: unknown) => rejecters[index](error),
    resolve: (index: number, width = 1280, height = 360) =>
      resolvers[index]({ height, width } as unknown as StubImage),
  };
}

class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();

  constructor(readonly callback: IntersectionObserverCallback) {
    StubIntersectionObserver.instances.push(this);
  }
}

const documentStub = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  visibilityState: "visible" as DocumentVisibilityState,
};

const SOURCES: SkinMorphRendererOptions["sources"] = [
  { src: "/hero/a.webp", tierColor: [1, 0.5, 0] },
  { src: "/hero/b.webp", tierColor: [0, 0.5, 1] },
];

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  StubIntersectionObserver.instances = [];
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("createSkinMorphRenderer", () => {
  it("returns null under reduced motion without touching getContext", () => {
    const { canvas, stub } = createStubCanvas();

    const renderer = createSkinMorphRenderer(canvas, {
      reducedMotion: true,
      sources: SOURCES,
    });

    expect(renderer).toBeNull();
    expect(stub.getContext).not.toHaveBeenCalled();
  });

  it("returns null when the data saver is on, before any context request", () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const { canvas, stub } = createStubCanvas();

    const renderer = createSkinMorphRenderer(canvas, {
      reducedMotion: false,
      sources: SOURCES,
    });

    expect(renderer).toBeNull();
    expect(stub.getContext).not.toHaveBeenCalled();
  });

  it("returns null when neither webgl2 nor webgl contexts exist", () => {
    const { canvas, stub } = createStubCanvas(() => null);

    const renderer = createSkinMorphRenderer(canvas, {
      reducedMotion: false,
      sources: SOURCES,
    });

    expect(renderer).toBeNull();
    expect(stub.getContext).toHaveBeenCalledWith("webgl2", expect.anything());
    expect(stub.getContext).toHaveBeenCalledWith("webgl", expect.anything());
  });

  it("resolves whenReady only after the first two textures upload", async () => {
    const { gl } = createStubGl();
    const { canvas } = createStubCanvas();
    const loader = createImageLoader();
    const scheduler = createScheduler();

    const renderer = createSkinMorphRenderer(canvas, {
      cancelFrame: scheduler.cancelFrame,
      createContext: () => gl,
      loadImage: loader.loadImage,
      now: () => 0,
      reducedMotion: false,
      requestFrame: scheduler.requestFrame,
      sources: SOURCES,
    });

    expect(renderer).not.toBeNull();
    if (!renderer) return;

    let ready = false;
    void renderer.whenReady.then(() => {
      ready = true;
    });

    await flushMicrotasks();
    expect(loader.loadImage).toHaveBeenCalledTimes(1);

    loader.resolve(0);
    await flushMicrotasks();
    expect(ready).toBe(false);
    expect(loader.loadImage).toHaveBeenCalledTimes(2);

    loader.resolve(1);
    await flushMicrotasks();
    expect(ready).toBe(true);

    renderer.destroy();
  });

  it("rejects whenReady when a texture load fails", async () => {
    const { gl } = createStubGl();
    const { canvas } = createStubCanvas();
    const loader = createImageLoader();
    const scheduler = createScheduler();

    const renderer = createSkinMorphRenderer(canvas, {
      cancelFrame: scheduler.cancelFrame,
      createContext: () => gl,
      loadImage: loader.loadImage,
      now: () => 0,
      reducedMotion: false,
      requestFrame: scheduler.requestFrame,
      sources: SOURCES,
    });

    expect(renderer).not.toBeNull();
    if (!renderer) return;

    await flushMicrotasks();
    loader.reject(0, new Error("network down"));

    await expect(renderer.whenReady).rejects.toThrow("network down");
    renderer.destroy();
  });

  it("schedules frames on start, cancels on stop, and cleans up on destroy", async () => {
    const stubbed = createStubGl();
    const { canvas, stub } = createStubCanvas();
    const loader = createImageLoader();
    const scheduler = createScheduler();

    const renderer = createSkinMorphRenderer(canvas, {
      cancelFrame: scheduler.cancelFrame,
      createContext: () => stubbed.gl,
      loadImage: loader.loadImage,
      now: () => 16,
      reducedMotion: false,
      requestFrame: scheduler.requestFrame,
      sources: SOURCES,
    });

    expect(renderer).not.toBeNull();
    if (!renderer) return;

    await flushMicrotasks();
    loader.resolve(0);
    await flushMicrotasks();
    loader.resolve(1);
    await renderer.whenReady;

    renderer.start();
    renderer.start();
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
    expect(scheduler.pending.size).toBe(1);

    renderer.setMix(1);
    renderer.setPointer(0.5, -0.25);
    scheduler.step();
    expect(stubbed.gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(scheduler.pending.size).toBe(1);

    renderer.stop();
    expect(scheduler.cancelFrame).toHaveBeenCalledTimes(1);
    expect(scheduler.pending.size).toBe(0);

    renderer.start();
    expect(scheduler.pending.size).toBe(1);

    renderer.destroy();
    expect(scheduler.pending.size).toBe(0);

    // Every created program/shader/texture/buffer is deleted again.
    const createdIds = stubbed.created.map((resource) => resource.id).sort();
    const deletedIds = stubbed.deleted.map((resource) => resource.id).sort();
    expect(stubbed.created.length).toBeGreaterThanOrEqual(6);
    expect(deletedIds).toEqual(createdIds);

    expect(stub.removeEventListener).toHaveBeenCalledWith(
      "webglcontextlost",
      expect.any(Function),
    );
    expect(documentStub.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(StubIntersectionObserver.instances).toHaveLength(1);
    expect(StubIntersectionObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("goes permanently dark on context loss and notifies the host", async () => {
    const stubbed = createStubGl();
    const { canvas, stub } = createStubCanvas();
    const loader = createImageLoader();
    const onContextLost = vi.fn();
    const scheduler = createScheduler();

    const renderer = createSkinMorphRenderer(canvas, {
      cancelFrame: scheduler.cancelFrame,
      createContext: () => stubbed.gl,
      loadImage: loader.loadImage,
      now: () => 0,
      onContextLost,
      reducedMotion: false,
      requestFrame: scheduler.requestFrame,
      sources: SOURCES,
    });

    expect(renderer).not.toBeNull();
    if (!renderer) return;

    renderer.start();
    expect(scheduler.pending.size).toBe(1);

    const lostCall = stub.addEventListener.mock.calls.find(
      ([type]) => type === "webglcontextlost",
    );
    expect(lostCall).toBeDefined();
    (lostCall?.[1] as () => void)();

    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(scheduler.pending.size).toBe(0);

    renderer.start();
    expect(scheduler.pending.size).toBe(0);

    renderer.destroy();
  });
});

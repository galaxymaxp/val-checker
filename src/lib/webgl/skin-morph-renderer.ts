import {
  skinMorphFragmentShader,
  skinMorphFragmentShaderLegacy,
} from "./shaders/skin-morph.frag";
import {
  skinMorphVertexShader,
  skinMorphVertexShaderLegacy,
} from "./shaders/skin-morph.vert";

type GLContext = WebGL2RenderingContext | WebGLRenderingContext;

type LoadedImage = TexImageSource & { width: number; height: number };

interface NetworkInformationLike {
  readonly saveData?: boolean;
}

interface NavigatorWithConnection {
  readonly connection?: NetworkInformationLike;
}

export interface SkinMorphSource {
  readonly src: string;
  readonly tierColor: readonly [number, number, number];
}

export interface SkinMorphRendererOptions {
  readonly cancelFrame?: (handle: number) => void;
  readonly createContext?: (canvas: HTMLCanvasElement) => GLContext | null;
  readonly loadImage?: (src: string) => Promise<LoadedImage>;
  readonly now?: () => number;
  readonly onContextLost?: () => void;
  readonly reducedMotion: boolean;
  readonly requestFrame?: (cb: FrameRequestCallback) => number;
  readonly sources: readonly SkinMorphSource[];
}

export interface SkinMorphRenderer {
  readonly destroy: () => void;
  readonly resize: (width: number, height: number, dpr: number) => void;
  /** Continuous 0..N-1 across the source list; the renderer derives the texture pair and local mix. */
  readonly setMix: (value: number) => void;
  /** Pointer position in -1..1, smoothed internally. */
  readonly setPointer: (x: number, y: number) => void;
  readonly start: () => void;
  readonly stop: () => void;
  /** Resolves once the first two textures are uploaded. */
  readonly whenReady: Promise<void>;
}

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  powerPreference: "low-power",
  premultipliedAlpha: false,
};

const POINTER_LERP = 0.08;
const POINTER_LIMIT = 1;
const MAX_DPR = 2;

function saveDataEnabled(): boolean {
  if (typeof navigator === "undefined") return false;

  const connection = (navigator as Navigator & NavigatorWithConnection).connection;

  return connection?.saveData === true;
}

function defaultCreateContext(canvas: HTMLCanvasElement): GLContext | null {
  return (
    canvas.getContext("webgl2", CONTEXT_ATTRIBUTES) ??
    canvas.getContext("webgl", CONTEXT_ATTRIBUTES)
  );
}

async function defaultLoadImage(src: string): Promise<LoadedImage> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();

  return image;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function createSkinMorphRenderer(
  canvas: HTMLCanvasElement,
  options: SkinMorphRendererOptions,
): SkinMorphRenderer | null {
  // Motion and data-saver preferences veto the substrate before any GPU work.
  if (options.reducedMotion) return null;
  if (saveDataEnabled()) return null;

  const gl = options.createContext
    ? options.createContext(canvas)
    : defaultCreateContext(canvas);

  if (!gl) return null;

  const isWebgl2 =
    typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

  const compileShader = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  };

  const vertexShader = compileShader(
    gl.VERTEX_SHADER,
    isWebgl2 ? skinMorphVertexShader : skinMorphVertexShaderLegacy,
  );
  const fragmentShader = compileShader(
    gl.FRAGMENT_SHADER,
    isWebgl2 ? skinMorphFragmentShader : skinMorphFragmentShaderLegacy,
  );
  const program = gl.createProgram();

  if (!vertexShader || !fragmentShader || !program) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    if (program) gl.deleteProgram(program);

    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  if (!isWebgl2) gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);

  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);

    return null;
  }

  gl.useProgram(program);

  // WebGL1 has no gl_VertexID: bind an explicit 3-vertex fullscreen triangle.
  // The standard-derivatives extension is optional flavor, not a requirement.
  let vertexBuffer: WebGLBuffer | null = null;

  if (!isWebgl2) {
    gl.getExtension("OES_standard_derivatives");
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  }

  const uniforms = {
    hueShift: gl.getUniformLocation(program, "uHueShift"),
    mix: gl.getUniformLocation(program, "uMix"),
    pointer: gl.getUniformLocation(program, "uPointer"),
    resolution: gl.getUniformLocation(program, "uResolution"),
    texA: gl.getUniformLocation(program, "uTexA"),
    texAspect: gl.getUniformLocation(program, "uTexAspect"),
    texB: gl.getUniformLocation(program, "uTexB"),
    tierColor: gl.getUniformLocation(program, "uTierColor"),
    time: gl.getUniformLocation(program, "uTime"),
  };

  gl.uniform1i(uniforms.texA, 0);
  gl.uniform1i(uniforms.texB, 1);

  const cancelFrame =
    options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const loadImage = options.loadImage ?? defaultLoadImage;
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  const sources = options.sources;

  const aspects: number[] = sources.map(() => 1);
  const textures: (WebGLTexture | null)[] = sources.map(() => null);

  let dead = false;
  let destroyed = false;
  let frameHandle: number | null = null;
  let hidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  let loadedCount = 0;
  let mixValue = 0;
  let offscreen = false;
  let running = false;
  const pointer = { x: 0, y: 0 };
  const pointerTarget = { x: 0, y: 0 };
  const timeOrigin = now();

  const isActive = () => running && !dead && !destroyed && !hidden && !offscreen;

  const drawScene = () => {
    const elapsed = (now() - timeOrigin) / 1000;
    pointer.x += (pointerTarget.x - pointer.x) * POINTER_LERP;
    pointer.y += (pointerTarget.y - pointer.y) * POINTER_LERP;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.043, 0.055, 0.075, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (loadedCount === 0) return;

    // setMix is continuous across the source list; clamp to the textures
    // uploaded so far, then split into a pair plus a local mix. An exact
    // integer lands cleanly on texture A with a local mix of zero.
    const maxIndex = loadedCount - 1;
    const clamped = clamp(mixValue, 0, maxIndex);
    const indexA = Math.min(Math.floor(clamped), maxIndex);
    const indexB = Math.min(indexA + 1, maxIndex);
    const localMix = clamped - indexA;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[indexA]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[indexB]);

    const tierA = sources[indexA].tierColor;
    const tierB = sources[indexB].tierColor;

    gl.uniform1f(uniforms.hueShift, 0);
    gl.uniform1f(uniforms.mix, localMix);
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.texAspect, aspects[indexA], aspects[indexB]);
    gl.uniform3f(
      uniforms.tierColor,
      tierA[0] + (tierB[0] - tierA[0]) * localMix,
      tierA[1] + (tierB[1] - tierA[1]) * localMix,
      tierA[2] + (tierB[2] - tierA[2]) * localMix,
    );

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const renderFrame: FrameRequestCallback = () => {
    frameHandle = null;
    if (!isActive()) return;

    drawScene();
    frameHandle = requestFrame(renderFrame);
  };

  const syncLoop = () => {
    if (isActive()) {
      if (frameHandle === null) frameHandle = requestFrame(renderFrame);
    } else if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
  };

  const handleVisibilityChange = () => {
    hidden = document.visibilityState === "hidden";
    syncLoop();
  };

  const handleContextLost = () => {
    // No restore path: the substrate goes permanently dark and the host is
    // told so it can fall back to the static presentation.
    dead = true;
    syncLoop();
    options.onContextLost?.();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  canvas.addEventListener("webglcontextlost", handleContextLost);

  let observer: IntersectionObserver | null = null;

  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) offscreen = !entry.isIntersecting;
      syncLoop();
    });
    observer.observe(canvas);
  }

  const uploadTexture = (index: number, image: LoadedImage) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate a texture.");

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    aspects[index] = image.height > 0 ? image.width / image.height : 1;
    textures[index] = texture;
  };

  let resolveReady: () => void = () => {};
  let rejectReady: (error: unknown) => void = () => {};
  const whenReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Keep an unobserved whenReady from surfacing as an unhandled rejection.
  whenReady.catch(() => {});

  const readyThreshold = Math.min(2, sources.length);

  if (readyThreshold === 0) resolveReady();

  // Lazy texture strategy: the first two sources gate readiness, the rest
  // stream in the background. setMix clamps to the loaded prefix meanwhile.
  void (async () => {
    for (let index = 0; index < sources.length; index += 1) {
      if (dead || destroyed) return;

      try {
        const image = await loadImage(sources[index].src);
        if (dead || destroyed) return;

        uploadTexture(index, image);
        loadedCount = index + 1;
        if (loadedCount === readyThreshold) resolveReady();
      } catch (error) {
        rejectReady(error);
        return;
      }
    }
  })();

  return {
    destroy: () => {
      if (destroyed) return;

      destroyed = true;
      running = false;

      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      observer?.disconnect();

      for (const texture of textures) {
        if (texture) gl.deleteTexture(texture);
      }
      textures.fill(null);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(program);
    },
    resize: (width: number, height: number, dpr: number) => {
      if (destroyed || dead) return;

      const cappedDpr = clamp(dpr, 1, MAX_DPR);
      canvas.width = Math.max(1, Math.round(width * cappedDpr));
      canvas.height = Math.max(1, Math.round(height * cappedDpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    setMix: (value: number) => {
      mixValue = clamp(value, 0, Math.max(sources.length - 1, 0));
    },
    setPointer: (x: number, y: number) => {
      pointerTarget.x = clamp(x, -POINTER_LIMIT, POINTER_LIMIT);
      pointerTarget.y = clamp(y, -POINTER_LIMIT, POINTER_LIMIT);
    },
    start: () => {
      if (destroyed || dead) return;

      running = true;
      syncLoop();
    },
    stop: () => {
      running = false;
      syncLoop();
    },
    whenReady,
  };
}

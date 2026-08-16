/**
 * Fragment shaders for the skin morph substrate.
 *
 * The WebGL2 (GLSL ES 3.00) variant and the WebGL1 (GLSL ES 1.00) fallback
 * share one technique body; the only differences are the shading-language
 * scaffolding (version, in/out vs varying, texture vs texture2D, output
 * variable) and the iridescent-sweep phase, which uses luminance
 * derivatives on WebGL2 and a plain uv-driven phase on WebGL1 where the
 * standard-derivatives extension is optional.
 */

const uniformDeclarations = `
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform float uTime;
uniform float uHueShift;
uniform vec2 uPointer;
uniform vec2 uResolution;
uniform vec2 uTexAspect;
uniform vec3 uTierColor;
`;

const sharedFunctions = `
// --- Value noise -----------------------------------------------------------

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Four octaves of value noise.
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * valueNoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// --- Contain fit -----------------------------------------------------------

// Scale factor that letterboxes a texture of the given aspect ratio inside
// the canvas (contain fit: the image is never stretched).
vec2 containScale(float texAspect) {
  float canvasAspect = uResolution.x / max(uResolution.y, 1.0);
  return texAspect > canvasAspect
    ? vec2(1.0, texAspect / canvasAspect)
    : vec2(canvasAspect / texAspect, 1.0);
}

// Samples a texture with contain-fit uv correction and pointer parallax at
// the given depth. Outside the letterboxed fit the sample is transparent.
vec4 sampleContain(sampler2D tex, float texAspect, float depth) {
  vec2 offset = uPointer * -0.018 * depth;
  vec2 tuv = (vUv + offset - 0.5) * containScale(texAspect) + 0.5;
  if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) {
    return vec4(0.0);
  }
  return SKIN_SAMPLE(tex, tuv);
}

// --- Hue/chroma in YIQ space -----------------------------------------------

// Column-major RGB -> YIQ.
const mat3 RGB_TO_YIQ = mat3(
  0.299, 0.596, 0.211,
  0.587, -0.274, -0.523,
  0.114, -0.322, 0.312
);

// Column-major YIQ -> RGB.
const mat3 YIQ_TO_RGB = mat3(
  1.0, 1.0, 1.0,
  0.956, -0.272, -1.106,
  0.621, -0.647, 1.703
);

// Rotates hue by uHueShift plus a slow shimmer, with a slight saturation
// push on the chroma axes before rotating back.
vec3 hueChroma(vec3 rgb) {
  float angle = uHueShift + sin(uTime * 0.2) * 0.03;
  vec3 yiq = RGB_TO_YIQ * rgb;
  yiq.yz *= 1.08;
  float rotCos = cos(angle);
  float rotSin = sin(angle);
  yiq.yz = mat2(rotCos, rotSin, -rotSin, rotCos) * yiq.yz;
  return YIQ_TO_RGB * yiq;
}
`;

const mainBody = `
void main() {
  // 1-2. Aspect-corrected contain-fit sampling with per-layer parallax:
  // skin A sits at depth 1.0, skin B slightly deeper at 1.15.
  vec4 colA = sampleContain(uTexA, uTexAspect.x, 1.0);
  vec4 colB = sampleContain(uTexB, uTexAspect.y, 1.15);

  // 3. Noise-driven dissolve. The threshold is remapped so both resting
  // endpoints (uMix 0 and 1) are fully outside the noise range and clean.
  float n = fbm(vUv * 6.0);
  float threshold = uMix * 1.16 - 0.08;
  float reveal = 1.0 - smoothstep(threshold - 0.08, threshold + 0.08, n);
  // Mix rgb and alpha separately (sources are straight-alpha textures).
  vec4 col = vec4(mix(colA.rgb, colB.rgb, reveal), mix(colA.a, colB.a, reveal));

  // Emissive burn front along the dissolve edge, gated to mid-transition so
  // resting states carry no residue.
  float front = 1.0 - clamp(abs(n - threshold) / 0.08, 0.0, 1.0);
  float gate = smoothstep(0.0, 0.05, uMix) * smoothstep(1.0, 0.95, uMix);
  col.rgb += uTierColor * pow(front, 3.0) * 1.6 * col.a * gate;

  // 4. Hue/chroma pass in YIQ space.
  col.rgb = hueChroma(col.rgb);

  // 5. Iridescent sweep: a thin diagonal band tinted by a cosine palette.
  float s = fract(vUv.x * 0.7 + vUv.y * 0.3 - uTime * 0.12);
  float band = smoothstep(0.0, 0.04, s) * smoothstep(0.09, 0.05, s);
  float phase = sweepPhase(col.rgb);
  vec3 tint = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + phase));
  col.rgb += tint * band * 0.35 * col.a;

  // 6. Composite over a shader-generated backdrop: two very dim radial
  // glows (accent red top-left, mint top-right) drifting at parallax depth
  // 0.5 above the base #0b0e13.
  vec2 bgUv = vUv + uPointer * -0.018 * 0.5;
  vec3 bg = vec3(0.043, 0.055, 0.075);
  float glowRed = 1.0 - clamp(distance(bgUv, vec2(0.12, 0.92)) / 0.9, 0.0, 1.0);
  bg += vec3(1.0, 0.27, 0.32) * pow(glowRed, 2.0) * 0.05;
  float glowMint = 1.0 - clamp(distance(bgUv, vec2(0.88, 0.92)) / 0.9, 0.0, 1.0);
  bg += vec3(0.5, 1.0, 0.8) * pow(glowMint, 2.0) * 0.04;

  vec3 finalRgb = mix(bg, col.rgb, clamp(col.a, 0.0, 1.0));
  SKIN_OUTPUT = vec4(finalRgb, 1.0);
}
`;

export const skinMorphFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

#define SKIN_SAMPLE(tex, uv) texture(tex, uv)
#define SKIN_OUTPUT outColor
${uniformDeclarations}${sharedFunctions}
// Sweep phase from luminance derivatives: the band refracts across detail.
float sweepPhase(vec3 rgb) {
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  return (dFdx(luma) + dFdy(luma)) * 40.0;
}
${mainBody}`;

export const skinMorphFragmentShaderLegacy = `precision highp float;

varying vec2 vUv;

#define SKIN_SAMPLE(tex, uv) texture2D(tex, uv)
#define SKIN_OUTPUT gl_FragColor
${uniformDeclarations}${sharedFunctions}
// WebGL1 fallback: standard derivatives are optional, so the sweep phase is
// driven by uv alone (same band, flatter refraction).
float sweepPhase(vec3 rgb) {
  return vUv.x * 0.6 + vUv.y * 0.4 + rgb.g * 0.0;
}
${mainBody}`;

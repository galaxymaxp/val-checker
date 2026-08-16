/**
 * Fullscreen-triangle vertex shaders for the skin morph substrate.
 *
 * The WebGL2 variant needs no vertex buffers: three clip-space corners are
 * indexed by gl_VertexID and the oversized triangle covers the viewport.
 * The WebGL1 (GLSL ES 1.00) variant has no gl_VertexID, so the renderer
 * binds a 3-vertex position buffer on that path instead.
 */

export const skinMorphVertexShader = `#version 300 es

out vec2 vUv;

// One oversized triangle that covers the whole clip-space square.
const vec2 verts[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));

void main() {
  vec2 position = verts[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0., 1.);
}
`;

export const skinMorphVertexShaderLegacy = `
attribute vec2 aPosition;

varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0., 1.);
}
`;

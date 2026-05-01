// Shaders GLSL do efeito principal.

export const VS_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FS_SRC = `
precision highp float;
varying vec2 v_uv;

uniform sampler2D u_tex;
uniform sampler2D u_prev;
uniform float u_time;
uniform vec2  u_res;

uniform float u_wave;
uniform float u_chroma;
uniform float u_scan;
uniform float u_bulge;
uniform float u_glitch;
uniform float u_feedback;
uniform float u_invert;
uniform float u_pixelate;
uniform float u_vignette;
uniform float u_noise;
uniform float u_hue;
uniform float u_tint_r;
uniform float u_tint_g;
uniform float u_tint_b;

float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 barrel(vec2 uv, float k) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  c *= 1.0 + k * r2;
  return c + 0.5;
}
vec3 hueShift(vec3 col, float h) {
  const vec3 k = vec3(0.57735, 0.57735, 0.57735);
  float ca = cos(h), sa = sin(h);
  return col * ca + cross(k, col) * sa + k * dot(k, col) * (1.0 - ca);
}

void main() {
  vec2 uv = v_uv;
  if (u_pixelate > 0.001) {
    float cells = mix(u_res.x, 80.0, u_pixelate);
    vec2 grid = vec2(cells, cells * u_res.y / u_res.x);
    uv = (floor(uv * grid) + 0.5) / grid;
  }
  uv = mix(uv, barrel(uv, u_bulge * 0.6), step(0.001, u_bulge));
  uv.x += sin(uv.y * 30.0 + u_time * 2.0) * 0.02 * u_wave;
  uv.y += sin(uv.x * 20.0 + u_time * 1.3) * 0.015 * u_wave;
  float bandY = floor(uv.y * 40.0);
  float bandRand = rand(vec2(bandY, floor(u_time * 6.0)));
  if (bandRand > 1.0 - u_glitch * 0.6) {
    uv.x += (bandRand - 0.5) * 0.1 * u_glitch;
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 dir = uv - 0.5;
  float r = texture2D(u_tex, uv + dir * 0.02 * u_chroma).r;
  float g = texture2D(u_tex, uv).g;
  float b = texture2D(u_tex, uv - dir * 0.02 * u_chroma).b;
  vec3 col = vec3(r, g, b);
  vec3 prev = texture2D(u_prev, v_uv).rgb;
  col = mix(col, max(col, prev * 0.92), u_feedback);
  col *= mix(vec3(1.0), vec3(u_tint_r, u_tint_g, u_tint_b), 0.85);
  col = mix(col, hueShift(col, u_hue * 6.2831), step(0.001, u_hue));
  float sl = mix(1.0, 0.55 + 0.45 * sin(v_uv.y * u_res.y * 1.5), u_scan);
  col *= sl;
  float n = (rand(v_uv * u_res + u_time * 100.0) - 0.5) * 0.3 * u_noise;
  col += n;
  float d = distance(v_uv, vec2(0.5));
  col *= 1.0 - smoothstep(0.4, 0.9, d) * u_vignette;
  col = mix(col, 1.0 - col, u_invert);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

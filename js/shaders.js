// GLSL for terrain, water, sky and clouds. All custom materials share the
// same lighting + fog uniforms (owned by `sharedUniforms`) so the day/night
// cycle updates everything by writing to one object.
//
// Colour management: textures are decoded from sRGB, all lighting and fog
// maths happens in linear space, and every fragment shader ends with
// <colorspace_fragment> to encode for the screen. Colour uniforms hold
// linear values; literal colours in GLSL are written in sRGB and wrapped
// in toLinear() so they read like the palette they came from.

import * as THREE from 'three';
import { SEA_LEVEL } from './config.js';

export const sharedUniforms = {
  uTime: { value: 0 },
  uSkyLightColor: { value: new THREE.Color(1, 1, 1) },
  uBlockLightColor: { value: new THREE.Color().setRGB(1.0, 0.8, 0.55, THREE.SRGBColorSpace) },
  uAmbient: { value: 0.035 },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.95) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uFogFar: { value: 96 },
  uFogDensity: { value: 0.0045 },
  uUnderwater: { value: 0 },
};

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSkyLightColor;
  uniform vec3 uBlockLightColor;
  uniform float uAmbient;
  uniform vec3 uFogColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uFogFar;
  uniform float uFogDensity;
  uniform float uUnderwater;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  vec3 toLinear(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(2.2));
  }

  // Perceptual brightness (0–1) for a 0–1 light level.
  float lightCurve(float l) {
    return pow(l, 1.7);
  }

  // Linear light reaching a surface. The curves are tuned perceptually, so
  // each term is converted to linear before the (linear) light colours.
  vec3 shadeLight(float sky, float blk) {
    float flicker = 0.94 + 0.06 * sin(uTime * 9.0 + sin(uTime * 23.0));
    return pow(lightCurve(sky), 2.2) * uSkyLightColor
      + pow(lightCurve(blk), 2.2) * uBlockLightColor * flicker
      + vec3(pow(uAmbient, 2.2));
  }

  // Atmospheric fog. Near the camera it is ray-marched through 4-block
  // voxel cells of drifting density, which gives the characteristic
  // "blocky" volumetric look; it is denser in low-lying areas. Distance
  // fog then hides the edge of the loaded world.
  vec3 applyFog(vec3 col, vec3 worldPos, float skyLight) {
    vec3 ray = worldPos - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-4);

    if (uUnderwater > 0.5) {
      float f = 1.0 - exp(-dist * 0.11);
      vec3 waterFog = toLinear(vec3(0.04, 0.16, 0.32)) * (uSkyLightColor * 0.9 + 0.1) * mix(0.1, 1.0, skyLight);
      return mix(col, waterFog, f);
    }

    float march = min(dist, 80.0);
    float stepLen = march / 8.0;
    vec3 wind = vec3(uTime * 0.7, 0.0, uTime * 0.3);
    float density = 0.0;
    for (int i = 0; i < 8; i++) {
      vec3 p = cameraPosition + dir * ((float(i) + 0.5) * stepLen);
      float cell = hash13(floor((p + wind) / 4.0));
      float height = exp(-max(p.y - ${SEA_LEVEL + 3}.0, 0.0) * 0.07);
      density += (0.3 + 0.7 * cell) * height;
    }
    density *= stepLen * uFogDensity;
    float fog = 1.0 - exp(-density);
    fog = max(fog, smoothstep(uFogFar * 0.55, uFogFar, dist));

    float sunAmount = pow(max(dot(dir, uSunDir), 0.0), 8.0);
    vec3 fogCol = uFogColor + uSunColor * sunAmount * 0.3;
    // Fog is lit by the sky: it fades to near-black deep inside caves.
    fogCol *= pow(mix(0.04, 1.0, lightCurve(skyLight)), 2.2);
    return mix(col, fogCol, clamp(fog, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function createTerrainMaterial(textureArray) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sharedUniforms, uAtlas: { value: textureArray } },
    vertexShader: /* glsl */ `
      attribute vec4 aTex;
      attribute vec4 aLight;
      varying vec3 vUv;
      varying vec3 vLight;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position / 16.0, 1.0);
        vWorldPos = wp.xyz;
        vUv = aTex.xyz;
        vLight = aLight.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp sampler2DArray;
      uniform sampler2DArray uAtlas;
      ${COMMON}
      varying vec3 vUv;
      varying vec3 vLight;
      varying vec3 vWorldPos;
      void main() {
        vec4 tex = texture(uAtlas, vec3(vUv.xy, vUv.z));
        if (tex.a < 0.5) discard;
        vec3 col = tex.rgb * shadeLight(vLight.x, vLight.y) * pow(vLight.z, 2.2);
        gl_FragColor = vec4(applyFog(col, vWorldPos, vLight.x), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Smooth terrain (Surface Nets): flat palette colours for now; Phase 3 adds
// stylized texturing. Smooth normals give soft sky shading, the grid light
// gives cave darkness and torchlight, and a gentle world-space variation
// keeps large areas from looking flat.
// ---------------------------------------------------------------------------

export function createSmoothTerrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...sharedUniforms },
    vertexShader: /* glsl */ `
      attribute vec4 aColour;
      attribute vec4 aLight;
      varying vec3 vColour;
      varying float vAO;
      varying vec2 vLight;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vColour = aColour.rgb;
        vAO = aColour.a;
        vLight = aLight.xy;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vColour;
      varying float vAO;
      varying vec2 vLight;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      float valueNoise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
        float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
        return mix(a, b, f.z);
      }

      void main() {
        vec3 n = normalize(vNormal);
        // Perceptual shading: full on top, softer on walls, darkest underneath.
        float hemi = 0.8 + 0.2 * n.y;
        float variation = 0.93 + 0.1 * valueNoise3(vWorldPos * 0.35) + 0.04 * valueNoise3(vWorldPos * 1.7);
        float shade = clamp(vAO * hemi * variation, 0.0, 1.2);
        vec3 col = toLinear(vColour) * shadeLight(vLight.x, vLight.y) * pow(shade, 2.2);
        gl_FragColor = vec4(applyFog(col, vWorldPos, vLight.x), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Water: screen-space refraction (with depth-based absorption and shore
// foam) + planar reflection, blended by a Fresnel term.
// ---------------------------------------------------------------------------

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uReflection: { value: null },
      uRefraction: { value: null },
      uDepth: { value: null },
      uReflMatrix: { value: new THREE.Matrix4() },
      uUseReflection: { value: 1 },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 1000 },
      uSkyTop: { value: new THREE.Color() },
      uSkyHorizon: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aLight;
      uniform mat4 uReflMatrix;
      varying vec3 vWorldPos;
      varying vec4 vReflCoord;
      varying vec4 vClip;
      varying vec3 vLight;
      void main() {
        vec4 wp = modelMatrix * vec4(position / 16.0, 1.0);
        vWorldPos = wp.xyz;
        vReflCoord = uReflMatrix * wp;
        vClip = projectionMatrix * viewMatrix * wp;
        vLight = aLight.xyz;
        gl_Position = vClip;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uReflection;
      uniform sampler2D uRefraction;
      uniform sampler2D uDepth;
      uniform float uUseReflection;
      uniform float uCameraNear;
      uniform float uCameraFar;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      ${COMMON}
      varying vec3 vWorldPos;
      varying vec4 vReflCoord;
      varying vec4 vClip;
      varying vec3 vLight;

      float linearDepth(float z) {
        float ndc = z * 2.0 - 1.0;
        return 2.0 * uCameraNear * uCameraFar / (uCameraFar + uCameraNear - ndc * (uCameraFar - uCameraNear));
      }

      // Analytic wave slope from a handful of travelling sine waves.
      vec2 waveSlope(vec2 p) {
        float t = uTime;
        vec2 s = vec2(0.0);
        vec2 d1 = vec2(0.8, 0.6);  s += d1 * cos(dot(p, d1) * 1.3 + t * 1.6) * 0.06;
        vec2 d2 = vec2(-0.5, 0.86); s += d2 * cos(dot(p, d2) * 2.1 + t * 2.1) * 0.045;
        vec2 d3 = vec2(0.2, -0.98); s += d3 * cos(dot(p, d3) * 3.7 + t * 2.9) * 0.03;
        vec2 d4 = vec2(-0.93, -0.36); s += d4 * cos(dot(p, d4) * 6.3 + t * 3.7) * 0.018;
        return s;
      }

      void main() {
        vec2 screen = (vClip.xy / vClip.w) * 0.5 + 0.5;
        if (!gl_FrontFacing) {
          // Seen from below: the world above, refracted and tinted.
          vec2 s = waveSlope(vWorldPos.xz);
          vec3 above = texture2D(uRefraction, screen + s * 0.12).rgb * toLinear(vec3(0.5, 0.78, 0.95));
          gl_FragColor = vec4(applyFog(above, vWorldPos, vLight.x), 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec3 viewVec = cameraPosition - vWorldPos;
        float dist = length(viewVec);
        vec3 V = viewVec / dist;
        vec3 flatN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (dot(flatN, V) < 0.0) flatN = -flatN;
        bool isTop = flatN.y > 0.5;

        float waveFade = 1.0 - smoothstep(30.0, 90.0, dist);
        vec2 slope = waveSlope(vWorldPos.xz) * waveFade;
        vec3 N = isTop ? normalize(vec3(-slope.x, 1.0, -slope.y)) : flatN;

        float surfaceDepth = linearDepth(gl_FragCoord.z);
        vec2 refrUV = screen + N.xz * 0.05 * waveFade;
        float sceneDepth = linearDepth(texture2D(uDepth, refrUV).r);
        if (sceneDepth < surfaceDepth) {
          // Distortion sampled something in front of the water — undo it.
          refrUV = screen;
          sceneDepth = linearDepth(texture2D(uDepth, refrUV).r);
        }
        float thickness = max(sceneDepth - surfaceDepth, 0.0);

        vec3 light = shadeLight(vLight.x, vLight.y);
        vec3 refr = texture2D(uRefraction, refrUV).rgb;
        vec3 absorb = exp(-thickness * vec3(0.32, 0.11, 0.07));
        vec3 deep = toLinear(vec3(0.015, 0.07, 0.19)) * light;
        vec3 body = refr * absorb + deep * (1.0 - absorb);

        vec3 R = reflect(-V, N);
        vec3 refl;
        if (uUseReflection > 0.5 && isTop) {
          vec2 ruv = vReflCoord.xy / vReflCoord.w + N.xz * 0.04 * waveFade;
          refl = texture2D(uReflection, ruv).rgb;
        } else {
          refl = mix(uSkyHorizon, uSkyTop, clamp(R.y, 0.0, 1.0)) * pow(clamp(vLight.x * 1.2, 0.2, 1.0), 2.2);
        }

        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        fresnel = clamp(fresnel + 0.06, 0.0, 0.95);
        vec3 col = mix(body, refl, fresnel);

        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 350.0) * 4.0 * smoothstep(0.0, 0.1, uSunDir.y);
        col += uSunColor * spec * pow(lightCurve(vLight.x), 2.2);

        if (isTop) {
          float foamNoise = 0.6 + 0.4 * sin(vWorldPos.x * 3.1 + uTime * 1.7) * sin(vWorldPos.z * 2.7 - uTime * 1.3);
          float foam = (1.0 - smoothstep(0.0, 0.45, thickness)) * foamNoise;
          col = mix(col, toLinear(vec3(0.92, 0.96, 1.0)) * light, foam * 0.55);
        }

        gl_FragColor = vec4(applyFog(col, vWorldPos, vLight.x), 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Sky dome: gradient, square sun & moon, twinkling stars, sunset glow.
// ---------------------------------------------------------------------------

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uSunDir: sharedUniforms.uSunDir,
      uSunColor: sharedUniforms.uSunColor,
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunset: { value: new THREE.Color() },
      uSunsetAmount: { value: 0 },
      uNight: { value: 0 },
      uUnderwater: sharedUniforms.uUnderwater,
      uSkyLightColor: sharedUniforms.uSkyLightColor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunset;
      uniform float uSunsetAmount;
      uniform float uNight;
      uniform float uUnderwater;
      uniform vec3 uSkyLightColor;
      varying vec3 vDir;

      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        if (uUnderwater > 0.5) {
          gl_FragColor = vec4(pow(vec3(0.04, 0.16, 0.32), vec3(2.2)) * (uSkyLightColor * 0.9 + 0.1), 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.45));
        col = mix(col, uHorizon * 0.55, clamp(-h * 2.5, 0.0, 1.0));

        float sunDot = dot(dir, uSunDir);
        float horizonBand = 1.0 - clamp(abs(h) * 2.2, 0.0, 1.0);
        col += uSunset * uSunsetAmount * horizonBand * (0.35 + 0.65 * pow(max(sunDot, 0.0), 3.0));
        col += uSunColor * pow(max(sunDot, 0.0), 48.0) * 0.35;

        // Square sun and moon in a basis aligned with the sun direction.
        vec3 right = normalize(cross(uSunDir, vec3(0.0, 0.0, 1.0)));
        vec3 up = cross(right, uSunDir);
        vec2 sp = vec2(dot(dir, right), dot(dir, up));
        float aboveHorizon = smoothstep(-0.02, 0.02, h);
        if (sunDot > 0.0 && max(abs(sp.x), abs(sp.y)) < 0.05) {
          col = mix(col, pow(vec3(1.0, 0.96, 0.82), vec3(2.2)) * 1.6, aboveHorizon);
        }
        if (sunDot < 0.0 && max(abs(sp.x), abs(sp.y)) < 0.038) {
          vec2 cell = floor((sp + 0.038) / 0.076 * 6.0);
          float crater = hash13(vec3(cell, 7.0)) > 0.72 ? 0.58 : 1.0;
          col = mix(col, pow(vec3(0.86, 0.89, 0.96), vec3(2.2)) * crater, aboveHorizon);
        }

        // Stars on a quantised direction grid.
        if (uNight > 0.01 && h > 0.0) {
          vec3 q = floor(dir * 190.0);
          float s = hash13(q);
          if (s > 0.9965) {
            float twinkle = 0.7 + 0.3 * sin(uTime * 3.0 + s * 500.0);
            col += vec3((s - 0.9965) / 0.0035) * twinkle * uNight * smoothstep(0.0, 0.25, h);
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
}

// ---------------------------------------------------------------------------
// Blocky cloud layer (procedural, drifting).
// ---------------------------------------------------------------------------

export function createCloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uFogColor: sharedUniforms.uFogColor,
      uCloudColor: { value: new THREE.Color(1, 1, 1) },
      uFadeDistance: { value: 300 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform vec3 uCloudColor;
      uniform float uFadeDistance;
      varying vec3 vWorldPos;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash12(i);
        float b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0));
        float d = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 cell = floor((vWorldPos.xz + vec2(uTime * 1.5, 0.0)) / 12.0);
        float n = valueNoise(cell * 0.18) * 0.7 + valueNoise(cell * 0.5) * 0.3;
        if (n < 0.56) discard;
        float dist = length(vWorldPos.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(uFadeDistance * 0.5, uFadeDistance, dist);
        vec3 col = mix(uFogColor, uCloudColor, fade);
        gl_FragColor = vec4(col, 0.82 * fade);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Day/night cycle: moves the sun and moon, blends sky/fog/light colours
// through dawn, day, dusk and night, and drives the cloud layer.

import * as THREE from 'three';
import { sharedUniforms, createSkyMaterial, createCloudMaterial } from './shaders.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const PALETTE = {
  dayTop: C(0.3, 0.52, 0.92),
  dayHorizon: C(0.66, 0.8, 0.97),
  nightTop: C(0.006, 0.01, 0.03),
  nightHorizon: C(0.03, 0.045, 0.09),
  sunset: C(1.0, 0.42, 0.16),
  daySkyLight: C(1.0, 0.98, 0.94),
  duskSkyLight: C(1.0, 0.7, 0.5),
  nightSkyLight: C(0.16, 0.2, 0.34),
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class DayNightCycle {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.3; // 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
    this.dayLength = 600; // seconds per full cycle
    this.daylight = 1; // 0 at night, 1 in full day
    this.skyBrightness = 1; // multiplier on sky light (for mob spawning)

    this.skyMaterial = createSkyMaterial();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMaterial);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.cloudMaterial = createCloudMaterial();
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), this.cloudMaterial);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 10;
    scene.add(this.clouds);

    this.top = new THREE.Color();
    this.horizon = new THREE.Color();
    this.fog = new THREE.FogExp2(0xffffff, 0.004);
    scene.fog = this.fog;
  }

  /** Clock string for the HUD, e.g. "06:30". */
  get clock() {
    const minutes = Math.floor(this.time * 24 * 60);
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  get isNight() {
    return this.daylight < 0.35;
  }

  update(dt, camera, farDistance) {
    this.time = (this.time + dt / this.dayLength) % 1;
    const angle = (this.time - 0.25) * Math.PI * 2;
    const sunDir = sharedUniforms.uSunDir.value.set(Math.cos(angle), Math.sin(angle), 0.28).normalize();
    const elevation = sunDir.y;

    this.daylight = smooth(-0.14, 0.28, elevation);
    const sunset = (1 - smooth(0.0, 0.32, Math.abs(elevation + 0.03))) * smooth(-0.3, -0.05, elevation);

    this.top.copy(PALETTE.nightTop).lerp(PALETTE.dayTop, this.daylight);
    this.horizon.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, this.daylight);
    this.horizon.lerp(PALETTE.sunset, sunset * 0.45);

    const skyU = this.skyMaterial.uniforms;
    skyU.uTop.value.copy(this.top);
    skyU.uHorizon.value.copy(this.horizon);
    skyU.uSunset.value.copy(PALETTE.sunset);
    skyU.uSunsetAmount.value = sunset;
    skyU.uNight.value = 1 - smooth(0.0, 0.5, this.daylight);

    // Light cast on terrain by the sky.
    const skyLight = sharedUniforms.uSkyLightColor.value;
    skyLight.copy(PALETTE.nightSkyLight).lerp(PALETTE.daySkyLight, this.daylight);
    skyLight.lerp(PALETTE.duskSkyLight, sunset * 0.5);
    this.skyBrightness = 0.16 + 0.84 * this.daylight;

    sharedUniforms.uSunColor.value.setRGB(1.0, 0.72 + 0.23 * smooth(0, 0.4, elevation), 0.45 + 0.4 * smooth(0, 0.4, elevation))
      .multiplyScalar(smooth(-0.05, 0.1, elevation));
    sharedUniforms.uFogColor.value.copy(this.horizon);
    sharedUniforms.uFogFar.value = farDistance;

    this.fog.color.copy(this.horizon);
    this.fog.density = 2.2 / farDistance;

    this.dome.position.copy(camera.position);
    this.clouds.position.set(camera.position.x, 116, camera.position.z);
    this.cloudMaterial.uniforms.uCloudColor.value.setRGB(1, 1, 1).lerp(PALETTE.nightSkyLight, 1 - this.daylight).lerp(PALETTE.sunset, sunset * 0.25);
    this.cloudMaterial.uniforms.uFadeDistance.value = Math.max(220, farDistance * 2.5);
  }
}

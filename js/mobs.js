// Hostile mobs ("zombies"). They spawn in darkness — on the surface at
// night and in unlit caves at any time — hunt the player, take knockback,
// and burn up when caught in daylight.

import * as THREE from 'three';
import { MOBS, WORLD_HEIGHT } from './config.js';
import { BLOCK, BLOCK_SOLID } from './blocks.js';
import { moveEntity, isInWater } from './physics.js';

function pixelTexture(pixels, palette) {
  const size = pixels.length;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  pixels.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      ctx.fillStyle = palette[ch];
      ctx.fillRect(x, y, 1, 1);
    });
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

/** Shared geometry/materials for every zombie. */
class ZombieAssets {
  constructor() {
    const skin = '#5a8f4a';
    const face = pixelTexture([
      'gggggggg',
      'gGggggGg',
      'gggggggg',
      'gkkggkkg',
      'gggddggg',
      'ggddddgg',
      'gGggggGg',
      'gggggggg',
    ], { g: skin, G: '#4b7b3d', k: '#1b2a18', d: '#3d6331' });
    const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
    this.headMaterials = [
      new THREE.MeshBasicMaterial({ color: shade(skin, 0.75) }),
      new THREE.MeshBasicMaterial({ color: shade(skin, 0.75) }),
      new THREE.MeshBasicMaterial({ color: shade(skin, 1.0) }),
      new THREE.MeshBasicMaterial({ color: shade(skin, 0.5) }),
      new THREE.MeshBasicMaterial({ map: face }),
      new THREE.MeshBasicMaterial({ color: shade(skin, 0.85) }),
    ];
    this.shirt = new THREE.MeshBasicMaterial({ color: '#2f8f9a' });
    this.pants = new THREE.MeshBasicMaterial({ color: '#3b3f8f' });
    this.skin = new THREE.MeshBasicMaterial({ color: skin });
    // Box geometry with baked per-face shading via vertex colours.
    this.box = (w, h, d) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const shades = [0.75, 0.75, 1.0, 0.5, 0.9, 0.85];
      const colors = [];
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) colors.push(shades[f], shades[f], shades[f]);
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return g;
    };
    for (const m of [this.shirt, this.pants, this.skin]) m.vertexColors = true;
  }
}

let assets = null;

class Zombie {
  constructor(position) {
    assets = assets || new ZombieAssets();
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.width = 0.6;
    this.height = 1.9;
    this.health = 20;
    this.onGround = false;
    this.hitWall = false;
    this.attackCooldown = 0;
    this.hurtTimer = 0;
    this.burnTimer = 0;
    this.dying = 0;
    this.walkPhase = Math.random() * 10;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.yaw = 0;

    // Each zombie owns material clones so it can be tinted by light / damage.
    this.materials = [];
    const own = (m) => {
      const c = m.clone();
      c.userData.baseColor = m.color.clone();
      this.materials.push(c);
      return c;
    };
    const group = new THREE.Group();
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), assets.headMaterials.map(own));
    head.position.y = 1.62;
    const body = new THREE.Mesh(assets.box(0.5, 0.72, 0.28), own(assets.shirt));
    body.position.y = 1.02;
    const limb = (mat, x, y, len) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = new THREE.Mesh(assets.box(0.22, len, 0.22), mat);
      m.position.y = -len / 2;
      pivot.add(m);
      group.add(pivot);
      return pivot;
    };
    const skinMat = own(assets.skin);
    const pantsMat = own(assets.pants);
    this.armL = limb(skinMat, -0.36, 1.36, 0.7);
    this.armR = limb(skinMat, 0.36, 1.36, 0.7);
    // Zombies hold their arms out in front.
    this.armL.rotation.x = -Math.PI / 2;
    this.armR.rotation.x = -Math.PI / 2;
    this.legL = limb(pantsMat, -0.13, 0.68, 0.68);
    this.legR = limb(pantsMat, 0.13, 0.68, 0.68);
    group.add(head, body);
    this.mesh = group;
  }

  get alive() {
    return this.dying === 0;
  }

  hurt(amount, dir) {
    if (!this.alive) return;
    this.health -= amount;
    this.hurtTimer = 0.3;
    this.velocity.x += dir.x * 8;
    this.velocity.z += dir.z * 8;
    this.velocity.y = 5.5;
    if (this.health <= 0) this.dying = 0.0001;
  }

  /** Brightness from world light at head height, so mobs match terrain lighting. */
  applyLighting(world, cycle) {
    const v = world.getLight(Math.floor(this.position.x), Math.floor(this.position.y + 1.5), Math.floor(this.position.z));
    const sky = (v >> 4) / 15;
    const blk = (v & 15) / 15;
    const b = Math.max(Math.pow(sky, 1.7) * cycle.skyBrightness, Math.pow(blk, 1.7) * 0.95) + 0.05;
    const hurt = this.hurtTimer > 0 || this.burnTimer > 0;
    for (const m of this.materials) {
      m.color.copy(m.userData.baseColor).multiplyScalar(b);
      if (hurt) m.color.lerp(new THREE.Color(this.burnTimer > 0 ? 1 : 0.9, this.burnTimer > 0 ? 0.45 : 0.1, 0.05), 0.55);
    }
  }
}

export class MobManager {
  constructor(scene, world, player, cycle) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.cycle = cycle;
    this.mobs = [];
    this.spawnTimer = 0;
    this.enabled = true;
    this.kills = 0;
  }

  clear() {
    for (const m of this.mobs) this.scene.remove(m.mesh);
    this.mobs = [];
  }

  /** Effective light (0–15) at a cell, taking time of day into account. */
  effectiveLight(x, y, z) {
    const v = this.world.getLight(x, y, z);
    return Math.max((v >> 4) * this.cycle.skyBrightness, v & 15);
  }

  trySpawn() {
    if (this.mobs.length >= MOBS.maxCount) return;
    const p = this.player.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 26;
    const x = Math.floor(p.x + Math.cos(angle) * dist);
    const z = Math.floor(p.z + Math.sin(angle) * dist);
    const top = this.world.surfaceY(x, z);
    if (top < 0) return;
    // Either the surface or a random cave pocket below it.
    const underground = Math.random() < 0.5;
    let y = underground ? Math.floor(Math.max(4, Math.min(top, p.y + (Math.random() - 0.5) * 30))) : top + 1;
    // Settle onto a floor.
    for (let i = 0; i < 24 && y > 1; i++) {
      const below = this.world.getBlock(x, y - 1, z);
      if (below !== null && BLOCK_SOLID[below] && below !== BLOCK.LEAVES) break;
      y--;
    }
    if (y <= 1 || y >= WORLD_HEIGHT - 2) return;
    const feet = this.world.getBlock(x, y, z);
    const head = this.world.getBlock(x, y + 1, z);
    const below = this.world.getBlock(x, y - 1, z);
    const open = (id) => id !== null && !BLOCK_SOLID[id] && id !== BLOCK.WATER;
    if (!open(feet) || !open(head) || !BLOCK_SOLID[below] || below === BLOCK.LEAVES) return;
    if (this.effectiveLight(x, y, z) > MOBS.maxSpawnLight) return;
    if (Math.hypot(x + 0.5 - p.x, y - p.y, z + 0.5 - p.z) < 14) return;

    const mob = new Zombie(new THREE.Vector3(x + 0.5, y, z + 0.5));
    this.mobs.push(mob);
    this.scene.add(mob.mesh);
  }

  update(dt) {
    if (!this.enabled) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = MOBS.spawnInterval;
      for (let i = 0; i < 4; i++) this.trySpawn();
    }

    const player = this.player;
    const toRemove = [];
    for (const mob of this.mobs) {
      if (!mob.alive) {
        mob.dying += dt;
        mob.mesh.rotation.z = Math.min(Math.PI / 2, mob.dying * 5);
        mob.mesh.position.copy(mob.position);
        if (mob.dying > 0.8) toRemove.push(mob);
        continue;
      }
      const dx = player.position.x - mob.position.x;
      const dz = player.position.z - mob.position.z;
      const dy = player.position.y - mob.position.y;
      const dist = Math.hypot(dx, dz);
      if (dist > MOBS.despawnDistance) {
        toRemove.push(mob);
        continue;
      }

      // Burn in daylight when exposed to the sky.
      const lightHere = this.world.getLight(Math.floor(mob.position.x), Math.floor(mob.position.y + 1.6), Math.floor(mob.position.z));
      if (this.cycle.daylight > 0.55 && (lightHere >> 4) >= 14 && !isInWater(this.world, mob)) {
        mob.burnTimer += dt;
        if (mob.burnTimer > 1) {
          mob.burnTimer = 0.01;
          mob.hurt(4, { x: 0, z: 0 });
        }
      } else {
        mob.burnTimer = 0;
      }

      // AI: chase the player when close, otherwise wander.
      let wx = 0;
      let wz = 0;
      let speed = 0;
      if (!player.dead && dist < 32) {
        wx = dx / (dist || 1);
        wz = dz / (dist || 1);
        speed = 2.7;
      } else {
        mob.wanderTimer -= dt;
        if (mob.wanderTimer <= 0) {
          mob.wanderTimer = 2 + Math.random() * 4;
          mob.wanderAngle = Math.random() < 0.3 ? null : Math.random() * Math.PI * 2;
        }
        if (mob.wanderAngle !== null) {
          wx = Math.cos(mob.wanderAngle);
          wz = Math.sin(mob.wanderAngle);
          speed = 1.1;
        }
      }
      const blend = Math.min(1, dt * (mob.onGround ? 8 : 1.5));
      mob.velocity.x += (wx * speed - mob.velocity.x) * blend;
      mob.velocity.z += (wz * speed - mob.velocity.z) * blend;
      if (isInWater(this.world, mob)) {
        mob.velocity.y = Math.min(mob.velocity.y + 20 * dt, 2.5);
      } else {
        mob.velocity.y = Math.max(-50, mob.velocity.y - 28 * dt);
      }
      moveEntity(this.world, mob, dt);
      if (mob.hitWall && mob.onGround && speed > 0) mob.velocity.y = 8.2;

      // Melee attack.
      mob.attackCooldown -= dt;
      if (dist < 1.2 && Math.abs(dy) < 1.6 && mob.attackCooldown <= 0 && !player.dead) {
        mob.attackCooldown = 1;
        player.damage(3, { x: dx / (dist || 1), z: dz / (dist || 1) });
      }

      // Animation.
      if (speed > 0) mob.yaw = Math.atan2(wx, wz);
      const moving = Math.hypot(mob.velocity.x, mob.velocity.z);
      mob.walkPhase += dt * moving * 3.2;
      const swing = Math.sin(mob.walkPhase) * Math.min(0.7, moving * 0.3);
      mob.legL.rotation.x = swing;
      mob.legR.rotation.x = -swing;
      mob.armL.rotation.x = -Math.PI / 2 + swing * 0.2;
      mob.armR.rotation.x = -Math.PI / 2 - swing * 0.2;
      mob.hurtTimer = Math.max(0, mob.hurtTimer - dt);
      mob.mesh.position.copy(mob.position);
      mob.mesh.rotation.y = mob.yaw;
      mob.applyLighting(this.world, this.cycle);
    }
    for (const mob of toRemove) {
      if (!mob.alive) this.kills++;
      this.scene.remove(mob.mesh);
      this.mobs.splice(this.mobs.indexOf(mob), 1);
    }
  }

  /** Nearest living mob hit by a ray (slab test against its AABB). */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const mob of this.mobs) {
      if (!mob.alive) continue;
      const half = mob.width / 2 + 0.1;
      const min = [mob.position.x - half, mob.position.y, mob.position.z - half];
      const max = [mob.position.x + half, mob.position.y + mob.height, mob.position.z + half];
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      let tmin = 0;
      let tmax = maxDist;
      let hit = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-8) {
          if (o[a] < min[a] || o[a] > max[a]) { hit = false; break; }
          continue;
        }
        let t1 = (min[a] - o[a]) / d[a];
        let t2 = (max[a] - o[a]) / d[a];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
      if (hit && (!best || tmin < best.distance)) best = { mob, distance: tmin };
    }
    return best;
  }

  /** True if any mob overlaps the given block cell (blocks placement). */
  occupies(bx, by, bz) {
    return this.mobs.some((m) => {
      const half = m.width / 2;
      return m.position.x + half > bx && m.position.x - half < bx + 1 &&
        m.position.y + m.height > by && m.position.y < by + 1 &&
        m.position.z + half > bz && m.position.z - half < bz + 1;
    });
  }
}

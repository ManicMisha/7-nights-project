// Block targeting, mining (with crack overlay & particles), placing, and
// melee attacks on mobs.

import * as THREE from 'three';
import {
  MAT, MAT_HARDNESS, MAT_RENDER, MAT_SOLID, MAT_TILES, RENDER, isReplaceable,
} from './materials.js';
import { ITEM_PLACES, dropItem } from './items.js';
import { PLAYER } from './config.js';
import { intersectsBlock } from './physics.js';

const MAX_PARTICLES = 400;

export class BlockInteraction {
  constructor(scene, world, player, inventory, mobs, textures, sound) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.mobs = mobs;
    this.textures = textures;
    this.sound = sound;
    this.target = null;
    this.breakProgress = 0;
    this.breakKey = '';
    this.placeCooldown = 0;
    this.attackCooldown = 0;
    this.onBlockBroken = null;

    // Selection outline.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, fog: false }));
    this.outline.visible = false;
    scene.add(this.outline);

    // Crack overlay.
    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: textures.crackTextures[0], transparent: true, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMaterial);
    this.crack.visible = false;
    scene.add(this.crack);

    // Break particles (a single Points object, recycled).
    this.particles = [];
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, input, active) {
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.updateParticles(dt);

    if (!active || this.player.dead) {
      this.outline.visible = false;
      this.crack.visible = false;
      this.breakProgress = 0;
      return;
    }

    const eye = this.player.eye;
    const dir = this.player.lookDirection();
    this.target = this.world.raycast(eye, dir, PLAYER.reach, (id) => id !== MAT.AIR && id !== MAT.WATER);
    const mobHit = this.mobs.raycast(eye, dir, 3.6);
    const mobFirst = mobHit && (!this.target || mobHit.distance < this.target.distance);

    if (this.target && !mobFirst) {
      const t = this.target;
      this.outline.visible = true;
      this.outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    } else {
      this.outline.visible = false;
    }

    // Mining: hold the left button.
    if (input.buttons.has(0) && this.target && !mobFirst) {
      const t = this.target;
      const key = `${t.x},${t.y},${t.z}`;
      if (key !== this.breakKey) {
        this.breakKey = key;
        this.breakProgress = 0;
      }
      const hardness = MAT_HARDNESS[t.id];
      if (Number.isFinite(hardness)) {
        this.breakProgress += hardness > 0 ? dt / hardness : 1;
        if (Math.random() < dt * 12) this.spawnParticles(t, 1);
        if (this.breakProgress >= 1) this.breakBlock(t);
      }
    } else {
      this.breakProgress = 0;
      this.breakKey = '';
    }

    if (this.breakProgress > 0 && this.target) {
      this.crack.visible = true;
      this.crack.position.copy(this.outline.position);
      this.crackMaterial.map = this.textures.crackTextures[Math.min(9, Math.floor(this.breakProgress * 10))];
    } else {
      this.crack.visible = false;
    }

    // Placing: right button (repeats while held).
    if (input.buttons.has(2) && this.placeCooldown <= 0) {
      this.placeBlock();
      this.placeCooldown = 0.22;
    }
  }

  /** Left click: swing at a mob if one is in reach and in front of any block. */
  onMouseDown(button) {
    if (button !== 0 || this.attackCooldown > 0 || this.player.dead) return;
    const eye = this.player.eye;
    const dir = this.player.lookDirection();
    const mobHit = this.mobs.raycast(eye, dir, 3.6);
    const block = this.world.raycast(eye, dir, PLAYER.reach, (id) => id !== MAT.AIR && id !== MAT.WATER);
    if (mobHit && (!block || mobHit.distance < block.distance)) {
      const knock = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      mobHit.mob.hurt(5, knock);
      this.attackCooldown = 0.35;
      if (this.sound) this.sound.hit();
    }
  }

  breakBlock(t) {
    this.world.setMaterial(t.x, t.y, t.z, MAT.AIR);
    this.spawnParticles(t, 22);
    const drop = dropItem(t.id);
    if (drop) this.inventory.add(drop, 1);
    // Plants and torches resting on the broken block pop off too.
    const above = this.world.getMaterial(t.x, t.y + 1, t.z);
    if (above !== null && MAT_RENDER[above] === RENDER.CROSS) {
      this.world.setMaterial(t.x, t.y + 1, t.z, MAT.AIR);
      if (dropItem(above)) this.inventory.add(dropItem(above), 1);
    }
    this.breakProgress = 0;
    this.breakKey = '';
    if (this.sound) this.sound.dig(t.id);
    if (this.onBlockBroken) this.onBlockBroken(t.id);
  }

  placeBlock() {
    const t = this.target;
    const stack = this.inventory.selectedStack;
    if (!t || !stack) return;
    let x = t.x;
    let y = t.y;
    let z = t.z;
    // Clicking a replaceable plant replaces it; otherwise build on the face.
    if (t.id !== MAT.TALL_GRASS) {
      x += t.normal[0];
      y += t.normal[1];
      z += t.normal[2];
    }
    const existing = this.world.getMaterial(x, y, z);
    if (existing === null || !isReplaceable(existing)) return;
    const id = ITEM_PLACES[stack.id];
    if (!id) return;
    if (MAT_RENDER[id] === RENDER.CROSS) {
      // Torches and flowers need solid ground beneath them.
      const below = this.world.getMaterial(x, y - 1, z);
      if (!below || !MAT_SOLID[below]) return;
    }
    if (MAT_SOLID[id]) {
      if (intersectsBlock(this.player, x, y, z) || this.mobs.occupies(x, y, z)) return;
    }
    if (this.world.setMaterial(x, y, z, id)) {
      this.inventory.consumeSelected();
      if (this.sound) this.sound.place();
    }
  }

  spawnParticles(t, count) {
    const color = this.textures.averageColors[MAT_TILES[t.id * 3 + 2]];
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: t.x + 0.2 + Math.random() * 0.6,
        y: t.y + 0.2 + Math.random() * 0.6,
        z: t.z + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 4,
        vz: (Math.random() - 0.5) * 4,
        life: 0.5 + Math.random() * 0.5,
        r: Math.pow(color[0] * (0.7 + Math.random() * 0.3), 2.2),
        g: Math.pow(color[1] * (0.7 + Math.random() * 0.3), 2.2),
        b: Math.pow(color[2] * (0.7 + Math.random() * 0.3), 2.2),
      });
    }
  }

  updateParticles(dt) {
    const ps = this.particles;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (this.world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) {
        p.y = Math.floor(p.y) + 1.001;
        p.vy = 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      ps[n++] = p;
      this.pPos[(n - 1) * 3] = p.x;
      this.pPos[(n - 1) * 3 + 1] = p.y;
      this.pPos[(n - 1) * 3 + 2] = p.z;
      this.pCol[(n - 1) * 3] = p.r;
      this.pCol[(n - 1) * 3 + 1] = p.g;
      this.pCol[(n - 1) * 3 + 2] = p.b;
    }
    ps.length = n;
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}

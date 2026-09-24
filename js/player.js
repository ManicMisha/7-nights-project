// First-person player: mouse look, walking/sprinting/jumping, swimming,
// creative-style flight (double-tap Space), fall damage and health.

import * as THREE from 'three';
import { PLAYER, WORLD_HEIGHT } from './config.js';
import { MAT } from './materials.js';
import { moveEntity, isInWater } from './physics.js';

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.width = PLAYER.width;
    this.height = PLAYER.height;
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 1;
    this.flying = false;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.health = PLAYER.maxHealth;
    this.dead = false;
    this.hurtTimer = 0;
    this.invulnerable = 0;
    this.fallStartY = null;
    this.bobPhase = 0;
    this.spawnPoint = new THREE.Vector3();
    this.onDamage = null;
    this.onDeath = null;
    camera.rotation.order = 'YXZ';
  }

  get eye() {
    return new THREE.Vector3(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z);
  }

  /** Unit vector the camera is looking along. */
  lookDirection(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Finds solid, dry ground near (x, z) and moves the player there. */
  spawnAt(x, z) {
    for (let r = 0; r < 64; r += 4) {
      for (let a = 0; a < 8; a++) {
        const sx = Math.floor(x + Math.cos((a / 8) * Math.PI * 2) * r);
        const sz = Math.floor(z + Math.sin((a / 8) * Math.PI * 2) * r);
        const top = this.world.surfaceY(sx, sz);
        if (top < 0) continue;
        const id = this.world.getMaterial(sx, top, sz);
        if (id === MAT.WATER || id === MAT.LEAVES) continue;
        this.spawnPoint.set(sx + 0.5, top + 1, sz + 0.5);
        this.respawn();
        return true;
      }
    }
    this.spawnPoint.set(x + 0.5, WORLD_HEIGHT - 20, z + 0.5);
    this.respawn();
    return false;
  }

  respawn() {
    this.position.copy(this.spawnPoint);
    // Lift out of anything that might have been built on the spawn point.
    while (this.world.isSolid(Math.floor(this.position.x), Math.floor(this.position.y), Math.floor(this.position.z)) && this.position.y < WORLD_HEIGHT) {
      this.position.y += 1;
    }
    this.velocity.set(0, 0, 0);
    this.health = PLAYER.maxHealth;
    this.dead = false;
    this.fallStartY = null;
    this.invulnerable = 2;
  }

  toggleFlight() {
    this.flying = !this.flying;
    this.velocity.y = 0;
    this.fallStartY = null;
  }

  damage(amount, knockback) {
    if (this.dead || this.invulnerable > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.35;
    this.invulnerable = 0.5;
    if (knockback) {
      this.velocity.x += knockback.x * 7;
      this.velocity.z += knockback.z * 7;
      if (!this.flying) this.velocity.y = Math.max(this.velocity.y, 5);
    }
    if (this.onDamage) this.onDamage(amount);
    if (this.health <= 0) {
      this.dead = true;
      if (this.onDeath) this.onDeath();
    }
  }

  update(dt, input, controlsActive) {
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    if (controlsActive) {
      const [dx, dy] = input.consumeMouse();
      const k = 0.0022 * this.sensitivity;
      this.yaw -= dx * k;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch - dy * k));
    }

    const active = controlsActive && !this.dead;
    const fwd = active ? (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0) : 0;
    const strafe = active ? (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0) : 0;
    const jump = active && input.isDown('Space');
    const descend = active && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    const sprint = active && (input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyR'));

    // Wish direction on the horizontal plane.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * strafe;
    let wz = -cos * fwd - sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }

    this.inWater = isInWater(this.world, this, 0.3);
    const eye = this.eye;
    this.headInWater = this.world.getMaterial(Math.floor(eye.x), Math.floor(eye.y + 0.1), Math.floor(eye.z)) === MAT.WATER;

    if (this.flying) {
      const speed = PLAYER.flySpeed * (sprint ? 2 : 1);
      const blend = Math.min(1, dt * 10);
      this.velocity.x += (wx * speed - this.velocity.x) * blend;
      this.velocity.z += (wz * speed - this.velocity.z) * blend;
      const vy = (jump ? speed : 0) - (descend ? speed : 0);
      this.velocity.y += (vy - this.velocity.y) * blend;
    } else if (this.inWater) {
      const speed = PLAYER.walkSpeed * 0.55;
      const blend = Math.min(1, dt * 6);
      this.velocity.x += (wx * speed - this.velocity.x) * blend;
      this.velocity.z += (wz * speed - this.velocity.z) * blend;
      this.velocity.y -= 9 * dt;
      if (jump) this.velocity.y += 24 * dt;
      this.velocity.y = Math.max(-3, Math.min(3.8, this.velocity.y * (1 - dt * 2)));
      this.fallStartY = null;
    } else {
      const speed = sprint && fwd > 0 ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const blend = Math.min(1, dt * (this.onGround ? 14 : 2.5));
      this.velocity.x += (wx * speed - this.velocity.x) * blend;
      this.velocity.z += (wz * speed - this.velocity.z) * blend;
      this.velocity.y = Math.max(-55, this.velocity.y - PLAYER.gravity * dt);
      if (jump && this.onGround) this.velocity.y = PLAYER.jumpVelocity;
    }

    const wasOnGround = this.onGround;
    moveEntity(this.world, this, dt);

    // Fall damage.
    if (!this.flying && !this.inWater) {
      if (!this.onGround) {
        if (this.fallStartY === null || this.position.y > this.fallStartY) this.fallStartY = this.position.y;
      } else if (this.fallStartY !== null) {
        const fall = this.fallStartY - this.position.y;
        if (fall > 3.5) this.damage(Math.floor(fall - 3));
        this.fallStartY = null;
      }
    }
    if (this.flying && this.onGround && !jump) this.flying = false;

    if (this.position.y < -30) this.damage(100);

    // Camera with a gentle view bob while walking.
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && wasOnGround && horizSpeed > 0.5) this.bobPhase += dt * horizSpeed * 1.9;
    else this.bobPhase *= 0.9;
    const bob = Math.sin(this.bobPhase) * 0.045 * Math.min(1, horizSpeed / PLAYER.walkSpeed);
    this.camera.position.set(this.position.x, this.position.y + PLAYER.eyeHeight + Math.abs(bob), this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase * 0.5) * 0.004);
  }
}

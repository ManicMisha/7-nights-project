// Axis-separated AABB vs. voxel collision shared by the player and mobs.

import { BLOCK } from './blocks.js';

const EPS = 1e-4;

/**
 * Moves an entity through the world, resolving collisions one axis at a time.
 * The entity needs: position (feet centre, THREE.Vector3), velocity,
 * width, height. Sets onGround, hitWall, hitCeiling.
 */
export function moveEntity(world, e, dt) {
  e.onGround = false;
  e.hitWall = false;
  e.hitCeiling = false;
  const maxDelta = Math.max(Math.abs(e.velocity.x), Math.abs(e.velocity.y), Math.abs(e.velocity.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxDelta / 0.35));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    moveAxis(world, e, 'y', e.velocity.y * h);
    moveAxis(world, e, 'x', e.velocity.x * h);
    moveAxis(world, e, 'z', e.velocity.z * h);
  }
}

function moveAxis(world, e, axis, delta) {
  if (delta === 0) return;
  const p = e.position;
  p[axis] += delta;
  const half = e.width / 2;
  const minX = Math.floor(p.x - half + EPS);
  const maxX = Math.floor(p.x + half - EPS);
  const minY = Math.floor(p.y + EPS);
  const maxY = Math.floor(p.y + e.height - EPS);
  const minZ = Math.floor(p.z - half + EPS);
  const maxZ = Math.floor(p.z + half - EPS);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!world.isSolid(x, y, z)) continue;
        if (axis === 'y') {
          if (delta > 0) {
            p.y = y - e.height - EPS;
            e.hitCeiling = true;
          } else {
            p.y = y + 1 + EPS;
            e.onGround = true;
          }
        } else if (axis === 'x') {
          p.x = delta > 0 ? x - half - EPS : x + 1 + half + EPS;
          e.hitWall = true;
        } else {
          p.z = delta > 0 ? z - half - EPS : z + 1 + half + EPS;
          e.hitWall = true;
        }
        e.velocity[axis] = 0;
        return;
      }
    }
  }
}

/** True if any part of the entity's box overlaps a water block. */
export function isInWater(world, e, heightFraction = 0.4) {
  const x = Math.floor(e.position.x);
  const z = Math.floor(e.position.z);
  const y = Math.floor(e.position.y + e.height * heightFraction);
  return world.getBlock(x, y, z) === BLOCK.WATER;
}

/** True if the entity's box intersects the given block cell. */
export function intersectsBlock(e, bx, by, bz) {
  const half = e.width / 2;
  return (
    e.position.x + half > bx && e.position.x - half < bx + 1 &&
    e.position.y + e.height > by && e.position.y < by + 1 &&
    e.position.z + half > bz && e.position.z - half < bz + 1
  );
}

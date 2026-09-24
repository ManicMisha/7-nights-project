// Collision shared by the player and mobs. Two modes:
//   • smooth (default): the entity stands on the smooth terrain surface
//     (interpolated density), steps up small rises, hugs slopes when walking
//     downhill and is stopped by steeper walls. Legacy blocks (logs, placed
//     planks…) still collide as boxes.
//   • voxel (smoothTerrain flag off): axis-separated box vs. grid cells.

import { MAT, MAT_SOLID, MAT_TERRAIN } from './materials.js';

const EPS = 1e-4;
const STEP_HEIGHT = 0.6; // highest rise walked up without jumping
const GROUND_SNAP = 0.35; // how far a walking entity follows the ground down
const FOOT_INSET = 0.7; // footprint corners, as a fraction of the half-width

/**
 * Moves an entity through the world and resolves collisions. The entity
 * needs: position (feet centre, THREE.Vector3), velocity, width, height.
 * Sets onGround, hitWall and hitCeiling.
 */
export function moveEntity(world, e, dt) {
  if (world.smoothTerrain) moveSmooth(world, e, dt);
  else moveVoxel(world, e, dt);
}

// ---------------------------------------------------------------------------
// Smooth terrain
// ---------------------------------------------------------------------------

/** A legacy block that collides as a box (terrain is handled by density). */
function legacySolid(world, x, y, z) {
  const id = world.getMaterial(x, y, z);
  return id !== null && MAT_SOLID[id] === 1 && MAT_TERRAIN[id] === 0;
}

function solidPoint(world, x, y, z) {
  return world.densityAt(x, y, z) > 0 || legacySolid(world, Math.floor(x), Math.floor(y), Math.floor(z));
}

/**
 * Highest ground surface at (x, z) between yBottom and yTop: the terrain
 * surface or the top of a legacy block. +Infinity if yTop is inside the
 * terrain; −Infinity if there's no ground in the range.
 */
export function groundBelow(world, x, z, yTop, yBottom) {
  let best = -Infinity;
  let prevY = yTop;
  let prevF = world.densityAt(x, yTop, z);
  if (prevF > 0) return Infinity;
  // Density is linear between cell centres along a vertical line, so walk
  // down centre by centre and solve for the crossing exactly.
  let y = Math.floor(yTop - 0.5) + 0.5;
  if (y >= yTop) y -= 1;
  for (; y >= yBottom - 1; y -= 1) {
    const f = world.densityAt(x, y, z);
    if (f > 0) {
      best = y + ((prevY - y) * f) / (f - prevF);
      break;
    }
    prevY = y;
    prevF = f;
  }
  if (best < yBottom) best = -Infinity;
  for (let cy = Math.floor(yTop); cy >= Math.floor(yBottom); cy--) {
    if (legacySolid(world, Math.floor(x), cy, Math.floor(z))) {
      if (cy + 1 <= yTop && cy + 1 > best) best = cy + 1;
      break;
    }
  }
  return best;
}

function footprint(e) {
  const r = (e.width / 2) * FOOT_INSET;
  const { x, z } = e.position;
  return [[x, z], [x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]];
}

/** Highest ground under the entity's footprint in [yBottom, yTop]. */
function groundUnder(world, e, yTop, yBottom) {
  let g = -Infinity;
  for (const [x, z] of footprint(e)) g = Math.max(g, groundBelow(world, x, z, yTop, yBottom));
  return g;
}

/** True if anything solid overlaps the body between two heights. */
function bodyBlocked(world, e, yLow, yHigh) {
  const half = e.width / 2 - 0.02;
  const { x, z } = e.position;
  for (let y = yLow; ; y = Math.min(yHigh, y + 0.45)) {
    for (const [cx, cz] of [[x - half, z - half], [x + half, z - half], [x - half, z + half], [x + half, z + half], [x, z]]) {
      if (solidPoint(world, cx, y, cz)) return true;
    }
    if (y >= yHigh) return false;
  }
}

function moveSmooth(world, e, dt) {
  const wasGrounded = Boolean(e.grounded);
  e.onGround = false;
  e.hitWall = false;
  e.hitCeiling = false;
  const maxDelta = Math.max(Math.abs(e.velocity.x), Math.abs(e.velocity.y), Math.abs(e.velocity.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxDelta / 0.3));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    moveVertical(world, e, e.velocity.y * h);
    moveHorizontal(world, e, 'x', e.velocity.x * h);
    moveHorizontal(world, e, 'z', e.velocity.z * h);
  }
  // Walking downhill: follow the ground instead of bouncing off each step.
  if (wasGrounded && !e.onGround && e.velocity.y <= 0) {
    const g = groundUnder(world, e, e.position.y + 0.05, e.position.y - GROUND_SNAP);
    if (Number.isFinite(g)) {
      e.position.y = g;
      e.velocity.y = 0;
      e.onGround = true;
    }
  }
  e.grounded = e.onGround;
}

function moveVertical(world, e, dy) {
  const p = e.position;
  if (dy > 0) {
    if (bodyBlocked(world, e, p.y + e.height + dy - 0.05, p.y + e.height + dy - 0.05)) {
      e.hitCeiling = true;
      e.velocity.y = 0;
      return;
    }
    p.y += dy;
    return;
  }
  const target = p.y + dy;
  let g = groundUnder(world, e, p.y + 0.25, target);
  if (g === Infinity) {
    // Embedded (terrain appeared around the feet): lift out if it's shallow.
    g = groundUnder(world, e, p.y + 1.2, p.y);
    if (!Number.isFinite(g)) return;
  }
  if (g >= target) {
    p.y = g;
    e.velocity.y = 0;
    e.onGround = true;
  } else {
    p.y = target;
  }
}

function moveHorizontal(world, e, axis, d) {
  if (d === 0) return;
  const p = e.position;
  const old = p[axis];
  p[axis] += d;
  // Anything above step height blocks; lower rises are stepped onto.
  if (bodyBlocked(world, e, p.y + STEP_HEIGHT, p.y + e.height - 0.05)) {
    p[axis] = old;
    e.velocity[axis] = 0;
    e.hitWall = true;
    return;
  }
  const g = groundUnder(world, e, p.y + STEP_HEIGHT, p.y - 0.01);
  if (g === Infinity) {
    p[axis] = old;
    e.velocity[axis] = 0;
    e.hitWall = true;
  } else if (g > p.y) {
    p.y = g;
    e.onGround = true;
    if (e.velocity.y < 0) e.velocity.y = 0;
  }
}

// ---------------------------------------------------------------------------
// Voxel (cube) collision
// ---------------------------------------------------------------------------

function moveVoxel(world, e, dt) {
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
  return world.getMaterial(x, y, z) === MAT.WATER;
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

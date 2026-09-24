// Feature flags for systems that are still being built. A flag lets a
// half-finished system live on `main` switched off, so the game stays
// playable after every phase.
//
// Turn flags on or off per session from the URL:
//   ?flags=someFlag          → on
//   ?flags=-someFlag         → off
//   ?flags=a,-b              → several at once
//
// Add a flag here when its system lands; delete it once the system is
// finished and on by default.

export const FEATURE_FLAGS = {
  // name: { default: false, description: 'What it switches on' },
  smoothTerrain: {
    default: true,
    description: 'Draw terrain as a smooth surface (Surface Nets) with smooth-ground physics; off shows the old cubes. Remove once the cube path is retired.',
  },
};

/**
 * Resolves the active flags from a URL query string. Unknown names are
 * reported in `unknown` rather than silently ignored.
 */
export function resolveFlags(search = '', registry = FEATURE_FLAGS) {
  const flags = {};
  for (const [name, def] of Object.entries(registry)) flags[name] = Boolean(def.default);
  const unknown = [];
  const raw = new URLSearchParams(search).get('flags');
  if (raw) {
    for (const token of raw.split(',')) {
      const t = token.trim();
      if (!t) continue;
      const off = t.startsWith('-');
      const name = off ? t.slice(1) : t;
      if (name in registry) flags[name] = !off;
      else unknown.push(name);
    }
  }
  return { flags, unknown };
}

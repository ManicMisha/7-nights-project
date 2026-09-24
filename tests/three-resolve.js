// Node module resolve hook: 'three' → vendor/three.module.min.js.
const THREE_URL = new URL('../vendor/three.module.min.js', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
  return nextResolve(specifier, context);
}

// Loaded before the tests (see package.json). Resolves the bare 'three'
// import to the vendored build, mirroring the import map in index.html, so
// modules that use Three.js (like world.js) can be tested in Node.
import { register } from 'node:module';

register('./three-resolve.js', import.meta.url);

# Vendored browser dependencies

- `echarts-5.5.0.min.js`: Apache ECharts 5.5.0 distribution build.
- Source: https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js
- SHA-256: `42F8329D989B6F6539DD2B15BBDF0D82025762AC112FBB60DC57B27D7BCF3946`
- Upstream: https://github.com/apache/echarts
- License: Apache-2.0; see `ECHARTS-LICENSE.txt`.

The file is served locally so the footprint maps do not depend on a third-party
CDN at runtime.

- `astronomy-engine-2.1.19.min.js`: Astronomy Engine 2.1.19 browser build.
- Source: https://www.npmjs.com/package/astronomy-engine/v/2.1.19
- SHA-256: `F41139A87941EA017AB902B954C9389FA27EA72083D7FAB4971756D7769D14E6`
- Upstream: https://github.com/cosinekitty/astronomy
- License: MIT; the upstream copyright and license notice are retained in the
  minified distribution file.

- `three-0.160.1.min.js`: Three.js 0.160.1 classic browser distribution build.
- Source: https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js
- SHA-256: `170C6789F43217C96B3170F4B42FAFE135DE7F7CD48497A4218F9757EE1D49FA`
- Upstream: https://github.com/mrdoob/three.js
- License: MIT; see `THREE-LICENSE.txt`, copied from the 0.160.1 package license at
  https://cdn.jsdelivr.net/npm/three@0.160.1/LICENSE.

Three.js is served locally for the optional, transparent 3D environment layer;
the existing starfield and astronomy renderers remain separate. The page does
not contact the dependency CDN at runtime.

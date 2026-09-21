(() => {
  'use strict';
  const defaults = {
    spaceship: { sky: 'night', observation: { position: [0, 1.68, -9.95], yaw: 0, pitch: .03 }, pilot: { seat: [0, 1.68, -9.95], exit: [1.65, 1.68, -8.75] } },
    shelter: { sky: 'night', observation: { position: [0, 1.68, -1.6], yaw: 0, pitch: .02 } },
    hogwarts: { sky: 'clear', observation: { position: [0, 1.72, 6], yaw: 0, pitch: .03 } },
    snowmountain: { sky: 'clear', observation: { position: [0, 1.72, 5], yaw: 0, pitch: .03 } }
  };
  const identity = [0, 0, 0, 1], layers = new Map(), tierOrder = ['high', 'medium', 'low'];
  let manifest = null, manifestRequest, active = 'spaceship', mode = 'observe', skyMode = 'night', quality = 'auto';
  let status = 'preview', tier = null, error = '', production = 'draft', requestToken = 0, controller, requestKey = '';
  let recoveryTier = null, recoveryBlocked = false, recoveryLossRecorded = false;
  let pose = { orientation: identity, shipOrientation: identity, width: 1, height: 1, fov: 1, visible: false };
  const vertexSource = 'attribute vec2 vertex; varying vec2 screenPosition; void main(){screenPosition=vertex;gl_Position=vec4(vertex,0.0,1.0);}';
  const fragmentSource = 'precision highp float; uniform sampler2D panorama; uniform vec4 orientation; uniform vec2 viewport; uniform float tangent; varying vec2 screenPosition; vec3 rotate(vec4 rotation,vec3 direction){return direction+2.0*cross(rotation.xyz,cross(rotation.xyz,direction)+rotation.w*direction);} void main(){vec3 ray=normalize(vec3(screenPosition.x*viewport.x/viewport.y*tangent,screenPosition.y*tangent,1.0));ray=rotate(orientation,ray);vec2 uv=vec2(fract(atan(ray.x,ray.z)/6.28318530718+0.5),0.5-asin(clamp(ray.y,-1.0,1.0))/3.14159265359);gl_FragColor=texture2D(panorama,uv);}';
  const api = window.NightPanorama = {
    get ready() { return status === 'prerendered' || status === 'preview'; },
    getScene(id) { return { ...defaults[id], ...manifest?.scenes?.[id] }; },
    getSnapshot() { return { ready: api.ready, status, quality, tier, recoveryTier, production, scene: active, skyMode, error }; },
    setMode(value) { if (!['observe', 'explore', 'sky'].includes(value)) return false; mode = value; syncSkyAlignment(); visibility(); return true; },
    setSkyMode(value) { if (!['night', 'clear', 'dusk'].includes(value)) return false; skyMode = value; return load(); },
    setQuality(value) { if (!['auto', ...tierOrder].includes(value)) return false; quality = value; recoveryTier = null; recoveryBlocked = false; recoveryLossRecorded = false; requestKey = ''; return load(); },
    select(id, phase = defaults[id]?.sky) { if (!defaults[id]) return false; active = id; skyMode = phase || 'night'; return load(); },
    render(next) {
      pose = { ...pose, ...next }; visibility();
      if (mode !== 'observe' || !pose.visible || status !== 'prerendered') return;
      for (const [name, layer] of layers) {
        if (!layer.texture || layer.lost) continue;
        const orientation = name === 'sky' ? multiply(pose.shipOrientation || identity, pose.orientation) : pose.orientation;
        draw(layer, multiply(conjugate(layer.orientation), orientation));
      }
    },
    coversSky() { return mode === 'observe' && pose.visible && status === 'prerendered' && Boolean(layers.get('sky')?.texture) && !layers.get('sky')?.lost; },
    canSeeSky(horizontal, vertical) {
      const layer = layers.get('scene');
      if (mode !== 'observe' || !pose.visible || status !== 'prerendered' || !layer?.alpha || !layer.texture || layer.lost) return true;
      const uv = project(horizontal, vertical, pose, multiply(conjugate(layer.orientation), pose.orientation));
      const column = Math.min(layer.maskWidth - 1, Math.floor(uv[0] * layer.maskWidth));
      const row = Math.min(layer.maskHeight - 1, Math.floor(uv[1] * layer.maskHeight));
      return layer.alpha[(row * layer.maskWidth + column) * 4 + 3] < 32;
    },
    projection: { rotate, multiply, project },
    dispose() { controller?.abort(); requestToken++; for (const layer of layers.values()) disposeLayer(layer); layers.clear(); window.SceneSky?.setAlignment?.(null); }
  };
  function multiply(first, second) {
    return [first[3]*second[0]+first[0]*second[3]+first[1]*second[2]-first[2]*second[1], first[3]*second[1]-first[0]*second[2]+first[1]*second[3]+first[2]*second[0], first[3]*second[2]+first[0]*second[1]-first[1]*second[0]+first[2]*second[3], first[3]*second[3]-first[0]*second[0]-first[1]*second[1]-first[2]*second[2]];
  }
  function conjugate(rotation) { return [-rotation[0], -rotation[1], -rotation[2], rotation[3]]; }
  function rotate(rotation, direction) {
    const cross = [2*(rotation[1]*direction[2]-rotation[2]*direction[1]), 2*(rotation[2]*direction[0]-rotation[0]*direction[2]), 2*(rotation[0]*direction[1]-rotation[1]*direction[0])];
    return [direction[0]+rotation[3]*cross[0]+rotation[1]*cross[2]-rotation[2]*cross[1], direction[1]+rotation[3]*cross[1]+rotation[2]*cross[0]-rotation[0]*cross[2], direction[2]+rotation[3]*cross[2]+rotation[0]*cross[1]-rotation[1]*cross[0]];
  }
  function project(horizontal, vertical, camera, orientation = camera.orientation) {
    const tangent = Math.tan(camera.fov / 2), direction = [horizontal * camera.width / Math.max(1, camera.height) * tangent, vertical * tangent, 1];
    const length = Math.hypot(...direction), ray = rotate(orientation, direction.map(value => value / length));
    return [((Math.atan2(ray[0], ray[2]) / (Math.PI * 2) + .5) % 1 + 1) % 1, Math.max(0, Math.min(1, .5 - Math.asin(Math.max(-1, Math.min(1, ray[1]))) / Math.PI))];
  }
  function notify() { window.dispatchEvent(new CustomEvent('nightpanorama:change', { detail: api.getSnapshot() })); }
  function safeUrl(path) {
    const url = new URL(path, document.baseURI);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Panorama assets must use this site origin.');
    return url.href;
  }
  async function getManifest() {
    if (manifest) return manifest;
    if (!manifestRequest) manifestRequest = fetch(safeUrl('assets/life/panoramas/manifest.json')).then(response => {
      if (!response.ok) throw new Error('Panorama manifest unavailable.');
      return response.json();
    }).then(value => {
      if (value.version !== 1 || value.projection !== 'equirectangular' || !value.scenes) throw new Error('Unsupported panorama manifest.');
      manifest = value; return value;
    }).finally(() => { manifestRequest = null; });
    return manifestRequest;
  }
  async function load() {
    if (recoveryBlocked) return false;
    const key = [active, skyMode, quality].join(':');
    if (key === requestKey && (status === 'loading' || status === 'prerendered' || status === 'preview')) return true;
    requestKey = key; const token = ++requestToken;
    const Controller = window.AbortController || globalThis.AbortController;
    controller?.abort(); controller = Controller ? new Controller() : { signal: undefined, abort() {} }; const signal = controller.signal;
    for (const layer of layers.values()) releaseTexture(layer);
    syncSkyAlignment();
    status = 'loading'; tier = null; error = ''; visibility(); notify();
    try {
      const catalog = await getManifest(); if (token !== requestToken) return false;
      const entry = catalog.scenes[active], variant = entry?.variants?.[skyMode];
      window.dispatchEvent(new CustomEvent('nightpanorama:metadata', { detail: { scene: active, metadata: api.getScene(active) } }));
      production = variant?.production || entry?.production || 'draft';
      if (!variant?.tiers || !Object.values(variant.tiers).some(value => value?.src)) { status = 'preview'; notify(); return false; }
      const foreground = await loadLayer('scene', variant, token, signal);
      if (token !== requestToken) return false;
      if (variant.sky?.tiers) await loadLayer('sky', variant.sky, token, signal);
      if (token !== requestToken) return false;
      tier = foreground.tier; status = 'prerendered'; recoveryLossRecorded = false; syncSkyAlignment(); visibility(); notify(); return true;
    } catch (failure) {
      if (token !== requestToken || failure.name === 'AbortError') return false;
      for (const layer of layers.values()) releaseTexture(layer);
      syncSkyAlignment();
      status = 'error'; error = failure.message; requestKey = ''; visibility(); notify(); return false;
    }
  }
  function ensureLayer(name) {
    const existing = layers.get(name); if (existing && !existing.lost) return existing;
    if (existing?.lost) throw new Error('Panorama graphics are waiting to be restored.');
    const canvas = document.getElementById(name === 'sky' ? 'panoramaSkyCanvas' : 'panoramaCanvas');
    if (!canvas) throw new Error('Panorama canvas unavailable.');
    const context = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!context) throw new Error('Panorama graphics unavailable.');
    const precision = context.getShaderPrecisionFormat(context.FRAGMENT_SHADER, context.HIGH_FLOAT);
    const fragment = precision?.precision ? fragmentSource : fragmentSource.replace('precision highp float;', 'precision mediump float;');
    const shaders = [compile(context, context.VERTEX_SHADER, vertexSource), compile(context, context.FRAGMENT_SHADER, fragment)];
    const program = context.createProgram(); shaders.forEach(shader => context.attachShader(program, shader)); context.linkProgram(program); shaders.forEach(shader => context.deleteShader(shader));
    if (!context.getProgramParameter(program, context.LINK_STATUS)) { context.deleteProgram(program); throw new Error('Panorama shader unavailable.'); }
    const buffer = context.createBuffer(); context.bindBuffer(context.ARRAY_BUFFER, buffer); context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), context.STATIC_DRAW);
    const layer = { canvas, context, program, buffer, texture: null, alpha: null, orientation: identity, lost: false, uniforms: Object.fromEntries(['panorama','orientation','viewport','tangent'].map(name => [name, context.getUniformLocation(program, name)])), vertex: context.getAttribLocation(program, 'vertex'), maxTexture: context.getParameter(context.MAX_TEXTURE_SIZE) };
    layers.set(name, layer);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); layer.lost = true; controller?.abort(); requestToken++; requestKey = '';
      if (!recoveryLossRecorded) {
        const currentTier = tier || layer.tier || preferredTier(), nextIndex = tierOrder.indexOf(currentTier) + 1;
        recoveryTier = tierOrder[Math.min(tierOrder.length - 1, nextIndex)];
        recoveryBlocked = nextIndex >= tierOrder.length; recoveryLossRecorded = true;
      }
      for (const candidate of layers.values()) releaseTexture(candidate);
      status = 'error'; tier = null;
      error = recoveryBlocked ? 'Panorama graphics were interrupted at the lowest quality. Select a quality to retry.' : 'Panorama graphics were interrupted. Retrying at a lower quality after restoration.';
      syncSkyAlignment(); visibility(); notify();
    }, { once: true });
    canvas.addEventListener('webglcontextrestored', () => {
      if (layers.get(name) === layer) layers.delete(name);
      if (recoveryBlocked || [...layers.values()].some(candidate => candidate.lost)) return;
      requestKey = ''; load();
    }, { once: true });
    return layer;
  }
  function compile(context, type, source) {
    const shader = context.createShader(type); context.shaderSource(shader, source); context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) { context.deleteShader(shader); throw new Error('Panorama shader compilation failed.'); }
    return shader;
  }
  async function loadLayer(name, variant, token, signal) {
    const layer = ensureLayer(name);
    const preferred = preferredTier();
    const choices = tierOrder.slice(tierOrder.indexOf(preferred)).filter(name => variant.tiers[name]?.src && (!variant.tiers[name].width || variant.tiers[name].width <= layer.maxTexture));
    if (!choices.length) throw new Error('No panorama tier fits this device.');
    let lastError;
    for (const selected of choices) {
      let bitmap;
      try {
        const response = await fetch(safeUrl(variant.tiers[selected].src), signal ? { signal } : undefined);
        if (!response.ok) throw new Error('Panorama resource failed to load.');
        bitmap = await decode(await response.blob());
        if (token !== requestToken || signal?.aborted) { bitmap.close?.(); throw new DOMException('Aborted', 'AbortError'); }
        if (bitmap.width > layer.maxTexture || bitmap.height > layer.maxTexture) throw new Error('Panorama exceeds the device texture limit.');
        if (Math.abs(bitmap.width / bitmap.height - 2) > .02) throw new Error('Panorama must use a 2:1 equirectangular image.');
        upload(layer, bitmap); layer.orientation = normalized(variant.orientation || identity);
        if (name === 'scene') buildMask(layer, bitmap);
        layer.observation = variant.observation || null;
        layer.tier = selected; bitmap.close?.(); return layer;
      } catch (failure) { bitmap?.close?.(); if (token === requestToken) releaseTexture(layer); if (failure.name === 'AbortError' || token !== requestToken) throw new DOMException('Aborted', 'AbortError'); lastError = failure; }
    }
    throw lastError || new Error('Panorama resource unavailable.');
  }
  function normalized(rotation) { if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite)) throw new Error('Invalid panorama orientation.'); const length = Math.hypot(...rotation); if (length < .00001) throw new Error('Invalid panorama orientation.'); return rotation.map(value => value / length); }
  async function decode(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    return new Promise((resolve, reject) => { const url = URL.createObjectURL(blob), image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Panorama image decoding failed.')); }; image.src = url; });
  }
  function upload(layer, bitmap) {
    const context = layer.context, texture = context.createTexture(); context.bindTexture(context.TEXTURE_2D, texture);
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false); context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR); context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE); context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, bitmap);
    if (context.getError() !== context.NO_ERROR) { context.deleteTexture(texture); throw new Error('Panorama texture upload failed.'); }
    layer.texture = texture;
  }
  function buildMask(layer, bitmap) {
    const canvas = document.createElement('canvas'); canvas.width = Math.min(1024, bitmap.width); canvas.height = Math.round(canvas.width / 2);
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Panorama sky mask unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); layer.alpha = context.getImageData(0, 0, canvas.width, canvas.height).data; layer.maskWidth = canvas.width; layer.maskHeight = canvas.height;
  }
  function preferredTier() {
    const requested = quality === 'auto' ? (window.matchMedia('(pointer: coarse)').matches || navigator.connection?.saveData ? 'low' : 'medium') : quality;
    return recoveryTier ? tierOrder[Math.max(tierOrder.indexOf(requested), tierOrder.indexOf(recoveryTier))] : requested;
  }
  function draw(layer, orientation) {
    const context = layer.context, effectiveQuality = preferredTier(), budget = effectiveQuality === 'high' ? 8294400 : effectiveQuality === 'low' ? 1228800 : 3686400;
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(budget / Math.max(1, pose.width * pose.height)));
    const width = Math.max(1, Math.round(pose.width * ratio)), height = Math.max(1, Math.round(pose.height * ratio));
    if (layer.canvas.width !== width || layer.canvas.height !== height) { layer.canvas.width = width; layer.canvas.height = height; }
    context.viewport(0, 0, width, height); context.useProgram(layer.program); context.bindBuffer(context.ARRAY_BUFFER, layer.buffer); context.enableVertexAttribArray(layer.vertex); context.vertexAttribPointer(layer.vertex, 2, context.FLOAT, false, 0, 0);
    context.activeTexture(context.TEXTURE0); context.bindTexture(context.TEXTURE_2D, layer.texture); context.uniform1i(layer.uniforms.panorama, 0); context.uniform4fv(layer.uniforms.orientation, orientation); context.uniform2f(layer.uniforms.viewport, width, height); context.uniform1f(layer.uniforms.tangent, Math.tan(pose.fov / 2)); context.drawArrays(context.TRIANGLES, 0, 3);
  }
  function visibility() { for (const layer of layers.values()) layer.canvas.style.visibility = mode === 'observe' && pose.visible && status === 'prerendered' && layer.texture && !layer.lost ? 'visible' : 'hidden'; }
  function syncSkyAlignment() {
    const sky = layers.get('sky'), observation = sky?.observation;
    if (mode !== 'observe' || status !== 'prerendered' || !sky?.texture || sky.lost || observation?.kind !== 'art-direction-calibration' || observation.coordinateSystem !== 'sky-y-up-plus-z' || !Array.isArray(observation.sunDirection) || observation.sunDirection.length !== 3 || !observation.sunDirection.every(Number.isFinite)) { window.SceneSky?.setAlignment?.(null); return; }
    const sunDirection = rotate(sky.orientation, observation.sunDirection);
    if (window.SceneSky?.setAlignment?.({ ...observation, sunDirection }) === false) window.SceneSky.setAlignment(null);
  }
  function releaseTexture(layer) { if (layer.texture && !layer.lost) layer.context.deleteTexture(layer.texture); layer.texture = null; layer.alpha = null; layer.canvas.style.visibility = 'hidden'; }
  function disposeLayer(layer) { releaseTexture(layer); if (!layer.lost) { layer.context.deleteBuffer(layer.buffer); layer.context.deleteProgram(layer.program); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load(), { once: true }); else load();
})();

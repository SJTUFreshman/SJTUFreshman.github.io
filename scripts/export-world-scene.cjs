#!/usr/bin/env node
/* Export a procedural NightWorld builder into a renderer-neutral JSON scene. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require(path.join(__dirname, '..', 'assets', 'vendor', 'three-0.160.1.min.js'));

const sceneId = process.argv[2];
const outputFile = process.argv[3] || path.join('assets', 'life', 'panoramas', `${sceneId || 'scene'}.scene.json`);
const validScenes = ['spaceship', 'shelter', 'hogwarts', 'snowmountain'];
if (!validScenes.includes(sceneId)) {
  console.error(`Usage: node scripts/export-world-scene.cjs <${validScenes.join('|')}> [output.json]`);
  process.exit(2);
}

function createCanvasContext(canvas) {
  let currentPath = [];
  return {
    fillStyle: '#ffffff', strokeStyle: '#ffffff', font: '16px monospace', lineWidth: 1,
    fillText(text, horizontal, vertical) { canvas.commands.push({ type: 'text', text, horizontal, vertical, color: this.fillStyle, font: this.font }); },
    fillRect(horizontal, vertical, width, height) { canvas.commands.push({ type: 'rect', horizontal, vertical, width, height, color: this.fillStyle }); },
    beginPath() { currentPath = []; },
    moveTo(horizontal, vertical) { currentPath.push([horizontal, vertical]); },
    lineTo(horizontal, vertical) { currentPath.push([horizontal, vertical]); },
    stroke() { if (currentPath.length > 1) canvas.commands.push({ type: 'line', points: currentPath.slice(), color: this.strokeStyle, width: this.lineWidth }); },
    arc(horizontal, vertical, radius, start, end) { for (let step = 0; step <= 48; step++) { const angle = start + (end - start) * step / 48; currentPath.push([horizontal + Math.cos(angle) * radius, vertical + Math.sin(angle) * radius]); } },
    clearRect() {}, measureText() { return { width: 0 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  };
}
global.window = global;
global.THREE = THREE;
global.document = { createElement(type) {
  if (type !== 'canvas') return { style: {}, setAttribute() {} };
  const canvas = { width: 768, height: 128, commands: [], getContext() { return this.context; } };
  canvas.context = createCanvasContext(canvas);
  return canvas;
} };
global.Image = function Image() {};
global.window.document = global.document;

THREE.TextureLoader = class TextureLoader {
  load(url) { const texture = new THREE.Texture(); texture.userData.sourcePath = url; return texture; }
};
for (const file of ['19-world-kit.js', '21-world-outdoors.js', '22-world-interiors.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'life', 'scripts', file), 'utf8'), { filename: file });
}
const originalModel = window.NightWorldKit.model;
const originalLabel = window.NightWorldKit.label;
window.NightWorldKit.label = function captureLabel(parent, text, x, y, z, width, color) {
  const mesh = originalLabel.call(this, parent, text, x, y, z, width, color);
  mesh.userData.renderLabel = { text, width: width || 2, color: color || '#c9d5df' };
  return mesh;
};
window.NightWorldKit.model = function captureModel(parent, id, x, y, z, options) {
  const holder = originalModel.call(this, parent, id, x, y, z, options);
  const modelPath = path.join(__dirname, '..', 'assets', 'life', 'models', id, `${id}_1k.gltf`);
  if (fs.existsSync(modelPath)) {
    holder.userData.assetId = id;
    holder.userData.assetOptions = { height: options?.height || null, rotationY: options?.rotationY || 0 };
    options?.onLoad?.(holder);
  }
  return holder;
};

const world = window.NightWorldBuilders[sceneId](window.NightWorldKit);
world.group.updateMatrixWorld(true);
const geometryIds = new Map();
const geometries = [];
const materials = [];
const materialIds = new Map();
const assets = [];
const lights = [];
const labels = [];
const screens = [];
const objects = [];
function materialId(material) {
  if (!material) return null;
  if (materialIds.has(material)) return materialIds.get(material);
  const id = materials.length;
  const color = material.color ? material.color.getHex() : 0xffffff;
  const value = { id, color: `#${color.toString(16).padStart(6, '0')}`, roughness: material.roughness ?? 0.85,
    metalness: material.metalness ?? 0, opacity: material.opacity ?? 1, transparent: Boolean(material.transparent),
    emissive: material.emissive ? `#${material.emissive.getHex().toString(16).padStart(6, '0')}` : '#000000',
    emissiveIntensity: material.emissiveIntensity ?? 0, textures: {} };
  for (const [key, texture] of [['baseColor', material.map], ['normal', material.normalMap], ['roughness', material.roughnessMap]]) {
    if (texture?.userData?.sourcePath) value.textures[key] = { path: texture.userData.sourcePath, repeat: texture.repeat.toArray() };
  }
  materials.push(value); materialIds.set(material, id); return id;
}
function geometryId(geometry) {
  if (geometryIds.has(geometry)) return geometryIds.get(geometry);
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const value = { id: geometries.length, positions: Array.from(position.array), normals: geometry.getAttribute('normal') ? Array.from(geometry.getAttribute('normal').array) : [], colors: geometry.getAttribute('color') ? Array.from(geometry.getAttribute('color').array) : [], uvs: geometry.getAttribute('uv') ? Array.from(geometry.getAttribute('uv').array) : [], indices: geometry.index ? Array.from(geometry.index.array) : [] };
  geometries.push(value); geometryIds.set(geometry, value.id); return value.id;
}
world.group.traverse(object => {
  let ancestor = object;
  while (ancestor) {
    if (!ancestor.visible) return;
    if (ancestor.parent?.isLOD && ancestor.parent.levels[0]?.object !== ancestor) return;
    ancestor = ancestor.parent;
  }
  object.updateMatrixWorld(true);
  if (object.userData.assetId) assets.push({ id: object.userData.assetId, options: object.userData.assetOptions || {}, matrix: Array.from(object.matrixWorld.elements) });
  if (object.isLight) lights.push({ type: object.type, color: `#${object.color.getHex().toString(16).padStart(6, '0')}`, intensity: object.intensity, distance: object.distance || 0, position: object.getWorldPosition(new THREE.Vector3()).toArray() });
  if (object.userData.renderLabel) labels.push({ ...object.userData.renderLabel, matrix: Array.from(object.matrixWorld.elements) });
  else if (object.userData.screenCanvas) screens.push({ width: object.geometry.parameters.width, height: object.geometry.parameters.height, canvasWidth: object.userData.screenCanvas.width, canvasHeight: object.userData.screenCanvas.height, commands: object.userData.screenCanvas.commands, matrix: Array.from(object.matrixWorld.elements) });
  else if (object.isMesh && object.geometry) objects.push({ type: 'mesh', geometry: geometryId(object.geometry), material: materialId(Array.isArray(object.material) ? object.material[0] : object.material), matrix: Array.from(object.matrixWorld.elements), castShadow: Boolean(object.castShadow), receiveShadow: Boolean(object.receiveShadow) });
});
const observation = world.previewCamera || { position: world.spawn, yaw: world.yaw || 0, pitch: world.pitch || 0 };
const output = { version: 1, coordinateSystem: 'three-y-up-right-handed', scene: sceneId, environment: world.environment || { phase: 'night' }, observation, spawn: world.spawn, bounds: world.bounds, geometry: geometries, materials, objects, lights, assets, labels, screens, exportedAt: new Date().toISOString() };
const target = path.resolve(process.cwd(), outputFile);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(output));
console.log(JSON.stringify({ scene: sceneId, output: target, meshes: objects.length, geometries: geometries.length, materials: materials.length, assets: assets.length, lights: lights.length }));

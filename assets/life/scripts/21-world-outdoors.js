/*
 * Night environments.  These builders deliberately know nothing about the
 * site's content sections: they are quiet places to inhabit beneath the sky.
 */
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) return;
  const K = window.NightWorldKit;
  if (!K) return;

  const warm = 0xffc98b;
  const cool = 0x819ab7;
  const stone = 0x252a32;
  const darkWood = 0x30241f;
  const brass = 0x92704e;

  function base(id, description) {
    const world = {
      id,
      group: K.group(),
      spawn: [0, 1.72, 26], yaw: 0, pitch: 0.1,
      bounds: { minX: -145, maxX: 145, minZ: -145, maxZ: 145 },
      colliders: [], interactions: [],
      description,
      _sitting: false, _sitDistance: 0, _seat: null,
      update: function (dt, t, player) {
        if (this._sitting && player && (Math.hypot(player.x-this._seat[0],player.z-this._seat[1])>.05 || player.y>1.4)) {
          player.y = 1.72; this._sitting = false;
        }
      }, dispose: function () { K.disposeGroup(this.group); }
    };
    return world;
  }
  function interaction(world, id, en, zhCN, zhTW, x, y, z, radius, action) {
    const response = action;
    if (typeof action !== 'function') action = function () { return response; };
    const item = K.interaction(world, {
      id, label: { en, 'zh-CN': zhCN, 'zh-TW': zhTW },
      position: [x, y, z], radius: radius || 3, action
    });
    if (item && world.interactions.indexOf(item) < 0) world.interactions.push(item);
    return item;
  }
  function collider(world, x, z, w, d) {
    const c = { x, z, w, d };
    world.colliders.push(c);
    return c;
  }
  function pathway(world, points, color) {
    const route=K.group();world.group.add(route);
    const material=new THREE.MeshStandardMaterial({color:color||0x4b4741,roughness:1,transparent:true,opacity:.065,depthWrite:false});
    for(let i=1;i<points.length;i++){
      const from=points[i-1],to=points[i],distance=Math.hypot(to[0]-from[0],to[1]-from[1]);
      const strip=new THREE.Mesh(new THREE.PlaneGeometry(1.6,distance),material);
      strip.rotation.set(-Math.PI/2,0,Math.atan2(to[0]-from[0],to[1]-from[1]));
      strip.position.set((from[0]+to[0])*.5,.008,(from[1]+to[1])*.5);strip.receiveShadow=true;route.add(strip);
    }
    return route;
  }
  function shrub(parent, x, z, scale, color) {
    const g = K.group(); g.position.set(x, 0, z); g.scale.setScalar(scale || 1);
    parent.add(g);
    // Overlapping irregular foliage is much softer at a distance than a
    // single faceted icosahedron. Tiny stems also catch the warm edge light.
    for (let i = 0; i < 7; i++) {
      const a = i * 2.399, r = .18 + (i % 3) * .13;
      K.sphere(g, Math.cos(a) * r, .24 + (i % 4) * .12, Math.sin(a) * r,
        .30 + (i % 3) * .13, color || 0x1a2a2a, { roughness: .96 });
    }
    K.cylinder(g, 0, .18, 0, .035, .055, .36, 0x3b312a, 7, { roughness: 1 });
    return g;
  }
  function grassTuft(parent, x, z, scale, color) {
    const g = K.group(); g.position.set(x, 0, z); g.scale.setScalar(scale || 1); parent.add(g);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.399, lean = .15 + (i % 3) * .06;
      const blade = K.box(g, Math.cos(a) * .12, .22, Math.sin(a) * .12, .025, .45 + (i % 2) * .2, .025, color || 0x344b3d, { roughness: 1, rotationY: a });
      blade.rotation.z = Math.cos(a) * lean;
    }
    return g;
  }
  function reeds(parent, x, z, scale, color) {
    const g=K.group();g.position.set(x,0,z);g.scale.setScalar(scale||1);parent.add(g);
    const reedColor=color||0x263e35;
    for(let i=0;i<13;i++){
      const a=i*2.399, length=.48+(i%5)*.12, stem=K.cylinder(g,Math.cos(a)*.16,.24,Math.sin(a)*.16,.018,.028,length,reedColor,6,{roughness:1});
      stem.rotation.z=Math.cos(a)*(.15+(i%3)*.08);stem.rotation.x=Math.sin(a)*(.15+(i%4)*.06);
      if(i%3===0)K.sphere(g,Math.cos(a)*.16,.49,Math.sin(a)*.16,.065,0x5c6d55,{roughness:1});
    }
    return g;
  }
  function texturedGround(g, type, color, size) {
    const mesh = K.ground(g, color, size || 900, { roughness: .98 });
    const repeat=(size||900)/3.5;
    K.surface(mesh, type, repeat, repeat);
    return mesh;
  }
  function embankment(parent, x, z, sx, sz, color) {
    const mound = K.sphere(parent, x, -.16, z, 1, color || 0x1b2726, { roughness: .98 });
    mound.scale.set(sx, .45, sz); return mound;
  }
  function naturalTree(parent, x, z, h, tint) {
    const g=K.group();g.position.set(x,0,z);parent.add(g);
    K.surface(K.cylinder(g,0,h*.47,0,.032,.15,h*.94,0x3a302a,12,{roughness:.98}),'wood',1,4);
    // Individually tapered needle sprays, batched in one mesh per tree. No
    // cones or opaque foliage spheres: the night is visible between branches.
    const vertices=[],colors=[],twigs=[],color=new THREE.Color(tint||0x294334);
    const rand=n=>{const s=Math.sin(n*127.1+x*17.7+z*3.1)*43758.5453;return s-Math.floor(s);};
    g.rotation.set((rand(401)-.5)*.085,rand(407)*Math.PI,(rand(409)-.5)*.09);
    for(let layer=0;layer<12;layer++)for(let branch=0;branch<7;branch++){
      const seed=layer*117+branch*19;
      const angle=branch*Math.PI*2/7+layer*2.39+(rand(seed+3)-.5)*.75;
      const y=h*(.18+layer*.064+(rand(seed+7)-.5)*.088);
      const length=h*(.31-layer*.023)*(.62+rand(seed+11)*.75);
      const direction=new THREE.Vector3(Math.cos(angle),-.21+layer*.022+(rand(seed+13)-.5)*.26,Math.sin(angle));
      twigs.push(0,y,0,direction.x*length,y+direction.y*length,direction.z*length);
      for(let section=1;section<=10;section++)for(let spray=0;spray<12;spray++){
        const needleSeed=seed*541+section*31+spray*7;
        const t=Math.min(1,(section-.7+rand(needleSeed))/10), phase=spray*Math.PI/6+angle+rand(needleSeed+1)*.9, r=(1-t*.50)*h*(.05+rand(needleSeed+2)*.04);
        const center=new THREE.Vector3(direction.x*length*t+Math.cos(phase)*r,y+direction.y*length*t+Math.sin(phase)*r*.94+(rand(needleSeed+4)-.5)*h*.028,direction.z*length*t+Math.sin(phase)*r);
        const needleAngle=phase+rand(needleSeed+5)*.8, needleLength=h*(.022+rand(needleSeed+6)*.028);
        const tip=center.clone().add(new THREE.Vector3(Math.cos(needleAngle)*needleLength,needleLength*(.15+rand(needleSeed+8)),Math.sin(needleAngle)*needleLength));
        const needleWidth=h*(.006+rand(needleSeed+9)*.003);
        const side=new THREE.Vector3(-Math.sin(needleAngle)*needleWidth,0,Math.cos(needleAngle)*needleWidth);
        vertices.push(center.x-side.x,center.y,center.z-side.z,tip.x,tip.y,tip.z,center.x+side.x,center.y,center.z+side.z);
        const variation=.62+rand(section*17+spray+layer)*.55;
        for(let k=0;k<3;k++)colors.push(color.r*variation,color.g*variation,color.b*variation);
      }
    }
    const leafGeometry=new THREE.BufferGeometry();leafGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));leafGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));leafGeometry.computeVertexNormals();
    const needles=new THREE.Mesh(leafGeometry,new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.98,side:THREE.DoubleSide}));needles.castShadow=true;needles.receiveShadow=true;g.add(needles);
    const twigGeometry=new THREE.BufferGeometry();twigGeometry.setAttribute('position',new THREE.Float32BufferAttribute(twigs,3));g.add(new THREE.LineSegments(twigGeometry,new THREE.LineBasicMaterial({color:0x1c231c,transparent:true,opacity:.3})));
    return g;
  }
  function scannedRock(parent, x, z, height, angle) {
    const fallback=K.rock(parent,x,z,height);
    return K.model(parent,'rock_07',x,-.02,z,{height:height,rotationY:angle||0,onLoad:()=>{fallback.visible=false;}});
  }
  function scannedPine(parent,x,z,height,angle=0) {
    const levels=new THREE.LOD();levels.position.set(x,0,z);parent.add(levels);
    const fallback=naturalTree(levels,0,0,height,0x263b30);fallback.rotation.y=angle;
    levels.addLevel(fallback,0);
    K.model(levels,'pine_sapling_small_variant_01',0,0,0,{height,rotationY:angle,onLoad(holder){
      levels.levels.length=0;
      levels.addLevel(holder,0);
      levels.addLevel(fallback,typeof COARSE_POINTER!=='undefined'&&COARSE_POINTER?28:52);
    }});
    return levels;
  }
  function fire(parent, x, z, scale) {
    const g = K.group(); g.position.set(x, 0, z); g.scale.setScalar(scale || 1); parent.add(g);
    const fallbackPit=K.group();g.add(fallbackPit);
    if(K.model)K.model(g,'stone_fire_pit',0,0,0,{height:.43,onLoad(){fallbackPit.visible=false;}});
    // Crossed charred logs (with end grain) and a low ember bed.
    for(let i=0;i<3;i++) { const log=K.cylinder(g,0,.22+i*.04,0,.08,.09,.95,darkWood,12,{roughness:.95}); log.rotation.set(Math.PI/2,.08,i*Math.PI/3); }
    for(let i=0;i<12;i++){const a=i*Math.PI/6;K.rock(fallbackPit,Math.cos(a)*.78,Math.sin(a)*.78,.22+(i%3)*.035);}
    const ember=K.cylinder(g,0,.145,0,.36,.40,.075,0x421d14,20,{emissive:0xb52e11,emissiveIntensity:.7});
    const flameMat = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      uniforms:{uTime:{value:0},uTint:{value:new THREE.Color(0xff7a20)}},
      vertexShader:'uniform float uTime; varying vec2 vUv; void main(){vUv=uv; vec3 p=position; p.x += sin(uTime*5.0+position.y*8.0)*0.045*position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
      fragmentShader:`uniform float uTime; uniform vec3 uTint; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 a=floor(p),b=fract(p);b=b*b*(3.-2.*b);return mix(mix(hash(a),hash(a+vec2(1.,0.)),b.x),mix(hash(a+vec2(0.,1.)),hash(a+vec2(1.)),b.x),b.y);}
        void main(){
          float y=vUv.y, n=noise(vec2(vUv.x*5.,y*7.-uTime*2.6));
          float fine=noise(vec2(vUv.x*13.+uTime*.22,y*16.-uTime*5.));
          float sway=sin(y*8.-uTime*3.)*.095*y;
          float width=(1.-y)*(.4+.13*n);
          float shape=width-abs(vUv.x-.5+sway)+(n-.5)*.19*y+(fine-.5)*.04;
          float alpha=smoothstep(-.04,.095,shape)*smoothstep(0.,.1,y)*pow(1.-y,.6);
          float core=smoothstep(.04,.3,shape)*(1.-y);
          vec3 c=mix(vec3(.94,.075,.005),uTint,core*.55+.25);
          c=mix(c,vec3(1.,.76,.24),core*.75);
          gl_FragColor=vec4(c,alpha*.72);
        }` });
    const flames=[];
    for(let i=0;i<4;i++) { const f=new THREE.Mesh(new THREE.PlaneGeometry(.72+(i%2)*.22,1.35+(i%3)*.2,1,8),flameMat); f.position.set((i-1.5)*.16,.76+(i%2)*.08,(i%2)*.14-.08); f.rotation.y=(i%2)*Math.PI/2; f.userData.baseY=f.position.y; flames.push(f);g.add(f); }
    const sparks=[];
    for(let i=0;i<10;i++)sparks.push(K.sphere(g,0,.5,0,.014+(i%3)*.006,0xffb84a,{emissive:0xff7823,emissiveIntensity:2.5}));
    const light = K.point(g, 0, 1.2, 0, 0xffa348, 2.4, 9);
    g.userData.flames = flames; g.userData.sparks=sparks;g.userData.light = light; g.userData.flameMat=flameMat; g.userData.ember=ember;
    return g;
  }
  function updateFire(g,t,lit=true){
    g.userData.flames.forEach(f=>{if(f.material.uniforms&&f.material.uniforms.uTime)f.material.uniforms.uTime.value=t;});
    g.userData.flames.forEach((f,i)=>{const pulse=.9+.12*Math.sin(t*8+i*1.7)+.06*Math.sin(t*13+i);f.visible=lit;f.scale.set(1,pulse,1);f.position.y=f.userData.baseY+(pulse-1)*.22;f.rotation.z=Math.sin(t*5+i)*.08;});
    g.userData.sparks.forEach((s,i)=>{const age=(t*.5+i/8)%1;s.visible=lit;s.position.set(Math.sin(i*2.4+t*.4)*age*.5,.7+age*1.8,Math.cos(i*2.4+t*.3)*age*.5);});
    g.userData.light.intensity=(lit?12:1.4)*(1+.08*Math.sin(t*8));
  }
  function arch(parent, x, z, h, w, color) {
    const g = K.group(); g.position.set(x, 0, z); parent.add(g);
    K.box(g, -w / 2, h / 2, 0, .42, h, .42, color || stone, { roughness: .9 });
    K.box(g, w / 2, h / 2, 0, .42, h, .42, color || stone, { roughness: .9 });
    K.box(g, 0, h - .21, 0, w + .8, .42, .42, color || stone, { roughness: .9 });
    return g;
  }
  function lanterns(parent, xs, z, h, color) {
    // Paths commonly provide one z value per lamp.  Accept both a shared z
    // and a parallel array, keeping all transforms finite.
    xs.forEach((x, i) => K.lamp(parent, x, Array.isArray(z) ? z[i] : z, h || 2.5, color || warm));
  }
  function sitAction(world, text, seatY, seat) {
    return function () {
      if (!world.player) return text;
      if (world._sitting) { world.player.y = 1.72; world._sitting = false; return text; }
      const anchor=typeof seat==='function'?seat():seat;
      if(anchor){world.player.x=anchor[0];world.player.z=anchor[1];}
      world.player.y = seatY || 1.08; world._sitting = true; world._sitDistance = world.player.distance;world._seat=[world.player.x,world.player.z];
      return text;
    };
  }
  function seatAnchor(node, offset) {
    return function(){
      node.updateWorldMatrix(true,false);
      const position=node.localToWorld(new THREE.Vector3(0,0,offset??.15));
      return [position.x,position.z];
    };
  }

  function transit() {
    const w = base('transit', {
      en: 'A silent transfer ground under a permanent night. Follow the lamps, sit by the fire, and let the distance stay empty.',
      'zh-CN': '永夜下寂静的中转地。沿着灯光前行，在篝火边坐一会儿，让空旷保持空旷。',
      'zh-TW': '永夜下寂靜的中轉地。沿著燈光前行，在營火邊坐一會兒，讓空曠保持空曠。'
    });
    const g = w.group;
    w.spawn=[0,1.72,16];
    texturedGround(g, 'soil', 0x101923, 900);
    // Low horizon islands keep the sky dominant while giving the walker scale;
    // rounded berms read as earth instead of a ring of placeholder boxes.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 120 + (i % 3) * 18;
      const h = 2 + (i % 5) * 1.8;
      embankment(g, Math.cos(a) * r, Math.sin(a) * r, 8 + (i % 4) * 3, 6 + (i % 3) * 2, 0x121a23).position.y += h * .25;
      if (i % 2 === 0) shrub(g, Math.cos(a) * r + 3, Math.sin(a) * r - 2, 1.4, 0x18282a);
      if (i % 5 === 0) scannedRock(g, Math.cos(a) * r * .94, Math.sin(a) * r * .94, 1.7 + (i % 3) * .35, a);
    }
    const path = [[0, 35], [0, 13], [6, -7], [17, -27], [31, -43], [50, -51]];
    pathway(w, path);
    lanterns(g, [-2, 2, 5, 12, 22, 34, 46], [30, 14, -5, -23, -39, -48, -53], 2.5, warm);
    // A small transit shelter and an intentionally unused notice board.
    const slab=K.box(g, 0, -.13, 21, 8.5, .3, 4, stone, { roughness: .95 }); K.surface(slab,'concrete',3,2);
    const shelterWall=K.box(g, 0, 2.7, 19.2, 8.2, 5, .18, 0x1e2934, { roughness: .8 }); K.surface(shelterWall,'metal',3,2);
    K.box(g, -3.8, 1.35, 21, .3, 2.7, 3.6, brass, { roughness: .65, metalness: .35 });
    K.box(g, 3.8, 1.35, 21, .3, 2.7, 3.6, brass, { roughness: .65, metalness: .35 });
    const roof=K.box(g, 0, 5.3, 21, 8.8, .22, 4.2, 0x171e28, { roughness: .8 }); K.surface(roof,'metal',4,2);
    // Glulam frame, flashing and rain lip make the shelter read as a built
    // structure when the player gets close instead of a stack of primitives.
    for (const x of [-3.45, 3.45]) { K.box(g,x,5.48,21,.16,.09,4.25,0x5d6265,{metalness:.55,roughness:.4}); K.box(g,x,2.68,19.06,.22,5.2,.14,0x80624d,{roughness:.74}); }
    for (const z of [19.2,20.1,21,21.9,22.8]) K.box(g,0,5.43,z,8.5,.05,.045,0x596168,{metalness:.52,roughness:.45});
    for (const x of [-2.8,0,2.8]) { K.box(g,x,4.4,19.05,.08,1.55,.08,0x4e5960,{metalness:.45}); }
    // Back wall is collidable; the broad front remains an actual doorway.
    collider(w, 0, 19.2, 8.2, .25);
    collider(w, -3.8, 21, .35, 3.6); collider(w, 3.8, 21, .35, 3.6);
    const shelterBench=K.bench(g, 0, 20.5, 0); shelterBench.traverse(o=>{if(o.isMesh&&o.material)K.surface(o,'wood',2,1);});
    K.label(g, 'NIGHT TRANSFER', 0, 3.1, 19.32, 4.6, '#aab5c1');
    interaction(w, 'shelter-seat', 'Sit / stand by the shelter', '在候车亭坐下 / 起身', '在候車亭坐下 / 起身', 0, 1, 20.5, 2.3,
      sitAction(w, { en: 'The timetable has no destinations tonight. Move to stand up.', 'zh-CN': '今晚的时刻表没有目的地。移动即可起身。', 'zh-TW': '今晚的時刻表沒有目的地。移動即可起身。' },1.08,seatAnchor(shelterBench,.2)));
    // The camp is a visual pause, not a menu.
    const campFire = fire(g, 10, -11, 1.1); let fireLit = true;
    const campBench=K.bench(g, 7.4, -11, -.45); K.bench(g, 13.1, -11, .45);
    shrub(g, 5.3, -14, .8); shrub(g, 15, -8, .7);
    collider(w, 10, -11, 2.4, 2.4);
    interaction(w, 'transit-fire', 'Tend / bank the fire', '拨旺 / 拢住篝火', '撥旺 / 攏住營火', 10, 1, -11, 3.4, function () {
      fireLit = !fireLit;
      return fireLit ? { en: 'The fire catches again.', 'zh-CN': '火焰重新燃起。', 'zh-TW': '火焰重新燃起。' } : { en: 'Only the quiet embers remain.', 'zh-CN': '只剩安静的余烬。', 'zh-TW': '只剩安靜的餘燼。' };
    });
    interaction(w, 'camp-seat', 'Sit / stand by the fire', '在火边坐下 / 起身', '在火邊坐下 / 起身', 7.4, 1, -11, 2.2,
      sitAction(w, { en: 'Warmth, distance, and a sky without a ceiling.', 'zh-CN': '温度，远方，没有天花板的夜空。', 'zh-TW': '溫度，遠方，沒有天花板的夜空。' },1.08,seatAnchor(campBench)));
    // A distant ring of standing stones gives the route a destination.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      K.box(g, 50 + Math.cos(a) * 5, 1.5 + (i % 2) * .35, -52 + Math.sin(a) * 5, .85, 3 + (i % 2) * .7, .75, 0x343740, { roughness: 1, rotationY: a });
    }
    arch(g, 50, -52, 5.6, 5.5, 0x30343d);
    interaction(w, 'stone-ring', 'Standing stones', '石环', '石環', 50, 1, -48.4, 4, { en: 'Nothing waits beyond the stones. That is the point.', 'zh-CN': '石环之外没有等待着什么，这正是它的意义。', 'zh-TW': '石環之外沒有等待著什麼，這正是它的意義。' });
    const posture = w.update;
    w.update = function (dt, t, player) {
      posture.call(this, dt, t, player);
      updateFire(campFire,t,fireLit);
    };
    return w;
  }

  function lakeshore() {
    const w = base('lakeshore', {
      en: 'A quiet shore where the stars reach the water before dawn can find it.',
      'zh-CN': '寂静的湖岸，星光先于黎明抵达水面。',
      'zh-TW': '寂靜的湖岸，星光先於黎明抵達水面。'
    });
    const g = w.group;
    w.bounds={minX:-76,maxX:76,minZ:-34,maxZ:65};
    w.spawn=[-12,1.72,3];w.yaw=0;w.pitch=.015;
    texturedGround(g, 'soil', 0x121b21, 900);
    const waveUniforms={nightWaveTime:{value:0}};
    // Water begins at the shore; the only walking route beyond it is the dock.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(280, 190, 72, 48), new THREE.MeshStandardMaterial({ color: 0x071218, roughness: .36, metalness: .19, transparent: true, opacity: .96, emissive: 0x030810, emissiveIntensity: .12 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, .025, -112); g.add(water);
    water.material.onBeforeCompile=shader=>{
      shader.uniforms.nightWaveTime=waveUniforms.nightWaveTime;
      shader.vertexShader='varying vec3 vShorePosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvShorePosition=position;');
      shader.fragmentShader=`uniform float nightWaveTime;
        varying vec3 vShorePosition;
        float shoreHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
        float shoreNoise(vec2 p){vec2 a=floor(p),b=fract(p);b=b*b*(3.0-2.0*b);return mix(mix(shoreHash(a),shoreHash(a+vec2(1.0,0.0)),b.x),mix(shoreHash(a+vec2(0.0,1.0)),shoreHash(a+vec2(1.0)),b.x),b.y);}
        `+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float fresnel=pow(1.0-max(dot(normalize(vNormal),normalize(vViewPosition)),0.0),3.0);
        float brokenLight=shoreNoise(vShorePosition.xy*vec2(.8,2.7)+vec2(nightWaveTime*.035,nightWaveTime*.11));
        diffuseColor.rgb+=vec3(.009,.012,.017)*fresnel*(.35+brokenLight*.65);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec2 waterPoint=vShorePosition.xy*vec2(1.4,2.5)+vec2(nightWaveTime*.07,nightWaveTime*.16);
        float slopeX=shoreNoise(waterPoint+vec2(.08,0.0))-shoreNoise(waterPoint-vec2(.08,0.0));
        float slopeY=shoreNoise(waterPoint+vec2(0.0,.08))-shoreNoise(waterPoint-vec2(0.0,.08));
        normal=normalize(normal+vec3(slopeX*.13,slopeY*.1,0.0));`);
    };
    water.material.customProgramCacheKey=()=> 'night-shore-ripples-v1';
    const bank=K.box(g, 0, -.04, 4, 160, .1, 43, 0x403d38, { roughness: .98 }); K.surface(bank,'soil',18,7);
    // The water edge is slightly irregular, built from low shore stones.
    for (let i = -17; i <= 17; i++) {
      const x = i * 4.6;
      const shoreRock = (i % 6 === 0)
        ? scannedRock(g, x, -17 - Math.sin(i * .9) * 1.6, .75 + (Math.abs(i) % 3) * .18, i * .4)
        : K.rock(g, x, -17 - Math.sin(i * .9) * 1.6, .55 + (Math.abs(i) % 3) * .18);
    }
    for(let i=0;i<22;i++){
      const x=-67+i*6.35+(i%2)*.8,z=-14.2+Math.sin(i*1.7)*1.25;
      reeds(g,x,z,.72+(i%4)*.1,i%3?0x29453b:0x3a5640);
    }
    collider(w,-85.8,-98,128.4,162);collider(w,66.8,-98,166.4,162);
    collider(w,-19,-34,5.2,.2);
    const dock = K.group(); g.add(dock);
    for (let i = 0; i < 11; i++) {
      const plank=K.box(dock, 0, .035, -i * 3.2, 5.2, .07, 3.05, 0x4e4135, { roughness: .97,metalness:0 }); K.surface(plank,'wood',3,1);
      plank.material.roughnessMap=null;plank.material.roughness=.96;plank.material.metalness=0;plank.material.color.setHex(i%3===0?0x8a8983:0xa19b8e);plank.material.normalScale.set(.32,.32);
      const beamL=K.box(dock, -2.2, -.14, -i * 3.2, .3, .6, 2.9, 0x352d29, { roughness: .9 });
      const beamR=K.box(dock, 2.2, -.14, -i * 3.2, .3, .6, 2.9, 0x352d29, { roughness: .9 }); K.surface(beamL,'wood',1,2);K.surface(beamR,'wood',1,2);
      for(let j=0;j<6;j++)K.box(dock,-2.3+j*.9,.075,-i*3.2,.024,.012,3,0x2a2523);
      if(i>4){K.cylinder(dock,-2.5,.55,-i*3.2,.07,.08,1.2,darkWood,8);K.cylinder(dock,2.5,.55,-i*3.2,.07,.08,1.2,darkWood,8);}
    }
    dock.position.set(-19, 0, 0);
    for (let i = 0; i < 4; i++) K.lamp(g, -21.4, -i * 9, 2.25, 0xa4c8de);
    const dockBench=K.bench(g,-19,-30,Math.PI);
    interaction(w, 'lake-dock', 'Sit / stand at the dock', '在栈桥坐下 / 起身', '在棧橋坐下 / 起身', -19, 1, -30, 2.5,
      sitAction(w,{ en: 'Water moves beneath the planks. Move to stand up.', 'zh-CN': '水从木板下缓缓流过，移动即可起身。', 'zh-TW': '水從木板下緩緩流過，移動即可起身。' },1.08,seatAnchor(dockBench)));
    // A low rowboat rests on the shore.
    const boat = K.group(); g.add(boat); boat.position.set(28, .2, -8); boat.rotation.y = .26;
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b3c30, roughness: .9, side: THREE.DoubleSide }));
    hull.scale.set(3.6, .62, 1.15); hull.rotation.x = Math.PI; boat.add(hull);
    K.surface(hull,'wood',3,1);
    for(let i=0;i<7;i++){
      const x=-2.8+i*.93, width=Math.sqrt(Math.max(.05,1-(x/3.6)*(x/3.6)))*1.15;
      const rib=K.box(boat,x,-.12,0,.065,.18,width*1.9,0x6c5240,{roughness:.9});rib.rotation.z=x*.08;
    }
    for(const x of [-1.6,.3,1.7])K.surface(K.box(boat,x,.15,0,.4,.09,1.6,0x75614f,{roughness:.82}),'wood',1,2);
    K.box(boat, 0, .45, 0, 2.2, .13, .25, 0x372722, { roughness: 1 });
    K.box(boat,0,.62,0,4.8,.075,.075,0x4a3329,{rotationY:.3});K.box(boat,2.3,.62,-.7,.6,.09,.26,0x644837,{rotationY:.3});
    collider(w,28,-8,7.3,3.6);
    let boatRock=0;
    interaction(w, 'lake-boat', 'Nudge the old rowboat', '轻推岸边的小船', '輕推岸邊的小船', 28, 1, -6, 3, function(){boatRock=1;return { en: 'The wooden hull rocks and settles in the sand.', 'zh-CN': '木船晃了晃，又静静停在沙滩上。', 'zh-TW': '木船晃了晃，又靜靜停在沙灘上。' };});
    // A simple beacon on the opposite shore gives depth.
    K.cylinder(g, 48, 6, -61, 1.3, 1.05, 12, 0x252b32, 12, { roughness: .75 });
    K.cylinder(g, 48, 12.3, -61, 1.65, 1.65, .32, 0x6f5541, 16, { metalness: .25 });
    K.cylinder(g,48,13.02,-61,1.02,1.02,1.35,0xffce87,48,{emissive:0xffb45d,emissiveIntensity:1.25,roughness:.22});
    K.cylinder(g,48,13.88,-61,.12,1.72,.48,0x343c42,48,{metalness:.6,roughness:.44});
    for(let index=0;index<8;index++){
      const angle=index*Math.PI/4;
      K.cylinder(g,48+Math.cos(angle)*1.13,13.04,-61+Math.sin(angle)*1.13,.045,.045,1.55,0x3c464a,16,{metalness:.6});
    }
    K.point(g, 48, 12.5, -61, warm, 1.4, 28);
    K.label(g, 'LOW WATER BEACON', 44.7, 13.4, -60.7, 3, '#98b5c4');
    pathway(w, [[0, 30], [0, 13], [-8, 5], [-19, -2]], 0x4b4741);
    lanterns(g, [-2, 2, -5, -11, -17], [28, 18, 10, 3, -5], 2.3, warm);
    for (let i = 0; i < 12; i++) shrub(g, -69 + i * 12.5, 20 + Math.sin(i) * 3, .5 + (i % 3) * .18, 0x15252a);
    for(let i=0;i<42;i++)grassTuft(g,-73+i*3.5,-12+Math.sin(i*2.31)*2,.7+(i%4)*.12,0x34483c);
    for(let i=0;i<12;i++)naturalTree(g,-90+i*17,-87-Math.sin(i*1.4)*12,8+(i%4)*2,0x1e342e);
    scannedPine(g,-29,-4,5.4,.8);scannedPine(g,-5,-7,4.7,2.6);scannedPine(g,12,1,6.1,4.2);
    const posture=w.update,positions=water.geometry.attributes.position;
    w.update=function(dt,t,player){
      posture.call(this,dt,t,player);
      waveUniforms.nightWaveTime.value=t;
      boatRock=Math.max(0,boatRock-dt*.32);boat.rotation.z=Math.sin(t*4)*boatRock*.075;
      for(let i=0;i<positions.count;i++)positions.setZ(i,Math.sin(positions.getX(i)*.11+t*.65)*Math.cos(positions.getY(i)*.16+t*.4)*.035);
      positions.needsUpdate=true;water.geometry.computeVertexNormals();
    };
    return w;
  }

  function observatory() {
    const w = base('observatory', {
      en: 'A weathered hilltop observatory, open to the night and no longer expecting a visitor.',
      'zh-CN': '风雨侵蚀的山顶天文台，向夜空敞开，不再等待访客。',
      'zh-TW': '風雨侵蝕的山頂天文台，向夜空敞開，不再等待訪客。'
    });
    const g = w.group;
    texturedGround(g, 'soil', 0x171b23, 900);
    // Low hill rings fade into the horizon.
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12; const r = 62 + (i % 3) * 10;
      if (i % 3 === 0) scannedRock(g, Math.cos(a) * r, Math.sin(a) * r, 2 + (i % 2) * .8, a);
      else K.rock(g, Math.cos(a) * r, Math.sin(a) * r, 2 + (i % 2) * .8);
    }
    K.surface(K.cylinder(g, 0, -.1, -5, 16, 16, .22, 0x30353d, 96, { roughness: .95 }),'concrete',7,7);
    // Expansion joints and the steel rail sit flush with the walkable slab.
    for(let i=0;i<12;i++){const a=i*Math.PI/6;const seam=K.box(g,Math.cos(a)*8,.021,-5+Math.sin(a)*8,15.6,.006,.018,0x252b30,{rotationY:-a});}
    const track=new THREE.Mesh(new THREE.TorusGeometry(11.72,.065,10,96),new THREE.MeshStandardMaterial({color:0x53575a,metalness:.64,roughness:.5}));track.rotation.x=Math.PI/2;track.position.set(0,6.78,-5);g.add(track);
    // Open roof, four supports, and a ring that remains walkable.
    const roof = K.group(); g.add(roof); roof.position.set(0, 0, -5);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      if(i===2)continue;
      K.box(roof, Math.cos(a) * 11.6, 3.5, Math.sin(a) * 11.6, .62, 7, .62, 0x34383e, { roughness: .92 });
      collider(w,Math.cos(a)*11.6,-5+Math.sin(a)*11.6,.7,.7);
    }
    for(let segment=0;segment<32;segment++){
      const angle=(segment+.5)*Math.PI*2/32;
      if(Math.abs(angle-Math.PI/2)<.38||Math.abs(angle)<.21||Math.abs(angle-Math.PI)<.21||Math.abs(angle-Math.PI*2)<.21)continue;
      const positionX=Math.cos(angle)*11.6,positionZ=Math.sin(angle)*11.6;
      K.surface(K.box(roof,positionX,1.2,positionZ,2.29,2.4,.45,0x484b4a,{rotationY:Math.PI/2-angle}),'concrete',1,1);
      K.box(roof,positionX,2.44,positionZ,2.34,.14,.57,0x636963,{rotationY:Math.PI/2-angle,roughness:.78});
      collider(w,positionX,positionZ-5,Math.abs(Math.sin(angle))*2.29+Math.abs(Math.cos(angle))*.45,Math.abs(Math.cos(angle))*2.29+Math.abs(Math.sin(angle))*.45);
    }
    for(const side of [-1,1]){
      K.surface(K.box(roof,side*3.65,3.45,11.1,.46,6.9,.57,0x515451),'concrete',1,3);
      collider(w,side*3.65,6.1,.46,.57);
      K.box(roof,side*3.64,2.15,10.72,.22,.48,.15,0xd99c64,{emissive:0xffb877,emissiveIntensity:.65,roughness:.65});
      K.point(g,side*3.64,2.35,5.45,warm,1.35,11);
    }
    K.box(roof,0,6.65,11.1,7.76,.38,.57,0x575f60,{metalness:.42,roughness:.55});
    const ring = new THREE.Mesh(new THREE.TorusGeometry(11.7, .32, 8, 48), new THREE.MeshStandardMaterial({ color: 0x4a4d51, roughness: .9 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 6.9; roof.add(ring);
    // Two separated side segments leave a broad, real meridian slit overhead.
    const domeShell=K.group();roof.add(domeShell);
    for (let s = -1; s <= 1; s += 2) {
      const slit=.38,start=(s<0?-Math.PI/2:Math.PI/2)+slit*.5,length=Math.PI-slit;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(11.7, 72, 32, start, length, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x454950, roughness: .84, side: THREE.DoubleSide }));
      dome.scale.y = .75; dome.position.set(0,6.85,0); domeShell.add(dome);
      K.surface(dome,'metal',5,3);
      // Rolled standing seams follow the curvature, with an inner roof frame
      // visible in silhouette against the actual opening.
      for(let j=0;j<=14;j++){
        const phi=start+j*length/14,points=[];
        for(let k=0;k<=32;k++){const theta=k*Math.PI/64;points.push(new THREE.Vector3(-11.735*Math.cos(phi)*Math.sin(theta),6.85+11.735*Math.cos(theta)*.75,11.735*Math.sin(phi)*Math.sin(theta)));}
        const curve=new THREE.CatmullRomCurve3(points),rib=new THREE.Mesh(new THREE.TubeGeometry(curve,25,.038,6,false),new THREE.MeshStandardMaterial({color:0x697175,metalness:.58,roughness:.5}));domeShell.add(rib);
      }
    }
    K.cylinder(g,0,1.4,-5,.75,1,2.8,brass,20,{metalness:.42,roughness:.55});
    for(const side of [-1,1]){
      K.cylinder(g,side*2.25,.3,-5,.19,.25,.6,0x363e43,24,{metalness:.55,roughness:.5});
      const shade=K.cylinder(g,side*2.25,.68,-5,.25,.13,.22,0x74716a,24,{metalness:.4,roughness:.45});shade.rotation.z=side*-.32;
      K.point(g,side*2.25,1.15,-4.9,side<0?0xb8cbe0:0xffc98b,2,10);
    }
    K.sphere(g,0,2.8,-5,.64,0x687d89,{metalness:.55,roughness:.32});
    collider(w,0,-5,2.1,2.1);
    const mount=K.group();mount.position.set(0,2.8,-5);g.add(mount);
    const scope=K.group();mount.add(scope);scope.rotation.x=-.5;
    const tube=K.cylinder(scope,0,0,0,.45,.5,5.2,0x5d6570,24,{metalness:.5,roughness:.44});tube.rotation.x=Math.PI/2;
    const rim=K.cylinder(scope,0,0,-2.55,.59,.59,.22,0x313842,24,{metalness:.62,roughness:.35});rim.rotation.x=Math.PI/2;
    const lens=K.cylinder(scope,0,0,-2.68,.5,.5,.025,0x163344,24,{metalness:.6,roughness:.1,emissive:0x15374c,emissiveIntensity:.2});lens.rotation.x=Math.PI/2;
    const eyepiece=K.cylinder(scope,0,0,2.85,.14,.14,.58,0x252c34,16);eyepiece.rotation.x=Math.PI/2;
    for(const z of [-1.2,1.2]){const clamp=K.cylinder(scope,0,0,z,.515,.515,.17,0x343c44,48,{metalness:.6,roughness:.36});clamp.rotation.x=Math.PI/2;for(const x of [-.53,.53])K.sphere(scope,x,0,z,.052,0x819097,{metalness:.75,roughness:.3});}
    const axis=K.cylinder(mount,0,0,0,.22,.22,2.2,0x394650,36,{metalness:.65,roughness:.38});axis.rotation.z=Math.PI/2;
    for(const x of [-.8,.8])K.box(g,x,2.1,-5,.25,1.8,.65,0x38464e,{metalness:.6,roughness:.48});
    const handwheel=K.group();handwheel.position.set(1.24,2.2,-4.8);g.add(handwheel);
    const wheel=new THREE.Mesh(new THREE.TorusGeometry(.38,.034,10,48),new THREE.MeshStandardMaterial({color:0x8a7051,metalness:.72,roughness:.4}));wheel.rotation.y=Math.PI/2;handwheel.add(wheel);
    for(let i=0;i<3;i++){const spoke=K.cylinder(handwheel,0,0,0,.025,.025,.74,brass,12,{metalness:.64,roughness:.4});spoke.rotation.x=i*Math.PI/3;}
    K.cylinder(handwheel,0,0,0,.08,.08,.16,brass,24,{metalness:.6});
    const finder=K.cylinder(scope,.51,.28,-.5,.075,.09,1.1,0x66747c,24,{metalness:.5});finder.rotation.x=Math.PI/2;
    let scopeTarget=-.5,roofTarget=0;
    interaction(w, 'observatory-scope', 'Turn the telescope handwheel', '转动望远镜手轮', '轉動望遠鏡手輪', 0, 1.65, -2, 2.8, function(){scopeTarget=scopeTarget<-.7?-.38:-.95;return { en: 'The old gears lift the telescope toward the open slit.', 'zh-CN': '旧齿轮带着镜筒，缓缓转向敞开的穹顶。', 'zh-TW': '舊齒輪帶著鏡筒，緩緩轉向敞開的穹頂。' };});
    const terraceBench=K.bench(g, 13, -4, -Math.PI / 2);
    K.box(g, -13, .8, -4, 2.8, 1.5, 1.2, 0x242930, { roughness: .9 });
    K.box(g, -13, 1.58, -4, 2.1, .06, .75, 0x91b4c8, { emissive: 0x244154, emissiveIntensity: .45, roughness: .45 });
    collider(w,-13,-4,2.8,1.2);
    interaction(w, 'observatory-console', 'Rotate the observatory dome', '转动天文台穹顶', '轉動天文台穹頂', -13, 1.6, -3, 2.6, function(){roofTarget+=Math.PI/2;return { en: 'The dome turns slowly, opening a different strip of sky.', 'zh-CN': '穹顶缓缓转动，露出另一片夜空。', 'zh-TW': '穹頂緩緩轉動，露出另一片夜空。' };});
    interaction(w,'observatory-seat','Sit / stand on the terrace','在露台坐下 / 起身','在露台坐下 / 起身',13,1,-4,2.4,sitAction(w,{en:'A quiet seat beside the old instrument. Move to stand up.','zh-CN':'在旧仪器旁坐一会儿，移动即可起身。','zh-TW':'在舊儀器旁坐一會兒，移動即可起身。'},1.08,seatAnchor(terraceBench,.2)));
    const camp=fire(g, 0, 25, .72);collider(w,0,25,1.7,1.7);w.spawn=[0,1.72,35];
    K.bench(g, -3, 25, 0); K.bench(g, 3, 25, Math.PI);
    pathway(w, [[0, 42], [0, 26], [0, 12], [0, -1]], 0x47443e);
    lanterns(g, [-2, 2, -2, 2, -2], [38, 31, 22, 13, 4], 2.6, warm);
    for (let i = 0; i < 10; i++) naturalTree(g, -48 + i * 10.5, -31 - (i % 2) * 4, 7 + (i % 3) * 2, i%2?0x1d3531:0x182b2a);
    scannedPine(g,-21,16,5.3,1.4);scannedPine(g,23,12,6.2,3.5);
    const posture=w.update;
    w.update=function(dt,t,player){posture.call(this,dt,t,player);updateFire(camp,t);const change=(scopeTarget-scope.rotation.x)*Math.min(1,dt*1.6);scope.rotation.x+=change;handwheel.rotation.x+=change*10;domeShell.rotation.y+=(roofTarget-domeShell.rotation.y)*Math.min(1,dt*.35);};
    return w;
  }

  function loop() {
    const w = base('loop', {
      en: 'A path that returns to itself. Walk far enough and the place will remember you differently.',
      'zh-CN': '一条回到自身的路。走得足够远，这个地方会以不同的方式记住你。',
      'zh-TW': '一條回到自身的路。走得夠遠，這個地方會以不同的方式記住你。'
    });
    const g = w.group;
    texturedGround(g, 'soil', 0x151923, 900);
    pathway(w, [[0, 43], [0, 8], [18, -24], [36, -46], [28, -67], [0, -80]], 0x47433f);
    pathway(w, [[0, 43], [-4, 9], [-22, -25], [-37, -48], [-30, -67], [0, -80]], 0x47433f);
    for (let i = 0; i < 12; i++) {
      const z = 37 - i * 9;
      K.lamp(g, (i % 2 ? 2.2 : -2.2) + Math.sin(i) * 1.2, z, 2.5, i % 3 ? warm : 0x9dbad0);
    }
    // Three objects are moved/revealed on each loop phase.
    const moving = K.group(); g.add(moving);
    const archNode = arch(moving, 0, -79, 5.2, 5, 0x343744);
    const bell = K.group(); moving.add(bell); bell.position.set(24, 0, -37);
    for(const x of [-.9,.9])K.box(bell,x,1.9,0,.17,3.8,.2,darkWood);
    K.box(bell,0,3.8,0,2.3,.22,.3,darkWood);
    const bellSwing=K.group();bellSwing.position.y=3.55;bell.add(bellSwing);
    K.cylinder(bellSwing,0,-.5,0,.22,.63,1,brass,20,{roughness:.5,metalness:.4});
    K.cylinder(bellSwing,0,-1.02,0,.66,.66,.1,brass,20,{roughness:.5,metalness:.4});
    K.sphere(bellSwing,0,-1.07,0,.13,0x2d3035,{metalness:.5});
    K.cylinder(bellSwing,0,-1.65,0,.018,.018,1.25,0x99876e,8);
    K.point(bell,0,2.2,0,warm,.8,7);
    const chair = K.group(); moving.add(chair); chair.position.set(-20, 0, -35); const wanderingBench=K.bench(chair, 0, 0, .2);
    let bellEnergy=0;
    const bellAction=interaction(w, 'loop-bell', 'Pull the bell rope', '拉动悬钟的绳子', '拉動懸鐘的繩子', 24, 2, -37, 3, function(){bellEnergy=1;return { en: 'The bell swings in the still night.', 'zh-CN': '悬钟在寂静的夜色里来回摇荡。', 'zh-TW': '懸鐘在寂靜的夜色裡來回搖蕩。' };});
    interaction(w, 'loop-arch', 'The returning arch', '回返之门', '回返之門', 0, 1, -75, 3.5, { en: 'The stones are warm from a sun this world has never seen.', 'zh-CN': '石头带着温度，像来自这个世界从未见过的太阳。', 'zh-TW': '石頭帶著溫度，像來自這個世界從未見過的太陽。' });
    const chairAction=interaction(w, 'loop-chair', 'Sit / stand on the wandering bench', '在游移的长椅坐下 / 起身', '在遊移的長椅坐下 / 起身', -20, 1, -35, 2.8,sitAction(w,{en:'You are certain it was facing the other way. Move to stand up.','zh-CN':'你确定它刚才是朝着另一个方向的，移动即可起身。','zh-TW':'你確定它剛才是朝著另一個方向的，移動即可起身。'},1.08,seatAnchor(wanderingBench)));
    for (let i = 0; i < 14; i++) shrub(g, -56 + i * 8.5, -6 + Math.sin(i * 1.4) * 7, .5 + (i % 2) * .22, i % 3 ? 0x182329 : 0x24223a);
    for (let i=0;i<11;i++) {
      const x=-52+i*10.2,z=-6-Math.abs(Math.sin(i*1.13))*13,height=6+(i%4)*1.5;
      if(i===3||i===6||i===8)scannedPine(g,x,z,height,i*1.7);
      else naturalTree(g,x,z,height,i%3?0x1b302e:0x202d3b);
    }
    const camp=fire(g, 0, 17, .9);
    const campBlock=collider(w,0,17,2,2);
    const bellBlocks=[collider(w,23.1,-37,.25,.3),collider(w,24.9,-37,.25,.3)];
    collider(w,-2.5,-79,.5,.5);collider(w,2.5,-79,.5,.5);
    w._phase = 0; w._cooldown = 0;
    const posture=w.update;
    w.update = function (dt, t, player) {
      posture.call(this,dt,t,player);updateFire(camp,t);
      bellEnergy=Math.max(0,bellEnergy-dt*.15);bellSwing.rotation.z=Math.sin(t*5)*bellEnergy*.36;
      this._cooldown = Math.max(0, this._cooldown - (dt || 0));
      if (!player || this._cooldown > 0) return;
      // The dark arch is a true spatial seam: crossing it returns the walker to
      // the approach, then rearranges the quiet props and light colours.
      if (player.z < -86) {
        player.z = 39; player.x = 0; this._phase = (this._phase + 1) % 3; this._cooldown = 2.2;
        const shift = this._phase === 1 ? 1 : (this._phase === 2 ? -1 : 0);
        bell.position.set(24 + shift * 17, 0, -37 + shift * 8);
        chair.position.set(-20 - shift * 14, 0, -35 - shift * 7);
        chair.rotation.y=this._phase*Math.PI*.5;
        archNode.rotation.y=this._phase*Math.PI;
        camp.position.set(shift*11,0,17-this._phase*3);campBlock.x=camp.position.x;campBlock.z=camp.position.z;
        bellAction.position=[bell.position.x,2,bell.position.z];chairAction.position=[chair.position.x,1,chair.position.z];
        bellBlocks.forEach((c,i)=>{c.x=bell.position.x+(i?.9:-.9);c.z=bell.position.z;});
      }
    };
    w._loopPhase = function () { return w._phase; };
    return w;
  }

  function terrainHeight(horizontal, depth, snow) {
    const ridges = snow
      ? [[-220,-320,320,185,245], [175,-420,495,190,245], [460,-160,390,170,205], [-480,155,350,230,255], [165,455,415,190,245]]
      : [[-430,-365,150,320,215], [240,-440,245,290,230], [580,-230,235,220,320], [-420,370,180,270,210], [290,390,150,300,250]];
    let elevation = snow ? -180 : -57;
    for (const [centerX, centerZ, height, width, length] of ridges) {
      const distance = Math.hypot((horizontal-centerX)/width,(depth-centerZ)/length);
      elevation += height*Math.exp(-Math.pow(distance,1.45));
    }
    const detail = Math.sin(horizontal*.031+depth*.019)*Math.cos(depth*.047-horizontal*.007)*13
      + Math.sin(horizontal*.093-depth*.065)*Math.cos(depth*.071)*4.2
      + Math.sin(horizontal*.241+depth*.192)*1.4;
    const shelf = 1-Math.min(1,Math.max(0,(Math.hypot(horizontal/1.15,depth)-18)/24));
    return (elevation+detail)*(1-shelf*shelf*(3-2*shelf));
  }

  function mountainTerrain(parent, snow) {
    const geometry = new THREE.PlaneGeometry(1500,1500,220,220);
    geometry.rotateX(-Math.PI/2);
    const positions = geometry.attributes.position;
    const colors = [], stoneColor = new THREE.Color(snow?0x646d75:0x536354);
    const snowColor = new THREE.Color(snow?0xe5edf0:0x8a9b7a);
    for (let vertex=0;vertex<positions.count;vertex++) {
      const horizontal=positions.getX(vertex),depth=positions.getZ(vertex),height=terrainHeight(horizontal,depth,snow);
      positions.setY(vertex,height-.1);
      const slope=Math.hypot(terrainHeight(horizontal+2,depth,snow)-height,terrainHeight(horizontal,depth+2,snow)-height)*.5;
      const variation=.5+.5*Math.sin(horizontal*.033+depth*.031)*Math.sin(depth*.069);
      const covering=snow?Math.max(0,Math.min(1,1.28-slope*.66+variation*.22)):Math.max(0,Math.min(1,.78-slope*.6+variation*.2));
      const tint=stoneColor.clone().lerp(snowColor,covering).multiplyScalar(.83+variation*.17);
      colors.push(tint.r,tint.g,tint.b);
    }
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.94,metalness:0});
    const terrain=new THREE.Mesh(geometry,material);terrain.receiveShadow=true;terrain.castShadow=true;parent.add(terrain);
    K.surface(terrain,'concrete',100,100);terrain.material.color.setHex(0xffffff);
    return terrain;
  }

  function ridgeFence(world, snow) {
    for (const side of [-1,1]) {
      for (let index=0;index<6;index++) {
        const depth=-3+index*3.3,horizontal=side*(12+Math.sin(index*.65)*.9);
        const post=K.cylinder(world.group,horizontal,.58,depth,.044,.055,1.16,snow?0x555c61:0x61554a,20,{metalness:snow?.62:.08,roughness:.73});
        if(index<5) {
          const nextX=side*(12+Math.sin((index+1)*.65)*.9),nextZ=depth+3.3;
          const points=[new THREE.Vector3(horizontal,.87,depth),new THREE.Vector3((horizontal+nextX)/2,.71,(depth+nextZ)/2),new THREE.Vector3(nextX,.87,nextZ)];
          const rope=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),12,.015,6,false),new THREE.MeshStandardMaterial({color:snow?0x778084:0x8a806e,roughness:.84,metalness:snow?.45:0}));
          world.group.add(rope);
        }
        post.userData.ridgeMarker=true;
      }
    }
    collider(world,-13,7,1,25);collider(world,13,7,1,25);collider(world,0,-5,27,.3);
  }

  function gothicWindow(parent,horizontal,vertical,depth,width,height) {
    const shape=new THREE.Shape();shape.moveTo(-width/2,0);shape.lineTo(-width/2,height*.67);
    shape.quadraticCurveTo(-width*.45,height*.88,0,height);shape.quadraticCurveTo(width*.45,height*.88,width/2,height*.67);
    shape.lineTo(width/2,0);shape.closePath();
    const geometry=new THREE.ShapeGeometry(shape,12);
    const windowMesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x26383c,roughness:.45,metalness:.12,side:THREE.DoubleSide}));
    windowMesh.position.set(horizontal,vertical,depth);parent.add(windowMesh);
    K.box(parent,horizontal,vertical+height*.44,depth+.025,.06,height*.83,.045,0x909082,{roughness:.85});
    K.box(parent,horizontal,vertical+height*.43,depth+.025,width,.07,.05,0x929185,{roughness:.85});
  }

  function castleTower(parent,horizontal,depth,radius,height,roofHeight) {
    const tower=K.group();tower.position.set(horizontal,0,depth);parent.add(tower);
    const wall=K.cylinder(tower,0,height/2,0,radius*.93,radius,height,0x969387,40,{roughness:.93});
    K.surface(wall,'concrete',Math.max(2,radius*1.8),height/3);wall.material.color.setHex(0xaca796);
    for(const elevation of [height*.23,height*.58,height-.25])K.cylinder(tower,0,elevation,0,radius*1.005,radius*1.005,.26,0x8b8c81,40,{roughness:.87});
    const roof=K.cylinder(tower,0,height+roofHeight/2,0,.07,radius*1.23,roofHeight,0x42555b,40,{metalness:.12,roughness:.76});
    K.surface(roof,'metal',radius,roofHeight/2);roof.material.color.setHex(0x4f6469);
    for(let band=1;band<8;band++) {
      const ratio=band/8,ringRadius=radius*1.23*(1-ratio)+.07*ratio;
      K.cylinder(tower,0,height+roofHeight*ratio,0,ringRadius+.016,ringRadius+.055,.06,0x37494e,40,{metalness:.19,roughness:.72});
    }
    K.cylinder(tower,0,height+roofHeight+.42,0,.035,.06,.85,0x485455,16,{metalness:.6});
    for(let facade=0;facade<8;facade++) {
      const angle=facade*Math.PI/4,windows=K.group();tower.add(windows);windows.rotation.y=angle;
      for(const elevation of [height*.22,height*.53,height*.76])gothicWindow(windows,0,elevation,radius*.976,.55+radius*.18,1.6+radius*.28);
    }
    return tower;
  }

  function castleHall(parent,horizontal,depth,width,length,height) {
    const hall=K.group();hall.position.set(horizontal,0,depth);parent.add(hall);
    const wall=K.box(hall,0,height/2,0,width,height,length,0x9a978b,{roughness:.96});
    K.surface(wall,'concrete',width/3,height/3);wall.material.color.setHex(0xaca796);
    const roofShape=new THREE.Shape();roofShape.moveTo(-width*.56,0);roofShape.lineTo(0,width*.56);roofShape.lineTo(width*.56,0);roofShape.closePath();
    const roof=new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape,{depth:length+1,bevelEnabled:false}),new THREE.MeshStandardMaterial({color:0x4a5d61,roughness:.82,metalness:.1}));
    roof.position.set(0,height,-length/2-.5);hall.add(roof);
    for(let bay=0;bay<Math.floor(length/3);bay++) {
      const depthOffset=-length/2+1.5+bay*3;
      for(const side of [-1,1]) {
        const face=K.group();face.position.set(side*(width/2+.015),0,depthOffset);face.rotation.y=side*Math.PI/2;hall.add(face);
        gothicWindow(face,0,height*.36,0,1.15,height*.46);
        K.box(hall,side*(width/2+.2),height*.43,depthOffset+1.35,.55,height*.86,.55,0x8b8c81,{roughness:.95});
      }
    }
    for(const side of [-1,1]) {
      const facade=K.group();facade.position.z=side*(length/2+.01);facade.rotation.y=side<0?Math.PI:0;hall.add(facade);
      for(const horizontalOffset of [-width*.27,0,width*.27])gothicWindow(facade,horizontalOffset,height*.35,0,width*.16,height*.5);
    }
    return hall;
  }

  function hogwarts() {
    const world=base('hogwarts',{en:'A mountain overlook above the Black Lake, facing the towers of Hogwarts.','zh-CN':'黑湖上方的山间观景点，远眺霍格沃兹的塔楼与庭院。','zh-TW':'黑湖上方的山間觀景點，遠眺霍格沃茲的塔樓與庭院。'});
    world.spawn=[0,1.72,8];world.yaw=-.15;world.pitch=.045;
    world.bounds={minX:-12,maxX:12,minZ:-4,maxZ:19};
    world.environment={phase:'day',sunDirection:[-.6,.58,-.32],sunColor:0xfff1cf,sunIntensity:3.2,ambientIntensity:1.35,groundColor:0x78856c,fogColor:0xa5bbc4};
    mountainTerrain(world.group,false);ridgeFence(world,false);
    const lake=new THREE.Mesh(new THREE.PlaneGeometry(480,380,1,1),new THREE.MeshStandardMaterial({color:0x3f6f7b,roughness:.22,metalness:.3}));
    lake.rotation.x=-Math.PI/2;lake.position.set(-25,-34,-160);world.group.add(lake);
    const bluff=K.rock(world.group,-45,-190,52);bluff.position.y=-48;bluff.scale.set(71,37,50);
    const castle=K.group();castle.position.set(-45,-15,-190);castle.rotation.y=.23;world.group.add(castle);
    castleHall(castle,0,0,16,38,21);castleHall(castle,-23,-14,11,30,16);castleHall(castle,20,-19,13,36,20);
    castleHall(castle,-4,-34,44,11,15);
    castleTower(castle,-13,-17,5.2,49,17);castleTower(castle,13,-29,4.3,36,13);
    castleTower(castle,-26,1,3.1,26,11);castleTower(castle,26,-3,3.8,32,14);
    castleTower(castle,-26,-29,3.2,27,10);castleTower(castle,26,-37,3,30,11);
    castleTower(castle,0,21,3.8,31,15);castleTower(castle,11,14,2.1,22,9);
    for(let span=0;span<9;span++) {
      const horizontal=30+span*8;
      K.surface(K.box(castle,horizontal,-10,7,2.1,24,6,0x83877b,{roughness:1}),'concrete',2,5);
      K.box(castle,horizontal+4,3,7,10.1,2,6.8,0x969689,{roughness:.94});
      for(const side of [-1,1])K.box(castle,horizontal+4,4.25,7+side*3.15,8,.8,.38,0xa09e90,{roughness:.9});
    }
    const terrace=K.box(world.group,0,-.085,6.5,23,.16,24,0x6d7262,{roughness:1});K.surface(terrace,'soil',8,8);
    for(let rock=0;rock<24;rock++) {
      const horizontal=-10.5+rock*.91,depth=-3.5+Math.sin(rock*1.1)*.45;
      scannedRock(world.group,horizontal,depth,.32+(rock%4)*.12,rock*.61);
    }
    for(const tree of [[-21,8,9],[22,13,11],[-27,24,13],[29,31,15]])scannedPine(world.group,...tree,.4);
    for(let clump=0;clump<18;clump++)grassTuft(world.group,(clump%2?-1:1)*(8.5+clump%3),-1+clump,1+(clump%3)*.2,0x5d7151);
    const seat=K.bench(world.group,-7,9,.12);
    interaction(world,'highland-seat','Sit / stand above the lake','在湖上方坐下 / 起身','在湖上方坐下 / 起身',-7,1,9,2.4,sitAction(world,{en:'The lake and the castle stay quietly in view.','zh-CN':'湖水与城堡静静留在眼前。','zh-TW':'湖水與城堡靜靜留在眼前。'},1.08,seatAnchor(seat)));
    return world;
  }

  function snowmountain() {
    const world=base('snowmountain',{en:'A narrow high-alpine ridge above glaciers and an ocean of peaks.','zh-CN':'冰川上方的高山雪脊，群峰如海，山谷深不见底。','zh-TW':'冰川上方的高山雪脊，群峰如海，山谷深不見底。'});
    world.spawn=[0,1.72,7];world.yaw=.15;world.pitch=.1;
    world.bounds={minX:-12,maxX:12,minZ:-4,maxZ:19};
    world.environment={phase:'day',sunDirection:[.62,.48,-.46],sunColor:0xfff0dc,sunIntensity:3.7,ambientIntensity:1.5,groundColor:0xabb9c4,fogColor:0xb9d1df};
    mountainTerrain(world.group,true);ridgeFence(world,true);
    const snowShelf=K.ground(world.group,0xe4eaf0,34,{roughness:.99,metalness:0});K.surface(snowShelf,'concrete',14,14);snowShelf.material.color.setHex(0xf0f4f7);snowShelf.position.set(0,-.006,8);
    for(let rock=0;rock<21;rock++) {
      const side=rock%2?-1:1,horizontal=side*(10+Math.sin(rock*.63)*2),depth=-4+rock*1.14;
      const stoneNode=scannedRock(world.group,horizontal,depth,.45+(rock%5)*.28,rock*.72);
      if(rock%3===0) {
        const drift=K.sphere(world.group,horizontal,.25,depth,.85,0xe4edf1,{roughness:1});drift.scale.set(1.45,.25,1);
      }
    }
    const cairn=K.group();cairn.position.set(7.8,0,4.6);world.group.add(cairn);
    for(let layer=0;layer<6;layer++) {
      const stoneNode=K.rock(cairn,Math.sin(layer*2.1)*.07,Math.cos(layer)*.08,.5-layer*.055);stoneNode.position.y=.15+layer*.21;
    }
    collider(world,7.8,4.6,1.2,1.2);
    const summitPlate=K.box(world.group,7.7,.85,5.01,.46,.26,.025,0x5f6869,{metalness:.72,roughness:.48});
    K.label(world.group,'SUMMIT',7.7,.87,5.04,.39,'#d0d5cf');
    interaction(world,'summit-cairn','Read the summit marker','看看山顶标记','看看山頂標記',7.8,1,5.5,2.5,{en:'Only wind, ice, and the long way home.','zh-CN':'只有风、冰雪，以及漫长的归途。','zh-TW':'只有風、冰雪，以及漫長的歸途。'});
    const pack=K.group();pack.position.set(-6.8,0,10);pack.rotation.y=-.35;world.group.add(pack);
    const bag=K.box(pack,0,.36,0,.55,.72,.28,0x9c4e32,{roughness:1});K.surface(bag,'fabric',2,2);
    for(const horizontal of [-.18,.18])K.box(pack,horizontal,.38,.15,.065,.61,.027,0x474a42,{roughness:.94});
    K.box(pack,0,.34,.171,.38,.09,.025,0x51564e,{metalness:.2,roughness:.7});
    K.cylinder(pack,.6,.55,.05,.017,.02,1.1,0x737e81,16,{metalness:.7,roughness:.36}).rotation.z=.22;
    collider(world,-6.8,10,.65,.4);
    interaction(world,'ridge-rest','Pause beside the expedition pack','在登山包旁歇息','在登山包旁歇息',-6.8,1,10.5,2.3,{en:'The ridge is quiet enough to hear your own breathing.','zh-CN':'雪脊安静得能听见自己的呼吸。','zh-TW':'雪脊安靜得能聽見自己的呼吸。'});
    return world;
  }

  function shelter() {
    const world=base('shelter',{en:'A lived-in refuge above a silent, broken city.','zh-CN':'废土都市之上，一间仍有生活痕迹的避难所。','zh-TW':'廢土都市之上，一間仍有生活痕跡的避難所。'});
    const group=world.group;world.spawn=[0,1.72,2.8];world.yaw=-.08;world.pitch=.06;
    world.bounds={minX:-6.5,maxX:6.5,minZ:-5.5,maxZ:10.5};
    world.environment={phase:'night',sunDirection:[-.5,.7,.4],sunColor:0xb7d5ff,sunIntensity:1.05,ambientIntensity:.7,groundColor:0x55514a,fogColor:0x1c2734};
    const slab=K.box(group,0,-.16,2.5,13.5,.32,17,0x74746a,{roughness:1});K.surface(slab,'concrete',5,6);
    for(const side of [-1,1]) {
      const wall=K.box(group,side*6.6,2.1,2.5,.55,4.2,17,0x74746b,{roughness:1});K.surface(wall,'concrete',6,2);
      collider(world,side*6.6,2.5,.55,17);
      K.box(group,side*6.21,2.4,3.8,.14,.12,12.4,0x7f7560,{metalness:.5,roughness:.72});
      for(let bracket=0;bracket<6;bracket++)K.box(group,side*6.13,2.4,-1.6+bracket*2,.11,.35,.095,0x444a45,{metalness:.6});
    }
    K.surface(K.box(group,0,4.28,3,13.6,.36,16,0x737369,{roughness:1}),'concrete',6,6);
    K.surface(K.box(group,0,2.1,10.8,13.5,4.2,.6,0x77766d,{roughness:1}),'concrete',6,2);collider(world,0,10.8,13.5,.6);
    K.surface(K.box(group,0,.39,-5.8,13.5,.78,.6,0x88897d,{roughness:1}),'concrete',6,1);collider(world,0,-5.8,13.5,.6);
    for(const horizontal of [-6.1,6.1])K.box(group,horizontal,2.45,-5.75,.2,3.65,.3,0x645e4d,{metalness:.7,roughness:.7});
    K.box(group,0,4.03,-5.75,12.4,.22,.32,0x645e4d,{metalness:.65,roughness:.68});
    const shutter=K.group();shutter.position.set(0,3.78,-5.69);group.add(shutter);
    for(let slat=0;slat<4;slat++)K.box(shutter,0,-slat*.09,0,12,.08,.12,0x657064,{metalness:.68,roughness:.77});
    let shutterTarget=3.78;
    const city=K.group();city.position.y=-36;group.add(city);
    const ruins=new THREE.MeshStandardMaterial({color:0x4c5457,roughness:.97,metalness:.08});
    const concrete=new THREE.BoxGeometry(1,1,1);
    let ruinSeed=91527;
    const random=()=>{ruinSeed=(ruinSeed*16807)%2147483647;return (ruinSeed-1)/2147483646;};
    for(let building=0;building<38;building++) {
      const horizontal=(building%10-4.5)*31+(random()-.5)*15,depth=-85-Math.floor(building/10)*85-random()*35;
      const width=10+random()*15,length=12+random()*18,floors=3+Math.floor(random()*16),height=floors*3.3;
      const shell=new THREE.Mesh(concrete,ruins);shell.position.set(horizontal,height/2,depth);shell.scale.set(width,height,length);city.add(shell);
      for(let floor=1;floor<floors;floor++) {
        K.box(city,horizontal,floor*3.3,depth+length/2+.04,width+.35,.18,.45,0x75807d,{roughness:.94});
        for(let bay=0;bay<Math.floor(width/3);bay++) {
          if(random()<.18)continue;
          const window=K.box(city,horizontal-width/2+1.5+bay*3,floor*3.3+1.35,depth+length/2+.085,1.63,1.85,.04,random()<.025?0xc49a65:0x182329,{emissive:random()<.025?0x745531:0,emissiveIntensity:.2,roughness:.83});
        }
      }
      for(let remnant=0;remnant<5;remnant++) {
        const remnantX=horizontal+(random()-.5)*width,remnantZ=depth+(random()-.5)*length;
        K.box(city,remnantX,height+random()*1.4,remnantZ,.1,2+random()*3,.1,0x675b49,{metalness:.6,roughness:.85});
      }
      if(building%6===0) {
        const antenna=K.cylinder(city,horizontal,height+4,depth,.055,.075,8,0x777b70,16,{metalness:.7,roughness:.6});
        K.box(city,horizontal,height+6,depth,4,.05,.05,0x777b70,{metalness:.7});
      }
    }
    K.ground(city,0x1c262b,1200,{roughness:1});
    for(let street=0;street<4;street++)K.box(city,0,.015,-95-street*85,520,.02,14,0x293336,{roughness:1});
    const bed=K.group();bed.position.set(-4.8,0,6.5);group.add(bed);
    K.box(bed,0,.39,0,2.5,.16,3.8,0x525b54,{metalness:.7,roughness:.78});
    K.surface(K.box(bed,0,.59,0,2.38,.24,3.6,0x8b8a75,{roughness:1}),'fabric',3,4);
    K.surface(K.box(bed,0,.77,.55,2.42,.12,2.5,0x53645b,{roughness:1}),'fabric',3,3);
    K.surface(K.box(bed,0,.82,-1.24,1.55,.25,.65,0xa7a394,{roughness:1}),'fabric',2,1);
    for(const horizontal of [-1.05,1.05])for(const depth of [-1.6,1.6])K.cylinder(bed,horizontal,.18,depth,.055,.055,.36,0x5b625b,16,{metalness:.7});
    collider(world,-4.8,6.5,2.5,3.8);
    const desk=K.group();desk.position.set(4.8,0,4);group.add(desk);
    K.surface(K.box(desk,0,.88,0,2.4,.16,4.1,0x695b48,{roughness:.9}),'wood',2,3);
    for(const horizontal of [-.98,.98])for(const depth of [-1.7,1.7])K.box(desk,horizontal,.42,depth,.08,.84,.08,0x555f58,{metalness:.6});
    K.box(desk,0,1.02,-.7,1.3,.045,1.6,0xb3ae97,{roughness:1});
    K.cylinder(desk,.56,1.12,.65,.14,.12,.25,0xc2bda9,32,{roughness:.62});
    const radio=K.box(desk,-.25,1.19,1.1,1,.42,.55,0x3f4e45,{metalness:.38,roughness:.83});
    K.box(desk,-.42,1.22,1.382,.37,.17,.02,0x8a9f85,{emissive:0x506547,emissiveIntensity:.35});
    for(let vent=0;vent<6;vent++)K.box(desk,.09+vent*.05,1.22,1.387,.018,.18,.015,0x212f2a);
    K.cylinder(desk,.18,1.83,1.12,.01,.014,.9,0x8c9890,16,{metalness:.8}).rotation.z=.22;
    collider(world,4.8,4,2.4,4.1);
    const lampLight=K.point(group,4.5,2.6,3.1,0xffc38d,2.6,12);let lampOn=true;
    K.cylinder(group,4.5,2.85,3.1,.07,.4,.35,0x83765e,32,{metalness:.6,roughness:.6});
    K.cylinder(group,4.5,3.55,3.1,.018,.018,1.04,0x343f38,12,{metalness:.6});
    K.point(group,-4.5,2.8,6.9,0xf1ad70,.8,8);
    const stove=K.group();stove.position.set(-4.5,0,-2.2);group.add(stove);
    K.cylinder(stove,0,.47,0,.48,.43,.94,0x39423d,40,{metalness:.72,roughness:.77});
    K.box(stove,0,.42,.455,.47,.42,.055,0x1f2925,{metalness:.65,roughness:.65});
    K.box(stove,0,.42,.486,.32,.25,.015,0x6d351e,{emissive:0xbb5120,emissiveIntensity:.45});
    K.cylinder(stove,0,2.35,0,.1,.1,2.8,0x3d4841,24,{metalness:.66,roughness:.8});
    collider(world,-4.5,-2.2,1.1,1.1);
    const supplies=K.group();supplies.position.set(0,0,9.6);group.add(supplies);
    for(let crate=0;crate<4;crate++) {
      const horizontal=-2.8+crate*1.8;
      K.surface(K.box(supplies,horizontal,.45,0,1.5,.9,.9,crate%2?0x777960:0x776650,{roughness:.92}),'wood',2,1);
      for(const side of [-1,1])K.box(supplies,horizontal+side*.51,.45,.46,.07,.87,.04,0x454e43,{metalness:.58,roughness:.84});
      collider(world,horizontal,9.6,1.5,.9);
    }
    K.label(group,'SHELTER  /  04',0,3.45,10.44,2.6,'#a3a899').rotation.y=Math.PI;
    interaction(world,'shelter-shutter','Raise / lower the sunshade','升起 / 放下遮光帘','升起 / 放下遮光簾',5.7,1.9,-4.7,2.3,()=>{shutterTarget=shutterTarget>3?2.48:3.78;return {en:'The worn mechanism turns slowly.','zh-CN':'磨损的机构缓缓转动。','zh-TW':'磨損的機構緩緩轉動。'};});
    interaction(world,'shelter-light','Switch the work lamp','切换工作灯','切換工作燈',4.8,1.5,3,2.5,()=>{lampOn=!lampOn;lampLight.intensity=lampOn?13:.5;return {en:lampOn?'A little warmth returns to the room.':'The city becomes clearer in the dark.','zh-CN':lampOn?'一点暖意重新回到房间。':'黑暗中，都市变得更清晰。','zh-TW':lampOn?'一點暖意重新回到房間。':'黑暗中，都市變得更清晰。'};});
    interaction(world,'shelter-radio','Listen to the receiver','听听收音机','聽聽收音機',4.8,1.3,5.1,2.5,{en:'No voices tonight. The receiver still has power.','zh-CN':'今晚没有人声，接收器仍然通着电。','zh-TW':'今晚沒有人聲，接收器仍然通著電。'});
    world.update=(delta)=>{shutter.position.y+=(shutterTarget-shutter.position.y)*Math.min(1,delta*1.8);};
    return world;
  }

  window.NightWorldBuilders = window.NightWorldBuilders || {};
  Object.assign(window.NightWorldBuilders, { shelter, hogwarts, snowmountain });
})();

/* Night Worlds: self-contained environmental scenes.  The sky renderer remains the owner of the camera. */
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) return;
  let K = window.NightWorldKit || {};
  const B = window.NightWorldBuilders = window.NightWorldBuilders || {};
  const c = (v, fallback) => v == null ? fallback : v;
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({
    color: c(color, 0x4d5961), roughness: c(o.roughness, .72), metalness: c(o.metalness, .08),
    emissive: c(o.emissive, 0x000000), emissiveIntensity: c(o.emissiveIntensity, 0)
  });
  const box = (p, x, y, z, w, h, d, color, o = {}) => {
    if (K.box) return K.box(p, x, y, z, w, h, d, color, o);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o)); m.position.set(x, y, z); m.rotation.y = o.rotationY || 0; p.add(m); return m;
  };
  const cyl = (p, x, y, z, rt, rb, h, color, seg = 16, o = {}) => {
    if (K.cylinder) return K.cylinder(p, x, y, z, rt, rb, h, color, seg, o);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, o)); m.position.set(x, y, z); p.add(m); return m;
  };
  const sph = (p, x, y, z, r, color, o = {}) => {
    if (K.sphere) return K.sphere(p, x, y, z, r, color, o);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat(color, o)); m.position.set(x, y, z); p.add(m); return m;
  };
  const point = (p, x, y, z, color, intensity, distance) => K.point ? K.point(p, x, y, z, color, intensity, distance) : (() => { const l = new THREE.PointLight(color, intensity, distance); l.position.set(x, y, z); p.add(l); return l; })();
  const line = (p, points, color = 0x8edcff, opacity = .75) => { const g = new THREE.BufferGeometry().setFromPoints(points.map(a => new THREE.Vector3(a[0], a[1], a[2]))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); p.add(l); return l; };
  const text = (p, s, x, y, z, w = 2, color = '#c9d5df') => K.label ? K.label(p, s, x, y, z, w, color) : null;
  const baseWorld = (name, color) => {
    const world = { id: name, name, group: K.group ? K.group() : new THREE.Group(), spawn: [0, 1.68, 8], yaw: 0, pitch: .08,
      bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, colliders: [], interactions: [], player: null,
      update() {}, dispose() { if(K.disposeGroup){K.disposeGroup(this.group);return;} this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); },
      description: { en: '', 'zh-CN': '', 'zh-TW': '' } };
    if (K.ground) K.ground(world.group, color, 140, { roughness: .95 }); else box(world.group, 0, -.12, 0, 140, .2, 140, color, { roughness: .95 });
    return world;
  };
  const collider = (w, x, z, a, d) => { const item = { x, z, w: a, d }; w.colliders.push(item); return item; };
  const interact = (w, data) => { const item = K.interaction ? K.interaction(w, data) : data; if (item && !w.interactions.includes(item)) w.interactions.push(item); return item; };
  const trim = (p, x, y, z, r, color = 0x7993a2) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, .035, 8, 32), mat(color, { metalness: .7, roughness: .3 })); t.position.set(x, y, z); t.rotation.x = Math.PI / 2; p.add(t); return t; };
  const lamp = (p, x, z, h = 3, color = 0xffc285) => { const post = cyl(p, x, h / 2, z, .055, .075, h, 0x29343a, 10); sph(p, x, h + .05, z, .16, color, { emissive: color, emissiveIntensity: 2, roughness: .25 }); point(p, x, h, z, color, .7, 8); return post; };
  const bench = (p, x, z, ry = 0) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g); box(g, 0, .58, 0, 1.9, .14, .48, 0x604d3c); box(g, 0, .96, -.18, 1.9, .72, .12, 0x4c3b31); [-.72, .72].forEach(a => box(g, a, .3, 0, .12, .6, .38, 0x34333a)); return g; };
  const copy = (en, cn, tw) => ({ en, 'zh-CN': cn, 'zh-TW': tw || cn });
  const surface = (mesh,type,rx=1,ry=1) => { if(K.surface)K.surface(mesh,type,rx,ry); return mesh; };
  function glow(p, x, y, z, a, b, d, color, intensity = 1.5) { return box(p, x, y, z, a, b, d, color, { emissive: color, emissiveIntensity: intensity, metalness: .1 }); }
  function localMaterial(mesh) {
    mesh.material = mesh.material.clone();
    mesh.material.userData.shared = false;
    return mesh.material;
  }
  function upholstery(parent,x,y,z,width,height,depth,color,back=false){
    const geometry=new THREE.SphereGeometry(1,40,24),positions=geometry.attributes.position;
    const softened=value=>Math.sign(value)*Math.pow(Math.abs(value),.34);
    for(let index=0;index<positions.count;index++){
      const horizontal=softened(positions.getX(index)),vertical=softened(positions.getY(index)),forward=softened(positions.getZ(index));
      const taper=back?1-.1*Math.max(0,vertical):1;
      const lumbar=back?Math.exp(-Math.pow((vertical+.35)*2.6,2))*.027:0;
      const depression=back?0:Math.max(0,vertical)*Math.exp(-(horizontal*horizontal+forward*forward)*5)*height*.12;
      positions.setXYZ(index,horizontal*width*.5*taper,vertical*height*.5-depression,forward*depth*.5-lumbar);
    }
    geometry.computeVertexNormals();
    const mesh=surface(new THREE.Mesh(geometry,mat(color,{roughness:1,metalness:0})),'fabric',2,2);
    mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function upholsteredSeam(parent,x,y,z,width,height,color){
    const points=[];
    for(let index=0;index<=64;index++){
      const angle=index*Math.PI/32;
      points.push([x+Math.sign(Math.cos(angle))*Math.pow(Math.abs(Math.cos(angle)),.4)*width*.5,y+Math.sign(Math.sin(angle))*Math.pow(Math.abs(Math.sin(angle)),.4)*height*.5,z]);
    }
    return line(parent,points,color,.24);
  }
  function rod(p, a, b, radius, color) { const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), dir = end.clone().sub(start); const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), mat(color, { metalness: .7 })); mesh.position.copy(start.add(end).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); p.add(mesh); return mesh; }
  function screen(p, x, y, z, w, h, theme = 0x81d7eb) {
    box(p,x,y,z,w+.085,h+.085,.075,0x20272b,{metalness:.65,roughness:.48});
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.max(360,Math.round(1024*h/w));
    const ctx=canvas.getContext('2d');
    if(ctx.fillRect&&ctx.beginPath){
      const width=canvas.width,height=canvas.height,pad=38,amber=theme===0xdda969||theme===0xd8b076;
      const accent=amber?'#b6a07b':'#82a9ae';
      ctx.fillStyle='#0b1419';ctx.fillRect(0,0,width,height);
      ctx.lineWidth=1;ctx.strokeStyle='#25363d';
      for(let gx=pad;gx<width-pad;gx+=48){ctx.beginPath();ctx.moveTo(gx,80);ctx.lineTo(gx,height-65);ctx.stroke();}
      for(let gy=80;gy<height-65;gy+=36){ctx.beginPath();ctx.moveTo(pad,gy);ctx.lineTo(width-pad,gy);ctx.stroke();}
      ctx.fillStyle=accent;ctx.font='500 22px monospace';ctx.fillText(amber?'POWER / ENVIRONMENT':'ATTITUDE / FLIGHT DIRECTOR',pad,41);
      ctx.font='16px monospace';ctx.fillStyle='#566f76';ctx.fillText('NIGHT WATCH  /  LOCAL FRAME',pad,height-23);
      ctx.fillStyle='#a8b7b8';ctx.font='26px monospace';ctx.fillText(amber?'BUS  28.4 V':'HEADING  000°',pad,116);
      ctx.font='18px monospace';ctx.fillStyle='#7c9095';
      const rows=amber?['CABIN PRESSURE   101.3 kPa','OXYGEN MIX        20.9 %','BATTERY RESERVE   98.4 %']:['PITCH          +00.0°','ROLL           +00.0°','VECTOR         STABLE'];
      rows.forEach((row,index)=>ctx.fillText(row,pad,163+index*35));
      const cx=width*.76,cy=Math.max(170,height*.5),radius=Math.min(108,height*.27);
      ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='#49636d';
      for(let index=-2;index<=2;index++){
        const ordinate=cy+index*radius*.27,span=radius*(index? .38:.74);
        ctx.beginPath();ctx.moveTo(cx-span,ordinate);ctx.lineTo(cx+span,ordinate);ctx.stroke();
      }
      ctx.strokeStyle='#c3c5b7';ctx.beginPath();ctx.moveTo(cx-radius*.3,cy);ctx.lineTo(cx-10,cy);ctx.lineTo(cx,cy+8);ctx.lineTo(cx+10,cy);ctx.lineTo(cx+radius*.3,cy);ctx.stroke();
      ctx.fillStyle=accent;ctx.font='17px monospace';ctx.fillText('SYSTEM NOMINAL',width-233,height-23);
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:texture,emissiveMap:texture,color:0x9ca7a9,emissive:0xffffff,emissiveIntensity:.28,roughness:.31,metalness:.08}));
    panel.position.set(x,y,z+.041);p.add(panel);panel.userData.screenCanvas=canvas;
    for(const side of [-1,1])for(const vertical of [-1,1]){
      const screw=cyl(p,x+side*(w/2+.022),y+vertical*(h/2+.022),z+.041,.008,.008,.012,0x667074,16,{metalness:.7});screw.rotation.x=Math.PI/2;
    }
    return panel;
  }
  function plant(p, x, z, size = 1) {
    const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(size);p.add(g);
    cyl(g,0,.17,0,.19,.14,.34,0x88745e,32,{roughness:.98});
    surface(cyl(g,0,.34,0,.17,.17,.012,0x2b231c,24),'soil');
    // Thin curved leaf surfaces preserve an organic silhouette when the local
    // scanned plant model is unavailable. No stretched sphere foliage.
    for(let i=0;i<16;i++){
      const angle=i*2.399,reach=.25+(i%4)*.055,height=.65+(i%6)*.095;
      const geo=new THREE.PlaneGeometry(.19,.53,6,10),positions=geo.attributes.position;
      for(let j=0;j<positions.count;j++){
        const v=(positions.getY(j)+.265)/.53,width=Math.sin(v*Math.PI);
        positions.setXYZ(j,positions.getX(j)*width,positions.getY(j),Math.sin(v*Math.PI)*.065+Math.abs(positions.getX(j))*.25);
      }
      geo.computeVertexNormals();
      const material=mat(i%3?0x405b38:0x597447,{roughness:.8});material.side=THREE.DoubleSide;
      const leaf=new THREE.Mesh(geo,material);leaf.position.set(Math.cos(angle)*reach,height,Math.sin(angle)*reach);leaf.rotation.set(.28+((i%3)*.15),angle,.22);g.add(leaf);
      rod(g,[0,.3,0],[leaf.position.x,height-.2,leaf.position.z],.0045,0x46543a);
    }
    if(K.model){K.model(p,'potted_plant_01',x,0,z,{height:1.25*size,rotationY:x*.4,onLoad(){g.visible=false;}});}
  }

  function spaceship(kit) {
    K = kit || K;
    const w = baseWorld('spaceship', 0x111a20); w.spawn = [1.2, 1.68, -2.8]; w.bounds = { minX: -5.5, maxX: 5.5, minZ: -14, maxZ: 12 };
    const g = w.group;
    g.children.filter(node=>node.userData.ground).forEach(node=>g.remove(node));
    w.environment={phase:'night',sunDirection:[-.5,.7,.4],sunColor:0xb7d5ff,sunIntensity:.65,ambientIntensity:.62,groundColor:0x77776f,fogColor:0x000000};
    // hull shell and open central aisle
    surface(box(g, 0, -.2, 0, 10, .4, 28, 0x728089, { metalness: .65, roughness: .35 }),'metal',5,14);
    for(let z=-12;z<=12;z+=1.5){
      for(const x of [-3,0,3])surface(box(g,x,.007,z,2.94,.018,1.46,x?0x606a70:0x4e5a62,{metalness:.4,roughness:.65}),'metal',1,1);
    }
    // Cockpit roof and front are genuinely open; only the structural ribs occlude the stars.
    for (const side of [-1, 1]) {
      box(g, side*4.9, .45, 0, .3, .9, 28, 0x27353d, { metalness: .7 });
      box(g, side*4.9, 3.4, 1.5, .3, 2.2, 25, 0x27353d, { metalness: .7 });
      for(let z=-10;z<=12;z+=2.5){
        surface(box(g,side*4.725,.5,z,.018,.63,2.35,0x6a7379,{metalness:.6,roughness:.55}),'metal',1,2);
        box(g,side*4.68,.5,z,.022,.21,.62,0x202a31);
        for(let i=0;i<6;i++)box(g,side*4.663,.415+i*.032,z,.014,.012,.54,0x607078,{metalness:.7});
      }
      for (let z = -11; z <= 13; z += 4) box(g, side*4.9, 1.6, z, .32, 1.5, .26, 0x70818a, { metalness: .6 });
      glow(g, side*4.7, .17, 0, .05, .045, 25, 0x5dc0d8, 1.3);
      box(g, side*3.9, 4.6, 2.5, 2, .22, 22, 0x202b32, { metalness: .6 });
    }
    box(g, 0, 4.38, 7.5, 5.8, .22, 11, 0x202b32, { metalness: .6 });
    for (let z=-11;z<13;z+=3) {
      const framePoints = [[-4.7,.12,z],[-4.7,3.2,z],[-3.15,4.5,z],[3.15,4.5,z],[4.7,3.2,z],[4.7,.12,z]];
      for (let n=1;n<framePoints.length;n++) rod(g,framePoints[n-1],framePoints[n],.062,0x74818a);
      for(const side of [-1,1]){
        box(g,side*4.64,3.2,z,.12,.36,.3,0x99a3a7,{metalness:.7});
        for(const dy of [-.09,.09]){const bolt=cyl(g,side*4.56,3.2+dy,z,.018,.018,.025,0x26343a,12,{metalness:.85});bolt.rotation.z=Math.PI/2;}
      }
      box(g,0,.013,z,9.2,.018,.025,0x536169,{metalness:.7});
    }
    // windscreen frame and pilot deck
    box(g,0,.46,-13.4,9.6,.92,.35,0x17252e,{metalness:.7});
    rod(g,[-4.6,.9,-13.4],[-3.1,4.4,-13.4],.075,0x728894); rod(g,[4.6,.9,-13.4],[3.1,4.4,-13.4],.075,0x728894); rod(g,[-3.1,4.4,-13.4],[3.1,4.4,-13.4],.075,0x728894);
    for(const side of [-1,1]) {
      const foot=K.group();foot.position.set(side*4.55,.91,-13.4);g.add(foot);
      K.cylinder(foot,0,0,0,.17,.2,.18,0x56645f,24,{metalness:.66,roughness:.48});
      const cap=K.box(foot,0,.09,0,.36,.08,.36,0x8b947f,{metalness:.58,roughness:.52});
      cap.rotation.y=Math.PI/4;
    }
    for(const side of [-1,1]) {
      const header=K.group();header.position.set(side*3.1,4.39,-13.4);g.add(header);
      K.cylinder(header,0,0,0,.16,.2,.16,0x53635c,24,{metalness:.66,roughness:.46});
      K.box(header,0,-.09,0,.34,.07,.34,0x8e967d,{metalness:.58,roughness:.5});
    }
    const flightDeck=K.group();flightDeck.position.y=-.2;g.add(flightDeck);
    box(flightDeck,0,.82,-11.75,7,.35,1.35,0x26343a,{metalness:.6});
    const hud = screen(flightDeck,0,1.23,-11.95,1.38,.56);
    screen(flightDeck,-1.48,1.21,-11.96,1.12,.51,0xdda969); screen(flightDeck,1.48,1.21,-11.96,1.12,.51);
    for(const x of [-1.48,0,1.48]){
      const panel=surface(box(flightDeck,x,1.007,-11.5,x?1.18:1.42,.035,.42,0x75838a,{metalness:.7,roughness:.4}),'metal');
      for(let i=0;i<5;i++){
        const dial=cyl(flightDeck,x-.58+i*.28,1.05,-11.49,.047,.052,.075,0x28353c,20,{metalness:.55});
        box(flightDeck,dial.position.x,1.092,-11.472,.008,.006,.025,0xb8c4c7);
        for(const dz of [-.11,.11]){const bolt=cyl(flightDeck,x-.75+i*.34,1.032,-11.5+dz,.009,.009,.018,0x20282e,12,{metalness:.8});}
      }
    }
    for (let i=0;i<8;i++) glow(flightDeck,-.72+i*.205,1.015,-11.15,.07,.014,.12,i%3 ? 0x5899b3 : 0xd39c59,.8);
    for (const x of [-.68,.68]) { box(g,x,.9,-10.35,.16,.12,.66,0x475963); rod(g,[x,.95,-10.45],[x,1.25,-10.65],.055,0x17232a); }
    upholstery(g,0,.52,-9.9,.74,.2,.83,0x4d555d);
    const chairBack=upholstery(g,0,1.06,-9.48,.72,.99,.22,0x424e56,true);chairBack.rotation.x=.075;
    upholstery(g,0,1.64,-9.445,.48,.25,.23,0x637077,true);cyl(g,0,.25,-9.9,.13,.2,.5,0x2d3b42,32,{metalness:.55,roughness:.6});
    upholsteredSeam(g,0,1.07,-9.345,.59,.83,0x586870);
    for(const side of [-1,1]){
      const bolster=upholstery(g,side*.285,1.05,-9.56,.12,.75,.19,0x4d5d67,true);bolster.rotation.z=side*.1;
      surface(box(g,side*.22,1.36,-9.335,.08,.2,.024,0x293740),'fabric');
      box(g,side*.22,1.33,-9.315,.048,.025,.016,0x929a9c,{metalness:.7,roughness:.5});
    }
    for(const side of [-1,1]){
      rod(g,[side*.34,.6,-10.2],[side*.34,.6,-9.59],.016,0x8a9295);
      rod(g,[side*.34,.64,-9.57],[side*.34,1.48,-9.48],.015,0x8a9295);
      upholstery(g,side*.43,.78,-9.86,.115,.1,.59,0x47535a);
      rod(g,[side*.4,.54,-9.69],[side*.43,.73,-9.69],.023,0x697780);
    }
    for(const side of [-1,1]){
      surface(box(g,side*1.07,.62,-10.07,.34,.2,1.35,0x4b5a63,{metalness:.35,roughness:.7}),'metal');
      const switchPanel=box(g,side*1.07,.74,-10.18,.28,.025,.64,0x27343d,{roughness:.8});
      for(let index=0;index<5;index++){
        cyl(g,side*1.07,.77,-10.42+index*.1,.017,.019,.035,0x91a0a3,16,{metalness:.55,roughness:.55});
      }
      rod(g,[side*1.22,.61,-10.54],[side*1.22,.61,-9.61],.025,0x77858c);
    }
    const pilot = { seat: [0, 1.68, -9.95], exit: [1.65, 1.68, -8.75], active: false, throttle: 0, speed: 0, distance: 0 }; w.pilot = pilot;
    const thruster = [];
    [-3.2, -1.1, 1.1, 3.2].forEach(x => { const e = sph(g, x, .58, 12.6, .2, 0x57d8ff, { emissive: 0x37bfff, emissiveIntensity: 2 }); e.userData.baseScale = e.scale.clone(); thruster.push(e); });
    // living pod: bunks, galley, observation lounge
    const cabinGlow = [];
    for (const z of [3.5,7.8]) {
      box(g,-4.72,1.6,z,.16,3.2,3.4,0x35444c,{metalness:.55});
      for(const end of [-1,1])box(g,-3.6,1.6,z+end*1.63,2.25,3.2,.14,0x35444c,{metalness:.55});
      box(g,-3.6,3.19,z,2.25,.13,3.4,0x35444c,{metalness:.55});
      for (const y of [.58,2.04]) { box(g,-3.45,y,z,2.45,.19,2.75,0x677982); surface(box(g,-3.25,y+.19,z,2.7,.21,2.35,0x8d9c9f),'fabric',3,2); surface(box(g,-3.25,y+.34,z-.92,2.35,.13,.45,0xb9bcaf),'fabric',2,1); cabinGlow.push(glow(g,-2.48,y+.87,z,.04,.03,2.3,0xf0c08b,.8)); }
      collider(w,-3.7,z,2.6,3.4);
    }
    box(g,3.55,.6,5.3,2.5,1.2,4.6,0x354850); box(g,3.55,1.23,5.3,2.55,.12,4.7,0x94a09b,{metalness:.35});
    box(g,4.65,2.2,5.3,.22,1.7,4.7,0x566770); screen(g,4.38,2.15,4.9,.5,.65); cyl(g,3.2,1.38,4.5,.095,.095,.21,0xc2b18f); collider(w,3.55,5.3,2.6,4.8);
    bench(g,3.3,10.5,Math.PI/2); cyl(g,1.8,.74,10.6,.65,.65,.08,0x657778,24); cyl(g,1.8,.35,10.6,.07,.17,.7,0x4a5c64); plant(g,4.1,11.8,.9);
    box(g,0,2.2,13.5,9.5,4.4,.22,0x34464f,{metalness:.5}); box(g,0,1.65,13.33,2.15,3.3,.12,0x526970,{metalness:.6}); trim(g,0,1.9,13.18,.55,0x719aa5).rotation.x=0;
    const cabinLights = [point(g,0,3.8,-10,0x8ed8f0,1.7,14), point(g,0,3.7,5,0xffc68c,1.8,17), point(g,0,3.6,-1,0x93c3ce,1.2,12)];
    cabinLights.forEach(light => { light.userData.cabinIntensity = light.intensity; });
    text(g,'02  /  HABITAT',0,3.8,2,2.2,'#adc4ce'); text(g,'NIGHT WATCH',0,.69,-13.17,2,'#85c5d4');
    collider(w, -4.7, 0, .5, 28); collider(w, 4.7, 0, .5, 28); collider(w, 0, -13.5, 10, .5); collider(w, 0, 13.5, 10, .5);
    collider(w,0,-11.75,7,1.35); collider(w,0,-9.85,1.1,1.25); collider(w,3.3,10.5,.55,1.9); collider(w,1.8,10.6,1.3,1.3);
    const seatAction = interact(w, { id: 'pilot-seat', label: copy('Take the helm','进入驾驶位','進入駕駛位'), position: pilot.seat, radius: 2.6, action() { pilot.active = !pilot.active; if (w.player) { const q = pilot.active ? pilot.seat : pilot.exit; w.player.x = q[0]; w.player.y = q[1]; w.player.z = q[2]; } if(seatAction) seatAction.label=pilot.active ? copy('Leave the helm','离开驾驶位','離開駕駛位') : copy('Take the helm','进入驾驶位','進入駕駛位'); return pilot.active ? copy('Helm engaged. W/S thrust · A/D yaw · Q/E roll.','驾驶已接管。W/S 推力 · A/D 偏航 · Q/E 滚转。','駕駛已接管。W/S 推力 · A/D 偏航 · Q/E 滾轉。') : copy('Cruise hold. You can walk through the ship.','保持巡航。可以在舱内走动。','保持巡航。可以在艙內走動。'); } });
    let warmLights=true;
    interact(w,{id:'cabin-lights',label:copy('Change cabin lighting','切换舱内灯光','切換艙內燈光'),position:[3.4,1.4,4],radius:2.4,action(){
      warmLights=!warmLights;
      cabinLights.forEach(light => { light.intensity=light.userData.cabinIntensity*(warmLights?1:.12); });
      cabinGlow.forEach(mesh => { mesh.visible=warmLights; });
      return warmLights ? copy('Warm cabin lights restored.','暖色舱灯已恢复。','暖色艙燈已恢復。') : copy('Night watch lighting.','已切换为夜航灯光。','已切換為夜航燈光。');
    }});
    let telemetryTime=-1;
    w.update = (dt, t) => {
      thruster.forEach((e, i) => { const f = .7 + Math.max(0, pilot.throttle) * 2 + Math.sin(t * 9 + i) * .12; e.scale.copy(e.userData.baseScale).multiplyScalar(f); });
      hud.material.emissiveIntensity = .28 + Math.max(0, pilot.throttle) * .08;
      if (hud.userData.screenCanvas && t-telemetryTime>.2) {
        telemetryTime=t;
        const ctx=hud.userData.screenCanvas.getContext('2d');
        if(ctx.fillRect) {
          const flight=w.flight?.orientation||[0,0,0,1],pose=decomposeYawPitchRoll(flight,0),degrees=180/Math.PI;
          ctx.fillStyle='#0b1419';ctx.fillRect(30,83,555,181);
          ctx.fillStyle='#a8b7b8';ctx.font='26px monospace';ctx.fillText('HEADING  '+String(Math.round((pose.yaw*degrees+360)%360)).padStart(3,'0')+'°',38,116);
          ctx.fillStyle='#7c9095';ctx.font='18px monospace';
          ctx.fillText('PITCH       '+(pose.pitch*degrees).toFixed(1)+'°',38,163);
          ctx.fillText('ROLL        '+(pose.roll*degrees).toFixed(1)+'°',38,198);
          ctx.fillText('SPEED       '+(pilot.speed||0).toFixed(1)+' m/s',38,233);
          hud.material.map.needsUpdate=true;
        }
      }
      seatAction.label=pilot.active ? copy('Leave the helm','离开驾驶位','離開駕駛位') : copy('Take the helm','进入驾驶位','進入駕駛位');
    };
    const palette=new Map([[0x27353d,0xb8b7a9],[0x202b32,0xbfc0b4],[0x35444c,0x9faaa3],[0x354850,0xa4ada3],[0x34464f,0xb9bcad],[0x526970,0x747f79],[0x354850,0xa3aba0],[0x26343a,0x606e6d]]);
    g.traverse(node=>{
      if(!node.isMesh||!node.material||Array.isArray(node.material))return;
      const replacement=palette.get(node.material.color?.getHex());
      if(replacement!==undefined){const material=localMaterial(node);material.color.setHex(replacement);material.metalness=.28;material.roughness=.7;}
    });
    const ivory=0xc2c2b2,paintedMetal=0x83938d,frameColor=0x697a75,orange=0xa45a32;
    const bolt=(parent,horizontal,vertical,depth,normal='front')=>{
      const fastener=cyl(parent,horizontal,vertical,depth,.018,.018,.012,0x46534f,12,{metalness:.75,roughness:.5});
      fastener.rotation.x=normal==='front'?Math.PI/2:0;
      if(normal==='side')fastener.rotation.z=Math.PI/2;
      return fastener;
    };
    const accessPanel=(parent,horizontal,vertical,depth,width,height,color=ivory)=>{
      const panel=surface(box(parent,horizontal,vertical,depth,width,height,.035,color,{metalness:.24,roughness:.76}),'metal',width,height);
      panel.material.color.setHex(color);
      for(const side of [-1,1])for(const verticalSide of [-1,1])bolt(parent,horizontal+side*(width/2-.075),vertical+verticalSide*(height/2-.075),depth+.024);
      return panel;
    };
    for(const side of [-1,1]) {
      for(let panel=0;panel<6;panel++) {
        const depth=-3.4+panel*2.6,bulkhead=new THREE.Group();bulkhead.position.set(side*4.65,0,depth);bulkhead.rotation.y=-side*Math.PI/2;g.add(bulkhead);
        accessPanel(bulkhead,0,1.68,0,2.49,2.9,panel%3===0?0xaeb5a8:ivory);
        accessPanel(bulkhead,0,3.7,-.035,2.49,1.05,0xadb5a9);
        box(bulkhead,0,.38,.03,2.42,.07,.055,orange,{metalness:.1,roughness:.85});
        if(panel%2===0) {
          box(bulkhead,.7,1.8,.08,.035,.26,.055,0x52635a,{metalness:.68,roughness:.56});
          for(let vent=0;vent<8;vent++)box(bulkhead,-.85+vent*.087,2.58,.028,.035,.24,.02,0x61756b,{metalness:.4,roughness:.72});
          text(bulkhead,'ACCESS / '+String(panel+11).padStart(2,'0'),-.42,1.01,.041,.84,'#5c6b61');
        }
      }
      const overhead=surface(box(g,side*2.05,4.38,3.75,1.4,.23,18.2,0xc9c8b8,{metalness:.22,roughness:.76}),'metal',2,14);overhead.material.color.setHex(0xc9c8b8);
      const duct=cyl(g,side*3.57,4.09,3.3,.19,.19,18.7,paintedMetal,36,{metalness:.62,roughness:.6});duct.rotation.x=Math.PI/2;
      for(let clamp=0;clamp<14;clamp++) {
        const depth=-5.2+clamp*1.32,ring=new THREE.Mesh(new THREE.TorusGeometry(.197,.018,8,32),mat(0x586e63,{metalness:.74,roughness:.53}));
        ring.position.set(side*3.57,4.09,depth);g.add(ring);
        box(g,side*3.57,4.35,depth,.08,.3,.1,0x65796b,{metalness:.6,roughness:.64});
      }
      for(let cable=0;cable<3;cable++) {
        const cablePath=new THREE.CatmullRomCurve3([new THREE.Vector3(side*(4.35-cable*.06),3.93,-6.9),new THREE.Vector3(side*(4.4-cable*.06),3.94,-3),new THREE.Vector3(side*(4.4-cable*.06),3.94,4),new THREE.Vector3(side*(4.32-cable*.06),3.85,12.5)]);
        const conduit=new THREE.Mesh(new THREE.TubeGeometry(cablePath,32,.023,8,false),mat(cable===1?0x956342:0x394b44,{roughness:.83,metalness:.08}));g.add(conduit);
      }
    }
    for(const side of [-1,1]) {
      surface(box(g,side*3.04,2.18,-6.5,3.9,4.3,.28,ivory,{metalness:.3,roughness:.77}),'metal',3,3).material.color.setHex(ivory);
      box(g,side*1.12,1.88,-6.3,.18,3.66,.24,frameColor,{metalness:.6,roughness:.59});
      box(g,side*1.005,1.88,-6.27,.033,3.66,.07,0x273e32,{roughness:.95});
      for(const vertical of [.25,1.48,2.86,3.46])bolt(g,side*1.11,vertical,-6.166);
      text(g,side<0?'CABIN PRESSURE':'EMERGENCY SEAL',side*2.4,2.93,-6.325,1.23,'#53665a');
      accessPanel(g,side*2.4,1.8,-6.327,1.25,1.18,0xb0b7a6);
      box(g,side*2.4,1.57,-6.285,.7,.06,.025,orange,{roughness:.82});
      collider(w,side*3.04,-6.5,3.9,.28);
    }
    box(g,0,3.86,-6.5,2.1,.86,.28,ivory,{metalness:.35,roughness:.7});
    box(g,0,3.4,-6.3,2.42,.15,.24,frameColor,{metalness:.65,roughness:.55});
    text(g,'HABITAT  /  01',0,3.85,-6.338,1.65,'#4e6156');
    const serviceHatch=new THREE.Group();serviceHatch.position.set(0,0,13.14);serviceHatch.rotation.y=Math.PI;g.add(serviceHatch);
    accessPanel(serviceHatch,0,1.65,0,2.12,3.25,0x9daaa0);
    const hatchWheel=new THREE.Mesh(new THREE.TorusGeometry(.27,.03,10,48),mat(0x72887a,{metalness:.67,roughness:.54}));hatchWheel.position.set(.45,1.65,.07);serviceHatch.add(hatchWheel);
    for(let spoke=0;spoke<3;spoke++)rod(serviceHatch,[.45,1.65,.075],[.45+Math.cos(spoke*Math.PI*2/3)*.27,1.65+Math.sin(spoke*Math.PI*2/3)*.27,.075],.018,0x718475);
    text(serviceHatch,'AIRLOCK / KEEP CLEAR',0,2.85,.026,1.7,'#53685a');
    for(const horizontal of [-2.8,2.8]) {
      box(g,horizontal,3.76,-9.75,.13,.19,6.5,0xc4c4b2,{metalness:.22,roughness:.73});
      for(let clamp=0;clamp<5;clamp++)bolt(g,horizontal,3.68,-12.3+clamp*1.25,'top');
    }
    surface(box(g,0,4.49,-9.4,6.35,.2,6.05,0xc7c9b9,{metalness:.2,roughness:.79}),'metal',4,4).material.color.setHex(0xc7c9b9);
    accessPanel(g,0,3.52,-12.86,2.8,.62,0x667c71);
    for(let switchIndex=0;switchIndex<10;switchIndex++) {
      const horizontal=-1.11+switchIndex*.247;
      box(g,horizontal,3.49,-12.801,.13,.22,.035,0x344d40,{roughness:.81});
      glow(g,horizontal,3.63,-12.777,.045,.025,.012,switchIndex%3?0x9da479:0xbc7549,.45);
      rod(g,[horizontal,3.49,-12.771],[horizontal,3.54,-12.704],.012,0xa9b4a1);
    }
    text(g,'FLIGHT / RCS / GRAV',0,3.93,-12.864,2.1,'#879b85');
    const windscreenPaths=[
      [[-4.5,.96,-13.31],[-3.03,4.32,-13.31]],[[4.5,.96,-13.31],[3.03,4.32,-13.31]],
      [[-3.03,4.32,-13.31],[3.03,4.32,-13.31]],[[-4.5,.96,-13.31],[4.5,.96,-13.31]]
    ];
    for(const [start,end] of windscreenPaths) {
      rod(g,start,end,.075,0x283c31);
      const innerStart=start.map((value,axis)=>axis===2?value+.08:value),innerEnd=end.map((value,axis)=>axis===2?value+.08:value);
      rod(g,innerStart,innerEnd,.032,0x8e9e8b);
    }
    for(const side of [-1,1]) {
      const diagonal=[side*1.4,1.54,-13.35];rod(g,diagonal,[side*.93,3.37,-13.35],.045,0x667d6d);
      accessPanel(g,side*3.24,1.13,-11.74,1.15,.65,0x73877a);
      for(let switchIndex=0;switchIndex<6;switchIndex++) {
        const horizontal=side*3.24-.4+switchIndex*.16;
        bolt(g,horizontal,1.14,-11.704);glow(g,horizontal,1.32,-11.71,.035,.025,.018,switchIndex%2?0x8fa187:orange,.32);
      }
      text(g,side<0?'ELECTRICAL':'LIFE SUPPORT',side*3.24,.94,-11.707,.88,'#bdc4ac');
      const grab=new THREE.CatmullRomCurve3([new THREE.Vector3(side*2.13,1.05,-10.78),new THREE.Vector3(side*2.13,1.3,-10.78),new THREE.Vector3(side*2.13,1.32,-10.12),new THREE.Vector3(side*2.13,1.05,-10.12)]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(grab,22,.028,10,false),mat(orange,{metalness:.28,roughness:.72})));
    }
    const chartBoard=new THREE.Group();chartBoard.position.set(3.35,1.4,-8.5);chartBoard.rotation.y=-.32;g.add(chartBoard);
    accessPanel(chartBoard,0,0,0,.62,.88,0x5e7163);box(chartBoard,0,0,.026,.53,.73,.009,0xc1c6ad,{roughness:1});
    for(let row=0;row<9;row++)box(chartBoard,-.03,.25-row*.062,.034,.36,.007,.003,0x7a8e73,{roughness:1});
    text(g,'FRONTIER',0,.58,-13.185,1.95,'#a3b59a');
    text(g,'CONSTELLATION  /  EXPLORATION VESSEL',0,3.17,-6.294,1.7,'#748878');
    text(g,'01  /  FLIGHT DECK',0,3.79,-6.665,1.6,'#566d5d').rotation.y=Math.PI;
    const cockpitShell=new THREE.Group();g.add(cockpitShell);
    for(const side of [-1,1]) {
      const sideWall=surface(box(cockpitShell,side*2.87,1.23,-10.04,.21,2.46,6.24,0xaeb6a7,{metalness:.27,roughness:.73}),'metal',2,4);sideWall.material.color.setHex(0xaeb6a7);
      const windowBand=box(cockpitShell,side*2.86,2.92,-9.36,.22,1.46,4.86,0xbdc0ae,{metalness:.24,roughness:.72});
      const slopingSide=surface(box(cockpitShell,side*2.73,3.9,-9.39,.86,.22,5.76,0xc7c9b8,{metalness:.22,roughness:.74}),'metal',2,4);slopingSide.rotation.z=side*.45;slopingSide.material.color.setHex(0xc7c9b8);
      for(let station=0;station<5;station++) {
        const depth=-11.6+station*1.12;
        box(cockpitShell,side*2.72,1.53,depth,.11,2.85,.09,0x667d6c,{metalness:.56,roughness:.65});
        for(const height of [.31,1.03,1.86,2.42])bolt(cockpitShell,side*2.651,height,depth,'side');
      }
      box(cockpitShell,side*2.55,.54,-9.55,.3,.11,5.1,0x6c735e,{metalness:.51,roughness:.72});
      const rack=surface(box(cockpitShell,side*2.2,1.08,-8.18,.94,1.52,1.13,0x7a8d7b,{metalness:.45,roughness:.69}),'metal',2,2);rack.material.color.setHex(0x7a8d7b);
      for(let drawer=0;drawer<3;drawer++) {
        accessPanel(cockpitShell,side*2.2,.58+drawer*.42,-7.597,.77,.34,drawer===1?0x5b7260:0x9ca68d);
        box(cockpitShell,side*2.2,.57+drawer*.42,-7.558,.23,.022,.048,0x445c4b,{metalness:.62,roughness:.6});
      }
      const sideDisplay=new THREE.Group();sideDisplay.position.set(side*2.67,1.77,-10.5);sideDisplay.rotation.y=-side*.8;cockpitShell.add(sideDisplay);
      screen(sideDisplay,0,0,0,.74,.47,side<0?0xdda969:0x81d7eb);
      const glareshield=box(flightDeck,side*1.48,1.56,-11.91,1.25,.06,.27,0x273e30,{roughness:.92});glareshield.rotation.x=.03;
      rod(cockpitShell,[side*1.4,.89,-13.35],[side*1.4,1.58,-13.35],.045,0x667d6d);
      rod(cockpitShell,[side*.93,3.34,-13.35],[side*.93,4.41,-13.35],.045,0x667d6d);
      box(cockpitShell,side*.94,3.76,-13.36,.2,.75,.14,0xb4bca8,{metalness:.33,roughness:.74});
      point(cockpitShell,side*2.38,1.05,-10.42,side<0?0xe8b274:0xa7c1bd,.22,3.7);
      glow(cockpitShell,side*2.52,.27,-9.4,.08,.025,4.25,0xbc9857,.45);
      collider(w,side*2.85,-9.4,.22,5.5);
      collider(w,side*2.2,-8.18,.95,1.2);
    }
    box(cockpitShell,0,4.28,-9.35,5.52,.23,5.9,0xc6c7b7,{metalness:.22,roughness:.75});
    box(flightDeck,0,1.56,-11.91,1.52,.06,.27,0x273e30,{roughness:.92});
    box(cockpitShell,0,3.03,-11.35,.68,.12,1.87,0x425b47,{metalness:.45,roughness:.7});
    for(let row=0;row<7;row++) {
      for(const side of [-1,1])glow(cockpitShell,side*.19,2.96,-12.06+row*.22,.09,.018,.08,row%3?0x81966c:0xba7649,.35);
    }
    point(cockpitShell,0,3.58,-8.1,0xe7c396,.4,4.8);
    w.previewCamera={position:pilot.seat.slice(),yaw:0,pitch:.015};
    w.description = { en: 'The Frontier flight deck: instruments, pressure seals, and a sky without limits.', 'zh-CN': '开拓号驾驶舱：仪表、承压密封，以及没有边界的星空。', 'zh-TW': '開拓號駕駛艙：儀表、承壓密封，以及沒有邊界的星空。' }; return w;
  }

  function train(kit) {
    K=kit||K;
    const w=baseWorld('train',0x10171c); w.spawn=[0,1.68,8]; w.bounds={minX:-2.2,maxX:11.8,minZ:-16,maxZ:16}; const g=w.group;
    const outside=new THREE.Group(); g.add(outside);
    const platform=box(outside,7.25,-.26,0,9.5,.5,80,0x45474a,{roughness:1});
    for (let z=-36;z<=36;z+=2) { box(outside,2.9,.009,z,.24,.018,1.5,0x9b8d5e); box(outside,7.2,.012,z,8,.016,.03,0x697173); }
    for (let z=-32;z<=32;z+=12) { lamp(outside,10,z,4,0xffc78e); bench(outside,9,z+3,Math.PI/2); }
    for (const x of [-1.25,1.25]) box(outside,x,-.24,0,.09,.16,180,0x92989b,{metalness:.8});
    for (let z=-80;z<80;z+=2) box(outside,0,-.37,z,3.9,.18,.18,0x4a4037);
    box(outside,9.9,3.1,-7,.12,.6,3.4,0x243037); text(outside,'03   /   NIGHT LINE',8.5,3.12,-7,2.8,'#ead4a5');
    const scenery=[]; for(let i=0;i<30;i++) { const s=box(outside,-8-(i%4)*5,1.5+(i%3),-80+i*6,2.5,3+(i%3)*2,3,0x182831); scenery.push(s); }
    // Seats sit below the large, unglazed panoramic windows. The doors have a real opening.
    surface(box(g,0,-.12,0,4.8,.24,33,0x6e5547),'wood',2,12);
    box(g,0,3.48,0,4.9,.22,33,0xa29f96,{metalness:0,roughness:1});
    for(let z=-15;z<=15;z+=2.5){
      box(g,0,3.355,z,3.1,.013,.014,0x726f65,{metalness:0,roughness:1});
      for(const side of [-1,1]){
        box(g,side*1.38,3.346,z,.22,.02,.32,0x7d7b71,{metalness:.05,roughness:.95});
        for(let slot=0;slot<5;slot++)box(g,side*1.38,3.332,z-.12+slot*.06,.17,.005,.008,0x494d49,{roughness:1});
      }
    }
    for(const side of [-1,1]) {
      for(const interval of (side===1?[[-16,1.8],[4.2,16]]:[[-16,16]])) {
        const center=(interval[0]+interval[1])/2,length=interval[1]-interval[0];
        box(g,side*2.4,.45,center,.18,.9,length,0x2d414c,{metalness:.5}); box(g,side*2.4,3.05,center,.18,.72,length,0x394b53,{metalness:.5});
        collider(w,side*2.4,center,.22,length);
      }
      for(let z=-15;z<16;z+=3) {
        if(side===1&&z>=1.7&&z<=4.3) continue;
        box(g,side*2.4,1.92,z,.2,2.08,.14,0x8b958e,{metalness:.55});
        box(g,side*2.285,.45,z,.013,.66,.012,0x111b23);
        for(const y of [.21,.72]){const fastener=cyl(g,side*2.27,y,z-.12,.014,.014,.02,0x9aabad,12,{metalness:.8});fastener.rotation.z=Math.PI/2;}
        box(g,side*2.12,2.8,z,.36,.018,2.6,0x78858a,{metalness:.6});
        for(let i=0;i<5;i++)box(g,side*2.02,2.824,z-1.1+i*.5,.22,.024,.012,0x3e4b50,{metalness:.65});
      }
      glow(g,side*1.7,3.32,0,.055,.035,31,0xffd2a0,.7);
    }
    for(let z=-13.5;z<14;z+=4.5) {
      if(z>1&&z<5) continue;
      for(const side of [-1,1]) {
        upholstery(g,side*1.52,.51,z,1.2,.23,.99,0x66787c);
        const back=upholstery(g,side*1.52,.99,z+.43,1.19,.97,.23,0x4b6268,true);back.rotation.x=.075;
        upholstery(g,side*1.52,1.45,z+.47,.81,.18,.27,0xa3aaa1,true);
        upholsteredSeam(g,side*1.52,.98,z+.57,1.04,.82,0x657b7d);
        for(const sideOffset of [-.41,.41]){
          upholstery(g,side*1.52+sideOffset,.95,z+.36,.12,.72,.16,0x566c73,true);
          line(g,[[side*1.52+sideOffset,.63,z+.57],[side*1.52+sideOffset,1.31,z+.59]],0x64797b,.17);
        }
        for(const offset of [-.58,.58]){
          upholstery(g,side*1.52+offset,.74,z+.05,.1,.075,.62,0x777f78);
          rod(g,[side*1.52+offset,.48,z+.24],[side*1.52+offset,.7,z+.24],.017,0x647077);
        }
        for(const legX of [side*1.1,side*1.95])for(const dz of [-.36,.36])rod(g,[legX,.06,z+dz],[legX,.45,z+dz],.026,0x4b5559);
        for(const px of [side*.96,side*2.08])line(g,[[px,.65,z-.42],[px,.65,z+.34],[px,1.35,z+.39]],0x849293,.65);
        for(const x of [side*.91,side*2.13]) rod(g,[x,.6,z-.65],[x,.75,z+.35],.035,0x9a8e73);
        collider(w,side*1.52,z,1.25,1.55);
      }
    }
    // End walls frame a glazed observation bay rather than closing off the sky.
    for(const z of [-16.25,16.25]) { box(g,0,.47,z,4.8,.94,.2,0x2d414c); box(g,0,3.06,z,4.8,.7,.2,0x394b53); box(g,-2.25,1.86,z,.27,1.86,.2,0x8b958e); box(g,2.25,1.86,z,.27,1.86,.2,0x8b958e); collider(w,0,z,4.8,.3); }
    const doors=new THREE.Group(); g.add(doors); const leaves=[];
    for(const sign of [-1,1]) { const leaf=new THREE.Group(); doors.add(leaf); leaf.position.set(2.43,0,3+sign*.6); box(leaf,0,.57,0,.12,1.14,1.17,0x6a8288,{metalness:.6}); box(leaf,0,2.9,0,.12,.34,1.17,0x6a8288,{metalness:.6}); for(const dz of [-.56,.56]) box(leaf,0,1.91,dz,.12,1.55,.06,0x9bb0ad,{metalness:.6}); rod(leaf,[-.09,1.15,-sign*.45],[-.09,1.8,-sign*.45],.027,0xc0b58f); leaves.push(leaf); }
    const doorBlock=collider(w,2.43,3,.2,2.4); const state={open:false,door:0,moving:false,speed:0,offset:0}; w.train=state;
    const inDoorway=()=>w.player&&Math.abs(w.player.x-2.43)<.5&&Math.abs(w.player.z-3)<1.4;
    const setDoors=value=>{ state.open=value; };
    const doorAction=interact(w,{id:'train-door',label:copy('Open the carriage door','打开车门','打開車門'),position:[2.18,1.5,3],radius:2.5,action(){
      if(state.moving||state.speed>.1)return copy('Stop at the platform before opening the doors.','停车后才可以打开车门。','停車後才可以打開車門。');
      if(state.open&&inDoorway())return copy('Step clear of the doorway first.','请先离开门口，再关闭车门。','請先離開門口，再關閉車門。');
      setDoors(!state.open);
      return state.open?copy('The doors slide open. Walk out onto the platform.','车门已打开，可以走上站台。','車門已打開，可以走上月台。'):copy('The doors close softly.','车门轻轻合上。','車門輕輕合上。');
    }});
    interact(w,{id:'departure',label:copy('Depart / stop the train','发车 / 停车','發車 / 停車'),position:[0,1.4,-14.8],radius:2.6,action(){if(w.player&&w.player.x>2.2)return copy('Come aboard before departure.','请先回到车厢。','請先回到車廂。');state.moving=!state.moving;if(state.moving)setDoors(false);return state.moving?copy('The night line begins to move.','夜行列车缓缓启动。','夜行列車緩緩啟動。'):copy('Braking for the next quiet platform.','正在驶入下一座安静的站台。','正在駛入下一座安靜的月台。');}});
    screen(g,0,1.22,-16.08,1.2,.4,0xd8b076); text(g,'NIGHT LINE   03',0,2.86,-16.06,2,'#d6bd91');
    point(g,0,2.9,-10,0xffd1a0,1.3,15); point(g,0,2.9,4,0xffd1a0,1.3,17); point(g,8,3.1,3,0xffd29e,1.1,12);
    collider(w,11.8,0,.3,33);
    w.update=(dt,t)=>{
      state.door+=(Number(state.open)-state.door)*Math.min(1,dt*6);
      leaves.forEach((l,i)=>l.position.z=3+(i?1:-1)*(.6+state.door*1.15));
      doorBlock.enabled=state.door<.9;
      doorAction.label=state.open?copy('Close the carriage door','关闭车门','關閉車門'):copy('Open the carriage door','打开车门','打開車門');
      state.speed+=(Number(state.moving&&state.door<.05)*8-state.speed)*Math.min(1,dt*.4);
      if(state.speed<.01)state.speed=0;
      state.offset=(state.offset+state.speed*dt)%36; outside.position.z=state.offset; platform.position.z=-state.offset;
      if(!state.moving&&state.speed===0){outside.position.z=0;state.offset=0;platform.position.z=0;}
    };
    w.description=copy('A warm carriage, passing lights, and a deserted platform.','温暖的车厢、掠过的灯光和无人的夜间站台。','溫暖的車廂、掠過的燈光和無人的夜間月台。'); return w;
  }

  function room(kit) {
    K=kit||K;
    const w=baseWorld('room',0x171d23),g=w.group;
    w.spawn=[0,1.68,2.3];w.yaw=.06;w.pitch=-.015;
    w.bounds={minX:-4.13,maxX:4.13,minZ:-5.83,maxZ:3.58};
    // Human-scale bedroom/study: 8.5 by 7.5 metres, with a 3.1 m ceiling.
    // The arrival composition puts the bed left, lamplit desk right, and the
    // wide balcony opening directly ahead. There is no procedural floor grid.
    const plaster=(mesh,rx,ry)=>{
      surface(mesh,'concrete',rx,ry);
      if(mesh.material.userData.shared)localMaterial(mesh);
      mesh.material.map=null;mesh.material.roughnessMap=null;
      mesh.material.color.setHex(0xd7ccbb);mesh.material.roughness=1;mesh.material.needsUpdate=true;
      if(mesh.material.normalScale)mesh.material.normalScale.set(.065,.065);
      return mesh;
    };
    plaster(box(g,-4.25,1.55,0,.18,3.1,7.5,0xc7b9a3),4,2);
    plaster(box(g,4.25,1.55,0,.18,3.1,7.5,0xc7b9a3),4,2);
    plaster(box(g,0,1.55,3.75,8.5,3.1,.18,0xc7b9a3),4,2);
    surface(box(g,0,-.07,0,8.5,.14,7.5,0xa08b71),'wood',4,4);
    box(g,0,3.18,0,8.5,.16,7.5,0xc7c3b9);
    for(const x of [-4.13,4.13])surface(box(g,x,.07,0,.035,.14,7.4,0x9b886f),'wood',1,4);
    surface(box(g,0,.07,3.63,8.25,.14,.035,0x9b886f),'wood',4,1);
    collider(w,-4.25,0,.18,7.5);collider(w,4.25,0,.18,7.5);collider(w,0,3.75,8.5,.18);
    // Two broad windows flank a full-height, genuinely traversable door.
    for(const side of [-1,1]){
      plaster(box(g,side*3.7,1.55,-3.75,1.1,3.1,.18,0xc7b9a3),1,2);
      plaster(box(g,side*1.94,.21,-3.75,2.48,.42,.18,0xc7b9a3),2,1);
      box(g,side*3.12,1.75,-3.68,.075,2.6,.13,0x867866);
      box(g,side*.71,1.75,-3.68,.065,2.6,.13,0x867866);
      surface(box(g,side*1.93,.46,-3.57,2.48,.045,.28,0xa69072),'wood',2,1);
      collider(w,side*3.7,-3.75,1.1,.2);
      collider(w,side*1.94,-3.75,2.48,.2);
    }
    box(g,0,3.045,-3.75,6.3,.11,.2,0x867866);
    surface(box(g,0,-.06,-4.83,6.7,.12,2.16,0xa08b71),'wood',4,1.5);
    box(g,0,1.03,-5.93,6.65,.035,.055,0x5e6a6b,{metalness:.65});
    for(let x=-3.2;x<=3.25;x+=.28)box(g,x,.53,-5.93,.018,1.01,.018,0x5e6a6b,{metalness:.55});
    for(const x of [-3.34,3.34]){
      box(g,x,1.03,-4.85,.035,.035,2.16,0x5e6a6b,{metalness:.65});
      collider(w,x,-4.85,.1,2.2);
    }
    collider(w,0,-5.94,6.7,.1);
    // Upholstered bed: normal mattress size, low timber frame and soft linens.
    const bx=-2.63,bz=.02;
    surface(box(g,bx,.3,bz,1.85,.24,2.34,0x876d53),'wood',2,2);
    upholstery(g,bx,.5,bz,1.78,.22,2.22,0xd4d0c3);
    const blanketGeometry=new THREE.PlaneGeometry(2,1.76,40,36),blanketPositions=blanketGeometry.attributes.position;
    for(let index=0;index<blanketPositions.count;index++){
      const horizontal=blanketPositions.getX(index),longitudinal=-.34-blanketPositions.getY(index);
      const side=Math.max(0,(Math.abs(horizontal)-.82)/.18),foot=Math.max(0,(-longitudinal-1.02)/.2);
      const sideFall=side*side*(3-2*side),footFall=foot*foot*(3-2*foot);
      const folds=(Math.sin(longitudinal*4.2+horizontal*.8)*.014+Math.sin(horizontal*5.1-longitudinal*.4)*.011)*(1-sideFall*.7);
      const turnedEdge=Math.exp(-Math.pow((longitudinal-.37)/.14,2))*.027;
      blanketPositions.setXYZ(index,horizontal*.95,.634+folds+turnedEdge-sideFall*.21-footFall*.16,longitudinal);
    }
    blanketGeometry.computeVertexNormals();
    const blanket=surface(new THREE.Mesh(blanketGeometry,mat(0x7f9098,{roughness:1,metalness:0})),'fabric',3,3);
    blanket.material.side=THREE.DoubleSide;blanket.position.set(bx,0,bz);blanket.castShadow=true;blanket.receiveShadow=true;g.add(blanket);
    upholstery(g,bx,.72,bz+1.16,1.96,1.05,.15,0x998b78,true);
    for(const side of [-1,1]){
      const pillow=upholstery(g,bx+side*.43,.704,bz+.76,.73,.185,.45,0xded8c9);
      pillow.rotation.y=side*.025;pillow.rotation.z=side*.018;
    }
    for(const x of [bx-.75,bx+.75])for(const z of [bz-.91,bz+.91])cyl(g,x,.13,z,.035,.045,.26,0x685447,20);
    collider(w,bx,bz,1.96,2.4);
    surface(box(g,-3.72,.5,1.04,.49,.035,.48,0x9c8061),'wood');
    for(const x of [-3.9,-3.54])rod(g,[x,.02,.87],[x,.48,.87],.015,0x625344);
    box(g,-3.71,.545,1.03,.23,.055,.3,0x655f59);
    // The writing desk is visible in the arrival view, looking toward the window.
    const dx=2.63,dz=-1.62;
    surface(box(g,dx,.76,dz,2.05,.065,.78,0xa88a66),'wood',2,1);
    for(const x of [dx-.88,dx+.88])for(const z of [dz-.27,dz+.27])surface(box(g,x,.37,z,.045,.73,.045,0x66533f),'wood');
    collider(w,dx,dz,2.05,.78);
    const chair=new THREE.Group();chair.position.set(dx,0,dz+.77);chair.rotation.y=Math.PI;g.add(chair);
    surface(box(chair,0,.45,0,.48,.06,.47,0x9f8665),'wood');
    surface(box(chair,0,.74,-.21,.49,.43,.055,0x9f8665),'wood');
    for(const x of [-.18,.18])for(const z of [-.17,.17])rod(chair,[x,.02,z],[x,.43,z],.021,0x68533e);
    collider(w,dx,dz+.77,.48,.47);
    const deskLamp=new THREE.Group();g.add(deskLamp);
    const lampFallback=new THREE.Group();lampFallback.position.set(dx+.67,.8,dz-.03);deskLamp.add(lampFallback);
    cyl(lampFallback,0,0,0,.11,.11,.025,0x736b5b,32);
    rod(lampFallback,[0,.01,0],[0,.3,0],.009,0x9a896f);
    rod(lampFallback,[0,.3,0],[-.2,.48,0],.009,0x9a896f);
    cyl(lampFallback,-.21,.47,0,.055,.12,.1,0x456253,32);
    let lampsOn=true;
    const loadedLampMaterials=[];const loadedLampMaterialMap=new WeakMap();
    const readingLight=point(g,dx+.46,1.221,dz-.03,0xffce94,1,5);
    const setLoadedLampState=on=>loadedLampMaterials.forEach(material=>{
      material.emissiveIntensity=on?material.userData.lampEmissiveIntensity:0;
      material.needsUpdate=true;
    });
    if(K.model)K.model(deskLamp,'desk_lamp_arm_01',dx+.62,.8,dz-.03,{height:.54,rotationY:-.65,onLoad(holder){
      lampFallback.visible=false;
      holder.updateWorldMatrix(true,true);
      const emitterBounds=new THREE.Box3();
      holder.traverse(object=>{
        if(!object.isMesh||!object.material)return;
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(material=>{
          if(!material.emissive||material.emissive.getHex()===0||loadedLampMaterialMap.has(material))return;
          const dynamic=material.clone();dynamic.userData.shared=false;dynamic.userData.lampEmissiveIntensity=material.emissiveIntensity;
          loadedLampMaterials.push(dynamic);loadedLampMaterialMap.set(material,dynamic);
        });
        if(materials.some(material=>material.emissive&&material.emissive.getHex()!==0)){
          emitterBounds.union(new THREE.Box3().setFromObject(object));
          object.castShadow=false;
        }
        if(loadedLampMaterials.length){
          object.material=Array.isArray(object.material)?object.material.map(material=>loadedLampMaterialMap.get(material)||material):(loadedLampMaterialMap.get(object.material)||object.material);
        }
      });
      if(!emitterBounds.isEmpty()){
        const center=emitterBounds.getCenter(new THREE.Vector3());
        readingLight.position.copy(readingLight.parent.worldToLocal(center));
      }
      setLoadedLampState(lampsOn);
    }});
    const bulb=sph(lampFallback,-.21,.421,0,.034,0xffd89b,{emissive:0xffd89b,emissiveIntensity:1.2});
    bulb.castShadow=false;
    box(g,dx-.05,.798,dz+.03,.4,.01,.29,0xdfd7c7);
    box(g,dx-.05,.805,dz+.03,.008,.003,.27,0x7c6d59);
    rod(g,[dx-.42,.808,dz+.04],[dx-.15,.808,dz+.15],.003,0x3b4448);
    cyl(g,dx-.65,.864,dz-.11,.053,.049,.13,0xd8c9ae,32,{roughness:.35});
    // Reading corner just inside the left window; the main aisle stays clear.
    const loungeFallback=new THREE.Group();loungeFallback.position.set(-2.31,0,-2.66);loungeFallback.rotation.y=.28;g.add(loungeFallback);
    surface(box(loungeFallback,0,.4,0,.8,.16,.82,0x8e8375),'fabric');
    const loungeBack=surface(box(loungeFallback,0,.72,.33,.8,.61,.15,0x8e8375),'fabric');loungeBack.rotation.x=-.17;
    if(K.model)K.model(g,'mid_century_lounge_chair',-2.31,0,-2.66,{height:.91,rotationY:.28,onLoad(){loungeFallback.visible=false;}});
    collider(w,-2.31,-2.66,.93,.93);
    cyl(g,-1.44,.46,-2.68,.25,.25,.03,0x9a8163,48);cyl(g,-1.44,.22,-2.68,.018,.05,.44,0x5e4f3e,24);
    plant(g,3.63,-2.91,.82);plant(g,2.79,-5.02,.78);
    // Floor lamp and bookcase fill the rear without crowding the night view.
    const lx=-1.25,lz=1.44;
    cyl(g,lx,.025,lz,.2,.2,.05,0x645d50,32);cyl(g,lx,.78,lz,.011,.011,1.55,0x9c8a6a,20);
    const floorShade=surface(cyl(g,lx,1.63,lz,.18,.27,.32,0xd0bb99,48,{emissive:0x8d6540,emissiveIntensity:.15}),'fabric',2,1);
    const standing=point(g,lx,1.54,lz,0xffc78f,1.15,7);
    point(g,0,2.6,-3.18,0x8caec5,.55,8);
    localMaterial(bulb);localMaterial(floorShade);
    const readingIntensity=readingLight.intensity,standingIntensity=standing.intensity;
    surface(box(g,3.79,1.03,1.83,.36,2.06,1.6,0x7d6650),'wood',1,2);
    for(const y of [.19,.71,1.23,1.75])surface(box(g,3.52,y,1.83,.5,.025,1.5,0xa48a69),'wood',1,2);
    const bookColors=[0x7c8990,0x947963,0xaea28a,0x686c76,0x667e70];
    for(let i=0;i<22;i++){const row=Math.floor(i/6),j=i%6;box(g,3.47,.36+row*.52,1.2+j*.22,.22,.26+(j%3)*.03,.09,bookColors[i%5]);}
    collider(w,3.7,1.83,.62,1.65);
    surface(box(g,.15,.013,.28,2.22,.02,2.85,0xa6a095),'fabric',3,4);
    box(g,-4.13,1.76,.05,.055,.8,1.03,0x987955);box(g,-4.096,1.76,.05,.008,.71,.94,0x475d67);
    // Back-wall door is purely architectural, not a navigation portal.
    surface(box(g,.55,1.02,3.642,.85,2.04,.035,0x8e755a),'wood',1,2);
    for(const x of [.1,1])box(g,x,1.04,3.605,.045,2.1,.025,0x9e8b71);
    box(g,.55,2.095,3.605,.95,.045,.025,0x9e8b71);
    const handle=cyl(g,.86,.99,3.58,.012,.012,.13,0x9b9787,20,{metalness:.7});handle.rotation.z=Math.PI/2;
    // Balcony seat overlooks the existing sky, with no relation to site content.
    bench(g,-1.46,-5.17,Math.PI);
    cyl(g,-.1,.48,-5.04,.27,.27,.03,0x927958,40);cyl(g,-.1,.23,-5.04,.025,.06,.46,0x62543f,20);
    const curtainL=new THREE.Group(),curtainR=new THREE.Group();g.add(curtainL,curtainR);
    curtainL.position.set(-3.04,0,-3.49);curtainR.position.set(3.04,0,-3.49);
    curtainL.userData.curtain=curtainR.userData.curtain=true;
    for(const side of [-1,1]){
      const geometry=new THREE.PlaneGeometry(.58,2.62,30,6),positions=geometry.attributes.position;
      for(let i=0;i<positions.count;i++){const x=positions.getX(i)+.29;positions.setX(i,x*side);positions.setZ(i,Math.cos(x*Math.PI*24)*.028);}
      geometry.computeVertexNormals();const material=mat(0xb8a89a,{roughness:1});material.side=THREE.DoubleSide;
      const panel=surface(new THREE.Mesh(geometry,material),'fabric',1,4);panel.position.y=1.71;(side===1?curtainL:curtainR).add(panel);
    }
    rod(g,[-3.14,3.04,-3.49],[3.14,3.04,-3.49],.014,0x9b8666);
    let curtainsOpen=true,sitting=false,curtainAmount=0;
    interact(w,{id:'curtains',label:copy('Draw / part the curtains','拉合 / 拉开窗帘','拉合 / 拉開窗簾'),position:[-.83,1.65,-3.24],radius:1.8,action(){curtainsOpen=!curtainsOpen;return curtainsOpen?copy('The night fills the room.','夜空重新映入房间。','夜空重新映入房間。'):copy('The curtains close softly. The balcony door stays open.','窗帘轻轻合拢，阳台门依旧敞开。','窗簾輕輕合攏，陽台門依舊敞開。');}});
    interact(w,{id:'reading-light',label:copy('Switch the reading lamps','开关阅读灯','開關閱讀燈'),position:[dx+.35,1.1,dz+.1],radius:2,action(){lampsOn=!lampsOn;readingLight.intensity=lampsOn?readingIntensity:0;standing.intensity=lampsOn?standingIntensity:0;bulb.material.emissiveIntensity=lampsOn?1.2:0;floorShade.material.emissiveIntensity=lampsOn?.15:0;setLoadedLampState(lampsOn);return lampsOn?copy('A little warmth in the room.','室内亮起柔和暖光。','室內亮起柔和暖光。'):copy('Only the blue light of the sky remains.','只留下天空的蓝色微光。','只留下天空的藍色微光。');}});
    const seat=[-1.46,-5.31];
    const sitAction=interact(w,{id:'balcony-bench',label:copy('Sit on the balcony','坐在阳台长椅上','坐在陽台長椅上'),position:[seat[0],1.1,-5.17],radius:1.7,action(){sitting=!sitting;if(w.player){w.player.x=seat[0];w.player.z=sitting?seat[1]:-4.57;w.player.y=sitting?1.1:1.68;}sitAction.label=sitting?copy('Stand up','站起来','站起來'):copy('Sit on the balcony','坐在阳台长椅上','坐在陽台長椅上');return sitting?copy('A quiet seat beneath the stars. Move to stand up.','在星空下坐一会儿，移动即可起身。','在星空下坐一會兒，移動即可起身。'):copy('Back on your feet.','重新站起身。','重新站起身。');}});
    w.update=(dt,t)=>{
      curtainAmount+=(Number(!curtainsOpen)-curtainAmount)*Math.min(1,dt*3);
      curtainL.scale.x=curtainR.scale.x=1+curtainAmount*3.02;
      curtainL.rotation.y=Math.sin(t*.45)*.009;curtainR.rotation.y=Math.sin(t*.45+2)*.009;
      if(sitting&&w.player&&(Math.hypot(w.player.x-seat[0],w.player.z-seat[1])>.025||w.player.y>1.3)){
        sitting=false;w.player.y=1.68;sitAction.label=copy('Sit on the balcony','坐在阳台长椅上','坐在陽台長椅上');
      }
    };
    w.description=copy('A lamplit bedroom and study, opening onto a quiet balcony.','一间亮着暖灯的卧室兼书房，通往安静的星空阳台。','一間亮著暖燈的臥室兼書房，通往安靜的星空陽台。');
    return w;
  }
  Object.assign(B, { spaceship });
})();

/* Shared, local geometry for the places beneath the sky. */
(() => {
    'use strict';
    const T = window.THREE;
    if (!T) return;
    const materials = new Map();
    const geometries = new Map();
    const textureSets = new Map(), textureSources = new Map(), modelSources = new Map();
    const texturePaths = {
        wood: ['wood_floor','diff','nor_gl','rough'],
        soil: ['brown_mud','diff','nor_gl','rough'],
        fabric: ['fabric_pattern_07','col_1','nor_gl','rough'],
        concrete: ['brushed_concrete','diff','nor_gl','rough'],
        metal: ['rusty_metal_03','diff','nor_gl','rough']
    };
    function roundedBox(w,h,d) {
        const r=Math.min(.065,w*.08,h*.08,d*.08), half=[w/2,h/2,d/2];
        const positions=[], normals=[], uvs=[], indices=[];
        for(let axis=0;axis<3;axis++) for(const sign of [-1,1]) {
            const u=(axis+1)%3,v=(axis+2)%3, base=positions.length/3;
            const coords=a=>[-half[a],-half[a]+r*.3,-half[a]+r,half[a]-r,half[a]-r*.3,half[a]];
            const us=coords(u),vs=coords(v);
            for(let j=0;j<6;j++) for(let i=0;i<6;i++) {
                const p=[0,0,0];p[axis]=half[axis]*sign;p[u]=us[i];p[v]=vs[j];
                const inner=p.map((n,a)=>Math.max(-half[a]+r,Math.min(half[a]-r,n)));
                const normal=new T.Vector3(p[0]-inner[0],p[1]-inner[1],p[2]-inner[2]).normalize();
                positions.push(inner[0]+normal.x*r,inner[1]+normal.y*r,inner[2]+normal.z*r);
                normals.push(normal.x,normal.y,normal.z);uvs.push((us[i]+half[u])/(2*half[u]),(vs[j]+half[v])/(2*half[v]));
            }
            for(let j=0;j<5;j++) for(let i=0;i<5;i++) {
                const a=base+j*6+i,b=a+1,c=a+6,e=c+1;
                if(sign>0)indices.push(a,b,e,a,e,c);else indices.push(a,e,b,a,c,e);
            }
        }
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
        g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
        g.setIndex(indices);return g;
    }
    function material(color, options = {}) {
        const properties = { color, roughness: options.roughness ?? .85, metalness: options.metalness ?? .05,
            emissive: options.emissive ?? 0, emissiveIntensity: options.emissiveIntensity ?? 0,
            transparent: options.transparent ?? false, opacity: options.opacity ?? 1,
            side: options.side ?? T.FrontSide };
        const key = JSON.stringify(properties);
        if (!materials.has(key)) {
            const m = new T.MeshStandardMaterial(properties);
            m.userData.shared = true;
            materials.set(key, m);
        }
        return materials.get(key);
    }
    function geometry(key, build) {
        if (!geometries.has(key)) {
            const g = build(); g.userData.shared = true; geometries.set(key, g);
        }
        return geometries.get(key);
    }
    function mesh(parent, geometry, color, x, y, z, options = {}) {
        const m = new T.Mesh(geometry, material(color, options));
        m.position.set(x, y, z); m.rotation.y = options.rotationY || 0;
            m.receiveShadow = true; m.castShadow = true;
        parent.add(m); return m;
    }
    const K = window.NightWorldKit = {
        group: () => new T.Group(), material,
        box(parent, x, y, z, w, h, d, color, o = {}) {
            if(Math.min(w,h,d)>.06 && Math.max(w,h,d)<35 && o.rounded!==false) {
                return mesh(parent,geometry(`round:${w}:${h}:${d}`,()=>roundedBox(w,h,d)),color,x,y,z,o);
            }
            const m = mesh(parent, geometry('box', () => new T.BoxGeometry()), color, x, y, z, o);
            m.scale.set(w, h, d); return m;
        },
        cylinder(parent, x, y, z, rt, rb, h, color, segments = 16, o = {}) {
            const detail=rt===0?segments:Math.max(24,segments);
            return mesh(parent, geometry(`c:${rt}:${rb}:${h}:${detail}`, () => new T.CylinderGeometry(rt, rb, h, detail)), color, x, y, z, o);
        },
        sphere(parent, x, y, z, r, color, o = {}) {
            const m = mesh(parent, geometry('sphere', () => new T.SphereGeometry(1, 32, 20)), color, x, y, z, o);
            m.scale.setScalar(r); return m;
        },
        ground(parent, color, size = 1500, o = {}) {
            const m = mesh(parent, geometry('plane', () => new T.PlaneGeometry(1, 1)), color, 0, -.025, 0, o);
            m.rotation.x = -Math.PI / 2; m.scale.set(size, size, 1);
            m.userData.ground = true;
            m.castShadow = false;
            return m;
        },
        point(parent, x, y, z, color, intensity, distance) {
            const l = new T.PointLight(color, intensity * 5, distance, 1.2);
            l.position.set(x, y, z); l.userData.nominalIntensity = l.intensity; parent.add(l); return l;
        },
        lamp(parent, x, z, h = 3, color = 0xffc285) {
            const g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
            const iron={metalness:.55,roughness:.68};
            K.cylinder(g, 0, h / 2, 0, .029, .049, h, 0x3f454a, 32,iron);
            const foot=geometry('lamp-foot',()=>new T.LatheGeometry([[.13,0],[.14,.015],[.14,.04],[.1,.055],[.075,.12],[.057,.2],[.049,.24]].map(point=>new T.Vector2(...point)),32));
            mesh(g,foot,0x303639,0,0,0,iron);
            K.cylinder(g,0,h+.018,0,.11,.13,.29,0xe3bb87,32,{transparent:true,opacity:.12,roughness:.16});
            const bulb=K.sphere(g,0,h,0,.039,color,{emissive:color,emissiveIntensity:1.7});bulb.scale.y*=1.65;
            K.cylinder(g,0,h-.09,0,.028,.028,.075,0x987650,24,iron);
            for(let index=0;index<4;index++) {
                const angle=Math.PI*.25+index*Math.PI*.5;
                K.cylinder(g,Math.cos(angle)*.12,h+.025,Math.sin(angle)*.12,.007,.007,.32,0x303536,16,iron);
                K.cylinder(g,Math.cos(angle)*.095,.037,Math.sin(angle)*.095,.011,.011,.009,0x697072,12,iron);
            }
            const cap=geometry('lamp-cap',()=>new T.LatheGeometry([[.16,0],[.165,.012],[.14,.026],[.12,.05],[.078,.085],[.028,.1],[.015,.11]].map(point=>new T.Vector2(...point)),40));
            mesh(g,cap,0x333a40,0,h+.18,0,iron);
            K.sphere(g,0,h+.302,0,.018,0x333a40,iron);
            K.cylinder(g,0,h-.14,0,.15,.11,.028,0x333a40,32,iron);
            K.point(g, 0, h - .1, 0, color, .65, 9);
            return g;
        },
        bench(parent, x, z, angle = 0) {
            const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = angle; parent.add(g);
            const fallback=new T.Group();g.add(fallback);
            if(window.NightGLTFLoader) {
                K.model(g,'painted_wooden_bench',0,.02,0,{height:1.05,onLoad(){fallback.visible=false;}});
            }
            for (let i = 0; i < 4; i++) K.box(fallback, 0, .49, -.22 + i * .145, 2.2, .065, .13, 0x70523b);
            for (let i = 0; i < 3; i++) K.box(fallback, 0, .77 + i * .16, -.3, 2.2, .13, .075, 0x5d4634);
            [-.8, .8].forEach(v => {
                K.box(fallback, v, .28, 0, .09, .5, .55, 0x333b41);
                K.box(fallback, v, .67, -.3, .07, .9, .08, 0x333b41);
            }); return g;
        },
        pine(parent, x, z, h = 7) {
            const g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
            K.cylinder(g, 0, h * .25, 0, h * .015, h * .024, h * .5, 0x473b33, 6);
            for (let i = 0; i < 3; i++) K.cylinder(g, 0, h * (.4 + .2 * i), 0, 0, h * (.24 - .047 * i), h * .55, [0x192c2e,0x203638,0x263e3d][i], 8);
            return g;
        },
        rock(parent, x, z, scale = 1) {
            const m = mesh(parent, geometry('rock', () => {
                const geo=new T.SphereGeometry(1,48,32),points=geo.attributes.position;
                for(let i=0;i<points.count;i++) {
                    const x=points.getX(i),y=points.getY(i),z=points.getZ(i),variation=1+.085*Math.sin(x*4+z*3)*Math.cos(y*5)+.026*Math.sin(x*15-z*12+y*7);
                    points.setXYZ(i,x*variation,y*variation,z*variation);
                }
                geo.computeVertexNormals();return geo;
            }), 0x414b50, x, scale * .3, z);
            m.scale.set(scale, scale * .62, scale * .8); m.rotation.set(x * .34, z * .14, .2);
            K.surface(m,'concrete',2,2);m.material.color.setHex(0x777369);return m;
        },
        label(parent, text, x, y, z, width = 2, color = '#c9d5df') {
            const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = color; ctx.font = '500 40px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(text, 384, 64, 740);
            const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
            const m = new T.Mesh(new T.PlaneGeometry(width, width / 6), new T.MeshBasicMaterial({ map: texture, transparent: true, side: T.DoubleSide, depthWrite: false, toneMapped: false }));
            m.position.set(x, y, z); parent.add(m); return m;
        },
        surface(mesh,type,repeatX=1,repeatY=repeatX) {
            if(!texturePaths[type] || !T.TextureLoader || typeof Image==='undefined')return mesh;
            const [id,diff,normal,rough]=texturePaths[type],key=type+':'+repeatX+':'+repeatY;
            if(!textureSets.has(key)) {
                const loader=new T.TextureLoader();
                const load=(suffix,color)=>{
                    const path=`assets/life/textures/${id}_${suffix}_1k.jpg`;
                    if(!textureSources.has(path)) {
                        const source={copies:[],ready:false};textureSources.set(path,source);
                        source.texture=loader.load(path,()=>{source.ready=true;source.copies.forEach(copy=>{copy.needsUpdate=true;});});
                    }
                    const source=textureSources.get(path),tex=source.texture.clone();source.copies.push(tex);
                    if(source.ready)tex.needsUpdate=true;
                    tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(repeatX,repeatY);tex.anisotropy=4;
                    if(color)tex.colorSpace=T.SRGBColorSpace;tex.userData.shared=true;return tex;
                };
                textureSets.set(key,{map:type==='fabric'||type==='metal'?null:load(diff,true),normalMap:load(normal,false),roughnessMap:load(rough,false)});
            }
            const m=mesh.material.clone();m.userData.shared=false;
            Object.assign(m,textureSets.get(key));
            const normalStrength={wood:.3,soil:.3,fabric:.16,concrete:.32,metal:.2}[type];
            const roughnessFloor={wood:.62,soil:.86,fabric:.9,concrete:.76,metal:.42}[type];
            m.normalScale.set(normalStrength,normalStrength);
            m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, ${roughnessFloor.toFixed(2)});`);};
            m.customProgramCacheKey=()=>`night-surface-${type}`;
            if(type==='wood'||type==='concrete')m.color.setHex(0xc8c4bc);
            m.roughness=type==='metal'?.55:1;mesh.material=m;return mesh;
        },
        model(parent,id,x,y,z,options={}) {
            const holder=new T.Group();holder.position.set(x,y,z);holder.rotation.y=options.rotationY||0;parent.add(holder);
            if(!window.NightGLTFLoader)return holder;
            if(!modelSources.has(id))modelSources.set(id,new window.NightGLTFLoader().loadAsync(`assets/life/models/${id}/${id}_1k.gltf`).then(gltf=>{
                gltf.scene.traverse(o=>{
                    if(o.geometry)o.geometry.userData.shared=true;
                    if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]) {
                        m.userData.shared=true;for(const value of Object.values(m))if(value?.isTexture)value.userData.shared=true;
                    }
                });return gltf.scene;
            }).catch(error=>{modelSources.delete(id);console.warn('Optional scene model unavailable:',id,error);return null;}));
            modelSources.get(id).then(source=>{
                if(!source||holder.userData.disposed)return;
                const object=source.clone(true),bounds=new T.Box3().setFromObject(object),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
                const scale=(options.height||size.y)/Math.max(.001,size.y);
                object.scale.multiplyScalar(scale);object.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
                object.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});holder.add(object);
                if(options.onLoad)options.onLoad(holder);
            });return holder;
        },
        interaction(world, item) { world.interactions.push(item); return item; },
        collider(world, box) { world.colliders.push(box); return box; },
        disposeGroup(group) {
            const disposed = new Set();
            group.traverse(o => {
                o.userData.disposed=true;
                if(o.isLight&&o.shadow)o.shadow.dispose();
                if (o.geometry && !o.geometry.userData.shared && !disposed.has(o.geometry)) { o.geometry.dispose(); disposed.add(o.geometry); }
                for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
                    if (m.userData.shared || disposed.has(m)) continue;
                    for (const value of Object.values(m)) if (value?.isTexture && !value.userData.shared && !disposed.has(value)) { value.dispose(); disposed.add(value); }
                    m.dispose(); disposed.add(m);
                }
            }); group.clear();
        }
    };
})();

/* A position in a place, sharing the existing sky's orientation and field of view. */
(() => {
    'use strict';
    const T = window.THREE, K = window.NightWorldKit;
    const listeners = new Set(), keys = new Set();
    const player = { x: 0, y: 1.72, z: 0, distance: 0 };
    const motion = { forward: 0, strafe: 0, vx: 0, vz: 0 };
    let renderer, scene, view, world, moonLight, lastTime, elapsed = 0, target, audio, transition = 0;
    const nightDateCache = new Map();
    let menuReturn = null, wasRoam = true, savedOrientation, savedFov, message = '', messageUntil = 0;
    const ray = T ? new T.Raycaster() : null;
    const lookMatrix = T ? new T.Matrix4() : null;
    const vector = T ? new T.Vector3() : null;
    const api = window.NightWorld = {
        ready: false, error: '', currentId: 'transit', mode: 'explore', audioEnabled: false,
        player, world: null,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        getSnapshot() {
            return { id: api.currentId, ready: api.ready, error: api.error, walking: Math.hypot(motion.vx, motion.vz) > .05,
                position: { ...player }, distance: player.distance, mode: api.mode,
                interaction: target ? { label: local(target.label) } : null,
                piloting: Boolean(world?.pilot?.active), speed: world?.pilot?.speed || 0,
                graphics: renderer ? { geometries: renderer.info?.memory.geometries, textures: renderer.info?.memory.textures,
                    triangles: renderer.info?.render.triangles, calls: renderer.info?.render.calls } : null,
                audioEnabled: api.audioEnabled, message: performance.now() < messageUntil ? message : '' };
        },
        select(id) {
            const builder = window.NightWorldBuilders?.[id];
            if (!renderer || !builder) return false;
            let next;
            try { next = builder(K); validateWorld(next); }
            catch (error) {
                if(next?.group)K.disposeGroup(next.group);
                api.error = error.message; console.error('Could not create environment:', id, error); changed(); return false;
            }
            if (world) {
                scene.remove(world.group); K.disposeGroup(world.group);
                if (world.flight) { scene.remove(world.flight.exterior); K.disposeGroup(world.flight.exterior); }
            }
            world = api.world = next; api.currentId = id; api.error = '';
            world.player = player; scene.add(world.group);
            scene.fog = new T.FogExp2(0x111b29, id === 'spaceship' ? .00065 : ['room','train'].includes(id) ? .004 : .008);
            if (id === 'spaceship') {
                world.group.traverse(o => { if (o.userData.ground) o.visible = false; });
                world.flight = createFlightField(); scene.add(world.flight.exterior);
            }
            // Reserve a bounded set of nearby point lights; lamps remain emissive at distance.
            const lights = [];
            world.group.traverse(o => { if (o.isPointLight) lights.push(o); });
            if (!COARSE_POINTER && lights.length) {
                const interior=['spaceship','room','train'].includes(id);
                const key=interior?lights[0]:lights.reduce((brightest,light)=>light.intensity>brightest.intensity?light:brightest);
                key.castShadow=true;key.shadow.mapSize.set(512,512);
                key.shadow.camera.near=.1;key.shadow.camera.far=key.distance;
                key.shadow.bias=-.0003;key.shadow.normalBias=.018;key.shadow.radius=3;
            }
            world.lights = lights; reset(); transition = performance.now();
            try { localStorage.setItem('runde:night-world:v1', id); } catch (_) { /* Optional preference. */ }
            api.ready = true; document.body.classList.add('world-ready'); changed(); return true;
        },
        reset,
        setMotion(forward, strafe) { motion.forward = Math.max(-1, Math.min(1, forward)); motion.strafe = Math.max(-1, Math.min(1, strafe)); },
        clearInput() { keys.clear(); motion.forward = motion.strafe = motion.vx = motion.vz = 0; },
        setViewMode(mode) {
            if (!['explore','sky'].includes(mode)) return;
            api.mode = mode; api.clearInput(); clearCameraRoll();
            if (world?.pilot?.active) leavePilot();
            if (mode === 'sky') {
                camera.targetOrientation = constrainOrientationAboveHorizon(camera.targetOrientation, camera.lastStableYaw);
            }
            document.body.classList.toggle('world-explore-mode', mode === 'explore');
            document.body.classList.toggle('world-sky-mode', mode === 'sky'); changed();
        },
        look(dx, dy, multiplier = 1) {
            if (!api.ready || api.mode !== 'explore' || state.scene !== 'roam' || state.modalOpen || state.gateOpen) return false;
            const sensitivity = (COARSE_POINTER ? .0032 : .00175) * multiplier;
            if (world?.pilot?.active) {
                camera.targetOrientation = quatNormalize(quatMultiply(camera.targetOrientation,
                    quatMultiply(quatAxisAngle(0,1,0,dx*sensitivity),quatAxisAngle(1,0,0,dy*sensitivity))));
                return true;
            }
            const pose = decomposeYawPitchRoll(localOrientation(camera.targetOrientation), camera.lastStableYaw);
            camera.targetOrientation = globalOrientation(orientationFromYawPitchRoll(pose.yaw + dx * sensitivity,
                Math.max(-Math.PI * .485, Math.min(Math.PI * .485, pose.pitch - dy * sensitivity)), 0));
            camera.lastStableYaw = pose.yaw + dx * sensitivity;
            return true;
        },
        freeLook() { return api.ready && api.mode === 'explore' && state.scene === 'roam'; },
        inSpace() { return api.ready && api.currentId==='spaceship' && api.mode==='explore' && (state.scene==='roam'||state.scene==='entry'); },
        interact() {
            if (!allowed()) return;
            if (world?.pilot?.active) { leavePilot(); return; }
            if (!target) return;
            const result = typeof target.action === 'function' ? target.action.call(world) : target.action;
            if (result) { message = local(result); messageUntil = performance.now() + 4200; }
            if (world?.pilot?.active) {
                camera.targetOrientation = world.flight.orientation.slice();
                camera.orientation = camera.targetOrientation.slice();
            }
            changed();
        },
        async setAudio(enabled) {
            if (enabled) {
                try { audio ||= createAudio(); await audio.ctx.resume(); api.audioEnabled = true; }
                catch (_) { api.audioEnabled = false; }
            } else { api.audioEnabled = false; if (audio) await audio.ctx.suspend(); }
            changed();
        },
        tick(time) {
            if (!api.ready || !renderer) return;
            const dt = Math.max(0, Math.min(.05, (time - (lastTime ?? time)) / 1000)); lastTime = time;
            const roaming = state.scene === 'roam' || state.scene === 'entry';
            if (wasRoam && !roaming) { savedOrientation = camera.orientation.slice(); savedFov = camera.fov; api.clearInput(); }
            if (!wasRoam && roaming && savedOrientation && api.mode === 'explore') {
                camera.orientation = savedOrientation.slice(); camera.targetOrientation = savedOrientation.slice();
                camera.fov = savedFov; camera.targetFov = savedFov; savedOrientation = null;
            }
            wasRoam = roaming;
            if (allowed()) { elapsed += dt; move(dt); updateFlight(dt); }
            else { motion.vx = motion.vz = 0; keys.clear(); }
            if (!document.hidden && !state.modalOpen && roaming) world.update?.(dt, REDUCED_MOTION ? 0 : elapsed, player);
            syncCamera();
            findInteraction();
            const visible = api.mode === 'explore' && roaming;
            renderer.domElement.style.opacity = visible ? String(Math.min(1, (time - transition) / (REDUCED_MOTION ? 1 : 650))) : '0';
            renderer.domElement.style.visibility = visible ? 'visible' : 'hidden';
            if (visible) {
                updateShadowLight();
                updateLights(); renderer.render(scene, view);
            }
            if (audio && api.audioEnabled) updateAudio();
        },
        skyDate() {
            // Preserve the catalog and astronomy calculations, using a night observation time.
            // Longitude defines local solar midnight even when the browser is elsewhere.
            const now = new Date(startedAt), longitude = skyModel.location?.longitude || 0;
            const year = now.getUTCFullYear(), latitude = skyModel.location?.latitude || 0;
            const localMidnight = day => Date.UTC(year, day[0], day[1] + 1) - longitude / 15 * 3600000;
            const visitKey = `${year}:${latitude}:${longitude}:${now.getUTCMonth()}:${now.getUTCDate()}`;
            if (nightDateCache.has(visitKey)) return new Date(nightDateCache.get(visitKey));
            let timestamp = localMidnight([now.getUTCMonth(), now.getUTCDate()]);
            const astronomy = typeof Astronomy === 'undefined' ? null : Astronomy;
            if (typeof astronomy?.Equator === 'function' && typeof astronomy?.Horizon === 'function' &&
                Number.isFinite(latitude) && Number.isFinite(longitude)) {
                const observer = new astronomy.Observer(latitude, longitude, skyModel.location?.height || 0);
                const equatorial = astronomy.Equator('Sun', new Date(timestamp), observer, true, true);
                const solarAltitude = astronomy.Horizon(new Date(timestamp), observer,
                    equatorial.ra, equatorial.dec, 'normal').altitude;
                if (solarAltitude > -18) {
                    const seasons = astronomy.Seasons(year);
                    const winter = (latitude < 0 ? seasons.jun_solstice : seasons.dec_solstice).date;
                    timestamp = localMidnight([winter.getUTCMonth(), winter.getUTCDate()]);
                }
            }
            nightDateCache.set(visitKey, timestamp);
            return new Date(timestamp);
        },
        skyPointVisible(x, y) {
            if (!api.ready || api.mode !== 'explore' || state.scene !== 'roam') return true;
            ray.setFromCamera({ x: x / window.innerWidth * 2 - 1, y: 1 - y / window.innerHeight * 2 }, view);
            return !ray.intersectObjects(world.group.children, true).some(hit => {
                for (let node=hit.object; node; node=node.parent) if (!node.visible) return false;
                return hit.object.isMesh && !hit.object.userData.ignoreSkyOcclusion && hit.object.material?.opacity !== 0;
            });
        }
    };
    const startedAt = Date.now();
    function local(value) { return typeof value === 'string' ? value : value?.[state.currentLang] || value?.en || ''; }
    function changed() { listeners.forEach(fn => fn(api.getSnapshot())); }
    function localOrientation(q) { return world?.flight ? quatMultiply(quatConjugate(world.flight.orientation),q) : q; }
    function globalOrientation(q) { return world?.flight ? quatMultiply(world.flight.orientation,q) : q; }
    function allowed() { return api.ready && api.mode === 'explore' && state.scene === 'roam' && state.hasEntered && !state.modalOpen && !state.gateOpen && !state.altHeld && !document.hidden && !document.body.classList.contains('world-menu-open'); }
    function validateWorld(w) {
        if (!w?.group?.isGroup || !w.spawn?.every(Number.isFinite)) throw new Error('Invalid world or arrival position');
        w.group.updateMatrixWorld(true);
        w.group.traverse(o => { if (!o.matrixWorld.elements.every(Number.isFinite)) throw new Error('Non-finite object transform: ' + o.type); });
    }
    function reset() {
        if (!world) return;
        api.clearInput(); target = null;
        if (world.pilot) { world.pilot.active = false; world.pilot.throttle = 0; world.pilot.speed = 0; }
        if (world.flight) { world.flight.position.set(0,0,0); world.flight.orientation=[0,0,0,1]; world.group.position.set(0,0,0); world.group.quaternion.identity(); }
        [player.x, player.y, player.z] = world.spawn; player.distance = 0;
        camera.orientation = orientationFromYawPitch(world.yaw || 0, world.pitch ?? .09);
        camera.targetOrientation = camera.orientation.slice(); camera.lastStableYaw = world.yaw || 0;
        camera.fov = camera.targetFov = 62 * DEG; savedOrientation = null;
        changed();
    }
    function leavePilot() {
        const pilot = world.pilot; pilot.active = false; pilot.throttle = 0;
        [player.x, player.y, player.z] = pilot.exit;
        camera.targetOrientation = globalOrientation(orientationFromYawPitch(0, .04)); camera.orientation = camera.targetOrientation.slice();
        api.clearInput(); changed();
    }
    function blocked(x, z) {
        const r = .25, b = world.bounds;
        if (b && (x < b.minX + r || x > b.maxX - r || z < b.minZ + r || z > b.maxZ - r)) return true;
        return world.colliders.some(c => c.enabled !== false && Math.abs(x-c.x) < c.w/2+r && Math.abs(z-c.z) < c.d/2+r);
    }
    function createFlightField() {
        // Nearby physical reference points provide parallax; the catalog sky is untouched.
        const exterior = new T.Group(), objects = [];
        const rockGeometry = new T.SphereGeometry(1, 48, 32);
        const vertices=rockGeometry.attributes.position;
        for(let index=0;index<vertices.count;index++) {
            vector.fromBufferAttribute(vertices,index);
            const relief=1+.12*Math.sin(vector.x*3+vector.z*4)*Math.cos(vector.y*4)+.028*Math.sin(vector.x*19-vector.z*13+vector.y*7);
            vector.multiplyScalar(relief);vertices.setXYZ(index,vector.x,vector.y,vector.z);
        }
        rockGeometry.computeVertexNormals();
        const rockSurface=new T.Mesh(rockGeometry,K.material(0x77736d,{roughness:1,metalness:0}));
        K.surface(rockSurface,'concrete',4,3);rockSurface.material.color.setHex(0x77736d);
        const rockMaterial=rockSurface.material;
        let seed = 18493;
        const random = () => { seed=(seed*16807)%2147483647; return (seed-1)/2147483646; };
        for (let i=0;i<64;i++) {
            const rock=new T.Mesh(rockGeometry,rockMaterial);
            rock.position.set((random()-.5)*1800,(random()-.4)*900,(random()-.75)*1800);
            if (rock.position.length()<90) rock.position.x+=180;
            const size=5+random()*21; rock.scale.set(size,size*(.5+random()),size*(.7+random()));
            rock.rotation.set(random()*6,random()*6,random()*6); exterior.add(rock);
            rock.userData.origin=rock.position.clone(); objects.push(rock);
        }
        for(let i=0;i<3;i++) {
            const station=new T.Group(); station.position.set(-90+i*240,55+i*90,-380-i*540);
            const ring=new T.Mesh(new T.TorusGeometry(38+i*12,1.4,8,64),new T.MeshStandardMaterial({color:0x566b78,metalness:.75,roughness:.38}));
            station.add(ring);
            for(let j=0;j<8;j++) {
                const angle=j*Math.PI/4, radius=38+i*12;
                K.box(station,Math.cos(angle)*radius,Math.sin(angle)*radius,0,2,2,3,0x9cdadf,{emissive:0x589da9,emissiveIntensity:1.3});
            }
            station.userData.origin=station.position.clone(); objects.push(station); exterior.add(station);
        }
        return {exterior,objects,position:new T.Vector3(),orientation:[0,0,0,1]};
    }
    function updateFlight(dt) {
        const flight=world.flight;
        if(!flight)return;
        if(world.pilot.active) flight.orientation=camera.orientation.slice();
        else world.pilot.speed*=Math.exp(-dt*.8);
        const q=flight.orientation;
        // Mirror the sky's +Z-forward convention into Three's -Z-forward frame.
        world.group.quaternion.set(-q[0],-q[1],q[2],q[3]);
        vector.set(0,0,-1).applyQuaternion(world.group.quaternion);
        flight.position.addScaledVector(vector,world.pilot.speed*dt);
        world.group.position.copy(flight.position);
        for(const object of flight.objects) {
            const origin=object.userData.origin;
            for(const axis of ['x','y','z']) {
                const span=axis==='y'?1500:2400;
                object.position[axis]=origin[axis]+Math.round((flight.position[axis]-origin[axis])/span)*span;
            }
        }
        world.group.updateMatrixWorld(true); flight.exterior.updateMatrixWorld(true);
    }
    function move(dt) {
        const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + motion.forward;
        const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + motion.strafe;
        const pose = decomposeYawPitchRoll(localOrientation(camera.targetOrientation), camera.lastStableYaw);
        if (world.pilot?.active) {
            const p = world.pilot;
            p.throttle = Math.max(0, Math.min(1, (p.throttle || 0) + f * dt * .35));
            p.speed = (p.speed || 0) + (p.throttle * 180 - (p.speed || 0)) * (1 - Math.exp(-dt * 1.4));
            p.distance = (p.distance || 0) + p.speed * dt;
            const roll = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
            camera.targetOrientation = quatNormalize(quatMultiply(camera.targetOrientation,
                quatMultiply(quatAxisAngle(0,1,0,s*dt*.7),quatAxisAngle(0,0,1,roll*dt*.65))));
            if (keys.has('Space')) p.throttle = Math.max(0, p.throttle - dt * 1.5);
            return;
        }
        const length = Math.max(1, Math.hypot(f, s)), speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7 : 3.1;
        const tx = (Math.sin(pose.yaw)*f + Math.cos(pose.yaw)*s) / length * speed;
        const tz = (-Math.cos(pose.yaw)*f + Math.sin(pose.yaw)*s) / length * speed;
        const ease = 1-Math.exp(-dt*12);
        motion.vx += (tx-motion.vx)*ease; motion.vz += (tz-motion.vz)*ease;
        const oldX=player.x, oldZ=player.z;
        if (!blocked(player.x+motion.vx*dt, player.z)) player.x += motion.vx*dt;
        if (!blocked(player.x, player.z+motion.vz*dt)) player.z += motion.vz*dt;
        player.distance += Math.hypot(player.x-oldX, player.z-oldZ);
    }
    function syncCamera() {
        if (!view) return;
        const b = cameraBasis();
        lookMatrix.makeBasis(new T.Vector3(b.right[0],b.right[1],-b.right[2]), new T.Vector3(b.up[0],b.up[1],-b.up[2]), new T.Vector3(-b.forward[0],-b.forward[1],b.forward[2]));
        view.quaternion.setFromRotationMatrix(lookMatrix);
        view.position.set(player.x, player.y, player.z);
        if (world?.flight) view.position.applyQuaternion(world.group.quaternion).add(world.flight.position);
        view.fov = camera.fov / DEG; view.aspect = window.innerWidth/window.innerHeight;
        view.updateProjectionMatrix(); view.updateMatrixWorld(true);
    }
    function findInteraction() {
        target = null;
        if (!allowed()) return;
        if (world.pilot?.active) { target = { label: { en: 'F · leave the pilot seat', 'zh-CN': 'F · 离开驾驶位', 'zh-TW': 'F · 離開駕駛位' } }; return; }
        let best = Infinity;
        for (const item of world.interactions) {
            if (item.enabled === false) continue;
            const p = item.position;
            const distance = Math.hypot(player.x-p[0], player.z-p[2]);
            vector.set(p[0], p[1], p[2]);
            if (world.flight) vector.applyQuaternion(world.group.quaternion).add(world.flight.position);
            vector.project(view);
            if (distance > (item.radius || 3) || vector.z > 1 || Math.abs(vector.x) > 1.15 || Math.abs(vector.y) > 1.2) continue;
            if (distance < best) { best = distance; target = item; }
        }
    }
    function updateLights() {
        // All materials compile against at most six lights, independent of the number of path lamps.
        const lights = world.lights || [];
        for (const l of lights) { l.getWorldPosition(vector); l.userData.distance = vector.distanceToSquared(view.position); }
        lights.sort((a,b) => a.userData.distance-b.userData.distance);
        lights.forEach((l,i) => { l.visible = i < (COARSE_POINTER ? 4 : 6); });
    }
    function updateShadowLight() {
        if(!moonLight)return;
        const center=world.flight?world.flight.position:view.position;
        moonLight.position.set(center.x-18,center.y+32,center.z+15);
        moonLight.target.position.copy(center);moonLight.target.updateMatrixWorld(true);
    }
    function resize() {
        if (!renderer) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE_POINTER ? 1.15 : 1.6));
        renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    function createAudio() {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const master = ctx.createGain(); master.gain.value = .08; master.connect(ctx.destination);
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), data = buffer.getChannelData(0);
        let brown = 0;
        for (let i=0;i<data.length;i++) { brown=(brown+(Math.random()*2-1)*.022)/1.022; data[i]=brown*3; }
        const noise = ctx.createBufferSource(); noise.buffer=buffer; noise.loop=true;
        const filter=ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=650;
        const noiseGain=ctx.createGain();noiseGain.gain.value=.12;
        noise.connect(filter); filter.connect(noiseGain);noiseGain.connect(master); noise.start();
        const hum=ctx.createOscillator(), gain=ctx.createGain(); hum.type='sine'; hum.frequency.value=52; gain.gain.value=.15;
        hum.connect(gain); gain.connect(master); hum.start();
        const layer = (type, frequency) => {
            const source=ctx.createBufferSource(); source.buffer=buffer; source.loop=true;
            const tone=ctx.createBiquadFilter(); tone.type=type; tone.frequency.value=frequency; tone.Q.value=type==='bandpass'?0.55:0.25;
            const level=ctx.createGain(); level.gain.value=0; source.connect(tone); tone.connect(level); level.connect(master); source.start();
            return {source,tone,level};
        };
        const wind=layer('bandpass',380), wave=layer('bandpass',720), room=layer('lowpass',180);
        const windSwell=ctx.createOscillator(),windDepth=ctx.createGain();windSwell.frequency.value=.067;windDepth.gain.value=95;windSwell.connect(windDepth);windDepth.connect(wind.tone.frequency);windSwell.start();
        const seaSwell=ctx.createOscillator(),seaDepth=ctx.createGain();seaSwell.frequency.value=.17;seaDepth.gain.value=0;seaSwell.connect(seaDepth);seaDepth.connect(wave.level.gain);seaSwell.start();
        const clickBuffer=ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*.075)),ctx.sampleRate), clickData=clickBuffer.getChannelData(0);
        for(let i=0;i<clickData.length;i++){const envelope=Math.pow(1-i/clickData.length,5);clickData[i]=(Math.random()*2-1)*envelope*.65;}
        const clickGain=ctx.createGain();clickGain.gain.value=0;clickGain.connect(master);
        const fireGain=ctx.createGain();fireGain.gain.value=0;fireGain.connect(master);
        const engineOvertone=ctx.createOscillator(),engineLevel=ctx.createGain();engineOvertone.type='triangle';engineOvertone.frequency.value=96;engineLevel.gain.value=0;engineOvertone.connect(engineLevel);engineLevel.connect(master);engineOvertone.start();
        const railResonator=ctx.createBiquadFilter();railResonator.type='bandpass';railResonator.frequency.value=480;railResonator.Q.value=1.4;railResonator.connect(clickGain);
        const sound={ctx,master,filter,hum,gain,noiseGain,wind,wave,room,windSwell,windDepth,seaSwell,seaDepth,engineOvertone,engineLevel,railResonator,clickBuffer,clickGain,fireGain,nextClick:0,nextCrackle:0,world:null,fire:null};
        const hush=()=>{master.gain.setTargetAtTime(0,ctx.currentTime,.12);};
        document.addEventListener('nightworld:menu',event=>{if(event.detail?.open)hush();});
        document.addEventListener('visibilitychange',()=>{if(document.hidden)hush();});
        window.addEventListener('blur',hush);
        return sound;
    }
    function updateAudio() {
        const now=audio.ctx.currentTime, id=api.currentId, pilot=world?.pilot, throttle=pilot?.throttle||0;
        const trainSpeed=world?.train?.speed||0, trainAmount=Math.min(1,trainSpeed/8);
        const indoor=['spaceship','train','room'].includes(id);
        const active=api.audioEnabled&&api.mode==='explore'&&!document.hidden&&state.scene==='roam'&&!state.modalOpen&&!state.gateOpen;
        const target=(value)=>active?value:0;
        if(audio.world!==world){audio.world=world;audio.nextClick=now+.18;audio.nextCrackle=now+.3;audio.fire=null;world?.group?.traverse(node=>{if(node.userData.flames)audio.fire=node;});}
        audio.filter.frequency.setTargetAtTime(id==='lakeshore'?900:indoor?260:520,now,.55);
        audio.noiseGain.gain.setTargetAtTime(target(id==='train'?.1+trainAmount*.35:id==='spaceship'?.15+throttle*.2:id==='room'?.06:.12),now,.6);
        audio.gain.gain.setTargetAtTime(target(id==='spaceship'?.16+throttle*.22:id==='train'?.035+trainAmount*.14:id==='room'?.028:.012),now,.4);
        audio.hum.frequency.setTargetAtTime(id==='spaceship'?48+throttle*74:id==='train'?34+trainAmount*24:36,now,.4);
        audio.engineOvertone.frequency.setTargetAtTime(id==='spaceship'?96+throttle*148:84,now,.6);
        audio.engineLevel.gain.setTargetAtTime(target(id==='spaceship'?.032+throttle*.048:0),now,.5);
        audio.master.gain.setTargetAtTime(active?(id==='spaceship'?.055:id==='train'?.05:.042):0,now,.6);
        const distanceTo=(x,z)=>Math.hypot(player.x-x,player.z-z);
        const fireDistance=audio.fire?distanceTo(audio.fire.position.x,audio.fire.position.z):999;
        const fireLevel=Math.max(0,1-fireDistance/18)*(audio.fire?.userData.flames?.some(flame=>flame.visible)?1:.12);
        audio.fireGain.gain.setTargetAtTime(target(fireLevel*.24),now,.8);
        audio.wind.level.gain.setTargetAtTime(target(id==='lakeshore'?.23:id==='room'?.06:indoor?.025:.3),now,.9);
        audio.wave.level.gain.setTargetAtTime(target(id==='lakeshore'?.62:0),now,1.2);
        audio.seaDepth.gain.setTargetAtTime(target(id==='lakeshore'?.14:0),now,.6);
        audio.room.level.gain.setTargetAtTime(target(id==='room'?.15:id==='spaceship'?.06:id==='train'?.12:0),now,.8);
        audio.clickGain.gain.setTargetAtTime(target(id==='train'?.07+trainAmount*.1:0),now,.3);
        if(active&&id==='train'&&trainSpeed>0&&now>=audio.nextClick){
            const speed=Math.max(1,trainSpeed), interval=Math.max(.075,Math.min(.42,1.9/speed));
            audio.nextClick=Math.max(now,audio.nextClick);
            for(let scheduled=0;scheduled<3&&audio.nextClick<=now+.2;scheduled++,audio.nextClick+=interval){const source=audio.ctx.createBufferSource();source.buffer=audio.clickBuffer;source.playbackRate.value=.68+(scheduled%2)*.2;source.connect(audio.railResonator);source.onended=()=>source.disconnect();source.start(audio.nextClick);}
        } else if(id!=='train'||trainSpeed<=0||!active) audio.nextClick=now+.1;
        if(active&&fireLevel>.01&&now>=audio.nextCrackle){
            const source=audio.ctx.createBufferSource();source.buffer=audio.clickBuffer;source.playbackRate.value=.7+Math.random()*1.2;source.connect(audio.fireGain);source.onended=()=>source.disconnect();source.start(now);
            audio.nextCrackle=now+.35+Math.random()*1.4/(.35+fireLevel);
        } else if(fireLevel<=.01) audio.nextCrackle=now+.5;
    }
    document.addEventListener('keydown', event => {
        const worldControl=event.target?.closest?.('#environmentUI');
        if (!api.ready || api.mode !== 'explore' || !allowed() || (isInteractiveKeyTarget(event.target) && !worldControl)) return;
        if (worldControl && event.code==='Space') return;
        if (['KeyW','KeyA','KeyS','KeyD','KeyQ','ShiftLeft','ShiftRight','Space'].includes(event.code) || (world.pilot?.active && event.code==='KeyE')) {
            event.preventDefault(); event.stopImmediatePropagation(); keys.add(event.code); return;
        }
        if (event.code==='KeyF' && world.pilot?.active) { event.preventDefault(); event.stopImmediatePropagation(); leavePilot(); }
        else if (event.code==='KeyE' && !event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); api.interact(); }
    }, true);
    window.addEventListener('keyup', event => keys.delete(event.code), true);
    window.addEventListener('blur', api.clearInput);
    document.addEventListener('visibilitychange', () => { api.clearInput(); lastTime=null; if(audio) { if(document.hidden) audio.ctx.suspend(); else if(api.audioEnabled) audio.ctx.resume(); } });
    document.addEventListener('nightworld:menu', event => {
        api.clearInput(); clearCameraRoll();
        if (event.detail.open) {
            menuReturn = { gate: state.gateOpen, modal: state.modalOpen,
                inert: [dom.world,dom.portalNav,dom.celestialNav,dom.starNav,dom.sectionDrawerToggle].map(node=>[node,node.inert]) };
            state.modalOpen = true; state.lockIntent='modal';
            state.altHeld=false; state.altReturnMode=null; state.relockPending=false;
            state.lockRequestToken++; window.clearTimeout(state.lockRequestTimer); dom.entryTrigger.disabled=false;
            if(document.pointerLockElement===dom.world) document.exitPointerLock();
            dom.body.classList.add('cursor-free'); dom.body.classList.remove('view-locked');
            hideEntryGate();
            for(const node of [dom.world,dom.portalNav,dom.celestialNav,dom.starNav,dom.sectionDrawerToggle]) node.inert=true;
        } else if(menuReturn) {
            menuReturn.inert.forEach(([node,inert])=>{node.inert=inert;});
            state.modalOpen=menuReturn.modal; state.lockIntent=null;
            if(menuReturn.gate) setGateState(true, false); else settleUnlockedView('keyboard');
            menuReturn=null; syncSectionDrawerAvailability();
        }
    });
    window.addEventListener('resize',resize);
    function initialize() {
        if(!T||!K) { api.error='The environment renderer is unavailable.'; changed(); return; }
        try {
            const canvas=document.getElementById('environmentCanvas');
            renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:!COARSE_POINTER,powerPreference:'high-performance'});
            renderer.setClearColor(0x000000,0); renderer.outputColorSpace=T.SRGBColorSpace;
            renderer.toneMapping=T.ACESFilmicToneMapping; renderer.toneMappingExposure=1.4;
            renderer.shadowMap.enabled=!COARSE_POINTER;renderer.shadowMap.type=T.PCFSoftShadowMap;
            scene=new T.Scene(); view=new T.PerspectiveCamera(62,1,.08,1600);
            scene.add(new T.HemisphereLight(0xa1bfed,0x554b42,.8));
            scene.add(new T.AmbientLight(0xb3b2c4,.24));
            moonLight=new T.DirectionalLight(0xb7d5ff,1.05);moonLight.castShadow=!COARSE_POINTER;
            moonLight.shadow.mapSize.set(2048,2048);moonLight.shadow.camera.left=-38;moonLight.shadow.camera.right=38;
            moonLight.shadow.camera.top=38;moonLight.shadow.camera.bottom=-38;moonLight.shadow.camera.far=120;
            moonLight.shadow.bias=-.0002;moonLight.shadow.normalBias=.035;moonLight.shadow.radius=3;
            scene.add(moonLight,moonLight.target);
            resize(); let saved='transit'; try{saved=localStorage.getItem('runde:night-world:v1')||saved;}catch(_){}
            api.select(window.NightWorldBuilders?.[saved]?saved:'transit'); api.setViewMode('explore');
            refreshAstronomicalSky(api.skyDate()); updateEntryLocationCopy();
            canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();api.error='Graphics context lost. Reload to restore the environment.';api.ready=false;changed();});
            window.dispatchEvent(new CustomEvent('nightworld:ready'));
        } catch(error) { api.error=error.message; console.error('Environment renderer unavailable:',error); changed(); }
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initialize,{once:true}); else initialize();
})();

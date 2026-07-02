(function () {
    class MochiPet {
        constructor() {
            this.el = document.getElementById('pixelPet');
            this.sprite = document.getElementById('mochiSprite');
            this.bubble = document.getElementById('petBubble');
            this.summonBtn = document.getElementById('summonBtn');
            this.summonMenu = document.getElementById('summonMenu');
            this.interactMenu = document.getElementById('petInteractMenu');

            if (!this.el || !this.sprite || !this.summonBtn || !this.summonMenu || !this.interactMenu) {
                return;
            }

            if (this.interactMenu.parentElement !== document.body) {
                document.body.appendChild(this.interactMenu);
            }

            this.petProfiles = {
                mochi: {
                    id: 'mochi',
                    displayName: 'Mochi',
                    assetBase: 'assets/mochi/',
                    metrics: window.MOCHI_FRAME_METRICS || {},
                    phrases: {
                        summon: 'Mochi!',
                        click: 'moki!',
                        sleepClick: 'zzz...',
                        rest: 'nap',
                        snack: 'snack?',
                        feed: 'yum!',
                        pet: 'hehe',
                        play: 'boing!',
                        groom: 'hmm...',
                        sniff: 'sniff',
                        happy: 'moki!',
                        peek: 'peek',
                        follow: 'follow',
                        roam: 'roam',
                        drag: '!'
                    },
                    actions: {
                        rest: 'Rest',
                        roam: 'Roam',
                        feed: 'Feed',
                        pet: 'Pet',
                        play: 'Play',
                        groom: 'Groom',
                        sniff: 'Sniff',
                        happy: 'Wiggle',
                        peek: 'Peek',
                        findSnack: 'Find Snack',
                        follow: 'Follow',
                        stopFollow: 'Stop Follow',
                        dismiss: 'Dismiss'
                    }
                },
                appcopilot: {
                    id: 'appcopilot',
                    displayName: 'AppCopilot',
                    assetBase: 'assets/appcopilot/',
                    metrics: window.APPCOPILOT_FRAME_METRICS || {},
                    phrases: {
                        summon: 'AppCopilot!',
                        click: 'ready!',
                        sleepClick: 'charging...',
                        rest: 'charge',
                        snack: 'task?',
                        feed: 'execute!',
                        pet: 'ping!',
                        play: 'orchestrate!',
                        groom: 'review',
                        sniff: 'ground UI',
                        happy: 'ship!',
                        peek: 'peek',
                        follow: 'follow',
                        roam: 'roam',
                        drag: 'hold!'
                    },
                    actions: {
                        rest: 'Charge',
                        roam: 'Roam',
                        feed: 'Execute',
                        pet: 'Ping',
                        play: 'Orchestrate',
                        groom: 'Review Plan',
                        sniff: 'Ground UI',
                        happy: 'Ship',
                        peek: 'Peek',
                        findSnack: 'Find Task',
                        follow: 'Follow',
                        stopFollow: 'Stop Follow',
                        dismiss: 'Dismiss'
                    }
                },
                timo: {
                    id: 'timo',
                    displayName: 'Timo',
                    assetBase: 'assets/timo/',
                    metrics: window.TIMO_FRAME_METRICS || {},
                    phrases: {
                        summon: 'Timo!',
                        click: 'hi!',
                        sleepClick: 'zzz...',
                        rest: 'study nap',
                        snack: 'snack?',
                        feed: 'teach!',
                        pet: 'good job!',
                        play: 'render!',
                        groom: 'review',
                        sniff: 'explain',
                        happy: 'bravo!',
                        peek: 'peek',
                        follow: 'follow',
                        roam: 'roam',
                        drag: 'whoa!'
                    },
                    actions: {
                        rest: 'Study Nap',
                        roam: 'Roam',
                        feed: 'Teach',
                        pet: 'Encourage',
                        play: 'Render Lesson',
                        groom: 'Review Script',
                        sniff: 'Explain',
                        happy: 'Bravo',
                        peek: 'Peek',
                        findSnack: 'Find Prompt',
                        follow: 'Follow',
                        stopFollow: 'Stop Follow',
                        dismiss: 'Dismiss'
                    }
                }
            };
            this.currentPetId = 'mochi';
            this.currentProfile = this.petProfiles[this.currentPetId];
            this.assetBase = this.currentProfile.assetBase;
            this.frameMetrics = this.currentProfile.metrics;
            this.frameOffset = { x: 0, y: 0 };
            this.renderScale = 0.62;
            this.stageWidth = 224;
            this.stageHeight = 170;
            const frame = (name, index) => `frames/${name}/${name}-${String(index).padStart(2, '0')}.png`;
            const sequence = (name, count) => Array.from(
                { length: count },
                (_, index) => frame(name, index)
            );
            const pick = (name, indexes) => indexes.map((index) => frame(name, index));
            const range = (name, start, end) => {
                const step = start <= end ? 1 : -1;
                const frames = [];
                for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
                    frames.push(frame(name, index));
                }
                return frames;
            };
            const sprite = (name, width, height, fps, scale = 0.62, count = 20) => ({
                frames: sequence(name, count),
                width: Math.round(width * scale),
                height: Math.round(height * scale),
                fps
            });
            const clip = (name, width, height, fps, bob = 0, scale = 0.62, count = 20) => ({
                ...sprite(name, width, height, fps, scale, count),
                bob
            });
            const steadySteps = (count) => Array.from({ length: count }, () => 1);
            const directionMotion = (name, count, fps, stepWeights = steadySteps(count)) => ({
                frames: sequence(name, count),
                width: Math.round(300 * 0.62),
                height: Math.round(248 * 0.62),
                fps,
                stepWeights
            });

            const quietSitFrames = [
                ...range('sit', 0, 5),
                ...range('sit', 4, 1)
            ];
            const quietSleepFrames = pick('sleep', [
                0, 0, 0, 0, 1, 1, 2, 3, 4, 3,
                2, 1, 0, 0, 0, 0, 0, 0, 1, 0
            ]);

            this.poses = {
                stand: { frames: quietSitFrames, width: Math.round(220 * 0.62), height: Math.round(248 * 0.62), fps: 6 },
                sit: { frames: quietSitFrames, width: Math.round(220 * 0.62), height: Math.round(248 * 0.62), fps: 6 },
                walk: sprite('walk', 251, 222, 30, 0.62, 40),
                eat: sprite('eat_cookie', 275, 237, 18),
                happy: sprite('happy', 260, 256, 18),
                rest: { frames: quietSleepFrames, width: Math.round(311 * 0.62), height: Math.round(199 * 0.62), fps: 4 },
                sleep: { frames: quietSleepFrames, width: Math.round(311 * 0.62), height: Math.round(199 * 0.62), fps: 3 },
                groom: sprite('groom', 274, 256, 16),
                peek: sprite('sniff', 355, 222, 16),
                dance: sprite('play', 299, 256, 20)
            };
            this.walkVariants = {
                horizontal: this.poses.walk,
                down: directionMotion('run_down', 32, 30),
                up: directionMotion('run_up', 32, 30)
            };
            this.directionTransitions = {
                horizontal: {
                    up: directionMotion('turn_side_to_up', 32, 30),
                    down: directionMotion('turn_side_to_down', 32, 30)
                },
                up: {
                    horizontal: directionMotion('turn_up_to_side', 32, 30),
                    down: directionMotion('turn_up_to_down', 64, 32)
                },
                down: {
                    horizontal: directionMotion('turn_down_to_side', 32, 30),
                    up: directionMotion('turn_down_to_up', 64, 32)
                }
            };
            this.clips = {
                standToSit: clip('stand_to_sit', 220, 248, 16, 1),
                sitToStand: clip('sit_to_stand', 220, 248, 16, 1),
                standToWalk: clip('stand_to_walk', 300, 237, 28, 1.2, 0.62, 40),
                walkToStand: clip('walk_to_stand', 299, 235, 28, 1, 0.62, 40),
                sitToWalk: clip('sit_to_walk', 300, 237, 28, 1.2, 0.62, 40),
                walkToSit: clip('walk_to_sit', 299, 235, 28, 1, 0.62, 40),
                walkToEat: clip('walk_to_eat', 299, 235, 28, 1, 0.62, 40),
                sitToEat: clip('sit_to_eat', 299, 235, 18, 1),
                eatToHappy: clip('eat_to_happy', 260, 256, 18, 2.4),
                happyToSit: clip('happy_to_sit', 260, 256, 18, 1.4),
                happyToStand: clip('happy_to_stand', 260, 256, 18, 1.4),
                happyToWalk: clip('happy_to_walk', 300, 237, 28, 1.8, 0.62, 40),
                walkToRest: clip('walk_to_rest', 338, 217, 28, 0.8, 0.62, 40),
                sitToRest: clip('sit_to_rest', 338, 217, 18, 0.8),
                standToRest: clip('stand_to_rest', 338, 217, 18, 0.8),
                restToSleep: clip('rest_to_sleep', 311, 199, 8, 0.2),
                sleepToRest: clip('sleep_to_rest', 311, 199, 8, 0.3),
                restToSit: clip('rest_to_sit', 325, 232, 18, 1),
                restToWalk: clip('rest_to_walk', 325, 232, 28, 1.2, 0.62, 40),
                sleepToWalk: clip('sleep_to_walk', 325, 232, 28, 1.2, 0.62, 40),
                sitToPlay: clip('sit_to_play', 299, 256, 20, 3),
                playToSit: clip('play_to_sit', 299, 256, 20, 1.8),
                eatGrape: clip('eat_grape', 289, 256, 18, 1),
                eatCarrot: clip('eat_carrot', 271, 247, 18, 1.2),
                eatCookie: clip('eat_cookie', 275, 237, 18, 1),
                eatMelon: clip('eat_melon', 268, 251, 18, 1),
                curious: clip('sniff', 355, 222, 16, 1),
                groom: clip('groom', 274, 256, 16, 0.8),
                sniff: clip('sniff', 355, 222, 16, 1),
                peek: clip('sniff', 355, 222, 16, 1),
                dance: clip('play', 299, 256, 20, 4),
                happy: clip('happy', 260, 256, 18, 2.4),
                pet: {
                    frames: [...range('sit', 0, 8), ...range('happy', 0, 19), ...range('sit', 8, 19)],
                    width: Math.round(260 * 0.62),
                    height: Math.round(256 * 0.62),
                    fps: 18,
                    bob: 3
                },
                play: clip('play', 299, 256, 20, 5),
                hop: clip('happy', 260, 256, 20, 5),
                bye: {
                    frames: [...range('sit', 0, 10), ...range('happy', 0, 12), ...range('sit', 10, 19)],
                    width: Math.round(260 * 0.62),
                    height: Math.round(256 * 0.62),
                    fps: 18,
                    bob: 2.5
                }
            };
            this.foodClipBySnack = {
                grape: 'eatGrape',
                carrot: 'eatCarrot',
                cookie: 'eatCookie',
                melon: 'eatMelon'
            };

            this.snacks = [
                { id: 'grape', label: 'Grape' },
                { id: 'carrot', label: 'Carrot' },
                { id: 'cookie', label: 'Cookie' },
                { id: 'melon', label: 'Melon' }
            ];

            this.active = false;
            this.mode = 'roam';
            this.state = 'hidden';
            this.pose = 'stand';
            this.stablePose = 'stand';
            this.currentClip = null;
            this.afterClip = null;
            this.poseStartedAt = performance.now();
            this.poseFrame = -1;
            this.currentFramePath = '';
            this.x = 0;
            this.y = 0;
            this.targetX = 0;
            this.targetY = 0;
            this.facing = 1;
            this.idleUntil = 0;
            this.nextIdlePoseAt = 0;
            this.actionUntil = 0;
            this.returnAfterFeed = false;
            this.currentSnack = null;
            this.currentSnackType = null;
            this.pendingSnackType = null;
            this.feedClickHandler = null;
            this.menuOpen = false;
            this.pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            this.drag = null;
            this.suppressClick = false;
            this.lastHoverAt = 0;
            this.previousMode = 'roam';
            this.nextIdleTrickAt = 0;
            this.walkVariant = 'horizontal';
            this.pendingWalkVariant = null;
            this.pendingWalkVariantAt = 0;
            this.directionClip = null;
            this.directionClipTarget = null;
            this.directionClipStartedAt = 0;
            const baseWalkStepWeights = [
                0.35, 1.20, 1.35, 0.85, 0,
                1.45, 1.30, 1.15, 0.50, 1.30,
                0, 1.35, 0, 1.15, 0.55,
                1.45, 1.25, 0.75, 0.55, 0
            ];
            this.walkStepWeights = baseWalkStepWeights.flatMap((weight, index) => {
                const next = baseWalkStepWeights[(index + 1) % baseWalkStepWeights.length];
                return [weight, (weight + next) / 2];
            });
            this.walkStepWeightScale = this.walkStepWeights.length / this.walkStepWeights.reduce((sum, weight) => sum + weight, 0);
            this.lastLocomotionFrame = null;
            this.lastLocomotionState = null;
            this.lastLocomotionStartedAt = 0;
            this.lastTime = performance.now();
            this.raf = null;
            this.imageCache = new Map();

            this.preloadImages();
            this.ensureSnackUi();
            this.initEvents();
            this.setPose('stand');
            this.startLoop();
        }

        collectSpriteSets() {
            const transitionSets = Object.values(this.directionTransitions || {})
                .flatMap((transitions) => Object.values(transitions));
            return [
                ...Object.values(this.poses),
                ...Object.values(this.clips),
                ...Object.values(this.walkVariants),
                ...transitionSets
            ];
        }

        preloadFrame(src) {
            if (!src) return null;
            if (this.imageCache.has(src)) {
                return this.imageCache.get(src);
            }

            const img = new Image();
            img.decoding = 'sync';
            img.loading = 'eager';
            img.src = this.assetBase + src;
            this.imageCache.set(src, img);
            if (typeof img.decode === 'function') {
                img.decode().catch(() => {});
            }
            return img;
        }

        preloadImages() {
            this.collectSpriteSets().forEach((spriteSet) => {
                spriteSet.frames.forEach((src) => this.preloadFrame(src));
            });
        }

        ensureSnackUi() {
            this.snackLayer = document.getElementById('snackLayer');
            if (!this.snackLayer) {
                this.snackLayer = document.createElement('div');
                this.snackLayer.id = 'snackLayer';
                this.snackLayer.className = 'snack-layer';
                document.body.appendChild(this.snackLayer);
            }

            this.snackTray = document.getElementById('snackTray');
            if (!this.snackTray) {
                this.snackTray = document.createElement('div');
                this.snackTray.id = 'snackTray';
                this.snackTray.className = 'snack-tray';
                document.body.appendChild(this.snackTray);
            }
            this.snackTray.setAttribute('aria-label', `${this.currentProfile.displayName} snacks`);

            this.snackTray.innerHTML = '';
            this.snacks.forEach((snack) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'snack-choice';
                button.title = snack.label;
                button.dataset.snack = snack.id;
                button.innerHTML = `<span class="snack-pixel ${snack.id}" aria-hidden="true"></span>`;
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.pickSnack(snack.id);
                });
                this.snackTray.appendChild(button);
            });
        }

        initEvents() {
            this.summonBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.summonMenu.classList.toggle('show');
            });

            this.summonMenu.querySelectorAll('.summon-option').forEach((option) => {
                option.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.summonMenu.classList.remove('show');
                    if (option.dataset.char === 'hide') {
                        this.dismiss();
                    } else {
                        this.summon(option.dataset.char);
                    }
                });
            });

            this.sprite.addEventListener('click', (event) => {
                event.stopPropagation();
                if (this.suppressClick) {
                    this.suppressClick = false;
                    return;
                }
                this.showBubble(this.state === 'sleep' ? this.say('sleepClick') : this.say('click'));
            });

            this.sprite.addEventListener('dblclick', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.petMochi();
            });

            this.sprite.addEventListener('mouseenter', () => {
                if (!this.active || this.state === 'sleep' || this.state === 'drag') return;
                const now = performance.now();
                if (now - this.lastHoverAt < 2600) return;
                this.lastHoverAt = now;
                this.showBubble(this.say('sniff'));
                this.playSoftClip('curious');
            });

            this.sprite.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.showInteractMenu(event.clientX, event.clientY);
            });

            this.sprite.addEventListener('pointerdown', (event) => this.beginDrag(event));
            document.addEventListener('pointermove', (event) => this.trackPointer(event));
            document.addEventListener('pointerup', (event) => this.endDrag(event));

            document.addEventListener('click', () => {
                this.summonMenu.classList.remove('show');
                this.closeInteractMenu();
            });

            window.addEventListener('resize', () => {
                if (!this.active) return;
                this.keepInBounds();
                if (this.state === 'sleep' || this.mode === 'rest') {
                    this.goRest();
                }
            });

            document.addEventListener('keydown', (event) => {
                if (!this.active || event.repeat) return;
                if (this.isTypingTarget(event.target)) return;
                if (event.key.toLowerCase() === 'f') {
                    event.preventDefault();
                    this.openSnackTray();
                }
                if (event.key.toLowerCase() === 'r') {
                    event.preventDefault();
                    this.toggleMode();
                }
                if (event.key.toLowerCase() === 'p') {
                    event.preventDefault();
                    this.petMochi();
                }
                if (event.key.toLowerCase() === 'm') {
                    event.preventDefault();
                    this.playMochi();
                }
            });
        }

        isTypingTarget(target) {
            const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
        }

        say(key) {
            const fallback = this.petProfiles.mochi.phrases[key] || '';
            return this.currentProfile?.phrases?.[key] || fallback;
        }

        actionLabel(key, fallback) {
            return this.currentProfile?.actions?.[key] || fallback;
        }

        switchPet(petId) {
            const profile = this.petProfiles[petId] || this.petProfiles.mochi;
            if (profile.id === this.currentPetId) return;

            this.currentPetId = profile.id;
            this.currentProfile = profile;
            this.assetBase = profile.assetBase;
            this.frameMetrics = profile.metrics || {};
            this.imageCache.clear();
            this.poseFrame = -1;
            this.currentFramePath = '';
            this.frameOffset = { x: 0, y: 0 };
            this.sprite.alt = profile.displayName;
            if (this.snackTray) {
                this.snackTray.setAttribute('aria-label', `${profile.displayName} snacks`);
            }
            this.preloadImages();
            this.setPose(this.stablePose || 'stand');
        }

        summon(petId) {
            if (petId) {
                this.switchPet(petId);
            }
            const rect = this.summonBtn.getBoundingClientRect();
            this.active = true;
            this.mode = 'roam';
            this.state = 'travel';
            this.el.classList.add('active');
            this.setPose('walk');
            this.stablePose = 'walk';
            this.x = rect.left + rect.width / 2 - this.width / 2;
            this.y = rect.bottom + 6;
            this.setRandomTarget(true);
            this.showBubble(this.say('summon'));
        }

        dismiss() {
            if (!this.active) return;
            this.closeSnackTray();
            const rect = this.summonBtn.getBoundingClientRect();
            this.mode = 'dismiss';
            this.state = 'dismiss';
            this.targetX = rect.left + rect.width / 2 - this.width / 2;
            this.targetY = rect.top + rect.height / 2 - this.height / 2;
            this.transitionPose('walk');
        }

        toggleMode() {
            if (!this.active) return;
            if (this.mode === 'rest') {
                this.mode = 'roam';
                const startRoam = () => {
                    this.startTravel(true, this.say('roam'));
                };
                startRoam();
            } else {
                this.mode = 'rest';
                this.goRest();
            }
        }

        goRest() {
            if (!this.active) return;
            const nav = document.querySelector('.nav')?.getBoundingClientRect();
            const summon = this.summonBtn.getBoundingClientRect();
            this.mode = 'rest';
            this.state = 'toRest';
            this.targetX = this.clamp(summon.left - 168, 8, window.innerWidth - this.width - 8);
            this.targetY = nav ? nav.top + Math.max(4, nav.height - 48) : 8;
            this.showBubble(this.say('rest'));
            this.transitionPose('walk');
        }

        setPose(name) {
            const pose = this.poses[name] || this.poses.stand;
            this.currentClip = null;
            if (this.pose !== name) {
                this.el.dataset.pose = name;
                this.pose = name;
                this.poseStartedAt = performance.now();
                this.poseFrame = -1;
            }
            if (name !== 'walk') {
                this.directionClip = null;
                this.directionClipTarget = null;
                this.directionClipStartedAt = 0;
                this.resetLocomotionStep();
            }
            this.setStageBox();
            this.updateSpriteFrame(performance.now());
            this.stablePose = name;
        }

        setStageBox() {
            this.width = this.stageWidth;
            this.height = this.stageHeight;
            this.el.style.setProperty('--mochi-width', `${this.stageWidth}px`);
            this.el.style.setProperty('--mochi-height', `${this.stageHeight}px`);
        }

        setSpriteBox() {
            this.setStageBox();
        }

        playClip(name, after) {
            const clip = this.clips[name];
            if (!clip) {
                if (typeof after === 'function') after();
                return;
            }

            this.directionClip = null;
            this.directionClipTarget = null;
            this.directionClipStartedAt = 0;
            this.currentClip = {
                ...clip,
                name,
                startedAt: performance.now(),
                finished: false
            };
            this.afterClip = typeof after === 'function' ? after : null;
            this.state = 'clip';
            this.actionUntil = this.currentClip.startedAt + (clip.frames.length * 1000) / clip.fps;
            this.poseFrame = -1;
            this.resetLocomotionStep();
            this.el.dataset.pose = name;
            this.setSpriteBox(clip);
            this.updateSpriteFrame(this.currentClip.startedAt);
        }

        transitionPose(nextPose, after, options = {}) {
            const resumeState = options.resumeState || this.state;
            const finish = () => {
                this.setPose(nextPose);
                if (this.state === 'clip' && resumeState) {
                    this.state = resumeState;
                }
                if (typeof after === 'function') after();
            };

            if (options.instant) {
                finish();
                return;
            }

            const clipPath = this.getTransitionPath(this.stablePose || this.pose, nextPose);
            if (clipPath.length) {
                this.playClipSequence(clipPath, finish);
                return;
            }

            finish();
        }

        playClipSequence(names, after, index = 0) {
            if (index >= names.length) {
                if (typeof after === 'function') after();
                return;
            }

            this.playClip(names[index], () => this.playClipSequence(names, after, index + 1));
        }

        getTransitionPath(fromPose, toPose) {
            if (!fromPose || !toPose || fromPose === toPose) return [];
            const direct = `${fromPose}To${toPose.charAt(0).toUpperCase()}${toPose.slice(1)}`;
            if (this.clips[direct]) return [direct];

            const aliases = {
                dance: 'happy',
                groom: 'sit',
                peek: 'stand'
            };
            const from = aliases[fromPose] || fromPose;
            const to = aliases[toPose] || toPose;
            const aliased = `${from}To${to.charAt(0).toUpperCase()}${to.slice(1)}`;
            if (this.clips[aliased]) return [aliased];

            const fallback = {
                'sleep>sit': ['sleepToRest', 'restToSit'],
                'sleep>stand': ['sleepToRest', 'restToSit', 'sitToStand'],
                'sleep>walk': ['sleepToWalk'],
                'sleep>eat': ['sleepToRest', 'restToSit', 'sitToEat'],
                'sleep>happy': ['sleepToRest', 'restToSit', 'sitToPlay'],
                'rest>stand': ['restToSit', 'sitToStand'],
                'rest>eat': ['restToSit', 'sitToEat'],
                'rest>happy': ['restToSit', 'sitToPlay'],
                'rest>sleep': ['restToSleep'],
                'walk>sleep': ['walkToRest', 'restToSleep'],
                'sit>sleep': ['sitToRest', 'restToSleep'],
                'stand>sleep': ['standToRest', 'restToSleep'],
                'eat>sit': ['eatToHappy', 'happyToSit'],
                'eat>stand': ['eatToHappy', 'happyToStand'],
                'eat>walk': ['eatToHappy', 'happyToWalk'],
                'eat>rest': ['eatToHappy', 'happyToSit', 'sitToRest'],
                'eat>sleep': ['eatToHappy', 'happyToSit', 'sitToRest', 'restToSleep'],
                'happy>rest': ['happyToSit', 'sitToRest'],
                'happy>sleep': ['happyToSit', 'sitToRest', 'restToSleep'],
                'happy>eat': ['happyToSit', 'sitToEat']
            };
            return fallback[`${from}>${to}`] || [];
        }

        playSoftClip(name) {
            if (this.state === 'clip' || this.state === 'eat' || this.state === 'toSnack' || this.state === 'toRest') {
                return;
            }

            const mode = this.mode;
            const state = this.state;
            this.playClip(name, () => {
                this.mode = mode;
                if (mode === 'follow') {
                    this.state = 'follow';
                    this.transitionPose('walk');
                    return;
                }
                if (mode === 'rest') {
                    this.goRest();
                    return;
                }
                this.state = state === 'travel' ? 'travel' : 'idle';
                this.transitionPose(this.state === 'travel' ? 'walk' : 'stand');
            });
        }

        finishClip() {
            const after = this.afterClip;
            this.currentClip = null;
            this.afterClip = null;
            this.actionUntil = 0;
            this.resetLocomotionStep();
            if (typeof after === 'function') {
                after();
            }
        }

        isLocomotionState() {
            return ['travel', 'toRest', 'toSnack', 'toPeek', 'dismiss', 'follow'].includes(this.state);
        }

        getLocomotionProfile() {
            if (this.state === 'follow') return { speed: 420, fps: 22, bobScale: 1.05 };
            if (this.state === 'toSnack') return { speed: 440, fps: 22, bobScale: 1 };
            if (this.state === 'toRest') return { speed: 430, fps: 21, bobScale: 0.9 };
            if (this.state === 'dismiss') return { speed: 520, fps: 24, bobScale: 1.1 };
            if (this.state === 'toPeek') return { speed: 330, fps: 19, bobScale: 0.85 };
            return { speed: 300, fps: 18, bobScale: 0.9 };
        }

        getActiveSpriteSet() {
            if (this.currentClip) return this.currentClip;
            if (this.pose === 'walk') return this.getWalkSpriteSet();
            return this.poses[this.pose] || this.poses.stand;
        }

        getWalkSpriteSet() {
            if (this.directionClip) return this.directionClip;
            return this.walkVariants[this.walkVariant] || this.walkVariants.horizontal || this.poses.walk;
        }

        getWalkFps() {
            const variant = this.getWalkSpriteSet();
            return variant.fps || this.getLocomotionProfile().fps;
        }

        getSpriteFps(spriteSet) {
            if (!this.currentClip && this.pose === 'walk' && this.isLocomotionState()) {
                return this.getWalkFps();
            }
            return spriteSet.fps || 10;
        }

        getSpriteFrameIndex(spriteSet, now) {
            const frames = spriteSet.frames && spriteSet.frames.length ? spriteSet.frames : this.poses.stand.frames;
            const fps = this.getSpriteFps(spriteSet);
            const startedAt = this.currentClip ? this.currentClip.startedAt : (spriteSet.startedAt || this.poseStartedAt);
            const frameDuration = 1000 / fps;
            const elapsed = Math.max(0, Number.isFinite(now) ? now - startedAt : 0);
            let frame = Math.floor(elapsed / frameDuration);

            if (this.currentClip || spriteSet.once) {
                frame = Math.min(frame, frames.length - 1);
            } else {
                frame %= frames.length;
            }

            return Number.isFinite(frame) && frames[frame] ? frame : 0;
        }

        getWalkFrame(now) {
            const walk = this.getWalkSpriteSet();
            const fps = this.getWalkFps();
            const startedAt = walk.startedAt || this.poseStartedAt;
            const elapsed = Math.max(0, Number.isFinite(now) ? now - startedAt : 0);
            const frame = Math.floor(elapsed / (1000 / fps));
            if (walk.once) {
                return Math.min(frame, walk.frames.length - 1);
            }
            return frame % walk.frames.length;
        }

        resetLocomotionStep() {
            this.lastLocomotionFrame = null;
            this.lastLocomotionState = null;
            this.lastLocomotionStartedAt = 0;
        }

        getWalkStartedAt() {
            const walk = this.getWalkSpriteSet();
            return walk.startedAt || this.poseStartedAt;
        }

        getWalkStepWeights() {
            const weights = this.getWalkSpriteSet().stepWeights || this.walkStepWeights;
            const total = weights.reduce((sum, weight) => sum + weight, 0);
            return {
                weights,
                scale: total > 0 ? weights.length / total : 1
            };
        }

        consumeWalkStepWeight(now) {
            const frame = this.getWalkFrame(now);
            const startedAt = this.getWalkStartedAt();
            if (
                this.lastLocomotionFrame === null ||
                this.lastLocomotionState !== this.state ||
                this.lastLocomotionStartedAt !== startedAt
            ) {
                this.lastLocomotionFrame = frame;
                this.lastLocomotionState = this.state;
                this.lastLocomotionStartedAt = startedAt;
                return 0;
            }

            const totalFrames = this.getWalkSpriteSet().frames.length;
            const advance = (frame - this.lastLocomotionFrame + totalFrames) % totalFrames;
            if (advance === 0) {
                return 0;
            }

            let weight = 0;
            const { weights, scale } = this.getWalkStepWeights();
            for (let step = 1; step <= advance; step += 1) {
                const frameIndex = (this.lastLocomotionFrame + step) % totalFrames;
                weight += weights[frameIndex % weights.length] || 0;
            }

            this.lastLocomotionFrame = frame;
            this.lastLocomotionState = this.state;
            this.lastLocomotionStartedAt = startedAt;
            return weight * scale;
        }

        updateSpriteFrame(now) {
            const spriteSet = this.getActiveSpriteSet();
            const frames = spriteSet.frames && spriteSet.frames.length ? spriteSet.frames : this.poses.stand.frames;
            const frame = this.getSpriteFrameIndex(spriteSet, now);
            const framePath = frames[frame];

            if (frame !== this.poseFrame || framePath !== this.currentFramePath) {
                const cached = this.preloadFrame(framePath);
                if (cached && !cached.complete && this.currentFramePath) {
                    return;
                }
                this.poseFrame = frame;
                this.currentFramePath = framePath;
                this.sprite.src = cached ? cached.src : this.assetBase + framePath;
            }
            this.frameOffset = this.getFrameOffset(spriteSet, framePath);
        }

        getFrameOffset(spriteSet, framePath) {
            const metrics = this.frameMetrics[framePath];
            if (!metrics || !metrics.w || !metrics.h || !metrics.b) {
                return { x: 0, y: 0 };
            }

            const frameW = spriteSet.width || metrics.w * this.renderScale;
            const frameH = spriteSet.height || metrics.h * this.renderScale;
            const fitX = frameW / metrics.w;
            const fitY = frameH / metrics.h;
            const anchorX = Number.isFinite(metrics.a) ? metrics.a : (metrics.l + metrics.r) / 2;
            const renderedAnchorX = anchorX * fitX;
            const renderedBottom = metrics.b * fitY;

            this.sprite.style.setProperty('--mochi-frame-width', `${frameW.toFixed(2)}px`);
            this.sprite.style.setProperty('--mochi-frame-height', `${frameH.toFixed(2)}px`);

            return {
                x: Math.round((this.stageWidth / 2 - renderedAnchorX) * 10) / 10,
                y: Math.round((this.stageHeight - renderedBottom) * 10) / 10
            };
        }

        setRandomTarget(forceMove) {
            const margin = 16;
            const maxX = Math.max(margin, window.innerWidth - this.width - margin);
            const maxY = Math.max(margin + 56, window.innerHeight - this.height - margin);
            const nextX = margin + Math.random() * Math.max(1, maxX - margin);
            const nextY = 56 + Math.random() * Math.max(1, maxY - 56);

            if (!forceMove && Math.hypot(nextX - this.x, nextY - this.y) < 140) {
                return this.setRandomTarget(true);
            }

            this.targetX = nextX;
            this.targetY = nextY;
        }

        showInteractMenu() {
            if (!this.active) return;
            this.interactMenu.innerHTML = '';
            this.addMenuItem(this.mode === 'rest' ? this.actionLabel('roam', 'Roam') : this.actionLabel('rest', 'Rest'), () => this.toggleMode());
            this.addMenuItem(this.actionLabel('feed', 'Feed'), () => this.openSnackTray());
            this.addMenuItem(this.actionLabel('pet', 'Pet'), () => this.petMochi());
            this.addMenuItem(this.actionLabel('play', 'Play'), () => this.playMochi());
            this.addMenuItem(this.actionLabel('groom', 'Groom'), () => this.groomMochi());
            this.addMenuItem(this.actionLabel('sniff', 'Sniff'), () => this.sniffMochi());
            this.addMenuItem(this.actionLabel('happy', 'Wiggle'), () => this.happyMochi());
            this.addMenuItem(this.actionLabel('peek', 'Peek'), () => this.peekMochi());
            this.addMenuItem(this.actionLabel('findSnack', 'Find Snack'), () => this.findSnack());
            this.addMenuItem(this.mode === 'follow' ? this.actionLabel('stopFollow', 'Stop Follow') : this.actionLabel('follow', 'Follow'), () => this.toggleFollow());
            this.addMenuItem(this.actionLabel('dismiss', 'Dismiss'), () => this.dismiss());

            const rect = this.el.getBoundingClientRect();
            const gap = 8;
            const menuWidth = 154;
            const menuHeight = this.interactMenu.children.length * 40 + 8;
            let left = rect.right + gap;
            if (left + menuWidth > window.innerWidth - gap) {
                left = rect.left - menuWidth - gap;
            }

            let top = rect.top + Math.min(24, rect.height * 0.25);
            top = this.clamp(top, gap, window.innerHeight - menuHeight - gap);

            this.interactMenu.style.left = `${Math.round(this.clamp(left, gap, window.innerWidth - menuWidth - gap))}px`;
            this.interactMenu.style.top = `${Math.round(top)}px`;
            this.interactMenu.classList.add('show');
            this.menuOpen = true;
        }

        closeInteractMenu() {
            this.interactMenu.classList.remove('show');
            this.menuOpen = false;
        }

        addMenuItem(label, action) {
            const item = document.createElement('div');
            item.className = 'pet-menu-item';
            item.textContent = label;
            item.addEventListener('click', (event) => {
                event.stopPropagation();
                this.closeInteractMenu();
                action();
            });
            this.interactMenu.appendChild(item);
        }

        openSnackTray() {
            if (!this.active) this.summon();
            this.snackTray.classList.add('show');
            this.showBubble(this.say('snack'));
        }

        closeSnackTray() {
            this.snackTray.classList.remove('show');
            document.body.classList.remove('mochi-placing');
            this.pendingSnackType = null;
            this.snackTray.querySelectorAll('.snack-choice').forEach((button) => button.classList.remove('active'));
            if (this.feedClickHandler) {
                document.removeEventListener('click', this.feedClickHandler, true);
                this.feedClickHandler = null;
            }
        }

        pickSnack(type) {
            this.pendingSnackType = type;
            document.body.classList.add('mochi-placing');
            this.snackTray.querySelectorAll('.snack-choice').forEach((button) => {
                button.classList.toggle('active', button.dataset.snack === type);
            });

            if (this.feedClickHandler) {
                document.removeEventListener('click', this.feedClickHandler, true);
            }

            this.feedClickHandler = (event) => {
                if (event.target.closest('.snack-tray, .summon-menu, .pet-menu, .pet-summon-btn, .pet-wrapper')) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.dropSnack(event.clientX, event.clientY, type);
                this.closeSnackTray();
            };

            setTimeout(() => {
                document.addEventListener('click', this.feedClickHandler, true);
            }, 0);
        }

        dropSnack(x, y, type) {
            if (this.currentSnack) this.currentSnack.remove();

            const snack = document.createElement('div');
            snack.className = `dropped-snack ${type}`;
            snack.style.left = `${x}px`;
            snack.style.top = `${y}px`;
            this.snackLayer.appendChild(snack);
            this.currentSnack = snack;
            this.currentSnackType = type;
            this.snackPoint = { x, y };
            this.previousMode = this.mode;
            this.returnAfterFeed = this.mode === 'rest';
            this.mode = 'feed';
            this.state = 'toSnack';
            this.targetX = this.clamp(x - this.width * 0.5, 4, window.innerWidth - this.width - 4);
            this.targetY = this.clamp(y - this.height + 16, 4, window.innerHeight - this.height - 4);
            this.showBubble(this.say('feed'));
            this.transitionPose('walk');
        }

        eatCurrentSnack() {
            const clipName = this.foodClipBySnack[this.currentSnackType] || 'eatCookie';
            this.transitionPose('sit', () => {
                this.playClip(clipName, () => this.finishSnack());
            }, { resumeState: 'toSnack' });
        }

        finishSnack() {
            if (this.currentSnack) {
                this.currentSnack.remove();
                this.currentSnack = null;
            }
            this.currentSnackType = null;
            this.snackPoint = null;

            this.playClip('happy', () => {
                if (this.returnAfterFeed) {
                    this.returnAfterFeed = false;
                    this.mode = 'rest';
                    this.goRest();
                    return;
                }
                if (this.previousMode === 'follow') {
                    this.startFollow();
                    return;
                }
                this.mode = 'roam';
                this.state = 'idle';
                this.idleUntil = performance.now() + 1100;
                this.transitionPose('sit');
            });
        }

        startTravel(forceMove, bubbleText) {
            const begin = () => {
                this.state = 'travel';
                this.setRandomTarget(forceMove);
                if (bubbleText) this.showBubble(bubbleText);
            };
            this.transitionPose('walk', begin);
        }

        petMochi() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            const resumeRest = this.mode === 'rest';
            const resumeFollow = this.mode === 'follow';
            this.showBubble(this.say('pet'));

            const finish = () => {
                if (resumeRest) {
                    this.goRest();
                    return;
                }
                if (resumeFollow) {
                    this.startFollow();
                    return;
                }
                this.mode = 'roam';
                this.state = 'idle';
                this.idleUntil = performance.now() + 900;
                this.setPose('sit');
            };

            this.transitionPose('sit', () => this.playClip('pet', finish));
        }

        playMochi() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            this.mode = 'roam';
            this.showBubble(this.say('play'));
            this.transitionPose('sit', () => {
                this.playClip('sitToPlay', () => {
                    this.stablePose = 'dance';
                    this.playClip(Math.random() > 0.45 ? 'play' : 'dance', () => {
                        this.playClip('playToSit', () => {
                            this.state = 'idle';
                            this.idleUntil = performance.now() + 900;
                            this.setPose('sit');
                        });
                    });
                });
            });
        }

        groomMochi() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            this.mode = 'roam';
            this.showBubble(this.say('groom'));
            this.transitionPose('sit', () => {
                this.stablePose = 'groom';
                this.playClip('groom', () => {
                    this.state = 'idle';
                    this.idleUntil = performance.now() + 1100;
                    this.setPose('sit');
                });
            });
        }

        sniffMochi(after) {
            if (!this.active) this.summon();
            this.closeSnackTray();
            this.mode = 'roam';
            this.showBubble(this.say('sniff'));
            this.transitionPose('sit', () => {
                this.playClip('sniff', () => {
                    this.state = 'idle';
                    this.idleUntil = performance.now() + 900;
                    this.setPose('sit');
                    if (typeof after === 'function') after();
                });
            });
        }

        happyMochi() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            this.mode = 'roam';
            this.showBubble(this.say('happy'));
            this.transitionPose('sit', () => {
                this.playClip('happy', () => {
                    this.state = 'idle';
                    this.idleUntil = performance.now() + 900;
                    this.setPose('sit');
                });
            });
        }

        peekMochi() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            this.mode = 'roam';
            this.state = 'toPeek';
            this.showBubble(this.say('peek'));
            const goLeft = Math.random() > 0.5;
            this.facing = goLeft ? -1 : 1;
            this.targetX = goLeft ? 6 : window.innerWidth - this.width - 6;
            this.targetY = this.clamp(64 + Math.random() * (window.innerHeight - this.height - 130), 48, window.innerHeight - this.height - 8);
            this.transitionPose('walk');
        }

        findSnack() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            const snack = this.snacks[Math.floor(Math.random() * this.snacks.length)];
            const x = this.clamp(80 + Math.random() * (window.innerWidth - 160), 40, window.innerWidth - 40);
            const y = this.clamp(110 + Math.random() * (window.innerHeight - 190), 80, window.innerHeight - 60);
            this.sniffMochi(() => this.dropSnack(x, y, snack.id));
        }

        toggleFollow() {
            if (!this.active) this.summon();
            this.closeSnackTray();
            if (this.mode === 'follow') {
                this.mode = 'roam';
                this.startTravel(true, this.say('roam'));
                return;
            }

            this.startFollow();
        }

        startFollow() {
            const begin = () => {
                this.mode = 'follow';
                this.state = 'follow';
                this.showBubble(this.say('follow'));
            };
            this.mode = 'follow';
            this.state = 'follow';
            this.transitionPose('walk', begin);
        }

        beginDrag(event) {
            if (!this.active || event.button !== 0) return;
            this.drag = {
                startX: event.clientX,
                startY: event.clientY,
                offsetX: event.clientX - this.x,
                offsetY: event.clientY - this.y,
                moved: false,
                mode: this.mode
            };
        }

        trackPointer(event) {
            this.pointer = { x: event.clientX, y: event.clientY };
            if (!this.drag) return;

            const movedDistance = Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY);
            if (movedDistance > 6) {
                this.drag.moved = true;
            }

            if (!this.drag.moved) return;
            event.preventDefault();
            this.closeInteractMenu();
            this.closeSnackTray();
            this.state = 'drag';
            this.currentClip = null;
            this.el.classList.add('dragging');
            this.setPose('sit');
            this.x = this.clamp(event.clientX - this.drag.offsetX, 4, window.innerWidth - this.width - 4);
            this.y = this.clamp(event.clientY - this.drag.offsetY, 4, window.innerHeight - this.height - 4);
        }

        endDrag() {
            if (!this.drag) return;
            const didMove = this.drag.moved;
            const resumeMode = this.drag.mode;
            this.drag = null;
            this.el.classList.remove('dragging');

            if (!didMove) return;
            this.suppressClick = true;
            this.showBubble(this.say('drag'));
            this.mode = resumeMode === 'rest' ? 'rest' : resumeMode === 'follow' ? 'follow' : 'roam';
            this.playClip('hop', () => {
                if (this.mode === 'rest') {
                    this.goRest();
                    return;
                }
                if (this.mode === 'follow') {
                    this.state = 'follow';
                    this.transitionPose('walk');
                    return;
                }
                this.state = 'idle';
                this.idleUntil = performance.now() + 700;
                this.transitionPose('stand');
            });
        }

        update(dt, now) {
            if (!this.active) return;
            if (this.menuOpen) return;
            if (this.state === 'drag') return;

            if (this.state === 'clip') {
                if (now >= this.actionUntil) {
                    this.finishClip();
                }
                return;
            }

            if (this.mode === 'follow' && this.state !== 'clip') {
                this.updateFollow(dt, now);
                return;
            }

            if (this.state === 'idle') {
                if (!this.nextIdlePoseAt) {
                    this.nextIdlePoseAt = now + 5200 + Math.random() * 4200;
                }
                if (!this.nextIdleTrickAt) {
                    this.nextIdleTrickAt = now + 10000 + Math.random() * 9000;
                }

                if (this.mode === 'roam' && now > this.nextIdleTrickAt && now < this.idleUntil - 1500) {
                    const tricks = ['groom', 'sniff', 'happy'];
                    const trick = tricks[Math.floor(Math.random() * tricks.length)];
                    this.nextIdleTrickAt = now + 12000 + Math.random() * 10000;
                    this.playClip(trick, () => {
                        this.state = 'idle';
                        this.idleUntil = performance.now() + 1100;
                        this.setPose('sit');
                    });
                    return;
                }

                if (now > this.nextIdlePoseAt && now < this.idleUntil - 500) {
                    const nextPose = this.stablePose === 'sit' ? 'stand' : 'sit';
                    this.nextIdlePoseAt = now + 5200 + Math.random() * 4200;
                    this.transitionPose(nextPose, () => {
                        this.state = 'idle';
                    });
                    return;
                }

                if (now > this.idleUntil) {
                    this.nextIdlePoseAt = 0;
                    this.startTravel(false);
                }
            }

            if (this.state === 'sleep') {
                if (this.stablePose !== 'sleep') {
                    this.transitionPose('sleep');
                }
                return;
            }

            if (this.state === 'travel' || this.state === 'toRest' || this.state === 'toSnack' || this.state === 'toPeek' || this.state === 'dismiss') {
                this.moveToward(dt, now);
            }
        }

        updateFollow(dt, now) {
            this.targetX = this.clamp(this.pointer.x - this.width / 2, 4, window.innerWidth - this.width - 4);
            this.targetY = this.clamp(this.pointer.y - this.height + 12, 4, window.innerHeight - this.height - 4);

            const distance = Math.hypot(this.targetX - this.x, this.targetY - this.y);
            if (distance > 46) {
                this.state = 'follow';
                this.moveToward(dt, now);
                return;
            }

            this.state = 'followIdle';
            if (this.stablePose !== 'sit') {
                this.transitionPose('sit', null, { resumeState: 'followIdle' });
            }
        }

        getDesiredWalkVariant(dx, dy) {
            const ax = Math.abs(dx);
            const ay = Math.abs(dy);
            const verticalThreshold = this.walkVariant === 'horizontal' ? 1.55 : 1.15;

            if (ay > ax * verticalThreshold) {
                return dy > 0 ? 'down' : 'up';
            }
            return 'horizontal';
        }

        updateWalkVariant(dx, dy, now) {
            const nextVariant = this.getDesiredWalkVariant(dx, dy);
            if (this.directionClip) {
                if (nextVariant === this.directionClipTarget) {
                    this.pendingWalkVariant = null;
                }
                return;
            }

            if (nextVariant === this.walkVariant) {
                this.pendingWalkVariant = null;
                return;
            }

            if (this.pendingWalkVariant !== nextVariant) {
                this.pendingWalkVariant = nextVariant;
                this.pendingWalkVariantAt = now;
                return;
            }

            if (now - this.pendingWalkVariantAt < 120) {
                return;
            }

            this.startDirectionTransition(nextVariant, now);
            this.pendingWalkVariant = null;
        }

        startDirectionTransition(nextVariant, now) {
            const transition = this.directionTransitions[this.walkVariant]?.[nextVariant];
            if (!transition) {
                this.walkVariant = nextVariant;
                this.directionClip = null;
                this.directionClipTarget = null;
                this.directionClipStartedAt = 0;
                this.resetLocomotionStep();
                this.poseStartedAt = now;
                this.poseFrame = -1;
                this.currentFramePath = '';
                return;
            }

            this.directionClip = {
                ...transition,
                startedAt: now,
                once: true
            };
            this.directionClipTarget = nextVariant;
            this.directionClipStartedAt = now;
            this.pendingWalkVariant = null;
            this.resetLocomotionStep();
            this.poseStartedAt = now;
            this.poseFrame = -1;
            this.currentFramePath = '';
        }

        finishDirectionClip(now) {
            if (!this.directionClip) return;
            const duration = (this.directionClip.frames.length * 1000) / (this.directionClip.fps || this.getLocomotionProfile().fps);
            if (now < this.directionClipStartedAt + duration) return;

            this.walkVariant = this.directionClipTarget || this.walkVariant;
            this.directionClip = null;
            this.directionClipTarget = null;
            this.directionClipStartedAt = 0;
            this.resetLocomotionStep();
            this.poseStartedAt = now;
            this.poseFrame = -1;
            this.currentFramePath = '';
        }

        moveToward(dt, now = performance.now()) {
            const dx = this.targetX - this.x;
            const dy = this.targetY - this.y;
            const distance = Math.hypot(dx, dy);

            if (distance < 4) {
                this.x = this.targetX;
                this.y = this.targetY;
                this.onArrive(performance.now());
                return;
            }

            this.finishDirectionClip(now);
            this.updateWalkVariant(dx, dy, now);
            const facingVariant = this.directionClip
                ? (this.walkVariant === 'horizontal' ? 'horizontal' : this.directionClipTarget)
                : this.walkVariant;
            if (facingVariant === 'horizontal') {
                if (Math.abs(dx) > 0.5) {
                    this.facing = dx >= 0 ? 1 : -1;
                }
            } else {
                this.facing = 1;
            }

            this.setPose('walk');
            const profile = this.getLocomotionProfile();
            const stepWeight = this.consumeWalkStepWeight(now);
            const step = Math.min(distance, (profile.speed / this.getWalkFps()) * stepWeight);
            if (step > 0) {
                this.x += (dx / distance) * step;
                this.y += (dy / distance) * step;
            }
        }

        onArrive(now) {
            if (this.state === 'follow') {
                this.state = 'followIdle';
                this.transitionPose('sit', null, { resumeState: 'followIdle' });
                return;
            }

            if (this.state === 'dismiss') {
                this.playClip('bye', () => {
                    this.active = false;
                    this.state = 'hidden';
                    this.el.classList.remove('active');
                    this.closeSnackTray();
                });
                return;
            }

            if (this.state === 'toRest') {
                this.transitionPose('rest', () => {
                    this.state = 'sleep';
                    this.transitionPose('sleep', null, { resumeState: 'sleep' });
                }, { resumeState: 'toRest' });
                return;
            }

            if (this.state === 'toPeek') {
                this.transitionPose('stand', () => {
                    this.stablePose = 'peek';
                    this.playClip('peek', () => {
                        this.state = 'idle';
                        this.idleUntil = performance.now() + 900;
                        this.transitionPose('stand');
                    });
                }, { resumeState: 'toPeek' });
                return;
            }

            if (this.state === 'toSnack') {
                if (this.snackPoint) {
                    this.facing = this.snackPoint.x >= this.x + this.width / 2 ? 1 : -1;
                }
                this.eatCurrentSnack();
                return;
            }

            if (this.state === 'toSleep') {
                this.transitionPose('rest', () => {
                    this.state = 'sleep';
                    this.transitionPose('sleep', null, { resumeState: 'sleep' });
                }, { resumeState: 'toSleep' });
                return;
            }

            this.playClip('walkToSit', () => {
                this.state = 'idle';
                this.idleUntil = performance.now() + 520 + Math.random() * 1300;
                this.setPose('sit');
            });
        }

        render(now) {
            if (!this.active) return;
            const bob = this.getBob(now);
            this.updateSpriteFrame(now);
            const frameOffset = this.frameOffset || { x: 0, y: 0 };
            const offsetX = this.facing === -1 ? -frameOffset.x : frameOffset.x;
            const offsetY = frameOffset.y + bob;
            this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
            this.sprite.style.transform = `translate(${offsetX}px, ${offsetY}px) scaleX(${this.facing})`;
        }

        getBob(now) {
            if (this.state === 'drag') {
                return -2;
            }
            return 0;
        }

        keepInBounds() {
            this.x = this.clamp(this.x, 4, window.innerWidth - this.width - 4);
            this.y = this.clamp(this.y, 4, window.innerHeight - this.height - 4);
        }

        clamp(value, min, max) {
            return Math.min(Math.max(value, min), Math.max(min, max));
        }

        showBubble(text) {
            if (!this.bubble) return;
            clearTimeout(this.bubbleTimer);
            this.bubble.textContent = text;
            this.bubble.classList.add('show');
            this.bubbleTimer = setTimeout(() => {
                this.bubble.classList.remove('show');
            }, 1250);
        }

        startLoop() {
            const loop = (now) => {
                const dt = Math.min(0.04, (now - this.lastTime) / 1000 || 0.016);
                this.lastTime = now;
                this.update(dt, now);
                this.render(now);
                this.raf = requestAnimationFrame(loop);
            };
            this.raf = requestAnimationFrame(loop);
        }
    }

    window.MochiPet = MochiPet;
})();

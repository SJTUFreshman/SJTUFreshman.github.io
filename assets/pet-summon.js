(function () {
    "use strict";

    const SESSION_KEY = "runde:pet-runtime:v2";
    const RUNTIME_VERSION = "20260729-lazy-v4";
    const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const PETS = {
        mochi: { name: "Mochi", accent: "#ff78ad" },
        appcopilot: { name: "AppCopilot", accent: "#45c9d8" },
        timo: { name: "Timo", accent: "#ffd34f" }
    };
    const ASSETS = {
        style: "assets/mochi/mochi-pet.css",
        metrics: {
            mochi: {
                path: "assets/mochi/mochi-frame-metrics.js",
                global: "MOCHI_FRAME_METRICS"
            },
            appcopilot: {
                path: "assets/appcopilot/appcopilot-frame-metrics.js",
                global: "APPCOPILOT_FRAME_METRICS"
            },
            timo: {
                path: "assets/timo/timo-frame-metrics.js",
                global: "TIMO_FRAME_METRICS"
            }
        },
        runtime: "assets/mochi/mochi-pet.js"
    };

    const summonButton = document.getElementById("summonBtn");
    const summonMenu = document.getElementById("summonMenu");
    const dismissOption = summonMenu?.querySelector('[data-char="hide"]');
    if (!summonButton || !summonMenu) return;

    let systemPromise = null;
    let runtimePromise = null;
    const metricsPromises = new Map();
    let activeLoadPromise = null;
    let sequence = null;
    let sequenceStatus = null;
    let sequenceProgress = null;
    let retryButton = null;
    let closeButton = null;
    let pendingPetId = null;
    let pageInertState = [];
    let sequenceStartedAt = 0;
    let restoreFocusTarget = null;
    let petInstance = null;
    const residentPets = new Set();
    const knownCachedPets = new Set();

    const storedState = readSessionState();
    storedState?.loadedPets?.forEach((petId) => {
        if (PETS[petId]) knownCachedPets.add(petId);
    });

    function markPreferredPet(petId) {
        if (!PETS[petId]) return;
        summonMenu.dataset.preferredPet = petId;
        summonMenu.querySelectorAll(".summon-option[data-char]").forEach((option) => {
            if (option.dataset.char === petId) option.setAttribute("aria-current", "true");
            else option.removeAttribute("aria-current");
        });
    }

    if (storedState?.currentPetId) markPreferredPet(storedState.currentPetId);

    function delay(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    function readSessionState() {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY));
            if (
                !parsed ||
                parsed.v !== 2 ||
                parsed.runtimeVersion !== RUNTIME_VERSION ||
                !PETS[parsed.currentPetId]
            ) return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function writeSessionState(patch = {}) {
        const previous = readSessionState() || {};
        const currentPetId = PETS[patch.currentPetId]
            ? patch.currentPetId
            : PETS[previous.currentPetId]
                ? previous.currentPetId
                : "mochi";
        const state = {
            v: 2,
            runtimeVersion: RUNTIME_VERSION,
            ready: patch.ready ?? previous.ready ?? false,
            currentPetId,
            active: patch.active ?? previous.active ?? false,
            loadedPets: Array.from(knownCachedPets),
            updatedAt: Date.now()
        };
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
        } catch (error) {
            // Session persistence is an enhancement; the current page still works.
        }
        markPreferredPet(currentPetId);
        return state;
    }

    function clearSessionState() {
        try {
            sessionStorage.removeItem(SESSION_KEY);
        } catch (error) {
            // Ignore unavailable storage.
        }
    }

    function setMenuOpen(open, focusFirst = false) {
        const nextOpen = Boolean(open);
        summonMenu.classList.toggle("show", nextOpen);
        summonMenu.setAttribute("aria-hidden", String(!nextOpen));
        summonButton.setAttribute("aria-expanded", String(nextOpen));
        if (nextOpen && focusFirst) {
            const preferredPetId = summonMenu.dataset.preferredPet;
            const preferredOption = preferredPetId
                ? summonMenu.querySelector(`.summon-option[data-char="${preferredPetId}"]:not([hidden])`)
                : null;
            (preferredOption || summonMenu.querySelector(".summon-option:not([hidden])"))?.focus();
        }
    }

    function setButtonBusy(busy) {
        summonButton.setAttribute("aria-busy", String(Boolean(busy)));
        summonButton.disabled = Boolean(busy);
    }

    function createSequence() {
        if (sequence) return sequence;
        sequence = document.createElement("div");
        sequence.id = "petSummonSequence";
        sequence.className = "pet-summon-sequence";
        sequence.hidden = true;
        sequence.tabIndex = -1;
        sequence.setAttribute("role", "dialog");
        sequence.setAttribute("aria-modal", "true");
        sequence.setAttribute("aria-labelledby", "petSequenceTitle");
        sequence.setAttribute("aria-describedby", "petSequenceStatus");

        const confetti = Array.from({ length: 18 }, (_, index) => {
            const colors = ["#ffd34f", "#ff705f", "#67cf91", "#fffaf0", "#7568ef"];
            const x = 3 + ((index * 37) % 94);
            const delayValue = -((index * 0.17) % 2.1);
            const duration = 1.75 + ((index * 0.13) % 1.25);
            const color = colors[index % colors.length];
            return `<i style="--x:${x}%;--delay:${delayValue.toFixed(2)}s;--fall:${duration.toFixed(2)}s;--confetti:${color}"></i>`;
        }).join("");

        sequence.innerHTML = `
            <div class="pet-sequence-stage">
                <div class="pet-confetti" aria-hidden="true">${confetti}</div>
                <div class="pet-sequence-copy">
                    <span class="pet-sequence-kicker">Bonus round</span>
                    <h2 class="pet-sequence-title" id="petSequenceTitle">Buddy drop</h2>
                    <div class="pet-sequence-name" data-pet-sequence-name></div>
                </div>
                <div class="pet-sequence-arena" aria-hidden="true">
                    <div class="pet-sequence-rays"></div>
                    <div class="pet-sequence-ring"></div>
                    <div class="pet-sequence-token"></div>
                </div>
                <div class="pet-sequence-footer">
                    <div class="pet-sequence-status" id="petSequenceStatus" aria-live="polite"></div>
                    <div class="pet-sequence-progress" role="progressbar"
                         aria-label="Companion resources loaded" aria-valuemin="0"
                         aria-valuemax="100" aria-valuenow="0">
                        <span></span>
                    </div>
                    <div class="pet-sequence-actions">
                        <button class="pet-sequence-action primary" type="button" data-pet-retry>Retry</button>
                        <button class="pet-sequence-action" type="button" data-pet-close>Keep browsing</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(sequence);
        sequenceStatus = sequence.querySelector(".pet-sequence-status");
        sequenceProgress = sequence.querySelector(".pet-sequence-progress");
        retryButton = sequence.querySelector("[data-pet-retry]");
        closeButton = sequence.querySelector("[data-pet-close]");
        retryButton.addEventListener("click", () => {
            if (!pendingPetId || activeLoadPromise) return;
            requestPet(pendingPetId, { visual: true, forceRetry: true });
        });
        closeButton.addEventListener("click", () => closeSequence());
        return sequence;
    }

    function setPageInert(active) {
        if (active) {
            if (pageInertState.length) return;
            pageInertState = Array.from(document.body.children)
                .filter((element) => element !== sequence && !["SCRIPT", "STYLE"].includes(element.tagName))
                .map((element) => ({
                    element,
                    inert: element.inert,
                    ariaBusy: element.getAttribute("aria-busy")
                }));
            pageInertState.forEach(({ element }) => {
                element.inert = true;
                element.setAttribute("aria-busy", "true");
            });
            document.documentElement.style.overflow = "hidden";
            return;
        }
        pageInertState.forEach(({ element, inert, ariaBusy }) => {
            if (!element.isConnected) return;
            element.inert = inert;
            if (ariaBusy === null) element.removeAttribute("aria-busy");
            else element.setAttribute("aria-busy", ariaBusy);
        });
        pageInertState = [];
        document.documentElement.style.removeProperty("overflow");
    }

    function showSequence(petId) {
        const layer = createSequence();
        const profile = PETS[petId];
        restoreFocusTarget = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : summonButton;
        sequenceStartedAt = performance.now();
        layer.hidden = false;
        layer.classList.remove("is-visible", "is-ready", "is-error", "is-closing");
        layer.style.setProperty("--sequence-accent", profile.accent);
        layer.querySelector("[data-pet-sequence-name]").textContent = `Calling ${profile.name}`;
        retryButton.hidden = true;
        closeButton.hidden = true;
        updateSequence(2, "Opening the companion course…");
        setPageInert(true);
        requestAnimationFrame(() => {
            layer.classList.add("is-visible");
            layer.focus({ preventScroll: true });
        });
    }

    function updateSequence(percent, message) {
        if (!sequence) return;
        const value = Math.max(0, Math.min(100, Math.round(percent)));
        const bar = sequenceProgress?.querySelector("span");
        if (bar) bar.style.width = `${Math.max(4, value)}%`;
        sequenceProgress?.setAttribute("aria-valuenow", String(value));
        if (message && sequenceStatus) sequenceStatus.textContent = message;
    }

    async function closeSequence() {
        if (!sequence || sequence.hidden) {
            setPageInert(false);
            return;
        }
        sequence.classList.add("is-closing");
        sequence.classList.remove("is-visible");
        await delay(REDUCED_MOTION ? 40 : 360);
        sequence.hidden = true;
        sequence.classList.remove("is-ready", "is-error", "is-closing");
        setPageInert(false);
        const target = restoreFocusTarget?.isConnected ? restoreFocusTarget : summonButton;
        target?.focus({ preventScroll: true });
    }

    async function finishSequence(petId) {
        const minimum = REDUCED_MOTION ? 240 : 1300;
        const remaining = minimum - (performance.now() - sequenceStartedAt);
        if (remaining > 0) await delay(remaining);
        updateSequence(100, `${PETS[petId].name} cleared the course!`);
        sequence?.classList.add("is-ready");
        await delay(REDUCED_MOTION ? 180 : 880);
        await closeSequence();
    }

    function showSequenceError(error) {
        if (!sequence || sequence.hidden) return;
        sequence.classList.remove("is-ready");
        sequence.classList.add("is-error");
        updateSequence(
            Number(sequenceProgress?.getAttribute("aria-valuenow")) || 0,
            "The launch gate stumbled. Check the connection and retry."
        );
        retryButton.hidden = false;
        closeButton.hidden = false;
        retryButton.focus({ preventScroll: true });
        console.error("Companion loading failed:", error);
    }

    function versionedUrl(path) {
        const url = new URL(path, document.baseURI);
        url.searchParams.set("v", RUNTIME_VERSION);
        return url.href;
    }

    function loadStyle(path) {
        const id = "petRuntimeStyle";
        const existing = document.getElementById(id);
        if (existing?.dataset.loaded === "true") return Promise.resolve(existing);
        if (existing?.__loadPromise) return existing.__loadPromise;
        const link = existing || document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = versionedUrl(path);
        link.__loadPromise = new Promise((resolve, reject) => {
            link.addEventListener("load", () => {
                link.dataset.loaded = "true";
                resolve(link);
            }, { once: true });
            link.addEventListener("error", () => {
                link.remove();
                reject(new Error(`Could not load ${path}`));
            }, { once: true });
        });
        if (!existing) document.head.appendChild(link);
        return link.__loadPromise;
    }

    function loadScript(path) {
        const id = `petAsset-${path.replace(/[^a-z0-9]/gi, "-")}`;
        const existing = document.getElementById(id);
        if (existing?.dataset.loaded === "true") return Promise.resolve(existing);
        if (existing?.__loadPromise) return existing.__loadPromise;
        const script = existing || document.createElement("script");
        script.id = id;
        script.async = true;
        script.src = versionedUrl(path);
        script.__loadPromise = new Promise((resolve, reject) => {
            script.addEventListener("load", () => {
                script.dataset.loaded = "true";
                resolve(script);
            }, { once: true });
            script.addEventListener("error", () => {
                script.remove();
                reject(new Error(`Could not load ${path}`));
            }, { once: true });
        });
        if (!existing) document.head.appendChild(script);
        return script.__loadPromise;
    }

    async function activatePetCache() {
        if (
            !("serviceWorker" in navigator) ||
            !["http:", "https:"].includes(location.protocol)
        ) return false;
        try {
            const workerUrl = new URL("pet-cache-worker.js", document.baseURI);
            const registration = await navigator.serviceWorker.register(workerUrl.href, {
                scope: new URL("./", document.baseURI).pathname
            });
            await Promise.race([navigator.serviceWorker.ready, delay(1800)]);
            if (navigator.serviceWorker.controller) return true;
            await Promise.race([
                new Promise((resolve) => {
                    navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
                }),
                delay(1400)
            ]);
            return Boolean(navigator.serviceWorker.controller || registration.active);
        } catch (error) {
            console.warn("Companion cache is unavailable; using the browser cache instead.", error);
            return false;
        }
    }

    async function ensurePetMetrics(petId, visual) {
        const asset = ASSETS.metrics[petId];
        if (!asset) throw new Error(`No frame metrics were configured for ${petId}`);

        if (!window[asset.global]) {
            let promise = metricsPromises.get(petId);
            if (!promise) {
                promise = loadScript(asset.path).then(() => {
                    if (!window[asset.global]) {
                        throw new Error(`Frame metrics did not initialize for ${petId}`);
                    }
                    return window[asset.global];
                }).catch((error) => {
                    metricsPromises.delete(petId);
                    throw error;
                });
                metricsPromises.set(petId, promise);
            }
            if (visual) updateSequence(9, `Briefing ${PETS[petId].name}…`);
            await promise;
        }

        const profile = petInstance?.petProfiles?.[petId];
        if (profile) profile.metrics = window[asset.global];
    }

    async function ensureSystemAssets(petId, visual) {
        if (!systemPromise) {
            systemPromise = (async () => {
                if (visual) updateSequence(4, "Securing the launch lane…");
                await activatePetCache();
                if (visual) updateSequence(7, "Rolling out the game stage…");
                await loadStyle(ASSETS.style);
            })().catch((error) => {
                systemPromise = null;
                throw error;
            });
        }
        await systemPromise;
        await ensurePetMetrics(petId, visual);

        if (window.MochiPet) return;
        if (!runtimePromise) {
            runtimePromise = (async () => {
                if (visual) updateSequence(12, "Powering the companion portal…");
                await loadScript(ASSETS.runtime);
                if (!window.MochiPet) throw new Error("Companion runtime did not initialize");
            })().catch((error) => {
                runtimePromise = null;
                throw error;
            });
        }
        await runtimePromise;
    }

    function imageReady(image) {
        return new Promise((resolve, reject) => {
            const finish = () => {
                if (!image.naturalWidth) {
                    reject(new Error(`Companion frame failed: ${image.currentSrc || image.src}`));
                    return;
                }
                resolve();
            };
            if (image.complete) {
                finish();
                return;
            }
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", () => {
                reject(new Error(`Companion frame failed: ${image.currentSrc || image.src}`));
            }, { once: true });
        });
    }

    async function forEachConcurrent(items, concurrency, callback) {
        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < items.length) {
                const index = nextIndex;
                nextIndex += 1;
                await callback(items[index], index);
            }
        };
        const workers = Array.from(
            { length: Math.min(concurrency, items.length) },
            () => worker()
        );
        await Promise.all(workers);
    }

    function getLaunchFrameImages(petId) {
        const cache = petInstance?.imageCaches?.get(petId);
        if (!cache) return [];
        const launchSources = [
            ...(petInstance?.poses?.stand?.frames || []),
            ...(petInstance?.poses?.walk?.frames || [])
        ];
        const images = Array.from(new Set(launchSources))
            .map((source) => cache.get(source))
            .filter(Boolean);
        return images.length ? images : Array.from(cache.values()).slice(0, 48);
    }

    function retryBrokenFrames(petId) {
        const cache = petInstance?.imageCaches?.get(petId);
        if (!cache) return;
        const retryStamp = Date.now();
        cache.forEach((image) => {
            if (!image.complete || image.naturalWidth) return;
            const url = new URL(image.src);
            url.searchParams.set("retry", String(retryStamp));
            image.src = url.href;
        });
    }

    async function waitForPetFrames(petId, visual) {
        const images = getLaunchFrameImages(petId);
        if (!images.length) throw new Error(`No frames were prepared for ${petId}`);
        let completed = 0;
        let lastAnnouncedPercent = -1;
        await forEachConcurrent(images, 8, async (image) => {
            await imageReady(image);
            completed += 1;
            if (!visual) return;
            const percent = 12 + (completed / images.length) * 86;
            const rounded = Math.floor(percent);
            if (rounded !== lastAnnouncedPercent) {
                lastAnnouncedPercent = rounded;
                updateSequence(
                    percent,
                    `Loading ${PETS[petId].name} · ${completed.toLocaleString()} / ${images.length.toLocaleString()} launch frames`
                );
            }
        });
    }

    function instrumentPet(pet) {
        if (pet.__sessionInstrumented) return;
        pet.__sessionInstrumented = true;
        const originalSummon = pet.summon.bind(pet);
        const originalDismiss = pet.dismiss.bind(pet);
        pet.summon = function (petId) {
            const result = originalSummon(petId);
            const currentPetId = pet.currentPetId || petId || "mochi";
            knownCachedPets.add(currentPetId);
            dismissOption.hidden = false;
            writeSessionState({ ready: true, currentPetId, active: true });
            return result;
        };
        pet.dismiss = function () {
            const result = originalDismiss();
            dismissOption.hidden = true;
            writeSessionState({
                ready: true,
                currentPetId: pet.currentPetId || "mochi",
                active: false
            });
            return result;
        };
    }

    async function preparePet(petId, visual, forceRetry) {
        await ensureSystemAssets(petId, visual);
        if (!petInstance) {
            petInstance = new window.MochiPet({ initialPetId: petId });
            window.__mochiPet = petInstance;
            instrumentPet(petInstance);
        } else if (petInstance.currentPetId !== petId) {
            petInstance.switchPet(petId);
        }
        if (forceRetry) retryBrokenFrames(petId);
        await waitForPetFrames(petId, visual);
        residentPets.add(petId);
        knownCachedPets.add(petId);
        writeSessionState({
            ready: true,
            currentPetId: petId,
            active: readSessionState()?.active || false
        });
        return petInstance;
    }

    async function performPetRequest(petId, options) {
        const visual = Boolean(options.visual);
        if (visual) showSequence(petId);
        setButtonBusy(true);
        setMenuOpen(false);
        try {
            const pet = await preparePet(petId, visual, options.forceRetry);
            if (visual) await finishSequence(petId);
            if (options.summon !== false) pet.summon(petId);
            return pet;
        } catch (error) {
            if (visual) showSequenceError(error);
            else {
                clearSessionState();
                console.error("Companion restore failed:", error);
            }
            throw error;
        } finally {
            setButtonBusy(false);
        }
    }

    function requestPet(petId, options = {}) {
        if (!PETS[petId]) return Promise.resolve(null);
        if (activeLoadPromise) return activeLoadPromise;
        pendingPetId = petId;
        const requestOptions = {
            visual: options.visual ?? !residentPets.has(petId),
            summon: options.summon ?? true,
            forceRetry: options.forceRetry ?? false
        };
        if (requestOptions.forceRetry && sequence && !sequence.hidden) {
            sequence.classList.remove("is-error", "is-ready");
            retryButton.hidden = true;
            closeButton.hidden = true;
            updateSequence(3, "Reopening the launch lane…");
        }
        activeLoadPromise = performPetRequest(petId, requestOptions)
            .catch(() => null)
            .finally(() => {
                activeLoadPromise = null;
            });
        return activeLoadPromise;
    }

    summonButton.addEventListener("click", (event) => {
        if (petInstance) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenuOpen(!summonMenu.classList.contains("show"), event.detail === 0);
    }, true);

    summonMenu.addEventListener("click", (event) => {
        const option = event.target.closest(".summon-option");
        if (!option) return;
        const petId = option.dataset.char;
        if (petId === "hide") {
            if (petInstance) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            setMenuOpen(false);
            return;
        }
        if (!PETS[petId] || (petInstance && residentPets.has(petId))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestPet(petId);
    }, true);

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".pet-summon-control")) setMenuOpen(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (sequence && !sequence.hidden && sequence.classList.contains("is-error")) {
            closeSequence();
            return;
        }
        if (summonMenu.classList.contains("show")) {
            event.preventDefault();
            setMenuOpen(false);
            summonButton.focus();
        }
    });

})();

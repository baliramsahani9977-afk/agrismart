/* Lightweight, layered rain and ground-splash canvas for the existing seasonal hero. */
(function (root) {
  'use strict';

  function isLocalPreview() {
    return root.location && ['localhost', '127.0.0.1', '::1'].includes(root.location.hostname);
  }

  function initMonsoonRain(doc) {
    const documentRef = doc || root.document;
    const scene = documentRef && documentRef.getElementById('seasonal-scene');
    const canvas = documentRef && documentRef.getElementById('monsoon-rain-canvas');
    if (!scene || !canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const parameters = root.location && new URLSearchParams(root.location.search);
    const useLegacyPreview = Boolean(isLocalPreview() && parameters && parameters.get('rain-style') === 'old');
    scene.classList.toggle('rain-style-old', useLegacyPreview);
    const motionQuery = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let drops = [];
    let splashes = [];
    let frameHandle = null;
    let lastFrame = 0;
    let elapsed = 0;
    let currentWind = 0;
    let visible = true;
    let randomState = (Date.now() ^ Math.round(Math.random() * 0xffffffff)) >>> 0;

    function random() {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    function createDrop(initial) {
      const roll = random();
      const depth = roll < 0.58 ? 0 : (roll < 0.89 ? 1 : 2);
      const depthScale = [0.62, 0.9, 1.18][depth];
      return {
        x: random() * Math.max(width, 1),
        y: initial ? random() * Math.max(height * 0.94, 1) : -random() * Math.max(height * 0.28, 1),
        depth,
        length: (5 + random() * 7) * depthScale,
        width: (0.45 + random() * 0.43) * depthScale,
        alpha: (0.075 + random() * 0.11) * (depth === 2 ? 1.3 : 1),
        speed: (225 + random() * 220) * depthScale,
        gravity: (18 + random() * 34) * depthScale,
        windFactor: 0.35 + random() * 0.5,
        phase: random() * Math.PI * 2,
        curve: random() * 0.7 - 0.35
      };
    }

    function resize() {
      const bounds = scene.getBoundingClientRect();
      width = Math.max(0, bounds.width);
      height = Math.max(0, bounds.height);
      pixelRatio = Math.min(root.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const count = Math.max(32, Math.min(96, Math.round(width / 11)));
      drops = Array.from({ length: count }, () => createDrop(true));
      context.clearRect(0, 0, width, height);
    }

    function hasRainClass() {
      return scene.classList.contains('weather-rain') || scene.classList.contains('weather-rain-forecast');
    }

    function stop() {
      if (frameHandle !== null) root.cancelAnimationFrame(frameHandle);
      frameHandle = null;
      lastFrame = 0;
      splashes = [];
      context.clearRect(0, 0, width, height);
    }

    function sync() {
      const shouldRun = !useLegacyPreview && !motionQuery.matches && !documentRef.hidden && visible && hasRainClass();
      if (shouldRun && frameHandle === null) frameHandle = root.requestAnimationFrame(drawFrame);
      else if (!shouldRun && frameHandle !== null) stop();
    }

    function addSplash(drop, groundY) {
      if (random() > 0.2) return;
      if (splashes.length >= 14) splashes.shift();
      splashes.push({
        x: drop.x,
        y: groundY + random() * height * 0.012,
        age: 0,
        duration: 0.2 + random() * 0.14,
        radius: (2.2 + random() * 2.4) * (0.75 + drop.depth * 0.15)
      });
    }

    function drawSplash(splash) {
      const progress = splash.age / splash.duration;
      if (progress >= 1) return false;
      const opacity = (1 - progress) * 0.18;
      const radius = splash.radius * (0.55 + progress * 1.25);
      context.strokeStyle = `rgba(222, 233, 224, ${opacity})`;
      context.lineWidth = 0.65;
      context.beginPath();
      context.ellipse(splash.x, splash.y, radius, Math.max(0.7, radius * 0.24), 0, Math.PI, Math.PI * 2);
      context.stroke();
      if (progress < 0.45) {
        context.globalAlpha = opacity * 0.75;
        context.fillStyle = '#e0e8df';
        context.fillRect(splash.x + radius * 0.35, splash.y - radius * (1 - progress), 0.75, 1.5);
        context.globalAlpha = 1;
      }
      return true;
    }

    function drawFrame(timestamp) {
      frameHandle = null;
      if (motionQuery.matches || documentRef.hidden || !visible || !hasRainClass()) return;
      const delta = Math.min(0.035, lastFrame ? (timestamp - lastFrame) / 1000 : 0.016);
      lastFrame = timestamp;
      elapsed += delta;
      context.clearRect(0, 0, width, height);

      const windTarget = Math.sin(elapsed * 0.075) * 15 + Math.sin(elapsed * 0.17 + 1.4) * 7;
      currentWind += (windTarget - currentWind) * (1 - Math.exp(-delta * 0.22));
      const groundY = height * 0.905;

      drops.forEach((drop) => {
        const fallSpeed = drop.speed;
        drop.speed += drop.gravity * delta;
        const drift = (currentWind + Math.sin(elapsed * 0.6 + drop.phase) * 2.2) * drop.windFactor;
        const travelTime = drop.length / fallSpeed;
        const driftX = drift * travelTime;
        const bend = Math.sin(elapsed * 2.2 + drop.phase) * drop.curve;
        const startX = drop.x - driftX;
        const startY = drop.y - drop.length;

        context.beginPath();
        context.moveTo(startX, startY);
        context.quadraticCurveTo(drop.x + bend, drop.y - drop.length * 0.45, drop.x, drop.y);
        context.strokeStyle = `rgba(224, 235, 232, ${drop.alpha})`;
        context.lineWidth = drop.width;
        context.lineCap = 'round';
        context.stroke();

        drop.x += drift * delta;
        drop.y += drop.speed * delta;
        if (drop.y >= groundY) {
          addSplash(drop, groundY);
          Object.assign(drop, createDrop(false));
        } else if (drop.x < -18 || drop.x > width + 18) {
          drop.x = (drop.x + width + 36) % (width + 36) - 18;
        }
      });

      splashes = splashes.filter((splash) => {
        splash.age += delta;
        return drawSplash(splash);
      });
      sync();
    }

    resize();
    if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(resize).observe(scene);
    else root.addEventListener('resize', resize, { passive: true });
    if (typeof root.IntersectionObserver === 'function') {
      new root.IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        sync();
      }, { threshold: 0.02 }).observe(scene);
    }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(sync).observe(scene, { attributes: true, attributeFilter: ['class'] });
    documentRef.addEventListener('visibilitychange', sync);
    if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', sync);
    else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(sync);
    sync();
    return Object.freeze({ resize, sync, stop });
  }

  root.AgriMonsoonRain = Object.freeze({ init: initMonsoonRain });
  if (root.document) initMonsoonRain(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : window);

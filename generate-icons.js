// Run once: node generate-icons.js
// Generates icon-192.png and icon-512.png for the PWA manifest
const PNG = require('pngjs').PNG;
const fs  = require('fs');

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function lerp(a, b, t) { return a + (b - a) * t; }

function createIcon(size, outPath) {
  const png  = new PNG({ width: size, height: size, filterType: -1 });
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) * 4;
      const cx = x - half, cy = y - half;
      const dist  = Math.sqrt(cx * cx + cy * cy);
      const ndist = dist / half;               // 0 = centre, 1 = corner

      // ── Rounded-corner mask ──────────────────────────────────
      const cr = size * 0.22;
      const ax = Math.abs(cx) - (half - cr);
      const ay = Math.abs(cy) - (half - cr);
      const alpha = (ax > 0 && ay > 0 && Math.sqrt(ax*ax + ay*ay) > cr) ? 0 : 255;

      // ── Dark background gradient ─────────────────────────────
      let r = clamp(lerp(42, 14, ndist));
      let g = clamp(lerp(10,  4, ndist));
      let b = clamp(lerp(10,  4, ndist));

      // ── Central glowing emblem (55% radius) ──────────────────
      const embR = half * 0.55;
      if (dist < embR) {
        const t = 1 - dist / embR;
        r = clamp(lerp(220, 255, t * 0.6));   // orange-red
        g = clamp(lerp( 55, 130, t));
        b = clamp(lerp( 20,  45, t));
      }

      // ── Soft glow ring just outside emblem ───────────────────
      const glowIn = half * 0.55, glowOut = half * 0.72;
      if (dist >= glowIn && dist < glowOut) {
        const t = 1 - (dist - glowIn) / (glowOut - glowIn);
        r = clamp(r + (200 - r) * t * 0.45);
        g = clamp(g + ( 50 - g) * t * 0.30);
        b = clamp(b + ( 15 - b) * t * 0.20);
      }

      // ── Three small accent dots (R P S) ──────────────────────
      const dotR   = half * 0.09;
      const dotDist= half * 0.72;
      const dots = [
        { angle: -90, color: [255,255,255] },   // top
        { angle:  30, color: [255,255,255] },   // bottom-right
        { angle: 150, color: [255,255,255] },   // bottom-left
      ];
      for (const dot of dots) {
        const rad = dot.angle * Math.PI / 180;
        const dx  = cx - Math.cos(rad) * dotDist;
        const dy  = cy - Math.sin(rad) * dotDist;
        const dd  = Math.sqrt(dx*dx + dy*dy);
        if (dd < dotR) {
          const t = 1 - dd / dotR;
          r = clamp(r + (dot.color[0] - r) * t);
          g = clamp(g + (dot.color[1] - g) * t);
          b = clamp(b + (dot.color[2] - b) * t);
        }
      }

      png.data[idx]   = r;
      png.data[idx+1] = g;
      png.data[idx+2] = b;
      png.data[idx+3] = alpha;
    }
  }

  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log(`Created ${outPath} (${size}×${size})`);
}

createIcon(192, 'icon-192.png');
createIcon(512, 'icon-512.png');
console.log('Done.');

import * as THREE from 'three';

function makeCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Snow-dusted cracked concrete depot floor. */
export function floorTexture(): THREE.Texture {
  return makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#8d9aa1';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${30 + Math.random() * 40},${40 + Math.random() * 44},${48 + Math.random() * 46},${rnd(0.04, 0.14)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 5), rnd(1, 5));
    }
    // dark stains
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rnd(12, 60);
      const gr = g.createRadialGradient(x, y, 1, x, y, r);
      gr.addColorStop(0, 'rgba(38,46,52,0.30)');
      gr.addColorStop(1, 'rgba(38,46,52,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // cracks
    g.strokeStyle = 'rgba(24,30,34,0.5)';
    for (let i = 0; i < 12; i++) {
      g.lineWidth = rnd(0.6, 1.8);
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += rnd(-46, 46); y += rnd(-46, 46);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // snow patches
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rnd(14, 70);
      const gr = g.createRadialGradient(x, y, 1, x, y, r);
      gr.addColorStop(0, 'rgba(228,240,246,0.85)');
      gr.addColorStop(0.7, 'rgba(214,230,238,0.4)');
      gr.addColorStop(1, 'rgba(214,230,238,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, r, r * rnd(0.5, 0.9), Math.random() * 3, 0, 7);
      g.fill();
    }
    // faded hazard stripe strip
    g.save();
    g.globalAlpha = 0.16;
    g.translate(w * 0.5, h * 0.5);
    g.rotate(-0.2);
    for (let x = -w; x < w; x += 46) {
      g.fillStyle = x % 92 === 0 ? '#e0a63c' : '#15181b';
      g.fillRect(x, -14, 26, 28);
    }
    g.restore();
  });
}

/** Corrugated steel wall with rust + frost at the base. */
export function wallTexture(): THREE.Texture {
  return makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#39434b';
    g.fillRect(0, 0, w, h);
    const rib = 32;
    for (let x = 0; x < w; x += rib) {
      const gr = g.createLinearGradient(x, 0, x + rib, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.10)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0.05)');
      g.fillStyle = gr;
      g.fillRect(x, 0, rib, h);
    }
    // rust streaks
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w, y = Math.random() * h * 0.7;
      const len = rnd(30, 150);
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(122,74,44,0.34)');
      gr.addColorStop(1, 'rgba(122,74,44,0)');
      g.fillStyle = gr;
      g.fillRect(x, y, rnd(2, 7), len);
    }
    // dents / panel seams
    g.strokeStyle = 'rgba(10,14,17,0.6)';
    g.lineWidth = 2;
    for (let y = 0; y < h; y += 128) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    // frost / snow at base
    const fg = g.createLinearGradient(0, h * 0.72, 0, h);
    fg.addColorStop(0, 'rgba(220,235,242,0)');
    fg.addColorStop(1, 'rgba(224,238,244,0.85)');
    g.fillStyle = fg;
    g.fillRect(0, h * 0.72, w, h * 0.28);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(235,245,250,0.5)';
      g.beginPath();
      g.ellipse(Math.random() * w, h - rnd(0, 40), rnd(8, 30), rnd(4, 12), 0, 0, 7);
      g.fill();
    }
  });
}

/** Wooden supply crate with stenciled markings. */
export function crateTexture(): THREE.Texture {
  return makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#5d4a33';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      g.fillStyle = `rgba(${Math.random() > 0.5 ? 30 : 120},${40 + Math.random() * 30},${20 + Math.random() * 20},${rnd(0.05, 0.2)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rnd(2, 30), rnd(1, 3));
    }
    // planks
    g.strokeStyle = 'rgba(24,16,8,0.75)';
    g.lineWidth = 4;
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // frame
    g.strokeStyle = 'rgba(38,26,14,0.9)';
    g.lineWidth = 14;
    g.strokeRect(7, 7, w - 14, h - 14);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h);
    g.lineWidth = 10; g.strokeStyle = 'rgba(38,26,14,0.55)'; g.stroke();
    // stencil
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-0.04);
    g.font = '700 44px "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(226,232,235,0.72)';
    g.fillText('KDK-7', 0, -6);
    g.font = '700 20px "Arial Black", sans-serif';
    g.fillStyle = 'rgba(224,166,60,0.8)';
    g.fillText('SUPPLY // ARCTIC', 0, 26);
    g.restore();
    // snow dusting on top edge
    const fg = g.createLinearGradient(0, 0, 0, 30);
    fg.addColorStop(0, 'rgba(232,242,247,0.8)');
    fg.addColorStop(1, 'rgba(232,242,247,0)');
    g.fillStyle = fg;
    g.fillRect(0, 0, w, 30);
  });
}

/** Concrete barrier texture with hazard ends painted in. */
export function concreteTexture(): THREE.Texture {
  return makeCanvas(256, 128, (g, w, h) => {
    g.fillStyle = '#79828a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${Math.random() > 0.5 ? 40 : 150},${Math.random() > 0.5 ? 46 : 156},${Math.random() > 0.5 ? 52 : 160},${rnd(0.04, 0.13)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 4), rnd(1, 4));
    }
    g.fillStyle = 'rgba(30,36,40,0.5)';
    g.fillRect(0, h - 18, w, 18);
    // hazard stripe band
    g.save();
    g.beginPath(); g.rect(0, 20, w, 22); g.clip();
    for (let x = -40; x < w + 40; x += 40) {
      g.fillStyle = '#d99a34';
      g.beginPath();
      g.moveTo(x, 42); g.lineTo(x + 20, 20); g.lineTo(x + 40, 20); g.lineTo(x + 20, 42);
      g.fill();
    }
    g.restore();
    const fg = g.createLinearGradient(0, h - 26, 0, h);
    fg.addColorStop(0, 'rgba(228,240,246,0)');
    fg.addColorStop(1, 'rgba(228,240,246,0.7)');
    g.fillStyle = fg;
    g.fillRect(0, h - 26, w, 26);
  });
}

/** Winter camo fabric for mercenary coats. */
export function camoTexture(base: string): THREE.Texture {
  const t = makeCanvas(128, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const cols = ['rgba(226,236,240,0.85)', 'rgba(38,46,42,0.9)', 'rgba(96,110,104,0.8)', 'rgba(226,236,240,0.5)'];
    for (let i = 0; i < 46; i++) {
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      const x = Math.random() * w, y = Math.random() * h, r = rnd(5, 18);
      g.ellipse(x, y, r, r * rnd(0.4, 1), Math.random() * 3, 0, 7);
      g.fill();
    }
  });
  t.repeat.set(2, 2);
  return t;
}

/** Radial muzzle flash sprite. */
export function flashTexture(): THREE.Texture {
  return makeCanvas(128, 128, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const gr = g.createRadialGradient(cx, cy, 1, cx, cy, cx);
    gr.addColorStop(0, 'rgba(255,255,240,1)');
    gr.addColorStop(0.25, 'rgba(255,214,130,0.95)');
    gr.addColorStop(0.55, 'rgba(255,140,40,0.55)');
    gr.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // spikes
    g.save();
    g.translate(cx, cy);
    g.fillStyle = 'rgba(255,220,150,0.85)';
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(-4, 0); g.lineTo(0, -cx * 0.95); g.lineTo(4, 0);
      g.fill();
    }
    g.restore();
  });
}

/** Soft round dot — snow particles & glows. */
export function dotTexture(): THREE.Texture {
  return makeCanvas(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

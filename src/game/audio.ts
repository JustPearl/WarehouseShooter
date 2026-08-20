/* Procedural WebAudio SFX — no assets, everything synthesized. */

type OscType = OscillatorType;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // shared white-noise buffer
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startWind();
    } catch {
      this.ctx = null;
    }
  }

  private startWind() {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.028;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }

  private tone(type: OscType, f0: number, f1: number, dur: number, vol: number, when = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterType: BiquadFilterType, f0: number, f1: number, q = 0.8, when = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  shoot(kind: 'pistol' | 'smg' | 'revolver' | 'shotgun', ads: boolean) {
    const v = ads ? 0.85 : 1;
    if (kind === 'pistol') {
      this.noise(0.16, 0.85 * v, 'lowpass', 2200, 160, 0.7);
      this.tone('sine', 150, 44, 0.13, 0.7 * v);
      this.tone('square', 800, 220, 0.03, 0.16 * v);
    } else if (kind === 'shotgun') {
      // 12-gauge: a wide low roar, a chest-thump, and the auto-loader's bolt clack
      this.noise(0.26, 1.0 * v, 'lowpass', 950, 70, 0.8);
      this.tone('sine', 96, 30, 0.22, 0.9 * v);
      this.noise(0.08, 0.35 * v, 'bandpass', 1800, 900, 0.6, 0.02); // pellet spray
      this.noise(0.05, 0.22 * v, 'highpass', 1600, 2600, 0.7, 0.16); // bolt cycles
      this.tone('square', 300, 120, 0.03, 0.18 * v, 0.16);
    } else if (kind === 'revolver') {
      // snub .38: short-barrel boom — all low thump, sharp crack, then the cylinder click
      this.noise(0.13, 0.9 * v, 'lowpass', 1500, 110, 0.7);
      this.tone('sine', 132, 36, 0.12, 0.8 * v);
      this.noise(0.045, 0.3 * v, 'highpass', 2400, 3600, 0.7);
      this.tone('square', 1900, 700, 0.018, 0.14 * v, 0.07); // hand ratchets the cylinder
    } else {
      this.noise(0.085, 0.55 * v, 'lowpass', 3400, 420, 0.7);
      this.tone('square', 240, 90, 0.05, 0.22 * v);
      this.noise(0.05, 0.2 * v, 'highpass', 1400, 2400, 0.7);
    }
  }

  /** canned subsonic thump + gas hiss of a suppressor */
  supShot(kind: 'pistol' | 'smg' | 'revolver') {
    const lp = kind === 'pistol' ? 620 : kind === 'revolver' ? 520 : 900;
    this.noise(0.11, kind === 'smg' ? 0.3 : 0.42, 'lowpass', lp, lp * 0.3, 0.85);
    this.tone('sine', 120, 52, 0.09, 0.34);
    this.noise(0.16, 0.1, 'highpass', 3800, 5200, 0.9, 0.04); // escaping gas
    if (kind === 'revolver') this.tone('square', 1900, 700, 0.018, 0.1, 0.06); // cylinder still clicks
  }

  ui() {
    this.tone('square', 560, 640, 0.022, 0.16);
  }

  /** a shotgun shell sliding into the tube + the lifter click */
  shell() {
    this.noise(0.05, 0.24, 'bandpass', 900, 500, 0.8);
    this.tone('square', 220, 130, 0.04, 0.2);
    this.tone('square', 500, 300, 0.02, 0.14, 0.05);
  }

  /** warlord arrival: a low brass growl under the wind */
  warlord() {
    this.tone('sawtooth', 92, 44, 0.8, 0.42);
    this.tone('sawtooth', 138, 66, 0.8, 0.3, 0.06);
    this.noise(0.6, 0.22, 'lowpass', 420, 110, 0.95);
  }

  /** opening the loading gate / racking the bolt to start a tube reload */
  reloadGate() {
    this.noise(0.07, 0.3, 'bandpass', 1400, 700, 0.7);
    this.tone('square', 340, 180, 0.05, 0.2);
  }

  enemyShoot(dist: number) {
    const vol = Math.min(0.4, Math.max(0.06, 0.42 - dist * 0.013));
    this.noise(0.11, vol, 'bandpass', 700, 300, 1.1);
    this.tone('sine', 130, 50, 0.09, vol * 0.7);
  }

  impact() {
    this.noise(0.06, 0.22, 'bandpass', 1800, 700, 1.4);
  }

  hit(head: boolean) {
    this.tone('triangle', head ? 2400 : 1750, head ? 1900 : 1400, 0.05, 0.3);
  }

  kill() {
    this.tone('sine', 320, 70, 0.2, 0.42);
    this.tone('triangle', 1300, 900, 0.06, 0.2, 0.02);
  }

  hurt() {
    this.tone('sawtooth', 120, 52, 0.22, 0.5);
    this.noise(0.18, 0.3, 'lowpass', 500, 120, 0.8);
  }

  empty() {
    this.tone('square', 340, 300, 0.025, 0.22);
  }

  reload(dur: number) {
    this.tone('square', 720, 660, 0.03, 0.26);
    this.tone('square', 520, 470, 0.03, 0.24, dur * 0.4);
    this.noise(0.05, 0.2, 'bandpass', 900, 1400, 1.2, dur * 0.75);
    this.tone('square', 900, 820, 0.035, 0.28, dur * 0.92);
  }

  switchWeapon() {
    this.tone('square', 430, 400, 0.02, 0.2);
    this.tone('square', 640, 600, 0.02, 0.2, 0.06);
  }

  fireMode(burst: boolean) {
    this.tone('square', burst ? 620 : 430, burst ? 660 : 400, 0.022, 0.2);
    this.tone('square', burst ? 880 : 560, burst ? 930 : 520, 0.02, 0.16, 0.05);
  }

  melee(connected: boolean) {
    this.noise(0.1, 0.3, 'highpass', 900, 2600, 0.7); // whoosh
    if (connected) {
      this.tone('sine', 110, 40, 0.14, 0.5);
      this.noise(0.08, 0.4, 'bandpass', 500, 180, 1.2);
    }
  }

  enemyShotgun(dist: number) {
    const vol = Math.min(0.5, Math.max(0.1, 0.55 - dist * 0.012));
    this.noise(0.22, vol, 'lowpass', 1400, 90, 0.7);
    this.tone('sine', 100, 34, 0.2, vol * 0.9);
    this.noise(0.08, vol * 0.5, 'bandpass', 900, 300, 1.1);
  }

  enemyMarksman(dist: number) {
    const vol = Math.min(0.45, Math.max(0.08, 0.5 - dist * 0.011));
    this.noise(0.16, vol, 'bandpass', 2600, 500, 1.3); // sharp supersonic crack
    this.tone('sine', 170, 46, 0.16, vol * 0.8);
  }

  pickup() {
    this.tone('sine', 560, 980, 0.11, 0.3);
    this.tone('sine', 840, 1400, 0.1, 0.2, 0.08);
  }

  waveHorn() {
    this.tone('sawtooth', 68, 46, 1.05, 0.4);
    this.tone('sawtooth', 69.5, 47, 1.05, 0.32);
    this.tone('sine', 96, 38, 0.8, 0.42, 0.05);
  }

  waveClear() {
    this.tone('sine', 420, 640, 0.14, 0.3);
    this.tone('sine', 640, 900, 0.18, 0.26, 0.12);
  }

  step() {
    this.noise(0.05, 0.075, 'lowpass', 420, 160, 0.8);
  }

  death() {
    this.tone('sawtooth', 90, 28, 1.4, 0.5);
    this.noise(1.1, 0.35, 'lowpass', 900, 60, 0.7);
  }

  /** round whistling past your ear */
  nearMiss() {
    this.noise(0.14, 0.42, 'bandpass', 700, 3200, 2.2);
    this.noise(0.09, 0.2, 'bandpass', 1400, 4200, 2.4, 0.03);
  }

  /** lub-dub thump under 35 vitals — interval handled by the engine */
  heartbeat() {
    this.tone('sine', 56, 38, 0.1, 0.55);
    this.tone('sine', 50, 34, 0.12, 0.42, 0.17);
  }

  /** escalating killstreak fanfare — pitch climbs with the tier */
  stinger(tier: number) {
    const base = 265 * Math.pow(1.17, Math.min(6, tier));
    const steps = [0, 7, 12, 17];
    const n = Math.min(4, 1 + tier);
    for (let i = 0; i < n; i++) {
      const f = base * Math.pow(2, steps[i] / 12);
      this.tone('square', f, f * 0.96, 0.11, 0.13, i * 0.062);
    }
    this.tone('sawtooth', base * 2, base * 2.02, 0.22, 0.1, (n - 1) * 0.062 + 0.05);
    this.noise(0.16, 0.1, 'highpass', 3400, 5600, 0.8, 0.04);
  }
}

export const sfx = new Sfx();

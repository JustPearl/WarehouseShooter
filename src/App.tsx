import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './game/engine';
import type { EndStats, GameEvent, HudState } from './game/engine';

const MENU_BG = 'https://image.qwenlm.ai/generated-images/1257f3b2-7150-473b-9d84-c30ad3b818bb/_result.png';

const DEFAULT_HUD: HudState = {
  phase: 'menu',
  health: 100,
  weaponIndex: 0,
  weapons: [
    { name: 'KODIAK .45', short: 'KDK .45', mag: 8, reserve: 56, auto: false, mode: 'SEMI' },
    { name: 'PTARMIGAN M9', short: 'PTM 9MM', mag: 30, reserve: 150, auto: true, mode: 'AUTO' },
  ],
  wave: 0,
  enemiesLeft: 0,
  score: 0,
  kills: 0,
  reload: -1,
  gap: 8,
  ads: false,
  sprint: false,
  regen: false,
};

interface FeedItem { id: number; weapon: string; head: boolean; n: number }
interface HitMark { id: number; kill: boolean; head: boolean }
interface Banner { id: number; title: string; sub: string; tone: 'warn' | 'good' }

/* ---------- tiny inline SVG icons ---------- */
const IconSkull = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2C7 2 3 6 3 11c0 2.8 1.3 5.2 3.5 6.9V21a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3.1C19.7 16.2 21 13.8 21 11c0-5-4-9-9-9Zm-4 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm-4 5-1.5-3h3L12 18Z" />
  </svg>
);
const IconCross = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 1v6M12 17v6M1 12h6M17 12h6" />
  </svg>
);
const IconBullet = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2c2.5 1.8 4 4.6 4 8v8H8v-8c0-3.4 1.5-6.2 4-8Zm-4 18h8v2H8v-2Z" />
  </svg>
);
const IconGear = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2" />
  </svg>
);

/* ---------- settings ---------- */
function loadXhair(): boolean {
  try { return localStorage.getItem('wp_xhair') !== '0'; } catch { return true; }
}

function SettingToggle({ label, desc, value, onToggle }: { label: string; desc: string; value: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="group flex w-full items-center justify-between gap-4 py-2 text-left transition-colors duration-150 hover:bg-[rgba(127,183,201,0.08)]"
    >
      <span>
        <span className="block text-[12px] font-bold tracking-[0.22em] text-[#bfeaf5]">{label}</span>
        <span className="block text-[10px] font-medium tracking-[0.14em] text-[#7fb7c9]">{desc}</span>
      </span>
      <span
        className={`relative h-[22px] w-12 shrink-0 border transition-colors duration-150 ${
          value ? 'border-[#ffab3d] bg-[rgba(255,171,61,0.16)]' : 'border-[rgba(127,183,201,0.4)] bg-[rgba(10,20,27,0.6)] group-hover:border-[#9cc3d2]'
        }`}
      >
        <span
          className={`absolute top-[3px] h-[14px] w-[22px] transition-all duration-150 ${
            value ? 'left-[22px] bg-[#ffab3d] shadow-[0_0_9px_rgba(255,171,61,0.65)]' : 'left-[3px] bg-[#7fb7c9]'
          }`}
        />
      </span>
    </button>
  );
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

/* ============================== APP ============================== */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hud, setHud] = useState<HudState>(DEFAULT_HUD);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [hit, setHit] = useState<HitMark | null>(null);
  const [dmgId, setDmgId] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [stats, setStats] = useState<EndStats | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [crosshairOn, setCrosshairOn] = useState<boolean>(loadXhair);
  const toggleCrosshair = useCallback(() => {
    setCrosshairOn((v) => {
      const n = !v;
      try { localStorage.setItem('wp_xhair', n ? '1' : '0'); } catch { /* ignore */ }
      return n;
    });
  }, []);
  const feedSeq = useRef(0);

  const onEvent = useCallback((e: GameEvent) => {
    switch (e.type) {
      case 'hit':
        setHit({ id: Date.now() + Math.random(), kill: e.kill, head: e.head });
        break;
      case 'damage':
        setDmgId(Date.now() + Math.random());
        break;
      case 'wave':
        setBanner({ id: Date.now(), title: `WAVE ${e.n.toString().padStart(2, '0')}`, sub: `${e.count} HOSTILES INBOUND`, tone: 'warn' });
        break;
      case 'waveclear':
        setBanner({ id: Date.now(), title: `WAVE ${e.n.toString().padStart(2, '0')} CLEARED`, sub: `SUPPLY BONUS +${e.bonus} — AMMO RESTOCKED`, tone: 'good' });
        break;
      case 'kill': {
        const id = ++feedSeq.current;
        setFeed((f) => [{ id, weapon: e.weapon, head: e.head, n: id }, ...f].slice(0, 4));
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 2800);
        break;
      }
      case 'pickup':
        setToast({ id: Date.now(), text: e.text });
        break;
      case 'gameover':
        setStats(e.stats);
        break;
    }
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current, { hud: setHud, event: onEvent });
    engineRef.current = engine;
    engine.boot();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [onEvent]);

  const start = () => engineRef.current?.startGame();
  const resume = () => engineRef.current?.resume();
  const toMenu = () => engineRef.current?.toMenu();

  const w = hud.weapons[hud.weaponIndex];
  const playing = hud.phase === 'playing' || hud.phase === 'paused';
  const healthPct = hud.health / 100;
  const healthColor = hud.regen ? '#63e6b0' : healthPct > 0.5 ? '#bfeaf5' : healthPct > 0.25 ? '#ffab3d' : '#ff3b30';

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05090d] select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-none" />

      {/* ======================= IN-GAME HUD ======================= */}
      {playing && (
        <div className="pointer-events-none absolute inset-0">
          {/* base vignette */}
          <div className="fx-vignette absolute inset-0" />
          {hud.health <= 25 && <div className="fx-lowhp absolute inset-0" />}
          {dmgId > 0 && <div key={dmgId} className="fx-damage absolute inset-0" />}

          {/* crosshair */}
          {crosshairOn && !hud.ads && (
            <div className="absolute left-1/2 top-1/2" style={{ transform: 'translate(-50%,-50%)' }}>
              <div className="relative" style={{ width: 0, height: 0 }}>
                <span className="ch-line" style={{ width: 2, height: 9, left: -1, top: -hud.gap - 9 }} />
                <span className="ch-line" style={{ width: 2, height: 9, left: -1, top: hud.gap }} />
                <span className="ch-line" style={{ width: 9, height: 2, top: -1, left: -hud.gap - 9 }} />
                <span className="ch-line" style={{ width: 9, height: 2, top: -1, left: hud.gap }} />
                <span className="absolute rounded-full" style={{ width: 2, height: 2, left: -1, top: -1, background: '#d6f4fb' }} />
              </div>
            </div>
          )}
          {crosshairOn && hud.ads && (
            <span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffc46e] shadow-[0_0_6px_#ff9d2e]" />
          )}

          {/* hitmarker */}
          {hit && (
            <div key={hit.id} className="fx-hitmarker absolute left-1/2 top-1/2" style={{ color: hit.kill ? '#ff5c33' : hit.head ? '#ffab3d' : '#e8f6fb' }}>
              {[45, -45, 135, -135].map((r) => (
                <span key={r} className="absolute h-[2px] w-[9px]" style={{ background: 'currentColor', transform: `rotate(${r}deg) translateX(9px)`, boxShadow: '0 0 4px currentColor' }} />
              ))}
            </div>
          )}

          {/* banner */}
          {banner && (
            <div key={banner.id} className="fx-banner absolute left-1/2 top-[24%] -translate-x-1/2 text-center">
              <div className={`font-display text-5xl ${banner.tone === 'warn' ? 'text-[#ff5c33]' : 'text-[#bfeaf5]'}`} style={{ textShadow: '0 0 24px rgba(0,0,0,0.8), 0 2px 0 rgba(0,0,0,0.6)' }}>
                {banner.title}
              </div>
              <div className="mt-1 text-sm font-semibold tracking-[0.42em] text-[#ffab3d]">{banner.sub}</div>
            </div>
          )}

          {/* pickup toast */}
          {toast && (
            <div key={toast.id} className="fx-toast absolute left-1/2 top-[62%] -translate-x-1/2 font-display text-sm tracking-[0.25em] text-[#bfeaf5]" style={{ textShadow: '0 0 12px rgba(0,0,0,0.9)' }}>
              {toast.text}
            </div>
          )}

          {/* top-left: wave status */}
          <div className="hud-plate absolute left-5 top-5 px-5 py-3">
            <div className="hud-tick mb-1 h-[3px] w-10" />
            <div className="text-[10px] font-bold tracking-[0.3em] text-[#7fb7c9]">OPERATION WHITEOUT</div>
            <div className="font-display text-3xl leading-none text-[#bfeaf5]">
              WAVE <span className="text-[#ffab3d]">{hud.wave.toString().padStart(2, '0')}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-[#7fb7c9]">
              <IconSkull />
              HOSTILES REMAINING — <span className="text-[#ff5c33]">{hud.enemiesLeft.toString().padStart(2, '0')}</span>
            </div>
          </div>

          {/* top-right: score + feed */}
          <div className="absolute right-5 top-5 text-right">
            <div className="hud-plate hud-plate-r inline-block px-5 py-3">
              <div className="hud-tick mb-1 ml-auto h-[3px] w-10" style={{ transform: 'scaleX(-1)' }} />
              <div className="text-[10px] font-bold tracking-[0.3em] text-[#7fb7c9]">SCORE</div>
              <div className="font-display text-3xl leading-none text-[#bfeaf5]">{hud.score.toLocaleString()}</div>
              <div className="mt-1 text-xs font-semibold tracking-[0.2em] text-[#7fb7c9]">KILLS {hud.kills}</div>
            </div>
            <div className="mt-2 space-y-1">
              {feed.map((f) => (
                <div key={f.id} className="fx-feed flex items-center justify-end gap-2 text-xs font-bold tracking-[0.14em] text-[#bfeaf5]">
                  <span className="text-[#7fb7c9]">{f.weapon}</span>
                  <span className={f.head ? 'text-[#ffab3d]' : 'text-[#ff5c33]'}>{f.head ? <IconCross /> : <IconSkull />}</span>
                  <span>MERC-{f.n.toString().padStart(2, '0')}</span>
                </div>
              ))}
            </div>
          </div>

          {/* bottom-left: vitals */}
          <div className="hud-plate absolute bottom-5 left-5 px-5 py-3">
            <div className="flex items-end justify-between gap-8">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-bold tracking-[0.3em] text-[#7fb7c9]">VITALS</div>
                {hud.regen && (
                  <span className="fx-blink border border-[rgba(99,230,176,0.5)] bg-[rgba(99,230,176,0.12)] px-1.5 py-[1px] text-[9px] font-bold tracking-[0.22em] text-[#63e6b0]">
                    RESTORING
                  </span>
                )}
              </div>
              <div className="font-display text-2xl leading-none" style={{ color: healthColor }}>
                {hud.health}
                {hud.regen && <span className="ml-1 align-top text-sm text-[#63e6b0]">+</span>}
              </div>
            </div>
            <div className="mt-1.5 flex gap-[3px]">
              {Array.from({ length: 20 }).map((_, i) => (
                <span
                  key={i}
                  className="h-[7px] w-[9px] skew-x-[-14deg]"
                  style={{
                    background: i < Math.ceil(hud.health / 5) ? healthColor : 'rgba(127,183,201,0.14)',
                    boxShadow: i < Math.ceil(hud.health / 5) ? `0 0 6px ${healthColor}55` : 'none',
                  }}
                />
              ))}
            </div>
            {hud.sprint && <div className="mt-1 text-[10px] font-bold tracking-[0.3em] text-[#7fb7c9]">SPRINT</div>}
          </div>

          {/* bottom-right: weapon */}
          <div className="hud-plate hud-plate-r absolute bottom-5 right-5 px-5 py-3 text-right">
            <div className="flex items-center justify-end gap-2">
              <span className="text-[#ffab3d]"><IconBullet /></span>
              <span className="font-display text-lg leading-none text-[#bfeaf5]">{w.name}</span>
              <span className={`ml-1 border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.25em] ${w.mode === 'BURST' ? 'border-[#ffab3d] text-[#ffab3d]' : 'border-[rgba(127,183,201,0.35)] text-[#7fb7c9]'}`}>
                {w.auto ? `${w.mode} · V` : w.mode}
              </span>
            </div>
            <div className="mt-0.5 flex items-end justify-end gap-2">
              <span className={`font-display text-5xl leading-none ${w.mag === 0 ? 'fx-blink text-[#ff3b30]' : w.mag <= Math.ceil(WEAPON_MAGS[hud.weaponIndex] * 0.25) ? 'text-[#ffab3d]' : 'text-[#bfeaf5]'}`}>
                {w.mag.toString().padStart(2, '0')}
              </span>
              <span className="pb-1 font-display text-xl text-[#7fb7c9]">/ {w.reserve}</span>
            </div>
            <div className="mt-2 flex justify-end gap-1.5">
              {hud.weapons.map((x, i) => (
                <span
                  key={x.short}
                  className={`px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] ${i === hud.weaponIndex ? 'bg-[#ffab3d] text-[#10131a]' : 'border border-[rgba(127,183,201,0.3)] text-[#7fb7c9]'}`}
                >
                  {i + 1} {x.short}
                </span>
              ))}
            </div>
          </div>

          {/* control hints during wave 1 */}
          {hud.wave <= 1 && hud.phase === 'playing' && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-semibold tracking-[0.24em] text-[rgba(191,234,245,0.5)]">
              R RELOAD&ensp;•&ensp;V FIRE MODE&ensp;•&ensp;F MELEE&ensp;•&ensp;1/2 WEAPONS&ensp;•&ensp;RMB AIM&ensp;•&ensp;SHIFT SPRINT&ensp;•&ensp;5S CLEAR = VITALS RESTORE
            </div>
          )}
        </div>
      )}

      {/* ======================= MENU ======================= */}
      {hud.phase === 'menu' && (
        <div className="absolute inset-0 overflow-y-auto">
          <div className="fx-kenburns absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${MENU_BG})` }} />
          <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(4,9,13,0.94)_18%,rgba(4,9,13,0.72)_48%,rgba(4,9,13,0.45)_100%)]" />
          <div className="fx-vignette absolute inset-0" />

          <div className="relative mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-10 px-8 py-10 lg:flex-row lg:items-center lg:gap-16">
            {/* left: briefing */}
            <div className="fx-rise max-w-xl">
              <div className="mb-3 flex items-center gap-3 text-[11px] font-bold tracking-[0.4em] text-[#ff5c33]">
                <span className="inline-block h-[8px] w-[8px] animate-pulse bg-[#ff5c33]" />
                LIVE FIRE AUTHORIZED — 64.83°N 147.71°W
              </div>
              <h1 className="font-display leading-[0.9]">
                <span className="block text-6xl text-[#bfeaf5] md:text-7xl" style={{ textShadow: '0 0 34px rgba(140,210,235,0.35)' }}>WHITEOUT</span>
                <span className="block text-4xl text-[#ffab3d] md:text-5xl">PROTOCOL<span className="text-[#bfeaf5]">_</span></span>
              </h1>
              <p className="mt-5 max-w-md text-[15px] font-medium leading-relaxed text-[#9cc3d2]">
                Prudhoe Supply Depot, Alaska. The convoy never made it. A mercenary company has taken the warehouse
                district and they are coming through the storm in <span className="font-bold text-[#bfeaf5]">endless waves</span>.
                Fight spills into the <span className="font-bold text-[#bfeaf5]">fenced snow yard</span> through the gates. Crate stacks, barriers and columns stop bullets — <span className="font-bold text-[#ffab3d]">use the cover</span>,
                aim for the red visors, and make every round count.
              </p>

              {/* controls */}
              <div className="hud-plate mt-6 grid max-w-md grid-cols-2 gap-x-6 gap-y-1.5 px-5 py-4 text-[12px] font-semibold tracking-[0.12em] text-[#9cc3d2]">
                {[
                  ['W A S D', 'MOVE'], ['MOUSE', 'AIM — CURSOR LOCKS'],
                  ['LMB', 'FIRE'], ['RMB', 'AIM DOWN SIGHTS'],
                  ['R', 'RELOAD'], ['1 / 2 / WHEEL', 'SWAP WEAPON'],
                  ['V', 'FIRE MODE — AUTO/BURST'], ['F', 'MELEE STOCK-STRIKE'],
                  ['SHIFT', 'SPRINT'], ['SPACE', 'JUMP'], ['ESC', 'PAUSE'],
                  ['5S CLEAR', 'VITALS RESTORE'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[rgba(127,183,201,0.12)] py-1">
                    <span className="font-display text-[11px] text-[#ffab3d]">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>

              {/* threat intel */}
              <div className="hud-plate mt-4 max-w-md px-5 py-4">
                <div className="text-[10px] font-bold tracking-[0.3em] text-[#7fb7c9]">THREAT INTEL — READ THE SHOULDER LAMP</div>
                <div className="mt-2.5 space-y-2 text-[12px] font-medium leading-snug text-[#9cc3d2]">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#3a4750]" />
                    <span><span className="font-bold text-[#bfeaf5]">RIFLEMAN</span> — standard. Holds mid-range, fires bursts.</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff8b2a] shadow-[0_0_8px_#ff8b2a]" />
                    <span><span className="font-bold text-[#ffab3d]">BREACHER</span> — shotgun. Sprints in close, hits hard. Keep distance or burst it down.</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#55d7ff] shadow-[0_0_8px_#55d7ff]" />
                    <span><span className="font-bold text-[#bfeaf5]">MARKSMAN</span> — precise long-range crack. Punishes you in the open. Close the gap.</span>
                  </div>
                </div>
              </div>

              <div className="relative mt-7 flex items-center gap-5">
                <button className="btn-mil text-lg" onClick={() => { setShowSettings(false); start(); }}>DEPLOY ▸</button>
                <button
                  className="btn-ghost flex items-center gap-2 text-xs"
                  style={showSettings ? { borderColor: '#ffab3d', color: '#ffab3d' } : undefined}
                  onClick={() => setShowSettings((s) => !s)}
                >
                  <IconGear /> SETTINGS
                </button>
                <span className="text-[11px] font-semibold tracking-[0.22em] text-[#7fb7c9]">MOUSE + KEYBOARD REQUIRED</span>

                {showSettings && (
                  <div className="fx-rise hud-plate absolute left-0 top-[calc(100%+12px)] z-20 w-80 px-5 py-4">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-sm text-[#bfeaf5]">FIELD SETTINGS</span>
                      <span className="text-[9px] font-bold tracking-[0.3em] text-[#7fb7c9]">SAVED LOCALLY</span>
                    </div>
                    <div className="mt-1 border-t border-[rgba(127,183,201,0.15)]">
                      <SettingToggle label="CROSSHAIR" desc="ON-SCREEN RETICLE OVERLAY" value={crosshairOn} onToggle={toggleCrosshair} />
                    </div>
                    <div className="mt-1 border-t border-[rgba(127,183,201,0.15)] pt-2 text-[10px] font-semibold tracking-[0.16em] text-[#7fb7c9]">
                      <span className="text-[#ff5c33]">TIP //</span> NO RETICLE? SHORT BURSTS, TRUST THE TRACERS.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* right: armory */}
            <div className="fx-rise w-full max-w-sm" style={{ animationDelay: '0.12s' }}>
              <div className="hud-plate hud-plate-r px-6 py-5">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-xl text-[#bfeaf5]">ARMORY</h2>
                  <span className="text-[10px] font-bold tracking-[0.3em] text-[#7fb7c9]">ISSUED ON SITE</span>
                </div>

                {ARMORY.map((a) => (
                  <div key={a.name} className="mt-5 border-t border-[rgba(127,183,201,0.15)] pt-4 first-of-type:border-t-0">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-lg text-[#ffab3d]">{a.name}</span>
                      <span className="text-[10px] font-bold tracking-[0.25em] text-[#7fb7c9]">{a.mode}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {a.spec.map((s) => (
                        <span key={s} className="border border-[rgba(127,183,201,0.28)] px-1.5 py-[2px] text-[9px] font-bold tracking-[0.16em] text-[#9cc3d2]">
                          {s}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[12px] font-medium text-[#7fb7c9]">{a.desc}</p>
                    <div className="mt-2 flex items-center gap-2 text-[9px] font-bold tracking-[0.18em]">
                      <span className="text-[#ff5c33]">RECOIL</span>
                      <span className="h-px flex-1 bg-[rgba(127,183,201,0.18)]" />
                      <span className="text-[#bfeaf5]">{a.recoil}</span>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {a.stats.map(([label, v, amber]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="w-9 text-[10px] font-bold tracking-[0.2em] text-[#7fb7c9]">{label}</span>
                          <div className={`stat-bar flex-1 ${amber ? 'amber' : ''}`}><i style={{ width: `${v}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="mt-5 border-t border-[rgba(127,183,201,0.15)] pt-3 text-[11px] font-semibold tracking-[0.18em] text-[#7fb7c9]">
                  <span className="text-[#ff5c33]">INTEL //</span> WAVES SCALE IN NUMBER AND ARMOR.
                  HEADSHOTS PAY +75. SUPPLY CRATES DROP FROM HOSTILES.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================= PAUSE ======================= */}
      {hud.phase === 'paused' && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgba(3,7,10,0.78)]">
          <div className="fx-rise hud-plate px-12 py-10 text-center">
            <div className="text-[11px] font-bold tracking-[0.4em] text-[#7fb7c9]">OPERATION SUSPENDED</div>
            <h2 className="font-display mt-1 text-5xl text-[#bfeaf5]">STAND BY</h2>
            <div className="mx-auto mt-3 h-[3px] w-16 bg-[#ffab3d]" />
            <p className="mt-3 text-sm font-semibold tracking-[0.14em] text-[#7fb7c9]">CURSOR RELEASED — THE STORM HOLDS ITS BREATH</p>

            <div className="mx-auto mt-6 w-72 border-t border-[rgba(127,183,201,0.18)] px-2 pt-3">
              <div className="text-left text-[9px] font-bold tracking-[0.32em] text-[#7fb7c9]">FIELD SETTINGS</div>
              <SettingToggle label="CROSSHAIR" desc="ON-SCREEN RETICLE OVERLAY" value={crosshairOn} onToggle={toggleCrosshair} />
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <button className="btn-mil w-64" onClick={resume}>RESUME ▸</button>
              <button className="btn-ghost w-64" onClick={start}>RESTART OPERATION</button>
              <button className="btn-ghost w-64" onClick={toMenu}>ABANDON — MAIN MENU</button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= GAME OVER ======================= */}
      {hud.phase === 'gameover' && stats && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgba(6,4,4,0.82)]">
          <div className="fx-rise max-w-lg px-8 text-center">
            <div className="text-[11px] font-bold tracking-[0.44em] text-[#ff5c33]">SIGNAL LOST — SECTOR 7</div>
            <h2 className="font-display mt-1 text-8xl text-[#ff3b30]" style={{ textShadow: '0 0 44px rgba(255,59,48,0.4)' }}>K.I.A.</h2>
            <p className="mt-2 text-sm font-semibold tracking-[0.2em] text-[#9cc3d2]">THE DEPOT FALLS SILENT BENEATH THE SNOW</p>

            <div className="hud-plate mt-7 grid grid-cols-3 gap-y-4 px-6 py-5">
              {[
                ['FINAL SCORE', stats.score.toLocaleString()],
                ['WAVES HELD', stats.wave.toString()],
                ['KILLS', stats.kills.toString()],
                ['HEADSHOTS', stats.headshots.toString()],
                ['ACCURACY', `${Math.round(stats.accuracy * 100)}%`],
                ['TIME HELD', fmtTime(stats.time)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] font-bold tracking-[0.26em] text-[#7fb7c9]">{k}</div>
                  <div className="font-display text-2xl text-[#bfeaf5]">{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center justify-center gap-4">
              <button className="btn-mil" onClick={start}>RE-DEPLOY ▸</button>
              <button className="btn-ghost" onClick={toMenu}>MAIN MENU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const WEAPON_MAGS = [8, 30];

const ARMORY = [
  {
    name: 'KODIAK .45',
    mode: 'SEMI-AUTO SIDEARM',
    spec: ['.45 ACP', '1.05 KG', 'STOCKLESS', 'SLIDE ACTION'],
    desc: 'Heavy-frame depot pistol. Slow, but each .45 round hits like a sledgehammer. Iron sights, honest work.',
    recoil: 'SIX HEAVY SHOVES, ALTERNATING TWIST — FAST RESET',
    stats: [
      ['DMG', 88, true],
      ['ROF', 34, false],
      ['MAG', 26, false],
      ['CTL', 62, false],
    ] as [string, number, boolean][],
  },
  {
    name: 'PTARMIGAN M9',
    mode: 'FULL-AUTO / 3-RD BURST',
    spec: ['9×19MM', '2.45 KG', 'FOLDING STOCK', 'SELECT-FIRE'],
    desc: 'Compact 9mm storm. The stock drinks the roll — recoil climbs in a weave. Tap V for a tight 3-round burst at range.',
    recoil: 'BRACED CLIMB — NEAR-FLAT IN ADS',
    stats: [
      ['DMG', 40, true],
      ['ROF', 92, false],
      ['MAG', 68, false],
      ['CTL', 44, false],
    ] as [string, number, boolean][],
  },
];

import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './game/engine';
import type { EndStats, GameEvent, HudState } from './game/types';
import { PERKS } from './game/types';
import { sfx } from './game/audio';

const DEFAULT_HUD: HudState = {
  phase: 'menu',
  health: 100,
  maxhp: 100,
  weaponIndex: 0,
  weapons: [
    { name: 'KODIAK .45', short: 'KDK .45', mag: 8, reserve: 56, auto: false, mode: 'SEMI', atts: [], locked: false },
    { name: 'PTARMIGAN M9', short: 'PTM 9MM', mag: 30, reserve: 150, auto: true, mode: 'AUTO', atts: [], locked: true },
    { name: 'SABLE .38', short: 'SBL .38', mag: 5, reserve: 40, auto: false, mode: 'SEMI', atts: [], locked: true },
    { name: 'RAVEN 12', short: 'RVN 12G', mag: 6, reserve: 36, auto: false, mode: 'SEMI', atts: [], locked: true },
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
  atts: [],
  streak: 0,
  streakT: 0,
  perkChoices: null,
};

interface FeedItem { id: number; weapon: string; head: boolean; n: number }
interface HitMark { id: number; kill: boolean; head: boolean }
interface Banner { id: number; title: string; sub: string; tone: 'warn' | 'good' }
interface ScorePop { id: number; text: string; x: number; y: number; head: boolean }

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
function loadSens(): number {
  try {
    const v = parseFloat(localStorage.getItem('wp_sens') || '');
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch { return 1; }
}
function loadLoadout(): { p: string[]; s: string[]; r: string[]; q: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem('wp_loadout') || '');
    if (raw && Array.isArray(raw.p) && Array.isArray(raw.s)) {
      return {
        p: raw.p, s: raw.s,
        r: Array.isArray(raw.r) ? raw.r : [],
        q: Array.isArray(raw.q) ? raw.q : [],
      };
    }
  } catch { /* ignore */ }
  return { p: [], s: [], r: [], q: [] };
}

/* ---------- attachment catalog (ids match the engine's ATT_MODS) ---------- */
type Wk = 'p' | 's' | 'r' | 'q';
interface AttDef { id: string; name: string; slot: string; weapon: Wk[]; good: string; bad: string }
const ATTACHMENTS: AttDef[] = [
  { id: 'supp',   name: 'MONOBLOC SUPPRESSOR',   slot: 'MUZZLE',     weapon: ['p', 's'],          good: 'RECOIL −12% · FLASH TAMED · SUBSONIC REPORT', bad: 'DAMAGE −8% · SLOWER SIGHT RAISE' },
  { id: 'comp',   name: 'AGGRESSOR COMPENSATOR', slot: 'MUZZLE',     weapon: ['p', 's'],          good: 'VERTICAL RECOIL −25%',                        bad: 'SPREAD +30% · LOUDER FLASH CONE' },
  { id: 'choke',  name: 'TACTICAL CHOKE',        slot: 'MUZZLE',     weapon: ['q'],               good: 'PELLET PATTERN −42%',                         bad: 'DAMAGE −4% · SLOWER SIGHT RAISE' },
  { id: 'xmag',   name: 'EXTENDED MAG / CYL.',   slot: 'MAGAZINE',   weapon: ['p', 's', 'r'],     good: '+4 (.45) / +10 (9MM) / +2 (.38) ROUNDS',      bad: 'RELOAD +25% · SLOWER HANDLING' },
  { id: 'tube',   name: 'TUBE EXTENSION',        slot: 'MAGAZINE',   weapon: ['q'],               good: '+2 SHELLS IN THE TUBE',                       bad: 'RELOAD +18% · MUZZLE-HEAVY' },
  { id: 'laser',  name: 'TACTICAL LASER',        slot: 'UNDERBARREL', weapon: ['p', 's', 'r', 'q'], good: 'HIP-FIRE BLOOM −45% · MOVE PENALTY −50%',    bad: 'RECOIL +5–8% · BEAM GIVES YOU AWAY' },
  { id: 'vgrip',  name: 'ANGLED GRIP',           slot: 'UNDERBARREL', weapon: ['s'],              good: 'VERTICAL RECOIL −22%',                        bad: 'MOVE PENALTY +22% · SLOWER ADS' },
  { id: 'fgrip',  name: 'VERTICAL FOREGRIP',     slot: 'UNDERBARREL', weapon: ['q'],              good: 'VERTICAL RECOIL −28%',                        bad: 'MOVE PENALTY +18% · SLOWER ADS' },
  { id: 'rdot',   name: 'MINI REFLEX SIGHT',     slot: 'OPTIC',      weapon: ['s', 'q'],          good: 'SNAPPIER SIGHT PICTURE · −30% ADS LAG',       bad: 'HIP SPREAD +12% · TOP-HEAVY' },
  { id: 'match',  name: 'MATCH TRIGGER',         slot: 'INTERNAL',   weapon: ['p'],               good: 'FIRE RATE +12% · FASTER RECOVERY',            bad: 'SHOT CONSISTENCY −35%' },
  { id: 'lslide', name: 'LONGSLIDE KIT',         slot: 'INTERNAL',   weapon: ['p'],               good: '−15% ADS LAG · RECOIL −8%',                   bad: 'SLOWER SIGHT RAISE · HEAVY FRONT' },
  { id: 'grips',  name: 'TARGET GRIPS',          slot: 'GRIP',       weapon: ['r'],               good: 'RECOIL −18% · TIGHTER PULL SPREAD',           bad: 'SLIGHTLY SLOWER SIGHT RAISE' },
];

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

/* ---------- loadout panel ---------- */
function LoadoutPanel({
  loadout, onToggle,
}: {
  loadout: { p: string[]; s: string[]; r: string[]; q: string[] };
  onToggle: (w: Wk, id: string) => void;
}) {
  const col = (wk: Wk, title: string, sub: string) => (
    <div className="hud-plate min-w-0 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-lg text-[#ffab3d]">{title}</span>
        <span className="text-[9px] font-bold tracking-[0.26em] text-[#7fb7c9]">{sub}</span>
      </div>
      <div className="mt-3 space-y-2">
        {ATTACHMENTS.filter((a) => a.weapon.includes(wk)).map((a) => {
          const equipped = loadout[wk].includes(a.id);
          const conflict = !equipped && loadout[wk].some((x) => ATTACHMENTS.find((y) => y.id === x)?.slot === a.slot);
          return (
            <button
              key={a.id}
              onClick={() => onToggle(wk, a.id)}
              className={`block w-full border px-3 py-2 text-left transition-all duration-150 ${
                equipped
                  ? 'border-[#ffab3d] bg-[rgba(255,171,61,0.10)] shadow-[0_0_14px_rgba(255,171,61,0.15)]'
                  : 'border-[rgba(127,183,201,0.22)] bg-[rgba(8,16,22,0.5)] hover:border-[rgba(191,234,245,0.55)] hover:bg-[rgba(127,183,201,0.08)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`font-display text-[13px] tracking-wide ${equipped ? 'text-[#ffab3d]' : 'text-[#bfeaf5]'}`}>{a.name}</span>
                <span className="flex items-center gap-2">
                  <span className="border border-[rgba(127,183,201,0.3)] px-1.5 py-[1px] text-[8px] font-bold tracking-[0.22em] text-[#7fb7c9]">{a.slot}</span>
                  <span className={`px-2 py-[2px] text-[9px] font-bold tracking-[0.22em] ${equipped ? 'bg-[#ffab3d] text-[#10131a]' : 'border border-[rgba(127,183,201,0.4)] text-[#7fb7c9]'}`}>
                    {equipped ? 'FITTED' : conflict ? 'SLOT USED' : 'EQUIP'}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] font-semibold tracking-[0.1em]">
                <span className="text-[#63e6b0]">▲ {a.good}</span>
                <span className="text-[#ff8a70]">▼ {a.bad}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="grid w-full max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {col('p', 'KODIAK .45', 'SIDEARM')}
      {col('s', 'PTARMIGAN M9', 'PRIMARY')}
      {col('r', 'SABLE .38', 'SNUB REVOLVER')}
      {col('q', 'RAVEN 12', 'TACTICAL 12G')}
    </div>
  );
}
/* ---------- between-wave perk draft: the choice that makes the next wave matter ---------- */
function PerkPicker({ choices, onPick }: { choices: string[]; onPick: (id: string) => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(3,8,12,0.6)]">
      <div className="fx-rise w-[min(94vw,56rem)]">
        <div className="text-center">
          <div className="text-[10px] font-bold tracking-[0.5em] text-[#7fb7c9]">SUPPLY DROP — WAVE CLEARED</div>
          <h2 className="font-display mt-1 text-4xl text-[#bfeaf5]">
            CHOOSE <span className="text-[#ffab3d]">YOUR EDGE</span>
          </h2>
          <div className="mx-auto mt-2 h-[3px] w-16 bg-[#ffab3d]" />
          <p className="mt-2 text-[11px] font-semibold tracking-[0.24em] text-[#7fb7c9]">
            PRESS <span className="text-[#ffab3d]">1 · 2 · 3</span> — ONE PERK, NO REFUNDS
          </p>
        </div>
        <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
          {choices.map((id, i) => {
            const def = PERKS.find((p) => p.id === id);
            if (!def) return null;
            return (
              <button
                key={id}
                onClick={() => onPick(id)}
                className="hud-plate group relative px-5 py-6 text-left transition-all duration-150 hover:-translate-y-1 hover:shadow-[0_0_30px_rgba(255,171,61,0.22)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[11px] tracking-[0.3em] text-[#54707e]">0{i + 1}</span>
                  <span className="border border-[rgba(255,171,61,0.45)] bg-[rgba(255,171,61,0.10)] px-2 py-[2px] font-display text-[12px] leading-none text-[#ffab3d] shadow-[0_0_10px_rgba(255,171,61,0.25)]">
                    {i + 1}
                  </span>
                </div>
                <div className="font-display mt-2 text-xl leading-tight text-[#bfeaf5] transition-colors duration-150 group-hover:text-[#ffab3d]">
                  {def.name}
                </div>
                <div className="mt-2 h-px w-full bg-[rgba(127,183,201,0.18)]" />
                <p className="mt-2 text-[12px] font-semibold tracking-[0.08em] text-[#9cc3d2]">{def.desc}</p>
                <span className="absolute left-0 top-0 h-[3px] w-0 bg-[#ffab3d] transition-all duration-200 group-hover:w-full" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

/* ---------- procedural briefing backdrop: the depot at night, no assets required ---------- */
function BriefingBackdrop() {
  const ribs = Array.from({ length: 40 }, (_, i) => 40 + i * 40);
  return (
    <div className="fx-kenburns absolute inset-0">
      <svg className="h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <linearGradient id="bbSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#04080d" />
            <stop offset="1" stopColor="#0b1622" />
          </linearGradient>
          <linearGradient id="bbMoon" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0e1d2e" />
            <stop offset="0.55" stopColor="#27425c" />
            <stop offset="1" stopColor="#a9c6de" />
          </linearGradient>
          <linearGradient id="bbFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#131c24" />
            <stop offset="1" stopColor="#070c11" />
          </linearGradient>
          <linearGradient id="bbCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffc46e" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ff9d2e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="bbShaft" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9fb9d4" stopOpacity="0.32" />
            <stop offset="1" stopColor="#9fb9d4" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* back wall + corrugation */}
        <rect width="1600" height="640" fill="#0d151d" />
        <rect width="1600" height="640" fill="url(#bbSky)" opacity="0.55" />
        {ribs.map((x) => (
          <rect key={x} x={x} y="0" width="3" height="640" fill="#1a2733" opacity="0.6" />
        ))}
        <rect y="205" width="1600" height="3" fill="#1a2733" opacity="0.8" />
        <rect y="430" width="1600" height="3" fill="#1a2733" opacity="0.8" />

        {/* the breach — torn steel opening onto the moonlit yard */}
        <polygon points="1150,262 1204,238 1262,258 1330,236 1408,254 1462,300 1470,388 1452,470 1466,548 1388,584 1300,566 1222,588 1160,540 1138,436 1156,340" fill="url(#bbMoon)" />
        {/* chain-link fence + flood tower through the hole */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={1170 + i * 38} y="392" width="3" height="160" fill="#0a141d" />
        ))}
        <rect x="1160" y="418" width="306" height="4" fill="#0a141d" />
        <rect x="1160" y="492" width="306" height="4" fill="#0a141d" />
        <rect x="1400" y="300" width="7" height="250" fill="#08111a" />
        <rect x="1382" y="296" width="44" height="12" fill="#08111a" />
        <circle cx="1382" cy="302" r="5" fill="#d7e6f2" opacity="0.9" />
        {/* snowfield through the breach */}
        <polygon points="1138,556 1470,548 1466,584 1160,590" fill="#33465a" opacity="0.55" />
        {/* jagged torn edges */}
        <polygon points="1150,262 1204,238 1262,258 1330,236 1408,254 1462,300 1452,292 1398,246 1324,228 1256,250 1198,230 1142,254" fill="#05090e" />

        {/* moonlight shaft across the floor */}
        <polygon points="1150,300 1462,320 1240,900 780,900" fill="url(#bbShaft)" />

        {/* floor */}
        <polygon points="0,640 1600,640 1600,900 0,900" fill="url(#bbFloor)" />
        <polygon points="0,640 1600,640 1600,648 0,648" fill="#1c2936" opacity="0.7" />

        {/* crate stacks + barrels, left flank */}
        <g fill="#141e27">
          <rect x="70" y="500" width="150" height="140" />
          <rect x="86" y="372" width="122" height="128" transform="rotate(-2 147 436)" />
          <rect x="252" y="540" width="128" height="100" />
        </g>
        <g fill="#1b2833">
          <rect x="70" y="500" width="150" height="8" />
          <rect x="86" y="372" width="122" height="8" />
        </g>
        <g fill="#111a22">
          <rect x="430" y="546" width="64" height="94" rx="6" />
          <rect x="506" y="546" width="64" height="94" rx="6" />
          <ellipse cx="462" cy="546" rx="32" ry="9" fill="#1d2b37" />
          <ellipse cx="538" cy="546" rx="32" ry="9" fill="#1d2b37" />
        </g>

        {/* wrecked truck silhouette, right of center */}
        <g fill="#0e161e">
          <rect x="880" y="512" width="270" height="118" />
          <rect x="1090" y="462" width="104" height="70" />
          <circle cx="930" cy="640" r="30" fill="#080d12" />
          <circle cx="1100" cy="640" r="30" fill="#080d12" />
        </g>

        {/* hanging tungsten lamps */}
        {[{ x: 560, f: 'fx-flicker' }, { x: 1010, f: 'fx-flicker2' }].map((l) => (
          <g key={l.x} className={l.f}>
            <rect x={l.x - 1} y="0" width="2" height="180" fill="#0a0f14" />
            <rect x={l.x - 16} y="176" width="32" height="12" fill="#241a10" />
            <polygon points={`${l.x - 130},640 ${l.x + 130},640 ${l.x + 26},188 ${l.x - 26},188`} fill="url(#bbCone)" />
            <ellipse cx={l.x} cy="642" rx="150" ry="26" fill="#ffab3d" opacity="0.13" />
            <circle cx={l.x} cy="188" r="6" fill="#ffd9a0" />
          </g>
        ))}

        <rect width="1600" height="130" fill="#04080d" opacity="0.7" />
      </svg>
      <div className="fx-snowdrift absolute inset-0 opacity-70" />
    </div>
  );
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
  const [pops, setPops] = useState<ScorePop[]>([]);
  const popSeq = useRef(0);
  const [stats, setStats] = useState<EndStats | null>(null);
  const [menuView, setMenuView] = useState<'root' | 'manual' | 'settings' | 'loadout'>('root');
  const [manualSec, setManualSec] = useState('brief');
  const [crosshairOn, setCrosshairOn] = useState<boolean>(loadXhair);
  const [sens, setSens] = useState<number>(loadSens);
  const [loadout, setLoadout] = useState<{ p: string[]; s: string[]; r: string[]; q: string[] }>(loadLoadout);
  const [showLoadout, setShowLoadout] = useState(false);

  const toggleAtt = useCallback((wk: Wk, id: string) => {
    setLoadout((prev) => {
      const list = prev[wk];
      let next: string[];
      if (list.includes(id)) {
        next = list.filter((x) => x !== id);
      } else {
        const slot = ATTACHMENTS.find((a) => a.id === id)?.slot;
        next = [...list.filter((x) => ATTACHMENTS.find((a) => a.id === x)?.slot !== slot), id];
      }
      const merged = { ...prev, [wk]: next };
      try { localStorage.setItem('wp_loadout', JSON.stringify(merged)); } catch { /* ignore */ }
      engineRef.current?.applyLoadout([...merged.p.map((x) => `p:${x}`), ...merged.s.map((x) => `s:${x}`), ...merged.r.map((x) => `r:${x}`), ...merged.q.map((x) => `q:${x}`)]);
      sfx.ui();
      return merged;
    });
  }, []);
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
      case 'streak':
        setBanner({ id: Date.now(), title: e.label, sub: `×${e.n} SCORE CHAIN`, tone: 'good' });
        break;
      case 'alert':
        setBanner({ id: Date.now(), title: e.title, sub: e.sub, tone: 'warn' });
        break;
      case 'scorepop': {
        const id = ++popSeq.current;
        setPops((ps) => [...ps.slice(-7), { id, text: e.text, x: e.x, y: e.y, head: e.head }]);
        setTimeout(() => setPops((ps) => ps.filter((p) => p.id !== id)), 950);
        break;
      }
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
    engine.setSensitivity(loadSens());
    const lo = loadLoadout();
    engine.applyLoadout([...lo.p.map((x) => `p:${x}`), ...lo.s.map((x) => `s:${x}`), ...lo.r.map((x) => `r:${x}`), ...lo.q.map((x) => `q:${x}`)]);
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
  const healthPct = hud.health / hud.maxhp;
  const healthColor = hud.regen ? '#63e6b0' : healthPct > 0.5 ? '#bfeaf5' : healthPct > 0.25 ? '#ffab3d' : '#ff3b30';

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05090d] select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-none" />

      {/* cold cinematic grade + film grain — always on for grit */}
      <div className="fx-cold pointer-events-none absolute inset-0" />
      <div className="fx-grain pointer-events-none absolute inset-0" />

      {/* ======================= IN-GAME HUD ======================= */}
      {playing && (
        <div className="pointer-events-none absolute inset-0">
          {/* between-wave perk draft — the fight freezes until you choose */}
          {hud.perkChoices && (
            <div className="pointer-events-auto">
              <PerkPicker
                choices={hud.perkChoices}
                onPick={(id) => {
                  sfx.ui();
                  engineRef.current?.choosePerk(id);
                }}
              />
            </div>
          )}
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

          {/* kill chain */}
          {hud.streak >= 2 && (
            <div key={hud.streak} className="fx-streak absolute left-1/2 top-[33%] -translate-x-1/2 text-center">
              <span className="font-display text-4xl text-[#ffab3d]" style={{ textShadow: '0 0 20px rgba(255,157,46,0.55), 0 2px 0 rgba(0,0,0,0.7)' }}>
                ×{hud.streak}
              </span>
              <span className="ml-2 align-middle text-[10px] font-bold tracking-[0.4em] text-[#ff7a45]">CHAIN</span>
              <div className="mx-auto mt-1 h-[3px] w-28 bg-[rgba(255,157,46,0.18)]">
                <div className="h-full bg-[#ffab3d]" style={{ width: `${Math.round(hud.streakT * 100)}%` }} />
              </div>
            </div>
          )}

          {/* floating score pops */}
          {pops.map((p) => (
            <div
              key={p.id}
              className={`fx-pop font-display pointer-events-none absolute text-xl ${p.head ? 'text-[#ff5c33]' : 'text-[#ffc46e]'}`}
              style={{ left: `${Math.round(p.x * 100)}%`, top: `${Math.round(p.y * 100)}%`, textShadow: '0 1px 0 rgba(0,0,0,0.8)' }}
            >
              {p.text}
            </div>
          ))}

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
            {w.atts.length > 0 && (
              <div className="mt-1 flex justify-end gap-1">
                {w.atts.map((a) => {
                  const def = ATTACHMENTS.find((x) => x.id === a);
                  return (
                    <span key={a} title={def?.name} className="border border-[rgba(255,171,61,0.4)] bg-[rgba(255,171,61,0.08)] px-1.5 py-[1px] text-[8px] font-bold tracking-[0.18em] text-[#ffab3d]">
                      {def ? def.slot : a.toUpperCase()}
                    </span>
                  );
                })}
              </div>
            )}
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
                  className={`px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] ${
                    x.locked
                      ? 'border border-dashed border-[rgba(127,183,201,0.2)] text-[rgba(127,183,201,0.32)]'
                      : i === hud.weaponIndex
                        ? 'bg-[#ffab3d] text-[#10131a]'
                        : 'border border-[rgba(127,183,201,0.3)] text-[#7fb7c9]'
                  }`}
                >
                  {i + 1} {x.locked ? '◌ CRATE' : x.short}
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
        <div className="absolute inset-0 overflow-hidden">
          <BriefingBackdrop />
          <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(4,9,13,0.94)_18%,rgba(4,9,13,0.72)_48%,rgba(4,9,13,0.45)_100%)]" />
          <div className="fx-vignette absolute inset-0" />

          {/* ---------- ROOT: minimal start ---------- */}
          {menuView === 'root' && (
            <div className="fx-rise relative flex h-full flex-col justify-between px-8 py-7 md:px-14 md:py-9">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 text-[11px] font-bold tracking-[0.4em] text-[#ff5c33]">
                    <span className="inline-block h-[8px] w-[8px] animate-pulse bg-[#ff5c33]" />
                    LIVE FIRE AUTHORIZED — 64.83°N 147.71°W
                  </div>
                  <div className="mt-2 h-[3px] w-16 bg-[#ffab3d]" />
                </div>
                <div className="text-right text-[9px] font-bold leading-relaxed tracking-[0.3em] text-[rgba(127,183,201,0.6)]">
                  ARCTIC OPS COMMAND<br />BUILD 2.6 // SECTOR 7
                </div>
              </div>

              <div className="max-w-2xl">
                <h1 className="font-display leading-[0.9]">
                  <span className="block text-7xl text-[#bfeaf5] md:text-8xl" style={{ textShadow: '0 0 44px rgba(120,190,220,0.3)' }}>WHITEOUT</span>
                  <span className="block text-5xl text-[#ffab3d] md:text-6xl">PROTOCOL<span className="fx-blink text-[#bfeaf5]">_</span></span>
                </h1>
                <p className="mt-5 text-[13px] font-semibold tracking-[0.34em] text-[#7fb7c9]">
                  HOLD THE DEPOT. OUTLAST THE STORM.
                </p>

                <div className="mt-10 flex flex-wrap items-center gap-4">
                  <button className="btn-mil px-14 py-4 text-xl" onClick={start}>DEPLOY ▸</button>
                  <button className="btn-ghost flex items-center gap-2 text-xs" onClick={() => setMenuView('manual')}>
                    FIELD MANUAL
                  </button>
                  <button className="btn-ghost flex items-center gap-2 text-xs" onClick={() => setMenuView('loadout')}>
                    LOADOUT
                  </button>
                  <button className="btn-ghost flex items-center gap-2 text-xs" onClick={() => setMenuView('settings')}>
                    <IconGear /> SETTINGS
                  </button>
                </div>
              </div>

              <div className="flex items-end justify-between text-[9px] font-bold tracking-[0.28em] text-[rgba(127,183,201,0.55)]">
                <span>MOUSE + KEYBOARD REQUIRED — CURSOR LOCKS ON DEPLOY</span>
                <span>-34°C // WIND 40KN // VIS 200M</span>
              </div>
            </div>
          )}

          {/* ---------- FIELD MANUAL: all intel in one dedicated dossier ---------- */}
          {menuView === 'manual' && (
            <div className="fx-rise absolute inset-0 flex flex-col bg-[rgba(3,8,12,0.93)]">
              <div className="flex items-center justify-between border-b border-[rgba(127,183,201,0.18)] px-8 py-4 md:px-14">
                <div>
                  <div className="text-[10px] font-bold tracking-[0.4em] text-[#7fb7c9]">OPERATION WHITEOUT</div>
                  <h2 className="font-display text-3xl text-[#bfeaf5]">FIELD MANUAL</h2>
                </div>
                <button className="btn-ghost text-xs" onClick={() => setMenuView('root')}>◂ BACK</button>
              </div>

              <div className="flex min-h-0 flex-1">
                {/* rail */}
                <div className="hidden w-52 shrink-0 flex-col gap-1 border-r border-[rgba(127,183,201,0.14)] px-6 py-6 md:flex">
                  {([['brief', '01', 'SITUATION'], ['controls', '02', 'CONTROLS'], ['armory', '03', 'ARMORY'], ['threats', '04', 'THREAT INTEL']] as [string, string, string][]).map(([id, num, label]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setManualSec(id);
                        document.getElementById(`fm-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`flex items-baseline gap-3 px-3 py-2 text-left text-[12px] font-bold tracking-[0.22em] transition-colors ${manualSec === id ? 'bg-[rgba(255,171,61,0.12)] text-[#ffab3d]' : 'text-[#7fb7c9] hover:bg-[rgba(127,183,201,0.08)] hover:text-[#bfeaf5]'}`}
                    >
                      <span className="font-display text-[11px]">{num}</span>
                      {label}
                    </button>
                  ))}
                </div>

                {/* dossier */}
                <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6 md:px-12">
                  <section id="fm-brief" className="max-w-2xl scroll-mt-4">
                    <div className="text-[10px] font-bold tracking-[0.4em] text-[#ffab3d]">01 // SITUATION</div>
                    <p className="mt-3 text-[15px] font-medium leading-relaxed text-[#9cc3d2]">
                      Prudhoe Supply Depot, Alaska. The convoy never made it. A mercenary company has taken the warehouse
                      district and they are coming through the storm in <span className="font-bold text-[#bfeaf5]">endless waves</span>.
                      The fight spills into the <span className="font-bold text-[#bfeaf5]">fenced snow yard</span> and along the
                      <span className="font-bold text-[#bfeaf5]"> freight yard</span> that runs beside the south wall — three rail
                      lines, parked boxcars, a tanker and a gantry crane make hard cover between the tracks.
                    </p>
                    <p className="mt-3 text-[15px] font-medium leading-relaxed text-[#9cc3d2]">
                      You deploy with <span className="font-bold text-[#ffab3d]">only the KODIAK sidearm</span>. Everything else —
                      the carbine, the snub .38, the 12-gauge — rides in on
                      <span className="font-bold text-[#ffab3d]"> rare supply crates dropped by the dead</span>, along with
                      field-strip kits that sharpen every weapon you carry. Warlords always drop. Make every round count;
                      hostiles route around the depot with <span className="font-bold text-[#bfeaf5]">real pathfinding</span> — they flank, not stall.
                    </p>
                    <div className="mt-4 border-l-2 border-[#ff5c33] pl-4 text-[12px] font-semibold tracking-[0.14em] text-[#7fb7c9]">
                      WAVES SCALE IN NUMBER AND ARMOR. HEADSHOTS PAY +75. CRATES UNLOCK WEAPONS. 5S CLEAR = VITALS RESTORE.
                    </div>
                  </section>

                  <section id="fm-controls" className="mt-10 max-w-2xl scroll-mt-4">
                    <div className="text-[10px] font-bold tracking-[0.4em] text-[#ffab3d]">02 // CONTROLS</div>
                    <div className="hud-plate mt-4 grid grid-cols-1 gap-x-8 gap-y-1.5 px-5 py-4 text-[12px] font-semibold tracking-[0.12em] text-[#9cc3d2] sm:grid-cols-2">
                      {([['W A S D', 'MOVE'], ['MOUSE', 'AIM — CURSOR LOCKS'], ['LMB', 'FIRE'], ['RMB', 'AIM DOWN SIGHTS'], ['R', 'RELOAD'], ['1-4 / WHEEL', 'SWAP WEAPON'], ['LMB MID-RELOAD', '12G SLAM-FIRE'], ['V', 'FIRE MODE — AUTO/BURST'], ['F', 'MELEE STOCK-STRIKE'], ['SHIFT', 'SPRINT'], ['SPACE', 'JUMP'], ['ESC', 'PAUSE'], ['5S CLEAR', 'VITALS RESTORE']] as [string, string][]).map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[rgba(127,183,201,0.12)] py-1.5">
                          <span className="font-display text-[11px] text-[#ffab3d]">{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section id="fm-armory" className="mt-10 max-w-2xl scroll-mt-4">
                    <div className="text-[10px] font-bold tracking-[0.4em] text-[#ffab3d]">03 // ARMORY</div>
                    {ARMORY.map((a) => (
                      <div key={a.name} className="hud-plate mt-4 px-5 py-4">
                        <div className="flex items-baseline justify-between">
                          <span className="font-display text-lg text-[#ffab3d]">{a.name}</span>
                          <span className="text-[10px] font-bold tracking-[0.25em] text-[#7fb7c9]">{a.mode}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {a.spec.map((s) => (
                            <span key={s} className="border border-[rgba(127,183,201,0.28)] px-1.5 py-[2px] text-[9px] font-bold tracking-[0.16em] text-[#9cc3d2]">{s}</span>
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
                  </section>

                  <section id="fm-threats" className="mt-10 max-w-2xl scroll-mt-4 pb-10">
                    <div className="text-[10px] font-bold tracking-[0.4em] text-[#ffab3d]">04 // THREAT INTEL — READ THE SHOULDER LAMP</div>
                    <div className="hud-plate mt-4 space-y-3 px-5 py-4 text-[12px] font-medium leading-snug text-[#9cc3d2]">
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
                  </section>
                </div>
              </div>
            </div>
          )}

          {/* ---------- SETTINGS ---------- */}
          {menuView === 'settings' && (
            <div className="fx-rise absolute inset-0 flex items-center justify-center bg-[rgba(3,8,12,0.9)] px-6">
              <div className="hud-plate w-full max-w-md px-7 py-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold tracking-[0.4em] text-[#7fb7c9]">SYSTEMS</div>
                    <h2 className="font-display text-3xl text-[#bfeaf5]">SETTINGS</h2>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => setMenuView('root')}>◂ BACK</button>
                </div>

                <div className="mt-3 border-t border-[rgba(127,183,201,0.15)]">
                  <SettingToggle label="CROSSHAIR" desc="ON-SCREEN RETICLE OVERLAY" value={crosshairOn} onToggle={toggleCrosshair} />
                </div>

                <div className="mt-2 border-t border-[rgba(127,183,201,0.15)] pt-4">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-[12px] font-bold tracking-[0.22em] text-[#bfeaf5]">MOUSE SENSITIVITY</div>
                      <div className="text-[10px] font-medium tracking-[0.14em] text-[#7fb7c9]">AIM SPEED MULTIPLIER</div>
                    </div>
                    <span className="font-display text-lg text-[#ffab3d]">{sens.toFixed(2)}×</span>
                  </div>
                  <input
                    type="range"
                    className="sens mt-3"
                    min={0.3}
                    max={2.5}
                    step={0.05}
                    value={sens}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setSens(v);
                      try { localStorage.setItem('wp_sens', String(v)); } catch { /* ignore */ }
                      engineRef.current?.setSensitivity(v);
                    }}
                  />
                  <div className="mt-1 flex justify-between text-[9px] font-bold tracking-[0.2em] text-[#7fb7c9]">
                    <span>STEADY 0.3×</span><span>DEFAULT 1.0×</span><span>QUICK 2.5×</span>
                  </div>
                </div>

                <div className="mt-4 border-t border-[rgba(127,183,201,0.15)] pt-3 text-[10px] font-semibold tracking-[0.16em] text-[#7fb7c9]">
                  <span className="text-[#ff5c33]">TIP //</span> SETTINGS SAVE LOCALLY AND APPLY MID-OPERATION.
                </div>
              </div>
            </div>
          )}

          {/* ---------- LOADOUT: fit attachments, one per slot per weapon ---------- */}
          {menuView === 'loadout' && (
            <div className="fx-rise absolute inset-0 flex flex-col bg-[rgba(3,8,12,0.93)]">
              <div className="flex items-center justify-between border-b border-[rgba(127,183,201,0.18)] px-8 py-4 md:px-14">
                <div>
                  <div className="text-[10px] font-bold tracking-[0.4em] text-[#7fb7c9]">OPERATION WHITEOUT</div>
                  <h2 className="font-display text-3xl text-[#bfeaf5]">WEAPON LOADOUT</h2>
                </div>
                <button className="btn-ghost text-xs" onClick={() => setMenuView('root')}>◂ BACK</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8 md:px-14">
                <div className="mb-5 max-w-4xl text-[11px] font-semibold tracking-[0.18em] text-[#7fb7c9]">
                  <span className="text-[#ff5c33]">ARMORY RULES //</span> ONE PART PER SLOT PER WEAPON. EVERY MOD CARRIES A COST — FITTING APPLIES IMMEDIATELY.
                </div>
                <LoadoutPanel loadout={loadout} onToggle={toggleAtt} />
              </div>
            </div>
          )}

        </div>
      )}

      {/* ======================= PAUSE ======================= */}
      {hud.phase === 'paused' && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgba(3,7,10,0.78)]">
          {!showLoadout ? (
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
                <button className="btn-mil w-64" onClick={() => { setShowLoadout(false); resume(); }}>RESUME ▸</button>
                <button className="btn-ghost w-64" onClick={() => setShowLoadout(true)}>WEAPON LOADOUT</button>
                <button className="btn-ghost w-64" onClick={start}>RESTART OPERATION</button>
                <button className="btn-ghost w-64" onClick={toMenu}>ABANDON — MAIN MENU</button>
              </div>
            </div>
          ) : (
            <div className="fx-rise max-h-[92vh] w-[min(96vw,64rem)] overflow-y-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-2xl text-[#bfeaf5]">WEAPON LOADOUT <span className="text-[11px] tracking-[0.3em] text-[#7fb7c9]">// APPLIES ON RESUME</span></h2>
                <button className="btn-ghost text-xs" onClick={() => setShowLoadout(false)}>◂ BACK TO STANDBY</button>
              </div>
              <LoadoutPanel loadout={loadout} onToggle={toggleAtt} />
            </div>
          )}
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

const WEAPON_MAGS = [8, 30, 5, 6];

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
    spec: ['9×19MM', '2.6 KG', 'AR PLATFORM', 'SKELETON STOCK'],
    desc: '9mm AR-platform carbine — flat-sided receivers, straight mag, short barrel and honest iron sights. Pull through the climb; V for burst.',
    recoil: 'BRACED CLIMB — NEAR-FLAT IN ADS',
    stats: [
      ['DMG', 40, true],
      ['ROF', 92, false],
      ['MAG', 68, false],
      ['CTL', 44, false],
    ] as [string, number, boolean][],
  },
  {
    name: 'SABLE .38',
    mode: 'DOUBLE-ACTION REVOLVER',
    spec: ['.38 SPL', '0.75 KG', 'SNUB-NOSE', 'OPEN FRAME'],
    desc: 'Five-shot pocket snub. Featherweight, so it kicks like a mule — but it never jams and every pull is its own event.',
    recoil: 'RISING STAIRCASE, CYLINDER TWIST — QUICK SETTLE',
    stats: [
      ['DMG', 92, true],
      ['ROF', 22, false],
      ['MAG', 16, false],
      ['CTL', 38, false],
    ] as [string, number, boolean][],
  },
  {
    name: 'RAVEN 12',
    mode: 'SEMI-AUTO TACTICAL 12G',
    spec: ['12 GAUGE', '3.2 KG', 'TUBE-FED', '8-PELLET'],
    desc: 'Black-polymer auto-loader. Eight pellets per pull tear a wide cone up close, then peter out past ~20m. Shells load one at a time — but you can slam-fire mid-reload.',
    recoil: 'DEEP TWO-STAGE SHOVE — WIDE LAZY ARC',
    stats: [
      ['DMG', 100, true],
      ['ROF', 18, false],
      ['MAG', 20, false],
      ['CTL', 30, false],
    ] as [string, number, boolean][],
  },
];

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Phase = "start" | "playing" | "paused" | "dying" | "gameover";

type Point = { x: number; y: number };

type Particle = Point & {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  spin: number;
};

type Ripple = Point & {
  life: number;
  maxLife: number;
  color: string;
};

type Popup = Point & {
  text: string;
  life: number;
  color: string;
};

type Mine = Point & {
  radius: number;
  phase: number;
};

type ScoreRow = {
  id: string;
  score: number;
  coils: number;
  date: string;
};

type GameState = {
  width: number;
  height: number;
  head: Point;
  angle: number;
  trail: Point[];
  trailLength: number;
  core: Point & { phase: number };
  mines: Mine[];
  particles: Particle[];
  ripples: Ripple[];
  popups: Popup[];
  score: number;
  coils: number;
  combo: number;
  comboTimer: number;
  energy: number;
  elapsed: number;
  mineTimer: number;
  shake: number;
  flash: number;
  hitStop: number;
  alive: boolean;
  lastTime: number;
  uiTimer: number;
};

type HoldControl = "left" | "right" | "boost";

const COLORS = {
  ink: "#090a08",
  acid: "#eaff38",
  orange: "#ff8a24",
  danger: "#ff3d25",
  cyan: "#58e8ff",
  paper: "#f3f1e8",
};

const SCORE_KEY = "coil-rush-high-scores-v1";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatScore(score: number) {
  return Math.max(0, Math.floor(score)).toString().padStart(6, "0");
}

function loadScores(): ScoreRow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCORE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function makeGame(width: number, height: number): GameState {
  const head = { x: width * 0.5, y: height * 0.7 };
  const firstDistance = clamp(height * 0.2, 95, 150);

  return {
    width,
    height,
    head,
    angle: -Math.PI / 2,
    trail: Array.from({ length: 28 }, (_, index) => ({
      x: head.x,
      y: head.y + index * 4,
    })),
    trailLength: 108,
    core: { x: head.x, y: head.y - firstDistance, phase: Math.random() * Math.PI * 2 },
    mines: [],
    particles: [],
    ripples: [],
    popups: [],
    score: 0,
    coils: 0,
    combo: 1,
    comboTimer: 0,
    energy: 100,
    elapsed: 0,
    mineTimer: 4.4,
    shake: 0,
    flash: 0,
    hitStop: 0,
    alive: true,
    lastTime: performance.now(),
    uiTimer: 0,
  };
}

function burst(
  game: GameState,
  x: number,
  y: number,
  color: string,
  count: number,
  force = 180,
) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = force * (0.35 + Math.random() * 0.8);
    const maxLife = 0.28 + Math.random() * 0.45;
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: maxLife,
      maxLife,
      size: 1.5 + Math.random() * 4.5,
      color,
      spin: (Math.random() - 0.5) * 8,
    });
  }

  if (game.particles.length > 360) {
    game.particles.splice(0, game.particles.length - 360);
  }
}

function spawnCore(game: GameState) {
  const margin = Math.min(64, game.width * 0.13);
  let candidate = { x: game.width / 2, y: game.height / 2 };

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const direction = game.angle + (Math.random() - 0.5) * 3.1;
    const travel = clamp(
      Math.min(game.width, game.height) * (0.24 + Math.random() * 0.17),
      105,
      225,
    );
    candidate = {
      x: clamp(game.head.x + Math.cos(direction) * travel, margin, game.width - margin),
      y: clamp(game.head.y + Math.sin(direction) * travel, margin, game.height - margin),
    };

    const clearOfMines = game.mines.every((mine) => distance(candidate, mine) > 82);
    const clearOfTrail = game.trail
      .filter((_, index) => index % 7 === 0)
      .every((point) => distance(candidate, point) > 38);

    if (distance(candidate, game.head) > 85 && clearOfMines && clearOfTrail) break;
  }

  game.core = { ...candidate, phase: Math.random() * Math.PI * 2 };
}

function spawnMine(game: GameState) {
  const maxMines = clamp(Math.floor((game.width * game.height) / 62_000), 3, 12);
  if (game.mines.length >= maxMines) return;

  const margin = Math.min(72, game.width * 0.16);
  let candidate = { x: margin, y: margin };

  for (let attempt = 0; attempt < 60; attempt += 1) {
    candidate = {
      x: margin + Math.random() * Math.max(1, game.width - margin * 2),
      y: margin + Math.random() * Math.max(1, game.height - margin * 2),
    };
    const clear =
      distance(candidate, game.head) > 155 &&
      distance(candidate, game.core) > 85 &&
      game.mines.every((mine) => distance(candidate, mine) > 68) &&
      game.trail
        .filter((_, index) => index % 8 === 0)
        .every((point) => distance(candidate, point) > 44);
    if (clear) break;
  }

  game.mines.push({
    ...candidate,
    radius: 16 + Math.random() * 4,
    phase: Math.random() * Math.PI * 2,
  });
}

function updateEffects(game: GameState, dt: number) {
  const drag = Math.pow(0.955, dt * 60);

  for (let index = game.particles.length - 1; index >= 0; index -= 1) {
    const particle = game.particles[index];
    particle.life -= dt;
    if (particle.life <= 0) {
      game.particles.splice(index, 1);
      continue;
    }
    particle.vx *= drag;
    particle.vy *= drag;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }

  for (let index = game.ripples.length - 1; index >= 0; index -= 1) {
    game.ripples[index].life -= dt;
    if (game.ripples[index].life <= 0) game.ripples.splice(index, 1);
  }

  for (let index = game.popups.length - 1; index >= 0; index -= 1) {
    game.popups[index].life -= dt;
    game.popups[index].y -= dt * 34;
    if (game.popups[index].life <= 0) game.popups.splice(index, 1);
  }

  game.shake = Math.max(0, game.shake - dt * 34);
  game.flash = Math.max(0, game.flash - dt * 3.7);
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  focus?: Point,
) {
  context.fillStyle = COLORS.ink;
  context.fillRect(-24, -24, width + 48, height + 48);

  const glowX = focus?.x ?? width * 0.5;
  const glowY = focus?.y ?? height * 0.55;
  const haze = context.createRadialGradient(glowX, glowY, 0, glowX, glowY, width * 0.7);
  haze.addColorStop(0, "rgba(117, 133, 21, 0.12)");
  haze.addColorStop(0.42, "rgba(30, 39, 16, 0.07)");
  haze.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = haze;
  context.fillRect(0, 0, width, height);

  const spacing = width < 560 ? 34 : 42;
  const offset = (time * 12) % spacing;
  context.strokeStyle = "rgba(234, 255, 56, 0.055)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = offset - spacing; x < width + spacing; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = offset - spacing; y < height + spacing; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();

  context.strokeStyle = "rgba(234, 255, 56, 0.32)";
  context.lineWidth = 1;
  context.setLineDash([8, 9]);
  context.strokeRect(18.5, 18.5, width - 37, height - 37);
  context.setLineDash([]);

  context.fillStyle = "rgba(243, 241, 232, 0.22)";
  context.font = "700 9px ui-monospace, monospace";
  context.letterSpacing = "2px";
  context.fillText("LIVE CIRCUIT", 31, 39);
  context.fillText("CR-88", Math.max(31, width - 72), Math.max(46, height - 31));
}

function drawAttractMode(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
) {
  drawBackdrop(context, width, height, time);

  context.save();
  context.globalAlpha = 0.34;
  context.shadowBlur = 20;
  context.shadowColor = COLORS.acid;
  context.strokeStyle = COLORS.acid;
  context.lineWidth = 7;
  context.lineCap = "round";
  context.beginPath();
  const centerY = height * 0.66;
  for (let x = -20; x <= width + 20; x += 8) {
    const y = centerY + Math.sin(x * 0.018 + time * 1.4) * Math.min(42, height * 0.08);
    if (x === -20) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function drawCore(context: CanvasRenderingContext2D, game: GameState) {
  const pulse = 1 + Math.sin(game.elapsed * 5 + game.core.phase) * 0.11;
  context.save();
  context.translate(game.core.x, game.core.y);
  context.rotate(game.elapsed * 1.6);
  context.scale(pulse, pulse);
  context.shadowColor = COLORS.cyan;
  context.shadowBlur = 24;
  context.strokeStyle = COLORS.cyan;
  context.lineWidth = 2;
  context.strokeRect(-11, -11, 22, 22);
  context.rotate(Math.PI / 4);
  context.fillStyle = COLORS.acid;
  context.fillRect(-6, -6, 12, 12);
  context.fillStyle = COLORS.ink;
  context.fillRect(-2, -2, 4, 4);
  context.restore();

  context.save();
  context.translate(game.core.x, game.core.y);
  context.rotate(-game.elapsed * 1.1);
  context.fillStyle = COLORS.paper;
  for (let index = 0; index < 4; index += 1) {
    context.rotate(Math.PI / 2);
    context.fillRect(0, -1, 19, 2);
  }
  context.restore();
}

function drawMine(context: CanvasRenderingContext2D, mine: Mine, time: number) {
  const pulse = 1 + Math.sin(time * 4 + mine.phase) * 0.13;
  context.save();
  context.translate(mine.x, mine.y);
  context.rotate(time * 0.75 + mine.phase);
  context.scale(pulse, pulse);
  context.shadowColor = COLORS.danger;
  context.shadowBlur = 18;
  context.strokeStyle = COLORS.danger;
  context.fillStyle = "rgba(255, 61, 37, 0.16)";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const radius = index % 2 === 0 ? mine.radius * 1.45 : mine.radius * 0.7;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.rotate(-time * 1.8);
  context.fillStyle = COLORS.danger;
  context.fillRect(-4, -4, 8, 8);
  context.restore();
}

function drawTrail(context: CanvasRenderingContext2D, game: GameState, boosting: boolean) {
  if (game.trail.length < 2) return;

  const path = () => {
    context.beginPath();
    const tail = game.trail[game.trail.length - 1];
    context.moveTo(tail.x, tail.y);
    for (let index = game.trail.length - 2; index >= 0; index -= 1) {
      context.lineTo(game.trail[index].x, game.trail[index].y);
    }
  };

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  path();
  context.globalAlpha = boosting ? 0.46 : 0.28;
  context.shadowColor = COLORS.acid;
  context.shadowBlur = boosting ? 30 : 18;
  context.strokeStyle = COLORS.acid;
  context.lineWidth = boosting ? 19 : 16;
  context.stroke();

  const tail = game.trail[game.trail.length - 1];
  const gradient = context.createLinearGradient(tail.x, tail.y, game.head.x, game.head.y);
  gradient.addColorStop(0, COLORS.orange);
  gradient.addColorStop(0.62, COLORS.acid);
  gradient.addColorStop(1, COLORS.paper);
  path();
  context.globalAlpha = 1;
  context.shadowBlur = 8;
  context.strokeStyle = gradient;
  context.lineWidth = 8;
  context.stroke();

  path();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(9, 10, 8, 0.55)";
  context.lineWidth = 2;
  context.setLineDash([2, 15]);
  context.stroke();
  context.setLineDash([]);
  context.restore();
}

function drawHead(context: CanvasRenderingContext2D, game: GameState, boosting: boolean) {
  context.save();
  context.translate(game.head.x, game.head.y);
  context.rotate(game.angle);

  if (boosting) {
    context.fillStyle = COLORS.orange;
    context.shadowBlur = 18;
    context.shadowColor = COLORS.orange;
    context.beginPath();
    context.moveTo(-13, -6);
    context.lineTo(-28 - Math.random() * 8, 0);
    context.lineTo(-13, 6);
    context.closePath();
    context.fill();
  }

  context.shadowColor = COLORS.acid;
  context.shadowBlur = 21;
  context.fillStyle = COLORS.acid;
  context.beginPath();
  context.moveTo(16, 0);
  context.lineTo(4, 12);
  context.lineTo(-11, 8);
  context.lineTo(-7, 0);
  context.lineTo(-11, -8);
  context.lineTo(4, -12);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = COLORS.ink;
  context.fillRect(4, -6, 5, 4);
  context.fillRect(4, 2, 5, 4);
  context.fillStyle = COLORS.paper;
  context.fillRect(5, -5, 2, 2);
  context.fillRect(5, 3, 2, 2);
  context.restore();
}

function drawEffects(context: CanvasRenderingContext2D, game: GameState) {
  context.save();
  context.globalCompositeOperation = "lighter";
  for (const particle of game.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    context.globalAlpha = alpha;
    context.fillStyle = particle.color;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.spin * (particle.maxLife - particle.life));
    context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
    context.restore();
  }
  context.restore();

  for (const ripple of game.ripples) {
    const progress = 1 - ripple.life / ripple.maxLife;
    context.globalAlpha = 1 - progress;
    context.strokeStyle = ripple.color;
    context.lineWidth = 3 * (1 - progress) + 0.5;
    context.beginPath();
    context.arc(ripple.x, ripple.y, 12 + progress * 70, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.textAlign = "center";
  context.font = "900 15px ui-monospace, monospace";
  for (const popup of game.popups) {
    context.globalAlpha = clamp(popup.life / 0.75, 0, 1);
    context.fillStyle = popup.color;
    context.fillText(popup.text, popup.x, popup.y);
  }
  context.globalAlpha = 1;
  context.textAlign = "start";
}

function drawGame(context: CanvasRenderingContext2D, game: GameState, boosting: boolean) {
  context.save();
  const shakeX = game.shake > 0 ? (Math.random() - 0.5) * game.shake : 0;
  const shakeY = game.shake > 0 ? (Math.random() - 0.5) * game.shake : 0;
  context.translate(shakeX, shakeY);
  drawBackdrop(context, game.width, game.height, game.elapsed, game.head);

  drawCore(context, game);
  for (const mine of game.mines) drawMine(context, mine, game.elapsed);
  drawTrail(context, game, boosting);
  if (game.alive) drawHead(context, game, boosting);
  drawEffects(context, game);
  context.restore();

  if (game.flash > 0) {
    context.fillStyle = `rgba(234, 255, 56, ${game.flash * 0.25})`;
    context.fillRect(0, 0, game.width, game.height);
  }
}

function ScoreTable({ scores, limit = 5 }: { scores: ScoreRow[]; limit?: number }) {
  const rows = Array.from({ length: limit }, (_, index) => scores[index]);

  return (
    <table className="score-table" aria-label="Local high scores">
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Run</th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row?.id ?? `empty-${index}`}>
            <td>{String(index + 1).padStart(2, "0")}</td>
            <td>{row ? `${row.coils} coils / ${row.date}` : "No signal"}</td>
            <td>{row ? formatScore(row.score) : "------"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 4V5L9 9H5Z" />
      {muted ? <path d="m18 9 4 4m0-4-4 4" /> : <path d="M17 8c1.6 2.2 1.6 5.8 0 8m3-11c3.4 4 3.4 10 0 14" />}
    </svg>
  );
}

function PauseIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paused ? <path d="m8 5 11 7-11 7V5Z" /> : <path d="M7 5h4v14H7zm7 0h4v14h-4z" />}
    </svg>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLElement>(null);
  const gameRef = useRef<GameState | null>(null);
  const phaseRef = useRef<Phase>("start");
  const dprRef = useRef(1);
  const finishTimerRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const keysRef = useRef(new Set<string>());
  const holdRef = useRef({
    left: new Set<number>(),
    right: new Set<number>(),
    boost: new Set<number>(),
  });
  const canvasPointersRef = useRef(new Map<number, "left" | "right">());

  const [phase, setPhase] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [energy, setEnergy] = useState(100);
  const [finalScore, setFinalScore] = useState(0);
  const [finalCoils, setFinalCoils] = useState(0);
  const [highScores, setHighScores] = useState<ScoreRow[]>(loadScores);
  const [newBest, setNewBest] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const playSound = useCallback((kind: "start" | "pickup" | "crash" | "click", pitch = 0) => {
    if (!soundEnabledRef.current) return;

    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();

      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);

      if (kind === "pickup") {
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(280 + Math.min(pitch, 6) * 42, now);
        oscillator.frequency.exponentialRampToValueAtTime(760 + pitch * 24, now + 0.11);
        gain.gain.setValueAtTime(0.055, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        oscillator.start(now);
        oscillator.stop(now + 0.15);
      } else if (kind === "crash") {
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(115, now);
        oscillator.frequency.exponentialRampToValueAtTime(34, now + 0.42);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
        oscillator.start(now);
        oscillator.stop(now + 0.45);
      } else {
        oscillator.type = kind === "start" ? "square" : "sine";
        oscillator.frequency.setValueAtTime(kind === "start" ? 150 : 260, now);
        oscillator.frequency.exponentialRampToValueAtTime(kind === "start" ? 470 : 330, now + 0.12);
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        oscillator.start(now);
        oscillator.stop(now + 0.17);
      }
    } catch {
      // Audio is an enhancement; the game remains fully playable if it is blocked.
    }
  }, []);

  const clearControls = useCallback(() => {
    keysRef.current.clear();
    holdRef.current.left.clear();
    holdRef.current.right.clear();
    holdRef.current.boost.clear();
    canvasPointersRef.current.clear();
  }, []);

  const startGame = useCallback(() => {
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }

    const arena = arenaRef.current;
    const rect = arena?.getBoundingClientRect();
    const width = Math.max(280, rect?.width ?? window.innerWidth);
    const height = Math.max(320, rect?.height ?? window.innerHeight);
    gameRef.current = makeGame(width, height);
    clearControls();
    phaseRef.current = "playing";
    setPhase("playing");
    setScore(0);
    setCombo(1);
    setEnergy(100);
    setNewBest(false);
    playSound("start");
  }, [clearControls, playSound]);

  const finishGame = useCallback((endedGame: GameState) => {
    if (phaseRef.current === "gameover") return;

    const completedScore = Math.floor(endedGame.score);
    const completedCoils = endedGame.coils;
    phaseRef.current = "gameover";
    setPhase("gameover");
    setFinalScore(completedScore);
    setFinalCoils(completedCoils);

    if (completedScore > 0) {
      const entry: ScoreRow = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        score: completedScore,
        coils: completedCoils,
        date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      };

      setHighScores((current) => {
        const next = [...current, entry].sort((a, b) => b.score - a.score).slice(0, 5);
        setNewBest(next[0]?.id === entry.id);
        try {
          localStorage.setItem(SCORE_KEY, JSON.stringify(next));
        } catch {
          // Local score persistence can be unavailable in private browsing modes.
        }
        return next;
      });
    }
  }, []);

  const crash = useCallback(
    (game: GameState) => {
      if (!game.alive || phaseRef.current !== "playing") return;
      game.alive = false;
      game.shake = 22;
      game.flash = 0.9;
      burst(game, game.head.x, game.head.y, COLORS.danger, 58, 260);
      burst(game, game.head.x, game.head.y, COLORS.acid, 24, 190);
      game.ripples.push({
        x: game.head.x,
        y: game.head.y,
        life: 0.72,
        maxLife: 0.72,
        color: COLORS.danger,
      });
      phaseRef.current = "dying";
      setPhase("dying");
      clearControls();
      playSound("crash");
      finishTimerRef.current = window.setTimeout(() => finishGame(game), 560);
    },
    [clearControls, finishGame, playSound],
  );

  const pauseGame = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    phaseRef.current = "paused";
    setPhase("paused");
    clearControls();
    playSound("click");
  }, [clearControls, playSound]);

  const resumeGame = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    if (gameRef.current) gameRef.current.lastTime = performance.now();
    phaseRef.current = "playing";
    setPhase("playing");
    clearControls();
    playSound("click");
  }, [clearControls, playSound]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabledRef.current;
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    if (next) playSound("click");
  }, [playSound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;

    const resize = () => {
      const rect = arena.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const game = gameRef.current;
      if (game && game.width > 0 && game.height > 0) {
        const scaleX = width / game.width;
        const scaleY = height / game.height;
        game.head.x *= scaleX;
        game.head.y *= scaleY;
        game.core.x *= scaleX;
        game.core.y *= scaleY;
        for (const point of game.trail) {
          point.x *= scaleX;
          point.y *= scaleY;
        }
        for (const mine of game.mines) {
          mine.x *= scaleX;
          mine.y *= scaleY;
        }
        for (const particle of game.particles) {
          particle.x *= scaleX;
          particle.y *= scaleY;
        }
        game.width = width;
        game.height = height;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(arena);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let animationFrame = 0;

    const frame = (time: number) => {
      const canvas = canvasRef.current;
      const arena = arenaRef.current;
      const context = canvas?.getContext("2d");

      if (canvas && arena && context) {
        const rect = arena.getBoundingClientRect();
        const dpr = dprRef.current;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);

        const game = gameRef.current;
        if (!game) {
          drawAttractMode(context, rect.width, rect.height, time / 1000);
        } else {
          const rawDt = (time - game.lastTime) / 1000;
          const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 1 / 30);
          game.lastTime = time;

          const leftHeld =
            keysRef.current.has("arrowleft") ||
            keysRef.current.has("a") ||
            holdRef.current.left.size > 0 ||
            [...canvasPointersRef.current.values()].includes("left");
          const rightHeld =
            keysRef.current.has("arrowright") ||
            keysRef.current.has("d") ||
            holdRef.current.right.size > 0 ||
            [...canvasPointersRef.current.values()].includes("right");
          const wantsBoost =
            keysRef.current.has("arrowup") ||
            keysRef.current.has("w") ||
            keysRef.current.has(" ") ||
            holdRef.current.boost.size > 0;
          const boosting = phaseRef.current === "playing" && wantsBoost && game.energy > 1;

          if (phaseRef.current === "playing" && game.alive) {
            if (game.hitStop > 0) {
              game.hitStop -= dt;
              updateEffects(game, dt * 0.45);
            } else {
              game.elapsed += dt;
              game.comboTimer = Math.max(0, game.comboTimer - dt);
              if (game.comboTimer === 0) game.combo = 1;

              const turn = Number(rightHeld) - Number(leftHeld);
              const turnSpeed = boosting ? 2.75 : 3.22;
              game.angle += turn * turnSpeed * dt;

              const baseSpeed = 176 + Math.min(92, game.elapsed * 1.4 + game.coils * 4.2);
              const speed = baseSpeed * (boosting ? 1.42 : 1);
              game.energy = clamp(game.energy + (boosting ? -37 : 14) * dt, 0, 100);
              game.score += dt * (10 + baseSpeed * 0.035) * (1 + (game.combo - 1) * 0.12);

              const previous = { ...game.head };
              game.head.x += Math.cos(game.angle) * speed * dt;
              game.head.y += Math.sin(game.angle) * speed * dt;
              game.trail.unshift({ ...game.head });

              let trailDistance = 0;
              let trimAt = game.trail.length;
              for (let index = 1; index < game.trail.length; index += 1) {
                trailDistance += distance(game.trail[index - 1], game.trail[index]);
                if (trailDistance >= game.trailLength) {
                  trimAt = index + 1;
                  break;
                }
              }
              if (trimAt < game.trail.length) game.trail.splice(trimAt);

              if (boosting && Math.random() < 0.72) {
                const maxLife = 0.18 + Math.random() * 0.18;
                game.particles.push({
                  x: previous.x - Math.cos(game.angle) * 8,
                  y: previous.y - Math.sin(game.angle) * 8,
                  vx: -Math.cos(game.angle) * (50 + Math.random() * 65) + (Math.random() - 0.5) * 34,
                  vy: -Math.sin(game.angle) * (50 + Math.random() * 65) + (Math.random() - 0.5) * 34,
                  life: maxLife,
                  maxLife,
                  size: 2 + Math.random() * 3,
                  color: Math.random() > 0.45 ? COLORS.orange : COLORS.acid,
                  spin: 0,
                });
              }

              if (distance(game.head, game.core) < 25) {
                game.combo = game.comboTimer > 0 ? Math.min(9, game.combo + 1) : 1;
                game.comboTimer = 3.25;
                game.coils += 1;
                const reward = 100 * game.combo;
                game.score += reward;
                game.trailLength += 24;
                game.energy = clamp(game.energy + 26, 0, 100);
                game.shake = 7 + game.combo * 0.8;
                game.flash = 0.42;
                game.hitStop = 0.038;
                burst(game, game.core.x, game.core.y, COLORS.cyan, 22 + game.combo * 2, 190);
                burst(game, game.core.x, game.core.y, COLORS.acid, 11, 135);
                game.ripples.push({
                  x: game.core.x,
                  y: game.core.y,
                  life: 0.52,
                  maxLife: 0.52,
                  color: COLORS.cyan,
                });
                game.popups.push({
                  x: game.core.x,
                  y: game.core.y - 25,
                  text: `+${reward}${game.combo > 1 ? `  x${game.combo}` : ""}`,
                  life: 0.75,
                  color: game.combo > 2 ? COLORS.acid : COLORS.paper,
                });
                playSound("pickup", game.combo);
                spawnCore(game);
                if (game.coils === 2 || game.coils % 4 === 0) spawnMine(game);
              }

              game.mineTimer -= dt;
              if (game.mineTimer <= 0) {
                spawnMine(game);
                game.mineTimer = Math.max(2.7, 5.9 - game.elapsed * 0.025);
              }

              const wallMargin = 21;
              const hitWall =
                game.head.x < wallMargin ||
                game.head.x > game.width - wallMargin ||
                game.head.y < wallMargin ||
                game.head.y > game.height - wallMargin;
              const hitMine = game.mines.some(
                (mine) => distance(game.head, mine) < mine.radius + 10,
              );

              let hitTrail = false;
              if (game.coils >= 4 && game.trail.length > 34) {
                for (let index = 30; index < game.trail.length; index += 3) {
                  if (distance(game.head, game.trail[index]) < 8.2) {
                    hitTrail = true;
                    break;
                  }
                }
              }

              updateEffects(game, dt);
              if (hitWall || hitMine || hitTrail) crash(game);

              game.uiTimer += dt;
              if (game.uiTimer >= 0.075) {
                game.uiTimer = 0;
                setScore(Math.floor(game.score));
                setCombo(game.combo);
                setEnergy(Math.round(game.energy));
              }
            }
          } else if (phaseRef.current === "dying") {
            updateEffects(game, dt);
          }

          drawGame(context, game, boosting);
        }
      }

      animationFrame = requestAnimationFrame(frame);
    };

    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [crash, playSound]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const gameKey = ["arrowleft", "arrowright", "arrowup", "a", "d", "w", " "].includes(key);
      if (gameKey) event.preventDefault();

      if (["start", "gameover", "dying"].includes(phaseRef.current)) {
        if (!event.repeat && (key === "enter" || key === " " || key === "r")) startGame();
        return;
      }

      if (phaseRef.current === "paused") {
        if (!event.repeat && (key === "escape" || key === "p" || key === "enter")) resumeGame();
        return;
      }

      if (phaseRef.current === "playing" && (key === "escape" || key === "p")) {
        if (!event.repeat) pauseGame();
        return;
      }

      keysRef.current.add(key);
    };

    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    const onBlur = () => clearControls();
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [clearControls, pauseGame, resumeGame, startGame]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && phaseRef.current === "playing") pauseGame();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pauseGame]);

  useEffect(
    () => () => {
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
      void audioRef.current?.close();
    },
    [],
  );

  const holdHandlers = (control: HoldControl) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      holdRef.current[control].add(event.pointerId);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      holdRef.current[control].delete(event.pointerId);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => {
      holdRef.current[control].delete(event.pointerId);
    },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => {
      holdRef.current[control].delete(event.pointerId);
    },
  });

  const updateCanvasPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const direction = event.clientX - rect.left < rect.width / 2 ? "left" : "right";
    canvasPointersRef.current.set(event.pointerId, direction);
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== "playing") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateCanvasPointer(event);
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    canvasPointersRef.current.delete(event.pointerId);
  };

  return (
    <div className={`game-app phase-${phase}`}>
      <header className="game-header">
        <button className="mini-brand" type="button" onClick={startGame} aria-label="Start a new Coil Rush run">
          <span>COIL</span>
          <b>RUSH</b>
        </button>

        <div className="hud">
          <div className="hud-score">
            <span>Score</span>
            <strong>{formatScore(score)}</strong>
          </div>
          <div className={`combo-readout ${combo > 1 ? "is-hot" : ""}`}>
            <span>Chain</span>
            <strong>x{combo}</strong>
          </div>
          <div className="boost-meter">
            <div className="boost-label">
              <span>Boost</span>
              <b>{energy}%</b>
            </div>
            <div className="boost-track" aria-hidden="true">
              <i style={{ width: `${energy}%` }} />
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            onClick={toggleSound}
            aria-label={soundEnabled ? "Mute sound" : "Enable sound"}
            title={soundEnabled ? "Mute sound" : "Enable sound"}
          >
            <SpeakerIcon muted={!soundEnabled} />
          </button>
          <button
            className="icon-button pause-button"
            type="button"
            onClick={phase === "paused" ? resumeGame : pauseGame}
            disabled={phase === "start" || phase === "gameover" || phase === "dying"}
            aria-label={phase === "paused" ? "Resume game" : "Pause game"}
            title={phase === "paused" ? "Resume game" : "Pause game"}
          >
            <PauseIcon paused={phase === "paused"} />
          </button>
        </div>
      </header>

      <main className="arena" ref={arenaRef}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={(event) => {
            if (canvasPointersRef.current.has(event.pointerId)) updateCanvasPointer(event);
          }}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onLostPointerCapture={onCanvasPointerUp}
          role="img"
          aria-label="Coil Rush game arena. Turn the glowing coil, collect energy cores, and avoid mines and your own tail."
        />

        {phase === "start" && (
          <section className="game-screen start-screen" aria-labelledby="game-title">
            <div className="start-copy">
              <p className="eyebrow"><span /> High-speed snake riot</p>
              <h1 id="game-title">
                <span>COIL</span>
                <span>RUSH</span>
              </h1>
              <p className="game-intro">
                Turn hard. Chain cores. Do not cross the live wire.
              </p>
              <button className="primary-button" type="button" onClick={startGame}>
                <span>Ignite run</span>
                <kbd>Enter</kbd>
              </button>
              <div className="control-hint" aria-label="Controls">
                <span><kbd>A</kbd><kbd>D</kbd> turn</span>
                <span><kbd>Space</kbd> boost</span>
                <span className="touch-hint">Hold left or right to turn</span>
              </div>
            </div>

            <aside className="leaderboard start-leaderboard">
              <div className="section-label">
                <span>Local legends</span>
                <b>Top 05</b>
              </div>
              <ScoreTable scores={highScores} />
            </aside>
          </section>
        )}

        {phase === "paused" && (
          <section className="game-screen pause-screen" aria-labelledby="pause-title">
            <p className="eyebrow"><span /> Circuit suspended</p>
            <h2 id="pause-title">HOLD<br />THE LINE</h2>
            <button className="primary-button" type="button" onClick={resumeGame}>
              <span>Resume</span>
              <kbd>P</kbd>
            </button>
            <button className="text-button" type="button" onClick={startGame}>Restart run</button>
          </section>
        )}

        {phase === "gameover" && (
          <section className="game-screen end-screen" aria-labelledby="end-title">
            <div className="end-summary">
              <p className="eyebrow danger"><span /> Signal severed</p>
              <h2 id="end-title">WIRE<br />DOWN</h2>
              {newBest && <p className="new-best">New local record</p>}
              <div className="final-score">
                <span>Final score</span>
                <strong>{formatScore(finalScore)}</strong>
                <small>{finalCoils} energy cores chained</small>
              </div>
              <button className="primary-button danger-button" type="button" onClick={startGame}>
                <span>Run it back</span>
                <kbd>R</kbd>
              </button>
            </div>

            <aside className="leaderboard end-leaderboard">
              <div className="section-label">
                <span>Local legends</span>
                <b>Top 05</b>
              </div>
              <ScoreTable scores={highScores} />
            </aside>
          </section>
        )}

        <div className="touch-controls" aria-label="Touch controls">
          <button type="button" className="turn-control left-control" aria-label="Turn left" {...holdHandlers("left")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
            <span>Turn</span>
          </button>
          <button type="button" className="boost-control" aria-label="Boost" {...holdHandlers("boost")}>
            <span>Boost</span>
            <i />
          </button>
          <button type="button" className="turn-control right-control" aria-label="Turn right" {...holdHandlers("right")}>
            <span>Turn</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        </div>

        <div className="arena-edge edge-left" aria-hidden="true">TURN / BURN / SURVIVE</div>
        <div className="arena-edge edge-right" aria-hidden="true">SYSTEM CR-88</div>
      </main>
    </div>
  );
}
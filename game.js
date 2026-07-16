'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const POWERS = {
  bomb: { name: 'Bomba', icon: '💣', glow: '#ff5252', dur: 500 },
  ray: { name: 'Rayo', icon: '⚡', glow: '#ffd54f', dur: 450 },
  tint: { name: 'Tinte', icon: '🎨', glow: '#ba68c8', dur: 500 },
  gravity: { name: 'Gravedad', icon: '🌐', glow: '#4dd0e1', dur: 550 },
  freeze: { name: 'Congelar', icon: '❄️', glow: '#7aa2f7', dur: 5000 },
};
const POWER_IDS = Object.keys(POWERS);
const FREEZE_MS = 5000;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const powerBanner = document.getElementById('power-banner');
const nextPowerEl = document.getElementById('next-power');
const gameoverBox = document.getElementById('gameover-box');
const pauseBox = document.getElementById('pause-box');
const pauseMainView = document.getElementById('pause-main-view');
const pauseControlsView = document.getElementById('pause-controls-view');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const controlsToggleBtn = document.getElementById('controls-toggle-btn');
const controlsBackBtn = document.getElementById('controls-back-btn');
const startLevelSelect = document.getElementById('start-level-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pieceSeq, effects, frozenUntil, freezeRemaining;
let startLevel = 1;

for (let i = 1; i <= 15; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = String(i);
  startLevelSelect.appendChild(opt);
}
startLevelSelect.value = String(startLevel);
startLevelSelect.addEventListener('change', () => {
  startLevel = parseInt(startLevelSelect.value, 10) || 1;
});
startLevelSelect.addEventListener('keydown', e => e.stopPropagation());

function showPauseMainView() {
  pauseMainView.classList.remove('hidden');
  pauseControlsView.classList.add('hidden');
}

resumeBtn.addEventListener('click', () => { if (paused) togglePause(); });
pauseRestartBtn.addEventListener('click', () => init());
controlsToggleBtn.addEventListener('click', () => {
  pauseMainView.classList.add('hidden');
  pauseControlsView.classList.remove('hidden');
});
controlsBackBtn.addEventListener('click', showPauseMainView);

const THEME_KEY = 'tetris-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeToggleBtn.setAttribute('aria-label', theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
}

function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
}

themeToggleBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  pieceSeq++;
  const power = pieceSeq % 2 === 0 ? POWER_IDS[Math.floor(Math.random() * POWER_IDS.length)] : null;
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0, power };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function pieceCenter() {
  const cells = [];
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c]) cells.push({ r: current.y + r, c: current.x + c });
  const cy = Math.round(cells.reduce((s, p) => s + p.r, 0) / cells.length);
  const cx = Math.round(cells.reduce((s, p) => s + p.c, 0) / cells.length);
  return { cx, cy };
}

function pushEffect(id, cells, cx, cy) {
  effects.push({ id, cells, cx, cy, start: performance.now(), dur: POWERS[id].dur });
}

function showPowerBanner(id) {
  const meta = POWERS[id];
  powerBanner.textContent = `${meta.icon} ${meta.name.toUpperCase()}`;
  powerBanner.style.color = meta.glow;
  powerBanner.classList.remove('hidden', 'show');
  // restart animation
  void powerBanner.offsetWidth;
  powerBanner.classList.add('show');
}

function firePower(id, cx, cy) {
  showPowerBanner(id);
  switch (id) {
    case 'bomb': {
      const cells = [];
      for (let r = cy - 1; r <= cy + 1; r++) {
        for (let c = cx - 1; c <= cx + 1; c++) {
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          if (board[r][c]) cells.push({ c, r, color: board[r][c] });
          board[r][c] = 0;
        }
      }
      pushEffect('bomb', cells, cx, cy);
      break;
    }
    case 'ray': {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        if (board[cy][c]) cells.push({ c, r: cy, color: board[cy][c] });
        board[cy][c] = 0;
      }
      for (let r = 0; r < ROWS; r++) {
        if (board[r][cx]) cells.push({ c: cx, r, color: board[r][cx] });
        board[r][cx] = 0;
      }
      pushEffect('ray', cells, cx, cy);
      break;
    }
    case 'tint': {
      const present = new Set();
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c]) present.add(board[r][c]);
      if (present.size) {
        const colors = [...present];
        const target = colors[Math.floor(Math.random() * colors.length)];
        const cells = [];
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (board[r][c] === target) {
              cells.push({ c, r, color: board[r][c] });
              board[r][c] = 0;
            }
        pushEffect('tint', cells, cx, cy);
      }
      break;
    }
    case 'gravity': {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        const colVals = [];
        for (let r = 0; r < ROWS; r++) if (board[r][c]) colVals.push(board[r][c]);
        const startRow = ROWS - colVals.length;
        for (let r = 0; r < ROWS; r++) {
          const val = r >= startRow ? colVals[r - startRow] : 0;
          if (board[r][c] !== val) cells.push({ c, r, color: val || board[r][c] });
          board[r][c] = val;
        }
      }
      pushEffect('gravity', cells, cx, cy);
      break;
    }
    case 'freeze': {
      const remaining = Math.max(0, frozenUntil - performance.now());
      frozenUntil = performance.now() + FREEZE_MS + remaining;
      pushEffect('freeze', [], cx, cy);
      break;
    }
  }
}

function lockPiece() {
  merge();
  if (current.power) {
    const { cx, cy } = pieceCenter();
    firePower(current.power, cx, cy);
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() || '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  const now = performance.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  if (current.power) {
    ctx.save();
    ctx.shadowColor = POWERS[current.power].glow;
    ctx.shadowBlur = 16;
  }
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  if (current.power) ctx.restore();

  drawEffects(now);
}

function drawEffects(now) {
  effects = effects.filter(fx => fx.id === 'freeze' ? now < frozenUntil : now - fx.start < fx.dur);
  for (const fx of effects) {
    const t = Math.min(1, (now - fx.start) / fx.dur);
    const meta = POWERS[fx.id];
    switch (fx.id) {
      case 'bomb': {
        const alpha = 1 - t;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = meta.glow;
        const radius = (1.6 + t * 1.2) * BLOCK;
        ctx.beginPath();
        ctx.arc((fx.cx + 0.5) * BLOCK, (fx.cy + 0.5) * BLOCK, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'ray': {
        const alpha = 1 - t;
        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = meta.glow;
        ctx.fillRect(0, fx.cy * BLOCK, COLS * BLOCK, BLOCK);
        ctx.fillRect(fx.cx * BLOCK, 0, BLOCK, ROWS * BLOCK);
        ctx.restore();
        break;
      }
      case 'tint': {
        const alpha = 1 - t;
        ctx.save();
        ctx.globalAlpha = alpha;
        for (const cell of fx.cells) {
          ctx.fillStyle = COLORS[cell.color];
          ctx.fillRect(cell.c * BLOCK + 1, cell.r * BLOCK + 1, BLOCK - 2, BLOCK - 2);
        }
        ctx.restore();
        break;
      }
      case 'gravity': {
        const alpha = 1 - t;
        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = meta.glow;
        ctx.lineWidth = 2;
        for (const cell of fx.cells) {
          ctx.beginPath();
          ctx.moveTo(cell.c * BLOCK + BLOCK / 2, cell.r * BLOCK);
          ctx.lineTo(cell.c * BLOCK + BLOCK / 2, cell.r * BLOCK + BLOCK * (1 - t));
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'freeze': {
        if (now >= frozenUntil) break;
        const remaining = Math.max(0, frozenUntil - now);
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = meta.glow;
        ctx.fillRect(0, 0, COLS * BLOCK, ROWS * BLOCK);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = meta.glow;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`❄️ ${(remaining / 1000).toFixed(1)}s`, (COLS * BLOCK) / 2, 24);
        ctx.restore();
        break;
      }
    }
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  if (next.power) {
    nextCtx.save();
    nextCtx.shadowColor = POWERS[next.power].glow;
    nextCtx.shadowBlur = 14;
  }
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
  if (next.power) nextCtx.restore();

  if (next.power) {
    const meta = POWERS[next.power];
    nextPowerEl.textContent = `${meta.icon} ${meta.name}`;
    nextPowerEl.style.color = meta.glow;
    nextPowerEl.classList.remove('hidden');
  } else {
    nextPowerEl.classList.add('hidden');
  }
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  gameoverBox.classList.remove('hidden');
  pauseBox.classList.add('hidden');
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    if (freezeRemaining > 0) {
      frozenUntil = lastTime + freezeRemaining;
      freezeRemaining = 0;
    }
    overlay.classList.add('hidden');
    loop(lastTime);
  } else {
    freezeRemaining = Math.max(0, frozenUntil - performance.now());
    cancelAnimationFrame(animId);
    gameoverBox.classList.add('hidden');
    pauseBox.classList.remove('hidden');
    showPauseMainView();
    startLevelSelect.value = String(startLevel);
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (ts < frozenUntil) {
    dropAccum = 0;
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  pieceSeq = 0;
  effects = [];
  frozenUntil = 0;
  freezeRemaining = 0;
  powerBanner.classList.remove('show');
  powerBanner.classList.add('hidden');
  nextPowerEl.classList.add('hidden');
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

initTheme();
init();

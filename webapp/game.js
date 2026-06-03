'use strict';

// ── Telegram ──────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ── Canvas ────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let W, H;
let cachedGrad = null;

function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
  cachedGrad = null; // пересоздать при следующей отрисовке
}
resize();
window.addEventListener('resize', resize);

// ── Константы ─────────────────────────────────
const GRAVITY      = 0.38;
const JUMP_FORCE   = -13;
const JUMP_SPRING  = -22;
const PLAYER_W     = 40;
const PLAYER_H     = 44;
const PLAT_W       = 70;
const PLAT_H       = 14;
const PLAT_COUNT   = 14;
const MOVE_SPEED   = 5;
const MAX_VY       = 22;   // терминальная скорость падения
const MAX_PARTICLES = 60;

const PT  = { NORMAL: 0, MOVING: 1, BREAK: 2, SPRING: 3 };
const CLR = {
  plat: { [PT.NORMAL]:'#4fffb0', [PT.MOVING]:'#4e90ff', [PT.BREAK]:'#ff6b6b', [PT.SPRING]:'#ffe97a' },
  player: '#76ff8e', eye: '#001a0e',
};

// ── DOM (кешируем, чтобы не искать каждый кадр) ──
const elScore     = document.getElementById('current-score');
const elHudBest   = document.getElementById('hud-best');
const elFinalScore = document.getElementById('final-score');
const elFinalBest  = document.getElementById('final-best');
const elBestStart  = document.getElementById('best-score-display');
const elNewRecord  = document.getElementById('new-record-badge');
const elSaveOk     = document.getElementById('save-ok');
const elNameInput  = document.getElementById('name-input');
const elLbList     = document.getElementById('lb-list');

// ── Рекорд ────────────────────────────────────
let bestScore = parseInt(localStorage.getItem('dj_best') || '0');
function updateBest(s) {
  if (s > bestScore) { bestScore = s; localStorage.setItem('dj_best', String(s)); return true; }
  return false;
}

// ── Таблица рекордов ──────────────────────────
function getLeaderboard() {
  try { return JSON.parse(localStorage.getItem('dj_lb') || '[]'); }
  catch { return []; }
}
function saveToLeaderboard(name, s) {
  const lb = getLeaderboard();
  lb.push({ name: name.trim() || 'Игрок', score: s });
  lb.sort((a, b) => b.score - a.score);
  lb.splice(10);
  localStorage.setItem('dj_lb', JSON.stringify(lb));
}
function renderLeaderboard() {
  const lb = getLeaderboard();
  if (!lb.length) {
    elLbList.innerHTML = '<div class="lb-empty">Нет результатов. Сыграй первым!</div>';
    return;
  }
  const medals = ['gold','silver','bronze'];
  elLbList.innerHTML = lb.map((e, i) => `
    <div class="lb-row">
      <span class="lb-rank ${medals[i] || ''}">${i < 3 ? ['🥇','🥈','🥉'][i] : i+1}</span>
      <span class="lb-name">${escapeHtml(e.name)}</span>
      <span class="lb-score">${e.score}</span>
    </div>`).join('');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Игровое состояние ─────────────────────────
let state = 'start';
let score, prevScore, cameraY, player, platforms, stars, particles;
let leftPressed = false, rightPressed = false;

// ── Платформы ─────────────────────────────────
function platType(sc) {
  const r = Math.random();
  if (sc < 200)  return PT.NORMAL;
  if (sc < 500)  return r < 0.15 ? PT.MOVING : PT.NORMAL;
  if (sc < 1000) return r < 0.12 ? PT.BREAK  : r < 0.28 ? PT.MOVING : PT.NORMAL;
  return r < 0.13 ? PT.SPRING : r < 0.23 ? PT.BREAK : r < 0.38 ? PT.MOVING : PT.NORMAL;
}
function makePlatform(x, y) {
  const type = platType(score || 0);
  return {
    x, y, w: PLAT_W, h: PLAT_H, type,
    broken: false,
    dir:   type === PT.MOVING ? (Math.random() < .5 ? 1 : -1) : 0,
    speed: 1.2 + Math.random() * 1.2,
  };
}
function generatePlatforms() {
  platforms = [];
  const start = { x: W/2 - PLAT_W/2, y: H - 80, w: PLAT_W, h: PLAT_H, type: PT.NORMAL, broken: false, dir: 0, speed: 0 };
  platforms.push(start);
  let lastY = start.y;
  while (platforms.length < PLAT_COUNT) {
    lastY -= 80 + Math.random() * 40;
    platforms.push(makePlatform(Math.random() * (W - PLAT_W), lastY));
  }
}

// ── Звёзды ────────────────────────────────────
function generateStars() {
  stars = Array.from({ length: 55 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: Math.random() * 1.4 + 0.3, a: 0.3 + Math.random() * 0.7,
  }));
}

// ── Частицы ───────────────────────────────────
function spawnParticles(x, y, color) {
  if (particles.length >= MAX_PARTICLES) return;
  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI * 2 * i / 5) + Math.random() * 0.5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * (1 + Math.random() * 2),
      vy: Math.sin(angle) * (1 + Math.random() * 2) - 1,
      life: 1, color,
    });
  }
}

// ── Инициализация ─────────────────────────────
function initGame() {
  score = prevScore = 0;
  cameraY  = 0;
  particles = [];
  generateStars();
  generatePlatforms();
  player = {
    x: W / 2 - PLAYER_W / 2,
    y: H - 180,
    vx: 0, vy: 0,
    facingRight: true,
    springAnim: 0,
  };
  elScore.textContent   = '0';
  elHudBest.textContent = bestScore;
}

// ── Физика ────────────────────────────────────
function update() {
  if (state !== 'game') return;

  // Горизонталь
  const dx = leftPressed ? -MOVE_SPEED : rightPressed ? MOVE_SPEED : 0;
  if (dx !== 0) {
    player.vx = dx;
    player.facingRight = dx > 0;
  } else {
    player.vx *= 0.75;
  }
  player.x += player.vx;

  // Wrap
  if (player.x + PLAYER_W < 0) player.x = W;
  if (player.x > W)             player.x = -PLAYER_W;

  // Гравитация + терминальная скорость
  player.vy = Math.min(player.vy + GRAVITY, MAX_VY);
  player.y += player.vy;

  // Камера
  const mid = H * 0.45;
  if (player.y < cameraY + mid) {
    const diff = (cameraY + mid) - player.y;
    cameraY -= diff;
    score   += Math.round(diff * 0.15);
    if (score !== prevScore) {
      prevScore = score;
      elScore.textContent = score;
    }
  }

  // Анимация пружины
  if (player.springAnim > 0) player.springAnim -= 0.15;

  // Движение платформ
  for (const p of platforms) {
    if (p.type === PT.MOVING && !p.broken) {
      p.x += p.dir * p.speed;
      if (p.x <= 0 || p.x + p.w >= W) p.dir *= -1;
    }
  }

  // Конец игры — проверяем ДО коллизии, чтобы избежать прыжков снизу
  if (player.y - cameraY > H + 80) {
    endGame();
    return;
  }

  // Коллизия (только при падении вниз)
  if (player.vy > 0) {
    const px = player.x, py = player.y;
    const foot = py + PLAYER_H;
    for (const p of platforms) {
      if (p.broken) continue;
      const sy = p.y - cameraY;
      // стопа пересекла платформу за этот кадр
      if (px + PLAYER_W > p.x && px < p.x + p.w &&
          foot >= sy && foot <= sy + p.h + player.vy + 2) {
        if (p.type === PT.BREAK) {
          p.broken = true;
          spawnParticles(p.x + p.w/2, sy, '#ff6b6b');
        } else if (p.type === PT.SPRING) {
          player.vy = JUMP_SPRING;
          player.springAnim = 1;
          spawnParticles(p.x + p.w/2, sy, '#ffe97a');
        } else {
          player.vy = JUMP_FORCE;
          spawnParticles(p.x + p.w/2, sy, '#4fffb0');
        }
        break;
      }
    }
  }

  // Прокрутка платформ — найти наименьший Y через обычный цикл
  platforms = platforms.filter(p => p.y - cameraY < H + 60);
  let topY = Infinity;
  for (const p of platforms) if (p.y < topY) topY = p.y;
  while (platforms.length < PLAT_COUNT) {
    const newY = topY - (80 + Math.random() * 40);
    platforms.push(makePlatform(Math.random() * (W - PLAT_W), newY));
    topY = newY;
  }

  // Частицы
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= 0.05;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ── Отрисовка ─────────────────────────────────
function draw() {
  if (!cachedGrad) {
    cachedGrad = ctx.createLinearGradient(0, 0, 0, H);
    cachedGrad.addColorStop(0, '#0a1628');
    cachedGrad.addColorStop(1, '#112244');
  }
  ctx.fillStyle = cachedGrad;
  ctx.fillRect(0, 0, W, H);

  if (state !== 'game') return;

  // Звёзды
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Частицы
  for (const p of particles) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Платформы
  for (const p of platforms) {
    if (p.broken) continue;
    const sy = p.y - cameraY;
    if (sy < -20 || sy > H + 20) continue;

    ctx.fillStyle = CLR.plat[p.type];
    roundRect(ctx, p.x, sy, p.w, p.h, 7);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, p.x + 4, sy + 2, p.w - 8, 4, 3);
    ctx.fill();

    if (p.type === PT.SPRING) {
      ctx.fillStyle = '#ff9900';
      ctx.fillRect(p.x + p.w/2 - 5, sy - 12, 10, 12);
    }
  }

  drawPlayer();
}

function drawPlayer() {
  const x = player.x;
  const y = player.y - cameraY;
  const sy = player.springAnim > 0 ? 1 + player.springAnim * 0.28 : 1;
  const sx = player.springAnim > 0 ? 1 - player.springAnim * 0.14 : 1;

  ctx.save();
  ctx.translate(x + PLAYER_W/2, y + PLAYER_H);
  ctx.scale(sx, sy);
  ctx.translate(-PLAYER_W/2, -PLAYER_H);

  ctx.fillStyle = CLR.player;
  roundRect(ctx, 0, 0, PLAYER_W, PLAYER_H, 10);
  ctx.fill();

  const ex = player.facingRight ? 5 : -5;
  ctx.fillStyle = CLR.eye;
  ctx.beginPath(); ctx.arc(PLAYER_W/2 - 8 + ex, 14, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(PLAYER_W/2 + 2 + ex, 14, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(PLAYER_W/2 - 7 + ex, 12, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(PLAYER_W/2 + 3 + ex, 12, 1.5, 0, Math.PI*2); ctx.fill();

  ctx.strokeStyle = CLR.eye; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(PLAYER_W/2 + ex, 22, 6, 0.2, Math.PI - 0.2); ctx.stroke();

  const lb = Math.sin(Date.now() / 120) * 3;
  ctx.fillStyle = '#2ecc71';
  ctx.fillRect(4,            PLAYER_H - 6 + (player.vy < 0 ? -2 :  lb), 10, 10);
  ctx.fillRect(PLAYER_W-14,  PLAYER_H - 6 + (player.vy < 0 ?  2 : -lb), 10, 10);

  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x+r, y); c.lineTo(x+w-r, y);
  c.quadraticCurveTo(x+w, y, x+w, y+r);
  c.lineTo(x+w, y+h-r);
  c.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  c.lineTo(x+r, y+h);
  c.quadraticCurveTo(x, y+h, x, y+h-r);
  c.lineTo(x, y+r);
  c.quadraticCurveTo(x, y, x+r, y);
  c.closePath();
}

// ── Игровой цикл ──────────────────────────────
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// ── Экраны ────────────────────────────────────
let prevScreen = 'start';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.getElementById('mobile-controls').style.display = name === 'game' ? 'flex' : 'none';
  prevScreen = name;
}

function startGame() {
  leftPressed = rightPressed = false;
  state = 'game';
  initGame();
  showScreen('game');
}

function endGame() {
  state = 'gameover';
  particles = [];

  const isNew = updateBest(score);
  elFinalScore.textContent = score;
  elFinalBest.textContent  = bestScore;
  elNewRecord.classList.toggle('hidden', !isNew);
  elSaveOk.classList.add('hidden');

  // Предзаполнить имя из Telegram
  const tgName = tg?.initDataUnsafe?.user?.first_name;
  if (tgName && !elNameInput.value) elNameInput.value = tgName;

  if (tg) tg.sendData(JSON.stringify({ score, best: bestScore }));

  showScreen('gameover');
}

function goToMenu() {
  state = 'start';
  elBestStart.textContent = bestScore;
  showScreen('start');
}

function openLeaderboard(backTarget) {
  renderLeaderboard();
  showScreen('leaderboard');
  document.getElementById('btn-lb-back').onclick = () => {
    state = backTarget === 'gameover' ? 'gameover' : 'start';
    showScreen(backTarget);
  };
}

// ── Кнопки UI ─────────────────────────────────
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click', goToMenu);
document.getElementById('btn-open-lb').addEventListener('click', () => openLeaderboard('start'));
document.getElementById('btn-lb-go').addEventListener('click',   () => openLeaderboard('gameover'));

document.getElementById('btn-save-score').addEventListener('click', () => {
  saveToLeaderboard(elNameInput.value, score);
  elSaveOk.classList.remove('hidden');
});

// ── Управление — клавиатура ───────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') leftPressed  = true;
  if (e.key === 'ArrowRight' || e.key === 'd') rightPressed = true;
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') leftPressed  = false;
  if (e.key === 'ArrowRight' || e.key === 'd') rightPressed = false;
});

// ── Управление — кнопки на экране ─────────────
function hold(btn, setter) {
  btn.addEventListener('touchstart',  e => { e.preventDefault(); setter(true);  }, { passive: false });
  btn.addEventListener('touchend',    e => { e.preventDefault(); setter(false); }, { passive: false });
  btn.addEventListener('touchcancel', e => { e.preventDefault(); setter(false); }, { passive: false });
  btn.addEventListener('mousedown', () => setter(true));
  btn.addEventListener('mouseup',   () => setter(false));
  btn.addEventListener('mouseleave',() => setter(false));
}
hold(document.getElementById('btn-left'),  v => leftPressed  = v);
hold(document.getElementById('btn-right'), v => rightPressed = v);

// ── Старт ─────────────────────────────────────
elBestStart.textContent = bestScore;
document.getElementById('mobile-controls').style.display = 'none';
showScreen('start');
loop();

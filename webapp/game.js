'use strict';

// ──────────────────────────────────────────────
//  Telegram Web App инициализация
// ──────────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ──────────────────────────────────────────────
//  Canvas & resize
// ──────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

let W, H;
function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ──────────────────────────────────────────────
//  Константы
// ──────────────────────────────────────────────
const GRAVITY         = 0.35;
const JUMP_FORCE      = -13;
const PLAYER_W        = 40;
const PLAYER_H        = 44;
const PLAT_W          = 70;
const PLAT_H          = 14;
const PLAT_COUNT      = 12;
const MOVE_SPEED      = 5;

// Типы платформ
const PT = { NORMAL: 0, MOVING: 1, BREAK: 2, SPRING: 3 };

// Цвета
const CLR = {
  bg_top:    '#0a1628',
  bg_bot:    '#112244',
  plat:      { [PT.NORMAL]:'#4fffb0', [PT.MOVING]:'#4e90ff', [PT.BREAK]:'#ff6b6b', [PT.SPRING]:'#ffe97a' },
  player:    '#76ff8e',
  eye:       '#001a0e',
  star:      'rgba(255,255,255,0.6)',
};

// ──────────────────────────────────────────────
//  Рекорд (localStorage)
// ──────────────────────────────────────────────
let bestScore = parseInt(localStorage.getItem('dj_best') || '0');
function updateBest(s) {
  if (s > bestScore) { bestScore = s; localStorage.setItem('dj_best', s); return true; }
  return false;
}

// ──────────────────────────────────────────────
//  Игровое состояние
// ──────────────────────────────────────────────
let state = 'start'; // 'start' | 'game' | 'gameover'
let score, cameraY, player, platforms, stars, particles;
let leftPressed = false, rightPressed = false;
let tiltX = 0; // акселерометр

// ──────────────────────────────────────────────
//  Генератор платформ
// ──────────────────────────────────────────────
function platType(score) {
  const r = Math.random();
  if (score < 200)  return PT.NORMAL;
  if (score < 500)  return r < 0.15 ? PT.MOVING : PT.NORMAL;
  if (score < 1000) return r < 0.12 ? PT.BREAK  : r < 0.25 ? PT.MOVING : PT.NORMAL;
  return r < 0.12 ? PT.SPRING : r < 0.22 ? PT.BREAK : r < 0.35 ? PT.MOVING : PT.NORMAL;
}

function makePlatform(x, y) {
  const type = platType(score || 0);
  return {
    x, y, w: PLAT_W, h: PLAT_H,
    type,
    broken: false,
    dir: type === PT.MOVING ? (Math.random() < 0.5 ? 1 : -1) : 0,
    speed: 1.2 + Math.random() * 1.2,
  };
}

function generatePlatforms() {
  platforms = [];
  const startPlat = { x: W/2 - PLAT_W/2, y: H - 80, w: PLAT_W, h: PLAT_H, type: PT.NORMAL, broken: false, dir: 0 };
  platforms.push(startPlat);
  let lastY = startPlat.y;
  while (platforms.length < PLAT_COUNT) {
    lastY -= 80 + Math.random() * 40;
    platforms.push(makePlatform(Math.random() * (W - PLAT_W), lastY));
  }
}

// ──────────────────────────────────────────────
//  Звёзды-фон
// ──────────────────────────────────────────────
function generateStars() {
  stars = Array.from({ length: 60 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.5 + 0.3,
    a: Math.random(),
  }));
}

// ──────────────────────────────────────────────
//  Частицы прыжка
// ──────────────────────────────────────────────
function spawnParticles(x, y, color) {
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i / 6) + Math.random() * 0.4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * (1.5 + Math.random() * 2),
      vy: Math.sin(angle) * (1.5 + Math.random() * 2) - 1,
      life: 1, color,
    });
  }
}

// ──────────────────────────────────────────────
//  Инициализация игры
// ──────────────────────────────────────────────
function initGame() {
  score    = 0;
  cameraY  = 0;
  particles = [];
  generateStars();
  generatePlatforms();

  player = {
    x:  W / 2 - PLAYER_W / 2,
    y:  H - 180,
    vx: 0,
    vy: 0,
    facingRight: true,
    onGround: false,
    springAnim: 0,
  };

  document.getElementById('current-score').textContent = '0';
  document.getElementById('hud-best').textContent = bestScore;
}

// ──────────────────────────────────────────────
//  Физика и обновление
// ──────────────────────────────────────────────
function update() {
  if (state !== 'game') return;

  // Горизонтальное движение
  const accel = tiltX !== 0 ? tiltX * 6 : (leftPressed ? -MOVE_SPEED : rightPressed ? MOVE_SPEED : 0);
  if (Math.abs(accel) > 0.1) {
    player.vx = accel;
    player.facingRight = accel > 0;
  } else {
    player.vx *= 0.8;
  }

  player.x += player.vx;

  // Обёртка по краям
  if (player.x + PLAYER_W < 0)  player.x = W;
  if (player.x > W)              player.x = -PLAYER_W;

  // Гравитация
  player.vy += GRAVITY;
  player.y  += player.vy;

  // Камера следует за игроком
  const midpoint = H / 2;
  if (player.y < cameraY + midpoint) {
    const diff = (cameraY + midpoint) - player.y;
    cameraY  -= diff;
    score    += Math.round(diff * 0.15);
    document.getElementById('current-score').textContent = score;
  }

  // Анимация пружины
  if (player.springAnim > 0) player.springAnim -= 0.15;

  // Обновление платформ
  for (const p of platforms) {
    if (p.type === PT.MOVING && !p.broken) {
      p.x += p.dir * p.speed;
      if (p.x <= 0 || p.x + p.w >= W) p.dir *= -1;
    }
  }

  // Коллизия с платформами (только при падении вниз)
  if (player.vy > 0) {
    const px = player.x, py = player.y;
    for (const p of platforms) {
      if (p.broken) continue;
      const inX = px + PLAYER_W > p.x && px < p.x + p.w;
      const inY = py + PLAYER_H > p.y - cameraY && py + PLAYER_H < p.y - cameraY + p.h + player.vy + 4;
      if (inX && inY) {
        if (p.type === PT.BREAK) {
          p.broken = true;
          spawnParticles(p.x + p.w/2, p.y - cameraY, '#ff6b6b');
        } else if (p.type === PT.SPRING) {
          player.vy = JUMP_FORCE * 1.7;
          player.springAnim = 1;
          spawnParticles(p.x + p.w/2, p.y - cameraY, '#ffe97a');
        } else {
          player.vy = JUMP_FORCE;
          spawnParticles(p.x + p.w/2, p.y - cameraY, '#4fffb0');
        }
        break;
      }
    }
  }

  // Прокрутка: убираем старые, добавляем новые платформы
  platforms = platforms.filter(p => p.y - cameraY < H + 50);
  while (platforms.length < PLAT_COUNT) {
    const topY = Math.min(...platforms.map(p => p.y));
    const newY = topY - (80 + Math.random() * 40);
    platforms.push(makePlatform(Math.random() * (W - PLAT_W), newY));
  }

  // Обновление частиц
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.1;
    p.life -= 0.04;
  }

  // Проверка падения
  if (player.y - cameraY > H + 60) {
    endGame();
  }
}

// ──────────────────────────────────────────────
//  Отрисовка
// ──────────────────────────────────────────────
function draw() {
  // Фон
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, CLR.bg_top);
  grad.addColorStop(1, CLR.bg_bot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (state !== 'game') return;

  // Звёзды
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = CLR.star;
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
    const screenY = p.y - cameraY;
    if (screenY < -20 || screenY > H + 20) continue;

    ctx.fillStyle = CLR.plat[p.type];
    roundRect(ctx, p.x, screenY, p.w, p.h, 7);
    ctx.fill();

    // Блик
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, p.x + 4, screenY + 2, p.w - 8, 4, 3);
    ctx.fill();

    // Пружина
    if (p.type === PT.SPRING) {
      ctx.fillStyle = '#ff9900';
      ctx.fillRect(p.x + p.w/2 - 5, screenY - 12, 10, 12);
    }
  }

  // Игрок
  drawPlayer();
}

function drawPlayer() {
  const x = player.x;
  const y = player.y - cameraY;
  const scaleY = player.springAnim > 0 ? 1 + player.springAnim * 0.3 : 1;
  const scaleX = player.springAnim > 0 ? 1 - player.springAnim * 0.15 : 1;

  ctx.save();
  ctx.translate(x + PLAYER_W / 2, y + PLAYER_H);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-(PLAYER_W / 2), -PLAYER_H);

  // Тело
  ctx.fillStyle = CLR.player;
  roundRect(ctx, 0, 0, PLAYER_W, PLAYER_H, 10);
  ctx.fill();

  // Тень под персонажем
  ctx.fillStyle = 'rgba(78,255,176,0.15)';
  ctx.beginPath();
  ctx.ellipse(PLAYER_W/2, PLAYER_H + 4, PLAYER_W/2, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Глаза
  const eyeOffX = player.facingRight ? 5 : -5;
  ctx.fillStyle = CLR.eye;
  // левый глаз
  ctx.beginPath();
  ctx.arc(PLAYER_W/2 - 8 + eyeOffX, 14, 4, 0, Math.PI * 2);
  ctx.fill();
  // правый глаз
  ctx.beginPath();
  ctx.arc(PLAYER_W/2 + 2 + eyeOffX, 14, 4, 0, Math.PI * 2);
  ctx.fill();
  // блик
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(PLAYER_W/2 - 7 + eyeOffX, 12, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(PLAYER_W/2 + 3 + eyeOffX, 12, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Рот
  ctx.strokeStyle = CLR.eye;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(PLAYER_W/2 + eyeOffX, 22, 6, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Ноги (прыгают)
  const legBounce = Math.sin(Date.now() / 120) * 3;
  ctx.fillStyle = '#2ecc71';
  ctx.fillRect(4,  PLAYER_H - 6 + (player.vy < 0 ? -2 : legBounce), 10, 10);
  ctx.fillRect(PLAYER_W - 14, PLAYER_H - 6 + (player.vy < 0 ? 2 : -legBounce), 10, 10);

  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// ──────────────────────────────────────────────
//  Игровой цикл
// ──────────────────────────────────────────────
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// ──────────────────────────────────────────────
//  Переключение экранов
// ──────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.getElementById('mobile-controls').style.display = name === 'game' ? 'flex' : 'none';
}

function startGame() {
  state = 'game';
  initGame();
  showScreen('game');
}

function endGame() {
  state = 'gameover';
  const isNew = updateBest(score);
  document.getElementById('final-score').textContent = score;
  document.getElementById('final-best').textContent  = bestScore;
  document.getElementById('new-record-badge').classList.toggle('hidden', !isNew);

  // Отправка счёта в Telegram
  if (tg) {
    tg.sendData(JSON.stringify({ score, best: bestScore }));
  }

  showScreen('gameover');
}

function goToMenu() {
  state = 'start';
  document.getElementById('best-score-display').textContent = bestScore;
  showScreen('start');
}

// ──────────────────────────────────────────────
//  Управление — клавиатура
// ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') leftPressed  = true;
  if (e.key === 'ArrowRight' || e.key === 'd') rightPressed = true;
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') leftPressed  = false;
  if (e.key === 'ArrowRight' || e.key === 'd') rightPressed = false;
});

// ──────────────────────────────────────────────
//  Управление — мобильные кнопки
// ──────────────────────────────────────────────
const btnLeft  = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');

function hold(btn, setter) {
  btn.addEventListener('touchstart',  e => { e.preventDefault(); setter(true);  }, { passive: false });
  btn.addEventListener('touchend',    e => { e.preventDefault(); setter(false); }, { passive: false });
  btn.addEventListener('touchcancel', e => { e.preventDefault(); setter(false); }, { passive: false });
  btn.addEventListener('mousedown', () => setter(true));
  btn.addEventListener('mouseup',   () => setter(false));
}
hold(btnLeft,  v => leftPressed  = v);
hold(btnRight, v => rightPressed = v);

// ──────────────────────────────────────────────
//  Управление — акселерометр
// ──────────────────────────────────────────────
if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
  // iOS 13+
  document.getElementById('btn-start').addEventListener('click', () => {
    DeviceMotionEvent.requestPermission().catch(() => {});
  });
}

window.addEventListener('deviceorientation', e => {
  if (e.gamma !== null) {
    tiltX = Math.max(-1, Math.min(1, e.gamma / 25));
  }
});

// ──────────────────────────────────────────────
//  Кнопки UI
// ──────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click',   startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click',    goToMenu);

// ──────────────────────────────────────────────
//  Старт
// ──────────────────────────────────────────────
document.getElementById('best-score-display').textContent = bestScore;
document.getElementById('mobile-controls').style.display  = 'none';
showScreen('start');
loop();

// Хранилище в Google-таблице: состояние разговоров бота, список дистанций и все регламенты.
// Таблица доступна через её скрипт (google-script.gs), развёрнутый как веб-приложение.
// Ссылка и секрет лежат в sheets.json рядом (в GitHub не публикуется):
//   { "url": "https://script.google.com/macros/s/.../exec", "secret": "..." }
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = process.env.REGLAMENT_SHEETS_FILE || path.join(__dirname, "sheets.json");
const { url, secret } = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));

async function call(action, params) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ secret, action }, params)),
        redirect: "follow",
      });
      const j = JSON.parse(await res.text());
      if (!j.ok) throw new Error(action + ": " + j.error);
      return j;
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
}

const kmText = lens => lens.map(n => String(n).replace(".", ",")).join(" / ");
const parseLens = s => String(s).split("/").map(x => parseFloat(x.trim().replace(",", ".")));

// Создаёт листы и, если лист «Дистанции» пуст, заполняет его стандартным списком.
async function init(R) {
  const defaults = [];
  R.SPORTS.forEach(sp => sp.distances.forEach(([name, lens]) => defaults.push([sp.name, name, kmText(lens)])));
  await call("setup", { defaults });
}

// Читает список дистанций из таблицы и подставляет его в генератор.
async function loadCatalog(R) {
  const { rows } = await call("catalog");
  const bySport = {};
  const skipped = [];
  rows.forEach(([sportName, name, lensText], i) => {
    const sp = R.SPORTS.find(s => s.name.toLowerCase() === String(sportName).trim().toLowerCase());
    const lens = parseLens(lensText);
    if (!sp || lens.length !== sp.segs.length || lens.some(n => !(n > 0))) { skipped.push(i + 2); return; }
    (bySport[sp.id] = bySport[sp.id] || []).push([String(name).trim(), lens]);
  });
  R.SPORTS.forEach(sp => { sp.distances = bySport[sp.id] || []; });
  return { count: rows.length - skipped.length, skipped };
}

// Состояние разговора записывается в таблицу после каждого шага.
// Запись идёт в фоне (по очереди для каждого чата), чтобы бот отвечал сразу, не дожидаясь Google.
// После перезапуска бот читает состояние из таблицы.
const cache = new Map();
const queues = new Map();
function enqueue(chatId, job) {
  const prev = queues.get(chatId) || Promise.resolve();
  const next = prev.then(job).catch(e => console.log(new Date().toISOString(), "Не удалось записать в таблицу:", e.message));
  queues.set(chatId, next);
  return next;
}
async function loadState(chatId) {
  if (!cache.has(chatId)) cache.set(chatId, (await call("getState", { chatId })).state);
  const st = cache.get(chatId);
  return st ? JSON.parse(JSON.stringify(st)) : null;
}
function saveState(chatId, state) {
  const copy = JSON.parse(JSON.stringify(state));
  cache.set(chatId, copy);
  enqueue(chatId, () => call("saveState", { chatId, state: copy }));
}
function deleteState(chatId) {
  cache.set(chatId, null);
  enqueue(chatId, () => call("deleteState", { chatId }));
}
// Дождаться, пока все фоновые записи уйдут в таблицу.
const flush = () => Promise.all([...queues.values()]);

// r: { source, user, date, title, sports, distances, startTime, fileName, text }
async function saveReglament(r) { await call("addReglament", { row: r }); }

module.exports = { init, loadCatalog, loadState, saveState, deleteState, saveReglament, flush };

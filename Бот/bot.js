// Telegram-бот генератора регламентов.
// Ключ бота лежит в token.txt, ссылка на таблицу — в sheets.json (оба в GitHub не публикуются).
// Список дистанций, состояние разговоров и все регламенты хранятся в Google-таблице (см. sheets.js).
// Запуск: node bot.js
const fs = require("fs");
const path = require("path");
// Путь к генератору можно переопределить (так делает автозапуск, которому macOS не даёт читать «Документы»).
const R = require(process.env.REGLAMENT_GENERATOR || "../Генератор/generator.js");
const db = require("./sheets.js");

const TOKEN = fs.readFileSync(path.join(__dirname, "token.txt"), "utf8").trim();
const API = "https://api.telegram.org/bot" + TOKEN + "/";

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function tg(method, params) {
  const res = await fetch(API + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(method + ": " + j.description);
  return j.result;
}

async function sendDocument(chatId, fileName, text, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("document", new Blob([text], { type: "text/plain;charset=utf-8" }), fileName);
  const res = await fetch(API + "sendDocument", { method: "POST", body: form });
  const j = await res.json();
  if (!j.ok) throw new Error("sendDocument: " + j.description);
}

// ---------- Состояние разговора (хранится в базе) ----------
// sel: { "вид:номер": { sportId, dist } }, custom: { вид: [дистанции] }, wait: чего ждём от пользователя
const newState = () => ({ sel: {}, custom: {}, wait: null });
async function loadState(chatId) { return (await db.loadState(chatId)) || newState(); }
const distancesOf = (st, sp) => R.presetDistances(sp).concat(st.custom[sp.id] || []);
const selCount = st => Object.keys(st.sel).length;

// ---------- Клавиатуры ----------
function sportsKeyboard(st) {
  const rows = [];
  for (let i = 0; i < R.SPORTS.length; i += 2) {
    rows.push(R.SPORTS.slice(i, i + 2).map(sp => {
      const n = Object.keys(st.sel).filter(k => k.startsWith(sp.id + ":")).length;
      return { text: sp.name + (n ? " (" + n + ")" : ""), callback_data: "sp:" + sp.id };
    }));
  }
  if (selCount(st)) rows.push([{ text: "✅ Дальше: указать дату", callback_data: "next" }]);
  return { inline_keyboard: rows };
}
function sportsText(st) {
  if (!selCount(st)) return "Выберите вид спорта:";
  const list = Object.values(st.sel).map(it => "• " + R.sportById(it.sportId).name + ", " + R.distLabel(R.sportById(it.sportId), it.dist));
  return "Выбрано:\n" + list.join("\n") + "\n\nМожно добавить ещё или нажать «Дальше».";
}
function distKeyboard(st, sp) {
  const rows = distancesOf(st, sp).map((d, i) => {
    const on = (sp.id + ":" + i) in st.sel;
    return [{ text: (on ? "✅ " : "▫️ ") + R.distLabel(sp, d), callback_data: "d:" + sp.id + ":" + i }];
  });
  rows.push([{ text: "➕ Своя дистанция", callback_data: "cu:" + sp.id }]);
  rows.push([{ text: "⬅️ К видам спорта", callback_data: "back" }]);
  return { inline_keyboard: rows };
}
const skipKeyboard = { inline_keyboard: [[{ text: "Пропустить", callback_data: "skip" }]] };

// ---------- Шаги ----------
async function showSports(chatId, st, editId) {
  if (editId) return tg("editMessageText", { chat_id: chatId, message_id: editId, text: sportsText(st), reply_markup: sportsKeyboard(st) });
  return tg("sendMessage", { chat_id: chatId, text: sportsText(st), reply_markup: sportsKeyboard(st) });
}
async function showDistances(chatId, st, sp, editId) {
  const text = sp.name + ": отметьте дистанции (можно несколько).";
  if (editId) return tg("editMessageText", { chat_id: chatId, message_id: editId, text, reply_markup: distKeyboard(st, sp) });
  return tg("sendMessage", { chat_id: chatId, text, reply_markup: distKeyboard(st, sp) });
}

async function start(chatId) {
  const st = newState();
  db.saveState(chatId, st);
  await tg("sendMessage", { chat_id: chatId,
    text: "Привет! Я составлю регламент и тайминг спортивного мероприятия.\n\nВыберите виды спорта и дистанции, потом укажите дату, и я пришлю готовый файл." });
  await showSports(chatId, st);
}

function parseDate(s) {
  const m = s.trim().match(/^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{2}|\d{4})$/);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function parseCustom(sp, s) {
  const [nums, ...rest] = s.split(",");
  const lens = nums.split("/").map(x => parseFloat(x.trim().replace(",", ".")));
  if (lens.length !== sp.segs.length || lens.some(n => !(n > 0))) return null;
  return { name: rest.join(",").trim() || "Своя дистанция", lens };
}

async function finish(chatId, st, from) {
  const params = { date: st.date, title: st.title, items: Object.values(st.sel) };
  const { text, fileName } = R.buildReglament(params);
  await sendDocument(chatId, fileName + ".txt", text, "Готово! Проверьте места, отмеченные [указать].");
  db.deleteState(chatId);
  const items = Object.values(st.sel);
  const user = from ? (from.username ? "@" + from.username : [from.first_name, from.last_name].filter(Boolean).join(" ")) : "";
  try {
    await db.saveReglament({
      source: "Telegram-бот", user, date: st.date, title: st.title || "Спортивное мероприятие",
      sports: [...new Set(items.map(it => R.sportById(it.sportId).name))].join(", "),
      distances: items.map(it => R.sportById(it.sportId).name + ": " + R.distLabel(R.sportById(it.sportId), it.dist)).join("\n"),
      startTime: "08:00", fileName: fileName + ".txt", text });
    await tg("sendMessage", { chat_id: chatId, text: "Регламент записан в таблицу. Чтобы составить новый, отправьте /new" });
  } catch (e) {
    log("Не удалось записать регламент в таблицу:", e.message);
    await tg("sendMessage", { chat_id: chatId, text: "Файл готов, но записать его в таблицу не получилось. Чтобы составить новый регламент, отправьте /new" });
  }
}

function customHint(sp) {
  if (sp.segs.length === 1) return "Напишите длину в километрах, например: 7\nМожно с названием через запятую: 7, Забег партнёров";
  const names = sp.segs.map(s => R.SEG[s].name).join(" / ");
  const example = sp.segs.map((s, i) => [1, 30, 7][i] || 5).join(" / ");
  return "Напишите длину этапов в километрах через «/» (" + names + "), например: " + example + "\nМожно с названием через запятую: " + example + ", Мой формат";
}

// ---------- Обработка событий ----------
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (text === "/start" || text === "/new") return start(chatId);
  const st = await loadState(chatId);

  if (st.wait && st.wait.startsWith("custom:")) {
    const sp = R.sportById(st.wait.slice(7));
    const d = parseCustom(sp, text);
    if (!d) return tg("sendMessage", { chat_id: chatId, text: "Не понял. " + customHint(sp) });
    (st.custom[sp.id] = st.custom[sp.id] || []).push(d);
    const idx = distancesOf(st, sp).length - 1;
    st.sel[sp.id + ":" + idx] = { sportId: sp.id, dist: d };
    st.wait = null;
    db.saveState(chatId, st);
    return showDistances(chatId, st, sp);
  }
  if (st.wait === "date") {
    const date = parseDate(text);
    if (!date) return tg("sendMessage", { chat_id: chatId, text: "Напишите дату в виде ДД.ММ.ГГГГ, например 12.06.2027" });
    st.date = date;
    st.wait = "title";
    db.saveState(chatId, st);
    return tg("sendMessage", { chat_id: chatId, text: "Как называется мероприятие? Напишите название или нажмите «Пропустить».", reply_markup: skipKeyboard });
  }
  if (st.wait === "title") {
    st.title = text;
    return finish(chatId, st, msg.from);
  }
  return start(chatId);
}

async function onCallback(q) {
  const chatId = q.message.chat.id, msgId = q.message.message_id, data = q.data || "";
  await tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  const st = await loadState(chatId);
  const [kind, a, b] = data.split(":");
  if (kind === "sp") return showDistances(chatId, st, R.sportById(a), msgId);
  if (kind === "back") return showSports(chatId, st, msgId);
  if (kind === "d") {
    const sp = R.sportById(a), key = a + ":" + b;
    if (key in st.sel) delete st.sel[key];
    else st.sel[key] = { sportId: a, dist: distancesOf(st, sp)[+b] };
    db.saveState(chatId, st);
    return showDistances(chatId, st, sp, msgId);
  }
  if (kind === "cu") {
    st.wait = "custom:" + a;
    db.saveState(chatId, st);
    return tg("sendMessage", { chat_id: chatId, text: R.sportById(a).name + ", своя дистанция.\n" + customHint(R.sportById(a)) });
  }
  if (kind === "next") {
    if (!selCount(st)) return showSports(chatId, st, msgId);
    st.wait = "date";
    db.saveState(chatId, st);
    return tg("sendMessage", { chat_id: chatId, text: "Когда мероприятие? Напишите дату, например 12.06.2027" });
  }
  if (kind === "skip" && st.wait === "title") return finish(chatId, st, q.from);
}

// ---------- Основной цикл ----------
async function main() {
  await db.init(R);
  const cat = await db.loadCatalog(R);
  log("Дистанций из таблицы: " + cat.count + (cat.skipped.length ? ", пропущены строки: " + cat.skipped.join(", ") : ""));
  const me = await tg("getMe");
  log("Бот запущен: @" + me.username);
  await tg("setMyCommands", { commands: [{ command: "new", description: "Новый регламент" }] }).catch(() => {});
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        } catch (e) { log("Ошибка обработки:", e.message); }
      }
    } catch (e) {
      log("Нет связи с Telegram:", e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

if (require.main === module) main().catch(e => { log("Не удалось запустить бота:", e.message); process.exit(1); });
module.exports = { onMessage, onCallback };

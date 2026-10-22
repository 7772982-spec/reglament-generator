// Telegram-бот генератора регламентов.
// Ключ бота лежит в token.txt рядом (в GitHub не публикуется).
// Запуск: node bot.js
const fs = require("fs");
const path = require("path");
const R = require("../Генератор/generator.js");

const TOKEN = fs.readFileSync(path.join(__dirname, "token.txt"), "utf8").trim();
const API = "https://api.telegram.org/bot" + TOKEN + "/";
const OUT_DIR = path.join(__dirname, "..", "Готовые регламенты");

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

// ---------- Состояние разговора с каждым пользователем ----------
const chats = new Map();
function state(chatId) {
  if (!chats.has(chatId)) chats.set(chatId, { sel: new Map(), custom: {}, wait: null });
  return chats.get(chatId);
}
const distancesOf = (st, sp) => R.presetDistances(sp).concat(st.custom[sp.id] || []);

// ---------- Клавиатуры ----------
function sportsKeyboard(st) {
  const rows = [];
  for (let i = 0; i < R.SPORTS.length; i += 2) {
    rows.push(R.SPORTS.slice(i, i + 2).map(sp => {
      const n = [...st.sel.keys()].filter(k => k.startsWith(sp.id + ":")).length;
      return { text: sp.name + (n ? " (" + n + ")" : ""), callback_data: "sp:" + sp.id };
    }));
  }
  if (st.sel.size) rows.push([{ text: "✅ Дальше: указать дату", callback_data: "next" }]);
  return { inline_keyboard: rows };
}
function sportsText(st) {
  if (!st.sel.size) return "Выберите вид спорта:";
  const list = [...st.sel.values()].map(it => "• " + R.sportById(it.sportId).name + ", " + R.distLabel(R.sportById(it.sportId), it.dist));
  return "Выбрано:\n" + list.join("\n") + "\n\nМожно добавить ещё или нажать «Дальше».";
}
function distKeyboard(st, sp) {
  const rows = distancesOf(st, sp).map((d, i) => {
    const on = st.sel.has(sp.id + ":" + i);
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
  chats.delete(chatId);
  await tg("sendMessage", { chat_id: chatId,
    text: "Привет! Я составлю регламент и тайминг спортивного мероприятия.\n\nВыберите виды спорта и дистанции, потом укажите дату, и я пришлю готовый файл." });
  await showSports(chatId, state(chatId));
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

async function finish(chatId, st) {
  const { text, fileName } = R.buildReglament({
    date: st.date, title: st.title,
    items: [...st.sel.values()],
  });
  // Копия — в папку «Готовые регламенты» на компьютере.
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const safe = fileName.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").slice(0, 120);
    let p = path.join(OUT_DIR, safe + ".txt"), n = 2;
    while (fs.existsSync(p)) p = path.join(OUT_DIR, safe + " (" + n++ + ").txt");
    fs.writeFileSync(p, text, "utf8");
  } catch (e) { log("Не удалось сохранить копию:", e.message); }
  await sendDocument(chatId, fileName + ".txt", text, "Готово! Проверьте места, отмеченные [указать].");
  await tg("sendMessage", { chat_id: chatId, text: "Чтобы составить новый регламент, отправьте /new" });
  chats.delete(chatId);
}

// ---------- Обработка событий ----------
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (text === "/start" || text === "/new") return start(chatId);
  const st = state(chatId);

  if (st.wait && st.wait.startsWith("custom:")) {
    const sp = R.sportById(st.wait.slice(7));
    const d = parseCustom(sp, text);
    if (!d) {
      return tg("sendMessage", { chat_id: chatId, text: "Не понял. " + customHint(sp) });
    }
    (st.custom[sp.id] = st.custom[sp.id] || []).push(d);
    const idx = distancesOf(st, sp).length - 1;
    st.sel.set(sp.id + ":" + idx, { sportId: sp.id, dist: d });
    st.wait = null;
    return showDistances(chatId, st, sp);
  }
  if (st.wait === "date") {
    const date = parseDate(text);
    if (!date) return tg("sendMessage", { chat_id: chatId, text: "Напишите дату в виде ДД.ММ.ГГГГ, например 12.06.2027" });
    st.date = date;
    st.wait = "title";
    return tg("sendMessage", { chat_id: chatId, text: "Как называется мероприятие? Напишите название или нажмите «Пропустить».", reply_markup: skipKeyboard });
  }
  if (st.wait === "title") {
    st.title = text;
    st.wait = null;
    return finish(chatId, st);
  }
  return start(chatId);
}

function customHint(sp) {
  if (sp.segs.length === 1) return "Напишите длину в километрах, например: 7\nМожно с названием через запятую: 7, Забег партнёров";
  const names = sp.segs.map(s => R.SEG[s].name).join(" / ");
  const example = sp.segs.map((s, i) => [1, 30, 7][i] || 5).join(" / ");
  return "Напишите длину этапов в километрах через «/» (" + names + "), например: " + example + "\nМожно с названием через запятую: " + example + ", Мой формат";
}

async function onCallback(q) {
  const chatId = q.message.chat.id, msgId = q.message.message_id, data = q.data || "";
  const st = state(chatId);
  await tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  const [kind, a, b] = data.split(":");
  if (kind === "sp") return showDistances(chatId, st, R.sportById(a), msgId);
  if (kind === "back") return showSports(chatId, st, msgId);
  if (kind === "d") {
    const sp = R.sportById(a), key = a + ":" + b;
    if (st.sel.has(key)) st.sel.delete(key);
    else st.sel.set(key, { sportId: a, dist: distancesOf(st, sp)[+b] });
    return showDistances(chatId, st, sp, msgId);
  }
  if (kind === "cu") {
    st.wait = "custom:" + a;
    return tg("sendMessage", { chat_id: chatId, text: R.sportById(a).name + ", своя дистанция.\n" + customHint(R.sportById(a)) });
  }
  if (kind === "next") {
    if (!st.sel.size) return showSports(chatId, st, msgId);
    st.wait = "date";
    return tg("sendMessage", { chat_id: chatId, text: "Когда мероприятие? Напишите дату, например 12.06.2027" });
  }
  if (kind === "skip" && st.wait === "title") {
    st.wait = null;
    return finish(chatId, st);
  }
}

// ---------- Основной цикл ----------
async function main() {
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

main().catch(e => { log("Не удалось запустить бота:", e.message); process.exit(1); });

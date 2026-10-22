// Скрипт Google-таблицы для бота @reglamentgeneratorbot.
// Вставляется в таблицу: Расширения → Apps Script. Разворачивается как веб-приложение.
// Бот обращается к нему по ссылке веб-приложения и пишет/читает листы этой таблицы.
// Защита: при первом подключении бот передаёт свой секретный ключ, скрипт запоминает его
// (в свойствах скрипта) и дальше отвечает только на запросы с этим ключом.
// В самом коде секретов нет, поэтому его можно спокойно копировать.

const SHEETS = {
  reglaments: { name: "Регламенты", header: ["Создано", "Источник", "Пользователь", "Дата мероприятия", "Название",
                                              "Виды спорта", "Дистанции", "Первый старт", "Файл", "Текст регламента"] },
  catalog:    { name: "Дистанции",  header: ["Вид спорта", "Название дистанции", "Длины этапов, км"] },
  state:      { name: "Состояние бота", header: ["Чат", "Состояние", "Обновлено"] },
};

function sheet_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const def = SHEETS[key];
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.appendRow(def.header);
    sh.getRange(1, 1, 1, def.header.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowsOf_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function findChatRow_(sh, chatId) {
  const rows = rowsOf_(sh);
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(chatId)) return i + 2;
  return 0;
}

function handle_(req) {
  switch (req.action) {
    case "setup": {
      Object.keys(SHEETS).forEach(sheet_);
      const cat = sheet_("catalog");
      if (cat.getLastRow() < 2 && req.defaults && req.defaults.length) {
        cat.getRange(2, 1, req.defaults.length, 3).setValues(req.defaults);
      }
      const first = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      if (first.getName() !== SHEETS.reglaments.name && first.getLastRow() === 0) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
      return { ok: true };
    }
    case "catalog":
      return { ok: true, rows: rowsOf_(sheet_("catalog")).map(r => r.map(String)) };
    case "getState": {
      const sh = sheet_("state"), row = findChatRow_(sh, req.chatId);
      return { ok: true, state: row ? JSON.parse(sh.getRange(row, 2).getValue()) : null };
    }
    case "saveState": {
      const sh = sheet_("state"), row = findChatRow_(sh, req.chatId);
      const values = [[String(req.chatId), JSON.stringify(req.state), new Date()]];
      if (row) sh.getRange(row, 1, 1, 3).setValues(values); else sh.appendRow(values[0]);
      return { ok: true };
    }
    case "deleteState": {
      const sh = sheet_("state"), row = findChatRow_(sh, req.chatId);
      if (row) sh.deleteRow(row);
      return { ok: true };
    }
    case "addReglament": {
      const r = req.row;
      sheet_("reglaments").appendRow([new Date(), r.source, r.user || "", r.date || "", r.title || "",
                                      r.sports || "", r.distances || "", r.startTime || "", r.fileName, r.text]);
      return { ok: true };
    }
  }
  return { ok: false, error: "unknown action" };
}

function doPost(e) {
  let out;
  const lock = LockService.getScriptLock();
  try {
    const req = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    let secret = props.getProperty("SECRET");
    if (!secret && req.action === "setup" && req.secret && String(req.secret).length >= 32) {
      props.setProperty("SECRET", String(req.secret));
      secret = String(req.secret);
    }
    if (!secret || req.secret !== secret) out = { ok: false, error: "forbidden" };
    else { lock.waitLock(20000); out = handle_(req); }
  } catch (err) {
    out = { ok: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

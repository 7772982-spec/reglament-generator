// Сохраняет регламент из локального генератора (страница «Открыть генератор») в Google-таблицу.
// Получает JSON { name, text } на вход; вызывается из Генератор/server.py.
const sheets = require("./sheets.js");

let input = "";
process.stdin.on("data", c => (input += c));
process.stdin.on("end", async () => {
  try {
    const { name, text } = JSON.parse(input);
    const m = /^Регламент — (.*) — (\d{4}-\d{2}-\d{2})$/.exec(name || "");
    // Дистанции и первый старт берём из текста регламента (раздел 4).
    const dist = (text.match(/^4\.\d+\. .*Старт в .*$/gm) || []).map(l => l.replace(/^4\.\d+\. /, "").replace(/\. Старт в .*$/, ""));
    const start = (text.match(/Первый старт — в (\d{2}:\d{2})/) || [])[1] || "";
    await sheets.saveReglament({
      source: "Генератор на компьютере", user: "", title: m ? m[1] : "", date: m ? m[2] : "",
      sports: [...new Set(dist.map(d => d.split(",")[0]))].join(", "), distances: dist.join("\n"),
      startTime: start, fileName: (name || "Регламент") + ".txt", text });
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
});

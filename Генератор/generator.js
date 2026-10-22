// Общая логика генератора регламентов: её используют и страница, и Telegram-бот.
(function (root) {
  // pace — минут на 1 км для расчёта лимита времени.
  const SEG = {
    swim: { name: "плавание",  pace: 37 },
    bike: { name: "велосипед", pace: 60 / 22 },
    run:  { name: "бег",       pace: 8.5 },
    trail:{ name: "бег",       pace: 15 },
    ski:  { name: "лыжи",      pace: 10 },
  };
  const SPORTS = [
    { id: "tri", name: "Триатлон", segs: ["swim", "bike", "run"], transition: true, distances: [
      ["Суперспринт", [0.4, 10, 2.5]], ["Спринт", [0.75, 20, 5]], ["Олимпийская", [1.5, 40, 10]],
      ["Половинная (113 км)", [1.9, 90, 21.1]], ["Полная (226 км)", [3.8, 180, 42.2]] ] },
    { id: "run", name: "Бег", segs: ["run"], distances: [
      ["Детский забег", [1]], ["", [3]], ["", [5]], ["", [10]], ["Полумарафон", [21.1]], ["Марафон", [42.2]] ] },
    { id: "swim", name: "Плавание на открытой воде", segs: ["swim"], distances: [
      ["", [1]], ["", [3]], ["", [5]], ["", [10]] ] },
    { id: "duath", name: "Дуатлон", segs: ["run", "bike", "run"], transition: true, distances: [
      ["Спринт", [5, 20, 2.5]], ["Стандарт", [10, 40, 5]] ] },
    { id: "aqua", name: "Акватлон", segs: ["swim", "run"], transition: true, distances: [
      ["Спринт", [0.75, 5]], ["Стандарт", [1, 5]] ] },
    { id: "bike", name: "Велогонка", segs: ["bike"], distances: [
      ["", [25]], ["", [50]], ["", [100]] ] },
    { id: "trail", name: "Трейл", segs: ["trail"], distances: [
      ["", [10]], ["", [25]], ["", [50]] ] },
    { id: "ski", name: "Лыжные гонки", segs: ["ski"], distances: [
      ["", [5]], ["", [10]], ["", [30]], ["", [50]] ] },
  ];

  const sportById = id => SPORTS.find(s => s.id === id);
  const presetDistances = sp => sp.distances.map(([name, lens]) => ({ name, lens }));

  const km = n => String(Math.round(n * 100) / 100).replace(".", ",") + " км";
  const kmShort = n => String(Math.round(n * 100) / 100).replace(".", ",");
  function distLabel(sport, d) {
    const lens = d.lens;
    const len = lens.length === 1 ? km(lens[0])
      : lens.map(kmShort).join(" / ") + " км (" + sport.segs.map(s => SEG[s].name).join(" / ") + ")";
    return d.name ? d.name + " — " + len : len;
  }

  // ---------- Время и даты ----------
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const WEEKDAYS = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
  function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(dt, n) { const r = new Date(dt); r.setDate(r.getDate() + n); return r; }
  function fmtDate(dt) { return dt.getDate() + " " + MONTHS[dt.getMonth()] + " " + dt.getFullYear() + " г."; }
  function fmtDateLong(dt) { return fmtDate(dt) + " (" + WEEKDAYS[dt.getDay()] + ")"; }
  function hhmm(min) {
    const day = Math.floor(min / 1440), m = ((min % 1440) + 1440) % 1440;
    const t = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    return day > 0 ? t + " (+" + day + " д.)" : t;
  }
  function dur(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + " ч" : "") + (h && m ? " " : "") + (m ? m + " мин" : "");
  }
  const ceil15 = m => Math.ceil(m / 15) * 15;
  function limitFor(sp, d) {
    let t = sp.segs.reduce((a, s, i) => a + SEG[s].pace * d.lens[i], 0);
    t += (sp.segs.length - 1) * 10; // транзиты
    return Math.max(30, ceil15(t));
  }

  // ---------- Генерация текста ----------
  // params: { date: "ГГГГ-ММ-ДД", startTime: "08:00", interval: 30, title, place, org, contacts,
  //           items: [{ sportId, dist: { name, lens } }] }
  function buildReglament(params) {
    const TBD = "[указать]";
    const date = parseDate(params.date);
    const title = (params.title || "").trim() || "Спортивное мероприятие";
    const place = (params.place || "").trim() || TBD;
    const org = (params.org || "").trim() || TBD;
    const contacts = (params.contacts || "").trim() || TBD;
    const [sh, sm] = (params.startTime || "08:00").split(":").map(Number);
    const T0 = sh * 60 + sm;
    const interval = Math.max(0, parseInt(params.interval == null ? 30 : params.interval, 10) || 0);

    // Длинные дистанции стартуют первыми.
    const races = params.items.map(({ sportId, dist }) => {
      const sport = sportById(sportId);
      return { sport, dist, limit: limitFor(sport, dist) };
    }).sort((a, b) => b.limit - a.limit);
    races.forEach((r, i) => {
      r.start = T0 + i * interval;
      r.close = r.start + r.limit;
      r.award = r.start + ceil15(r.limit * 0.55) + 30;
      r.label = r.sport.name + ", " + distLabel(r.sport, r.dist);
    });
    const sportNames = [...new Set(races.map(r => r.sport.name.toLowerCase()))];
    const hasTransition = races.some(r => r.sport.transition);
    const hasSwim = races.some(r => r.sport.segs.includes("swim"));
    const hasBike = races.some(r => r.sport.segs.includes("bike"));
    const lastClose = Math.max(...races.map(r => r.close));

    // Тайминг дня старта.
    const ev = [];
    ev.push([T0 - 120, "Открытие стартового городка"]);
    ev.push([T0 - 120, "Выдача стартовых пакетов в день старта (до " + hhmm(T0 - 45) + ")"]);
    if (hasTransition) ev.push([T0 - 90, "Открытие транзитной зоны, регистрация велосипедов и экипировки (до " + hhmm(T0 - 20) + ")"]);
    if (hasSwim) ev.push([T0 - 30, "Разминка в воде (до " + hhmm(T0 - 10) + ")"]);
    ev.push([T0 - 15, "Торжественное открытие, предстартовый брифинг"]);
    races.forEach(r => {
      ev.push([r.start, "СТАРТ: " + r.label]);
      ev.push([r.close, "Закрытие финиша: " + r.label]);
      ev.push([r.award, "Награждение: " + r.label]);
    });
    if (hasTransition) ev.push([lastClose + 15, "Окончание выдачи велосипедов из транзитной зоны"]);
    ev.push([lastClose + 30, "Закрытие мероприятия"]);
    ev.sort((a, b) => a[0] - b[0]);

    const L = [];
    const p = s => L.push(s);
    const cap = s => s.replace(/^./, c => c.toUpperCase());
    p("РЕГЛАМЕНТ");
    p(title.toUpperCase());
    p("");
    p("Дата: " + fmtDateLong(date));
    p("Место проведения: " + place);
    p("Организатор: " + org);
    p("");
    p("1. ОБЩИЕ ПОЛОЖЕНИЯ");
    p("1.1. Мероприятие «" + title + "» (далее — Мероприятие) проводится с целью популяризации массового спорта и здорового образа жизни, а также развития видов спорта: " + sportNames.join(", ") + ".");
    p("1.2. Настоящий регламент определяет порядок проведения Мероприятия, дистанции, программу и тайминг.");
    p("");
    p("2. ОРГАНИЗАТОР");
    p("2.1. Организатор Мероприятия — " + org + ".");
    p("2.2. Непосредственное проведение соревнований возлагается на главную судейскую коллегию, утверждённую Организатором.");
    p("");
    p("3. ВРЕМЯ И МЕСТО ПРОВЕДЕНИЯ");
    p("3.1. Дата проведения: " + fmtDateLong(date) + ".");
    p("3.2. Место проведения: " + place + ".");
    p("3.3. Первый старт — в " + hhmm(T0) + ". Подробный тайминг приведён в разделе 7.");
    p("");
    p("4. ДИСТАНЦИИ И ЛИМИТЫ ВРЕМЕНИ");
    races.forEach((r, i) => {
      p("4." + (i + 1) + ". " + r.label + ". Старт в " + hhmm(r.start) + ", лимит времени — " + dur(r.limit) + " (финиш закрывается в " + hhmm(r.close) + ").");
    });
    p("4." + (races.length + 1) + ". Схемы трасс публикуются Организатором не позднее чем за 7 дней до старта.");
    p("");
    p("5. УЧАСТНИКИ");
    p("5.1. К участию допускаются лица, достигшие 18 лет на день старта. Участники от 14 до 17 лет допускаются на дистанции до 10 км при наличии письменного согласия законного представителя.");
    p("5.2. Каждый участник обязан предоставить медицинскую справку о допуске к соревнованиям по выбранному виду спорта, выданную не ранее чем за 6 месяцев до старта.");
    p("5.3. Участник несёт ответственность за соответствие своей подготовки выбранной дистанции.");
    p("");
    p("6. РЕГИСТРАЦИЯ И СТАРТОВЫЕ ПАКЕТЫ");
    p("6.1. Регистрация участников проводится на сайте Организатора и закрывается за 3 дня до старта или при достижении лимита участников.");
    p("6.2. Стартовые пакеты выдаются " + fmtDate(addDays(date, -1)) + " с 12:00 до 20:00, а также в день старта с " + hhmm(T0 - 120) + " до " + hhmm(T0 - 45) + " по адресу: " + TBD + ".");
    p("6.3. Для получения стартового пакета необходимо предъявить документ, удостоверяющий личность, и медицинскую справку.");
    p("6.4. В стартовый пакет входят: стартовый номер, чип хронометража" + (hasSwim ? ", шапочка для плавания" : "") + (hasBike ? ", наклейки на велосипед и шлем" : "") + ", браслет участника.");
    p("");
    p("7. ПРОГРАММА И ТАЙМИНГ");
    p("");
    p(cap(fmtDateLong(addDays(date, -1))) + " — день накануне");
    p("12:00 — Открытие выдачи стартовых пакетов (до 20:00)");
    p("18:00 — Брифинг для участников");
    p("");
    p(cap(fmtDateLong(date)) + " — день старта");
    ev.forEach(([t, text]) => p(hhmm(t) + " — " + text));
    p("");
    p("Организатор вправе вносить изменения в тайминг с уведомлением участников не позднее чем за сутки до старта.");
    p("");
    p("8. ПРАВИЛА И ОПРЕДЕЛЕНИЕ РЕЗУЛЬТАТОВ");
    p("8.1. Хронометраж — электронный, с помощью чипов. Результат участника определяется по чистому времени прохождения дистанции.");
    p("8.2. Результаты подводятся в абсолютном зачёте среди мужчин и женщин отдельно на каждой дистанции" + (hasTransition ? "; время прохождения транзитных зон входит в итоговый результат" : "") + ".");
    p("8.3. Участники, не уложившиеся в лимит времени, снимаются с дистанции и получают статус «Не финишировал» (DNF).");
    p("8.4. Предварительные результаты публикуются в день старта. Протесты принимаются главным судьёй в течение 30 минут после публикации предварительных результатов.");
    p("");
    p("9. НАГРАЖДЕНИЕ");
    p("9.1. Победители и призёры (1–3 место) абсолютного зачёта среди мужчин и женщин на каждой дистанции награждаются кубками, медалями и дипломами.");
    p("9.2. Все участники, финишировавшие в лимит времени, получают памятную медаль финишёра.");
    p("9.3. Время награждения по каждой дистанции указано в разделе 7.");
    p("");
    p("10. БЕЗОПАСНОСТЬ И МЕДИЦИНСКОЕ ОБЕСПЕЧЕНИЕ");
    p("10.1. На трассе работают медицинские бригады и судьи. Медицинский пункт расположен в зоне старта/финиша.");
    if (hasSwim) p("10.2. На плавательном этапе работают спасатели на воде. Решение о допустимости гидрокостюма принимается по температуре воды в день старта.");
    if (hasBike) p("10." + (hasSwim ? 3 : 2) + ". На велосипедном этапе использование шлема обязательно на протяжении всей дистанции.");
    p("10." + (2 + (hasSwim ? 1 : 0) + (hasBike ? 1 : 0)) + ". Участник обязан выполнять требования судей и медицинского персонала, в том числе о сходе с дистанции.");
    p("");
    p("11. КОНТАКТЫ");
    p("11.1. " + contacts);
    p("");
    p("Настоящий регламент является официальным приглашением на соревнования.");
    p("");
    p("—");
    p("Создано генератором регламентов " + fmtDate(new Date()) + " Проверьте места, отмеченные " + TBD + ", и при необходимости поправьте лимиты времени.");

    return { text: L.join("\n"), fileName: "Регламент — " + title + " — " + params.date };
  }

  const api = { SEG, SPORTS, sportById, presetDistances, distLabel, buildReglament };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Reglament = api;
})(this);

export const DOMAIN_ORDER = ["numbers", "logic", "spatial", "verbal"];

export const DOMAINS = {
  numbers: { label: "Числовые закономерности", short: "Числа" },
  logic: { label: "Логические выводы", short: "Логика" },
  spatial: { label: "Пространственное мышление", short: "Пространство" },
  verbal: { label: "Смысловые связи", short: "Смысл" },
};

const TIPS = {
  numbers:
    "В рядах сначала выпишите разности между соседними числами. Если разности сами образуют ряд, следующее число уже видно.",
  logic:
    "В условиях со словами «все» и «если… то…» отдельно отметьте, что сказано, и что из этого вывести нельзя. Обратное утверждение само не следует.",
  spatial:
    "Назовите правило вслух: поворот, сдвиг или смена заливки. Варианты смотрите только после того, как правило уже сформулировано.",
  verbal:
    "В аналогии назовите связь первой пары одним глаголом — «противоположно», «служит инструментом» — и ищите ту же связь во второй.",
};

const TONE = [
  { min: 80, key: "strong", label: "уверенно" },
  { min: 50, key: "steady", label: "с опорой" },
  { min: 0, key: "grow", label: "пока хрупко" },
];

const BANDS = [
  {
    min: 130,
    key: "high",
    title: "Очень высокий диапазон",
    detail: "Результат попал в верхнюю часть шкалы этого теста.",
  },
  {
    min: 115,
    key: "above",
    title: "Заметно выше среднего",
    detail: "Результат выше типичной середины.",
  },
  {
    min: 100,
    key: "midhigh",
    title: "Чуть выше середины",
    detail: "Результат немного выше центра шкалы.",
  },
  {
    min: 85,
    key: "mid",
    title: "Около середины",
    detail: "Результат близок к центру шкалы.",
  },
  {
    min: 0,
    key: "below",
    title: "Ниже середины",
    detail: "Результат ниже центра шкалы этого теста.",
  },
];

const QUESTIONS = [
  {
    id: "n1",
    domain: "numbers",
    weight: 2,
    prompt: "Какое число продолжает ряд?",
    visual: { type: "sequence", items: ["2", "6", "12", "20", "30", "?"] },
    options: [
      { id: "a", text: "36" },
      { id: "b", text: "48" },
      { id: "c", text: "42" },
      { id: "d", text: "40" },
    ],
    correct: "c",
    explain:
      "Шаг между числами каждый раз растёт на 2: +4, +6, +8, +10, дальше +12. 30 + 12 = 42. Тот же ряд записывается как n×(n+1): 6×7 = 42.",
  },
  {
    id: "n2",
    domain: "numbers",
    weight: 2,
    prompt: "Какое число продолжает ряд?",
    visual: { type: "sequence", items: ["4", "9", "19", "39", "79", "?"] },
    options: [
      { id: "a", text: "139" },
      { id: "b", text: "169" },
      { id: "c", text: "119" },
      { id: "d", text: "159" },
    ],
    correct: "d",
    explain:
      "Каждое число получается из предыдущего правилом «умножить на 2 и прибавить 1». 79×2 + 1 = 159.",
  },
  {
    id: "n3",
    domain: "numbers",
    weight: 1,
    prompt: "Какое число продолжает ряд?",
    visual: { type: "sequence", items: ["81", "27", "9", "3", "?"] },
    options: [
      { id: "a", text: "1" },
      { id: "b", text: "0" },
      { id: "c", text: "2" },
      { id: "d", text: "6" },
    ],
    correct: "a",
    explain: "Каждое следующее число в три раза меньше предыдущего. 3 ÷ 3 = 1.",
  },
  {
    id: "l1",
    domain: "logic",
    weight: 2,
    prompt:
      "Все архитекторы внимательны. Кирилл внимателен. Какой вывод из этого следует?",
    options: [
      { id: "a", text: "Кирилл — архитектор" },
      { id: "b", text: "Все внимательные люди — архитекторы" },
      { id: "c", text: "Нельзя заключить, архитектор ли Кирилл" },
      { id: "d", text: "Кирилл точно не архитектор" },
    ],
    correct: "c",
    explain:
      "Из «все архитекторы внимательны» не следует обратное. Внимательность Кирилла не делает его архитектором и не исключает этого.",
  },
  {
    id: "l2",
    domain: "logic",
    weight: 2,
    prompt:
      "Если сегодня среда, вечером есть тренировка. Тренировки сегодня нет. Что из этого верно?",
    options: [
      { id: "a", text: "Сегодня среда" },
      { id: "b", text: "Сегодня не среда" },
      { id: "c", text: "Тренировку перенесли на завтра" },
      { id: "d", text: "Из условия нельзя ничего заключить" },
    ],
    correct: "b",
    explain:
      "Если из среды следует тренировка, а тренировки нет, то и среда исключается. Это отрицание следствия.",
  },
  {
    id: "l3",
    domain: "logic",
    weight: 2,
    prompt:
      "В коробке только красные и синие шары. Красных больше, чем синих. Верно ли, что красных больше половины?",
    options: [
      { id: "a", text: "Да, красных больше половины" },
      { id: "b", text: "Нет, это не следует" },
      { id: "c", text: "Только если шаров чётное число" },
      { id: "d", text: "Только если синих шаров нет" },
    ],
    correct: "a",
    explain:
      "Красных строго больше, чем синих, а других шаров нет. Значит, красных больше половины всех шаров.",
  },
  {
    id: "s1",
    domain: "spatial",
    weight: 2,
    prompt: "Какая фигура стоит на месте вопросительного знака?",
    visual: { type: "matrix" },
    options: [
      { id: "a", text: "Круг, контур", glyph: "circle" },
      { id: "b", text: "Треугольник, заливка", glyph: "triangle-fill" },
      { id: "c", text: "Треугольник, контур", glyph: "triangle" },
      { id: "d", text: "Квадрат, заливка", glyph: "square-fill" },
    ],
    correct: "c",
    explain:
      "В каждой строке круг, треугольник и квадрат встречаются по одному разу, а набор сдвигается влево. Заливка чередуется по строкам: контур, заливка, снова контур. В пустой клетке — треугольник контуром.",
  },
  {
    id: "s2",
    domain: "spatial",
    weight: 1,
    prompt: "Куда смотрит следующая стрелка?",
    visual: { type: "rotation" },
    options: [
      { id: "a", text: "Вправо", glyph: "arrow-right" },
      { id: "b", text: "Вверх", glyph: "arrow-up" },
      { id: "c", text: "Вниз", glyph: "arrow-down" },
      { id: "d", text: "Вверх и вправо", glyph: "arrow-up-right" },
    ],
    correct: "b",
    explain:
      "Стрелка каждый раз поворачивается на 90° по часовой стрелке. После направления влево следующая смотрит вверх.",
  },
  {
    id: "s3",
    domain: "spatial",
    weight: 2,
    prompt: "Сколько треугольников на фигуре?",
    visual: { type: "triangles" },
    options: [
      { id: "a", text: "4" },
      { id: "b", text: "8" },
      { id: "c", text: "5" },
      { id: "d", text: "6" },
    ],
    correct: "c",
    explain:
      "Три маленьких треугольника по углам, один перевёрнутый в центре и один большой снаружи. Вместе 5.",
  },
  {
    id: "v1",
    domain: "verbal",
    weight: 1,
    prompt: "Молчание относится к звуку так же, как темнота относится к…",
    options: [
      { id: "a", text: "ночи" },
      { id: "b", text: "тени" },
      { id: "c", text: "свету" },
      { id: "d", text: "тишине" },
    ],
    correct: "c",
    explain:
      "Первая пара — противоположности. Противоположность темноты — свет.",
  },
  {
    id: "v2",
    domain: "verbal",
    weight: 1,
    prompt: "Кисть относится к художнику так же, как скальпель относится к…",
    options: [
      { id: "a", text: "пациенту" },
      { id: "b", text: "больнице" },
      { id: "c", text: "лекарству" },
      { id: "d", text: "хирургу" },
    ],
    correct: "d",
    explain:
      "Кисть — рабочий инструмент художника. Скальпель — рабочий инструмент хирурга.",
  },
  {
    id: "v3",
    domain: "verbal",
    weight: 1,
    prompt: "Какое слово здесь лишнее?",
    options: [
      { id: "a", text: "Квадрат" },
      { id: "b", text: "Треугольник" },
      { id: "c", text: "Куб" },
      { id: "d", text: "Ромб" },
    ],
    correct: "c",
    explain:
      "Квадрат, треугольник и ромб — плоские фигуры. Куб объёмный, поэтому он лишний.",
  },
];

export function publicQuestions() {
  return QUESTIONS.map((q) => ({
    id: q.id,
    domain: q.domain,
    domainLabel: DOMAINS[q.domain].short,
    prompt: q.prompt,
    visual: q.visual || null,
    options: q.options.map((o) => ({
      id: o.id,
      text: o.text,
      glyph: o.glyph || null,
    })),
  }));
}

export function bandFor(iq) {
  return BANDS.find((b) => iq >= b.min) || BANDS[BANDS.length - 1];
}

function toneFor(percent) {
  return TONE.find((t) => percent >= t.min) || TONE[TONE.length - 1];
}

function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function scoreAnswers(answers = {}) {
  const domains = {};
  for (const key of DOMAIN_ORDER) {
    domains[key] = {
      key,
      label: DOMAINS[key].label,
      short: DOMAINS[key].short,
      earned: 0,
      total: 0,
    };
  }

  let earned = 0;
  let total = 0;
  const review = [];

  for (const q of QUESTIONS) {
    total += q.weight;
    domains[q.domain].total += q.weight;
    const picked = answers[q.id] || null;
    const ok = picked === q.correct;
    if (ok) {
      earned += q.weight;
      domains[q.domain].earned += q.weight;
    }
    const chosen = q.options.find((o) => o.id === picked);
    const right = q.options.find((o) => o.id === q.correct);
    review.push({
      id: q.id,
      prompt: q.prompt,
      domainLabel: DOMAINS[q.domain].short,
      ok,
      yourAnswer: chosen ? chosen.text : "Нет ответа",
      correctAnswer: right.text,
      explain: q.explain,
    });
  }

  const domainList = DOMAIN_ORDER.map((key) => {
    const d = domains[key];
    const percent = d.total ? Math.round((d.earned / d.total) * 100) : 0;
    const tone = toneFor(percent);
    return { ...d, percent, tone: tone.key, toneLabel: tone.label };
  });

  const ratio = total ? earned / total : 0;
  const z = (ratio - 0.5) / 0.16;
  const iq = clamp(Math.round(100 + z * 15), 70, 145);
  const percentile = Math.round(normalCdf((iq - 100) / 15) * 1000) / 10;
  const band = bandFor(iq);

  return { earned, total, iq, percentile, band, domains: domainList, review };
}

export function describe(iq, band, domains) {
  const ranked = [...domains].sort((a, b) => b.percent - a.percent);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const even = best.percent - worst.percent < 20;

  const leads = {
    high: `Балл ${iq} лежит в очень высоком диапазоне этой шкалы.`,
    above: `Балл ${iq} заметно выше середины шкалы.`,
    midhigh: `Балл ${iq} чуть выше середины шкалы.`,
    mid: `Балл ${iq} близок к середине шкалы.`,
    below: `Балл ${iq} ниже середины шкалы.`,
  };

  const lead =
    (leads[band.key] || leads.mid) +
    " За 100 принят центр, 15 баллов — шаг, внутри которого обычно лежит основная часть результатов.";

  const mid = even
    ? "Четыре навыка проявились ровно, без сильного перекоса. Имеет смысл смотреть отдельные ответы: при ровном профиле ошибки точечные."
    : `Увереннее всего прошёл блок «${best.label.toLowerCase()}» — ${best.percent}% веса заданий. Больше промахов в блоке «${worst.label.toLowerCase()}» — ${worst.percent}%.`;

  const tail =
    "Это короткий срез, а не сертификат интеллекта. Другой день, другая тишина и другие задачи сдвинули бы число.";

  return {
    lead,
    mid,
    tail,
    tip: even
      ? "В разборе отметьте вопросы, где ответ дался наугад. При ровном профиле полезнее разбирать отдельные ходы, чем «подтягивать навык» целиком."
      : TIPS[worst.key],
    tipLabel: even ? "Как читать ровный профиль" : `Куда смотреть: ${worst.label.toLowerCase()}`,
  };
}

export function findQuestion(id) {
  return QUESTIONS.find((q) => q.id === id) || null;
}

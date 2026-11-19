const KEY = "lumina.session";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LETTERS = ["А", "Б", "В", "Г"];
const TITLES = {
  home: "Lumina — тест мышления",
  quiz: "Тест — Lumina",
  analyzing: "Считаем результат — Lumina",
  paywall: "Отчёт готов — Lumina",
  checkout: "Оплата — Lumina",
  result: "Ваш результат — Lumina",
};

const app = document.querySelector("#app");
const state = {
  questions: [],
  session: null,
  index: 0,
  selected: null,
  busy: false,
  error: "",
  homeError: "",
  confirmCancel: false,
  sampleChoice: null,
  draft: { name: "", email: "", card: "", expiry: "", cvc: "" },
};

let renderGen = 0;
let timers = [];
let paintedRoute = "";
let writeChain = Promise.resolve();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function rub(amount) {
  return `${amount}\u00A0₽`;
}

function ruDate(iso) {
  return new Date(iso)
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(/\s*г\.?$/, "");
}

function ruDuration(sec) {
  if (sec < 90) return `${sec}\u00A0сек`;
  const min = Math.round(sec / 60);
  const mod10 = min % 10;
  const mod100 = min % 100;
  let word = "минут";
  if (mod10 === 1 && mod100 !== 11) word = "минута";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "минуты";
  return `${min}\u00A0${word}`;
}

function route() {
  const raw = (location.hash || "#/").replace(/^#\/?/, "").split("?")[0];
  return raw || "home";
}

function go(name) {
  const next = !name || name === "home" ? "#/" : `#/${name}`;
  if ((location.hash || "#/") === next) render();
  else location.hash = next;
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
}

async function api(path, opts = {}) {
  const response = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Не удалось выполнить запрос");
    error.status = response.status;
    throw error;
  }
  return data;
}

function brand() {
  return el(
    "button",
    { class: "brand", type: "button", onclick: () => go("home"), "aria-label": "Lumina, на главную" },
    el("span", {
      html: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1b1914"/><path d="M9 19.2 16 8.5l7 10.7" fill="none" stroke="#f4f0e6" stroke-width="1.8" stroke-linejoin="round"/><circle cx="16" cy="22.2" r="1.5" fill="#e3b86a"/></svg>`,
    }),
    "Lumina"
  );
}

function shell(content, { wide = false } = {}) {
  return el(
    "div",
    { class: "page" },
    el("header", { class: "top no-print" }, brand(), el("span", { class: "top-meta" }, "тест мышления")),
    el("main", { class: wide ? "wrap wide" : "wrap" }, content)
  );
}

function shape(kind) {
  const arrows = {
    "arrow-up": "M32 50 V14 M32 14 L20 26 M32 14 L44 26",
    "arrow-right": "M14 32 H50 M50 32 L38 20 M50 32 L38 44",
    "arrow-down": "M32 14 V50 M32 50 L20 38 M32 50 L44 38",
    "arrow-left": "M50 32 H14 M14 32 L26 20 M14 32 L26 44",
    "arrow-up-right": "M18 46 L46 18 M46 18 H30 M46 18 V34",
  };
  if (kind === "circle") return `<circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" stroke-width="3"/>`;
  if (kind === "circle-fill") return `<circle cx="32" cy="32" r="16" fill="currentColor"/>`;
  if (kind === "square") return `<rect x="16" y="16" width="32" height="32" rx="2" fill="none" stroke="currentColor" stroke-width="3"/>`;
  if (kind === "square-fill") return `<rect x="16" y="16" width="32" height="32" rx="2" fill="currentColor"/>`;
  if (kind === "triangle") return `<polygon points="32,12 54,52 10,52" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
  if (kind === "triangle-fill") return `<polygon points="32,14 54,52 10,52" fill="currentColor"/>`;
  if (arrows[kind]) {
    return `<path d="${arrows[kind]}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return "";
}

function glyphEl(kind) {
  return el("span", { class: "glyph", html: `<svg viewBox="0 0 64 64" aria-hidden="true">${shape(kind)}</svg>` });
}

function sequenceEl(items) {
  const row = el("div", { class: "sequence", "aria-hidden": "true" });
  items.forEach((item, index) => {
    if (index) row.append(el("span", { class: "sequence-arrow" }, "→"));
    row.append(el("span", { class: item === "?" ? "sequence-item is-empty" : "sequence-item" }, item));
  });
  return row;
}

function matrixEl() {
  const cells = [
    ["circle", "triangle", "square"],
    ["triangle-fill", "square-fill", "circle-fill"],
    ["square", "circle", null],
  ];
  const grid = el("div", { class: "matrix", "aria-hidden": "true" });
  cells.flat().forEach((kind) => {
    grid.append(kind ? el("div", { class: "cell" }, glyphEl(kind)) : el("div", { class: "cell is-empty" }, "?"));
  });
  return grid;
}

function rotationEl() {
  const kinds = ["arrow-right", "arrow-down", "arrow-left", null];
  const grid = el("div", { class: "rot-row", "aria-hidden": "true" });
  kinds.forEach((kind) => {
    grid.append(kind ? el("div", { class: "cell" }, glyphEl(kind)) : el("div", { class: "cell is-empty" }, "?"));
  });
  return grid;
}

function trianglesEl() {
  return el("div", {
    class: "figure",
    html: `<svg viewBox="0 0 120 108" aria-hidden="true">
      <polygon points="60,6 114,102 6,102" fill="none" stroke="#1b1914" stroke-width="2.2" stroke-linejoin="round"/>
      <polyline points="33,54 87,54 60,102 33,54" fill="none" stroke="#1b1914" stroke-width="2.2" stroke-linejoin="round"/>
    </svg>`,
  });
}

function visualEl(visual) {
  if (!visual) return null;
  if (visual.type === "sequence") return sequenceEl(visual.items);
  if (visual.type === "matrix") return matrixEl();
  if (visual.type === "rotation") return rotationEl();
  if (visual.type === "triangles") return trianglesEl();
  return null;
}

function currentQuestion() {
  return state.questions[state.index];
}

function progressPercent() {
  const total = state.questions.length || 1;
  const done = state.questions.filter((q) => state.session?.answers?.[q.id]).length;
  return Math.round((done / total) * 100);
}

function leftLabel() {
  const left = state.questions.length - state.index - 1;
  if (left <= 0) return "Последний вопрос";
  const mins = Math.max(1, Math.round(left * 0.6));
  return `Ещё около ${mins}\u00A0мин`;
}

function paintSelection() {
  document.querySelectorAll(".option").forEach((btn) => {
    const on = btn.dataset.id === state.selected;
    btn.classList.toggle("is-selected", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const next = document.querySelector('[data-action="next"]');
  if (next) next.disabled = !state.selected || state.busy;
  const bar = document.querySelector(".progress > span");
  if (bar) bar.style.width = `${progressPercent()}%`;
}

function selectOption(id) {
  if (state.busy) return;
  const question = currentQuestion();
  state.selected = id;
  state.error = "";
  state.session.answers[question.id] = id;
  paintSelection();
  const box = document.querySelector(".form-error");
  if (box) box.remove();
  const sessionId = state.session.id;
  writeChain = writeChain
    .catch(() => {})
    .then(() =>
      api(`/api/session/${sessionId}/answer`, {
        method: "POST",
        body: { questionId: question.id, optionId: id },
      })
    )
    .then((session) => {
      if (state.session && session.id === state.session.id) {
        state.session.answers = { ...session.answers, ...state.session.answers };
      }
    })
    .catch(() => {});
}

async function nextQuestion() {
  if (!state.selected || state.busy) return;
  state.busy = true;
  paintSelection();
  const button = document.querySelector('[data-action="next"]');
  if (button) button.textContent = "Сохраняем…";
  try {
    await writeChain;
    const question = currentQuestion();
    state.session = await api(`/api/session/${state.session.id}/answer`, {
      method: "POST",
      body: { questionId: question.id, optionId: state.selected },
    });
    if (state.index >= state.questions.length - 1) {
      state.session = await api(`/api/session/${state.session.id}/complete`, { method: "POST", body: {} });
      sessionStorage.setItem("lumina.play", "1");
      state.busy = false;
      go("analyzing");
      return;
    }
    state.index += 1;
    state.selected = state.session.answers[currentQuestion().id] || null;
    state.error = "";
    state.busy = false;
    render({ quiet: true, scroll: true });
  } catch (error) {
    state.busy = false;
    state.error = error.message;
    render({ quiet: true });
  }
}

function prevQuestion() {
  if (state.index === 0 || state.busy) return;
  state.index -= 1;
  state.selected = state.session.answers[currentQuestion().id] || null;
  state.error = "";
  render({ quiet: true, scroll: true });
}

async function startNew() {
  if (state.busy) return;
  state.busy = true;
  try {
    const session = await api("/api/session", { method: "POST", body: {} });
    localStorage.setItem(KEY, session.id);
    state.session = session;
    state.index = 0;
    state.selected = null;
    state.error = "";
    paintedRoute = "";
    state.busy = false;
    go("quiz");
  } catch (error) {
    state.busy = false;
    state.homeError = error.message;
    render({ quiet: true });
  }
}

function primaryHome() {
  const session = state.session;
  if (session?.paid) go("result");
  else if (session?.completed) go("paywall");
  else if (session) {
    paintedRoute = "";
    go("quiz");
  } else startNew();
}

function homeLabel() {
  const session = state.session;
  if (session?.paid) return "Открыть отчёт";
  if (session?.completed) return "К предложению";
  if (session && Object.keys(session.answers || {}).length) return "Продолжить тест";
  return "Начать бесплатно";
}

async function openCode(event) {
  event.preventDefault();
  const input = event.target.querySelector("input");
  const id = input.value.trim();
  if (!UUID_RE.test(id)) {
    state.homeError = "Код сессии скопирован не целиком.";
    render({ quiet: true });
    return;
  }
  try {
    const session = await api(`/api/session/${id}`);
    localStorage.setItem(KEY, session.id);
    state.session = session;
    state.homeError = "";
    if (session.paid) go("result");
    else if (session.completed) go("paywall");
    else {
      paintedRoute = "";
      go("quiz");
    }
  } catch (error) {
    state.homeError = error.message;
    render({ quiet: true });
  }
}

function viewHome() {
  const sampleOptions = [
    { id: "24", text: "36" },
    { id: "48", text: "48" },
    { id: "30", text: "30" },
    { id: "42", text: "42" },
  ];
  let sampleNote = null;
  if (state.sampleChoice === "48") sampleNote = ["ok", "Верно: каждое число удваивается, дальше 48."];
  else if (state.sampleChoice) sampleNote = ["miss", "Почти. Каждое число вдвое больше предыдущего, значит 48."];

  const continueLine =
    state.session && (state.session.completed || Object.keys(state.session.answers || {}).length)
      ? el(
          "p",
          { class: "fine" },
          state.session.paid
            ? "В этом браузере уже есть оплаченный отчёт."
            : state.session.completed
              ? "Тест уже отправлен. Точный балл ждёт на следующем шаге."
              : `Сохранено ответов: ${Object.keys(state.session.answers).length} из 12.`
        )
      : null;

  return shell(
    el(
      "div",
      {},
      el(
        "section",
        { class: "hero" },
        el(
          "div",
          {},
          el("p", { class: "kicker" }, "12 вопросов · около 8 минут"),
          el("h1", {}, "Узнайте, как устроено ваше мышление"),
          el(
            "p",
            { class: "lede" },
            "Числа, логика, пространство и смысл слов. Сам тест бесплатный. Точный балл, место на шкале и разбор ответов открываются по подписке."
          ),
          el(
            "div",
            { class: "hero-actions" },
            el("button", { class: "btn", type: "button", onclick: primaryHome }, homeLabel()),
            el("button", {
              class: "btn secondary",
              type: "button",
              onclick: () => document.getElementById("offer")?.scrollIntoView({ behavior: "smooth" }),
            }, "Сколько стоит")
          ),
          continueLine,
          state.homeError ? el("p", { class: "form-error" }, state.homeError) : null,
          state.session?.completed
            ? el("button", { class: "text-btn", type: "button", onclick: startNew, style: "margin-top:10px" }, "Пройти заново")
            : el("p", { class: "fine" }, `7 дней доступа — ${rub(149)}, дальше ${rub(399)} в месяц`)
        ),
        el(
          "div",
          { class: "panel" },
          el("p", { class: "kicker" }, "Так выглядит задание"),
          el("h2", { class: "prompt" }, "Какое число продолжает ряд?"),
          sequenceEl(["3", "6", "12", "24", "?"]),
          el(
            "div",
            { class: "options" },
            sampleOptions.map((option, index) =>
              el(
                "button",
                {
                  type: "button",
                  class: `option${state.sampleChoice === option.id ? " is-selected" : ""}`,
                  onclick: () => {
                    state.sampleChoice = option.id;
                    render({ quiet: true });
                  },
                },
                el("span", { class: "opt-key", "aria-hidden": "true" }, LETTERS[index]),
                option.text
              )
            )
          ),
          sampleNote ? el("p", { class: `sample-note ${sampleNote[0]}` }, sampleNote[1]) : el("p", { class: "sample-note" }, "Это пример. В зачёт он не идёт.")
        )
      ),
      el(
        "div",
        { class: "metrics" },
        metric("12", "заданий"),
        metric("4", "навыка"),
        metric("~8", "минут"),
        metric(rub(149), "за 7 дней")
      ),
      el(
        "section",
        { class: "section" },
        el("h2", {}, "Что измеряем"),
        el("p", { class: "intro" }, "Четыре коротких блока. В отчёте у каждого свой процент и короткая подсказка, куда смотреть дальше."),
        el(
          "div",
          { class: "skills" },
          skill("Числа", "Ряды и правила, по которым одно число получается из другого."),
          skill("Логика", "Выводы из условий: что следует, а что только кажется очевидным."),
          skill("Пространство", "Поворот, сдвиг и счёт фигур на одном рисунке."),
          skill("Смысл", "Аналогии и лишнее слово: связь, которую можно назвать глаголом.")
        )
      ),
      el(
        "section",
        { class: "section" },
        el("h2", {}, "Как проходит"),
        el(
          "div",
          { class: "steps-row" },
          stepCard("01", "Отвечаете", "Двенадцать вопросов, по одному на экран. Назад вернуться можно, правильность по дороге не подсвечиваем."),
          stepCard("02", "Прячем балл", "После отправки видна только широкая оценка: выше середины или около неё. Точное число остаётся на сервере."),
          stepCard("03", "Открываете отчёт", "Учебная оплата записывает подписку. Дальше — балл, кривая, четыре навыка и разбор каждого ответа.")
        )
      ),
      el(
        "section",
        { class: "section", id: "offer" },
        el("h2", {}, "Одна подписка, без мелкого шрифта"),
        el(
          "div",
          { class: "price" },
          el("p", { class: "kicker", style: "color:#e3b86a" }, "Полный отчёт"),
          el("div", { class: "sum" }, rub(149)),
          el("p", {}, "Семь дней доступа: точный балл, место на модельной кривой, профиль навыков и разбор ответов."),
          el("p", {}, `Дальше ${rub(399)} раз в месяц, пока продление не отмените. Кнопка отмены стоит на странице результата.`),
          el("button", { class: "btn light", type: "button", onclick: primaryHome }, homeLabel())
        )
      ),
      el(
        "section",
        { class: "section faq" },
        el("h2", {}, "Вопросы"),
        faq("Тест правда бесплатный?", "Да. До оплаты видна только качественная оценка, без числа. Деньги относятся к подробному отчёту."),
        faq(
          "Что будет списано?",
          `В модели продукта: ${rub(149)} сегодня и ${rub(399)} каждый месяц после седьмого дня. В этой сборке платёж учебный: банк не участвует, в базу попадают статус, чек и последние 4 цифры тестовой карты.`
        ),
        faq(
          "Это настоящий IQ?",
          "Нет. Это короткая учебная оценка. Шкала нарисована по нормальной кривой, а не по живой выборке. Результат не подходит для работы, учёбы или Mensa."
        ),
        faq(
          "Где лежат ответы?",
          "На сервере, в PostgreSQL, вместе со статусом оплаты. В браузере хранится только код сессии. Его можно вставить ниже и открыть тот же отчёт на другом устройстве."
        )
      ),
      el(
        "form",
        { class: "lookup", onsubmit: openCode },
        el("input", {
          "aria-label": "Код сессии",
          placeholder: "Код сессии, если проходили с другого устройства",
          autocomplete: "off",
        }),
        el("button", { class: "btn secondary", type: "submit" }, "Открыть")
      ),
      state.homeError ? el("p", { class: "form-error", style: "margin-top:10px" }, state.homeError) : null,
      el(
        "footer",
        { class: "footer" },
        el("p", {}, "Lumina — учебный сервис. Оценка не является медицинским или сертификационным тестом."),
        el("p", {}, "Вопросы авторские. Оплата имитируется и нужна, чтобы пройти воронку целиком.")
      ),
      el("div", { class: "sticky-cta no-print" }, el("button", { class: "btn", type: "button", onclick: primaryHome }, homeLabel()))
    ),
    { wide: true }
  );
}

function metric(value, label) {
  return el("div", { class: "metric" }, el("b", {}, value), el("span", {}, label));
}
function skill(title, text) {
  return el("article", { class: "skill" }, el("b", {}, title), el("p", {}, text));
}
function stepCard(no, title, text) {
  return el(
    "article",
    { class: "panel step-card" },
    el("div", { class: "step-no" }, no),
    el("div", {}, el("strong", {}, title), el("p", { class: "muted", style: "margin:4px 0 0" }, text))
  );
}
function faq(q, a) {
  return el("details", {}, el("summary", {}, q), el("p", {}, a));
}

function viewQuiz() {
  if (state.session.completed) {
    return shell(
      el(
        "section",
        { class: "panel" },
        el("p", { class: "kicker" }, "Тест уже отправлен"),
        el("h1", { class: "prompt" }, "Ответы закрыты"),
        el("p", {}, "Менять их после отправки нельзя: иначе балл можно было бы подгонять, увидев оценку."),
        el(
          "div",
          { class: "quiz-actions" },
          el("button", { class: "btn secondary", type: "button", onclick: startNew }, "Пройти заново"),
          el("button", { class: "btn", type: "button", onclick: () => go(state.session.paid ? "result" : "paywall") }, state.session.paid ? "К отчёту" : "К предложению")
        )
      )
    );
  }

  const question = currentQuestion();
  const glyphs = question.options.some((option) => option.glyph);
  return shell(
    el(
      "section",
      {},
      el(
        "div",
        { class: "quiz-meta" },
        el("span", { class: "pill" }, question.domainLabel),
        el("span", { class: "muted" }, leftLabel())
      ),
      el("div", { class: "progress", "aria-hidden": "true" }, el("span", { style: `width:${progressPercent()}%` })),
      el("p", { class: "kicker" }, `Вопрос ${state.index + 1} из ${state.questions.length}`),
      el("h1", { class: "prompt" }, question.prompt),
      visualEl(question.visual),
      el(
        "div",
        { class: glyphs ? "options glyphs" : "options", role: "group", "aria-label": "Варианты ответа" },
        question.options.map((option, index) =>
          el(
            "button",
            {
              type: "button",
              class: `option${state.selected === option.id ? " is-selected" : ""}`,
              "data-id": option.id,
              "aria-pressed": state.selected === option.id ? "true" : "false",
              "aria-label": option.text,
              onclick: () => selectOption(option.id),
            },
            glyphs ? glyphEl(option.glyph) : el("span", { class: "opt-key", "aria-hidden": "true" }, LETTERS[index]),
            glyphs ? el("span", { class: "opt-key" }, LETTERS[index]) : option.text
          )
        )
      ),
      state.error ? el("p", { class: "form-error", role: "alert" }, state.error) : null,
      el(
        "div",
        { class: "quiz-actions" },
        el(
          "button",
          { class: "btn secondary", type: "button", onclick: prevQuestion, disabled: state.index === 0 },
          "Назад"
        ),
        el(
          "button",
          {
            class: "btn",
            type: "button",
            "data-action": "next",
            disabled: !state.selected || state.busy,
            onclick: nextQuestion,
          },
          state.index === state.questions.length - 1 ? "Узнать оценку" : "Дальше"
        )
      ),
      el("p", { class: "note" }, "Клавиши 1–4 выбирают вариант, Enter подтверждает.")
    )
  );
}

function viewAnalyzing() {
  const lines = [
    "Сверяем ответы с ключом",
    "Собираем профиль по четырём навыкам",
    "Прячем точный балл до открытия отчёта",
  ];
  return shell(
    el(
      "section",
      { class: "panel analyze" },
      el("p", { class: "kicker" }, "Считаем"),
      el("h1", { class: "prompt" }, "Собираем отчёт по вашим ответам"),
      el(
        "div",
        { class: "steps" },
        lines.map((text, index) =>
          el(
            "div",
            { class: index === 0 ? "step is-now" : "step" },
            el("span", { class: "dot", "aria-hidden": "true" }, index === 0 ? "•" : ""),
            el("span", {}, text)
          )
        )
      )
    )
  );
}

function startAnalysis() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const marks = reduce ? [60, 120, 180, 240] : [700, 1500, 2400, 2900];
  const apply = (step) => {
    document.querySelectorAll(".step").forEach((node, index) => {
      node.classList.toggle("is-done", index < step);
      node.classList.toggle("is-now", index === step);
      const dot = node.querySelector(".dot");
      if (dot) dot.textContent = index < step ? "✓" : index === step ? "•" : "";
    });
  };
  later(() => apply(1), marks[0]);
  later(() => apply(2), marks[1]);
  later(() => apply(3), marks[2]);
  later(() => {
    sessionStorage.removeItem("lumina.play");
    go("paywall");
  }, marks[3]);
}

function viewPaywall() {
  const teaser = state.session.teaser || {
    title: "Отчёт собран",
    detail: "Точный балл сохранён и откроется после оплаты.",
  };
  const locked = [
    "Точный балл",
    "Место на модельной кривой",
    "Профиль из четырёх навыков",
    "Разбор каждого ответа",
  ];
  return shell(
    el(
      "div",
      { class: "stack" },
      el("p", { class: "kicker" }, "Шаг 2 из 3 · отчёт"),
      el("h1", { class: "prompt" }, teaser.title),
      el("p", { class: "lede", style: "margin-top:0" }, teaser.detail),
      el(
        "section",
        { class: "panel" },
        el(
          "ul",
          { class: "lock-list" },
          locked.map((item) => el("li", {}, el("span", {}, item), el("span", { class: "muted" }, "закрыто")))
        )
      ),
      el(
        "section",
        { class: "price" },
        el("p", { class: "kicker", style: "color:#e3b86a" }, "7 дней полного доступа"),
        el("div", { class: "sum" }, rub(149)),
        el("p", {}, `Потом ${rub(399)} раз в месяц. Если отменить до даты продления, следующее списание в модели продукта не проходит.`),
        el("button", { class: "btn light full", type: "button", onclick: () => go("checkout") }, `Открыть за ${rub(149)}`)
      ),
      el(
        "div",
        { class: "banner" },
        "Это демонстрация. Карта проверяется только по формату, деньги не уходят в банк, в базе остаётся статус учебной оплаты."
      ),
      el("button", { class: "btn secondary full", type: "button", onclick: startNew }, "Пройти тест заново")
    )
  );
}

function groupCard(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, "$1 ")
    .trim();
}

function syncPreview() {
  const num = document.querySelector("[data-preview='num']");
  const name = document.querySelector("[data-preview='name']");
  const exp = document.querySelector("[data-preview='exp']");
  if (num) num.textContent = groupCard(state.draft.card) || "•••• •••• •••• ••••";
  if (name) name.textContent = state.draft.name || "Имя на отчёте";
  if (exp) exp.textContent = state.draft.expiry || "ММ/ГГ";
}

function viewCheckout() {
  const draft = state.draft;
  return shell(
    el(
      "div",
      { class: "stack" },
      el("p", { class: "kicker" }, "Шаг 3 из 3 · оплата"),
      el("h1", { class: "prompt" }, "Учебная оплата"),
      el(
        "div",
        { class: "paycard", "aria-hidden": "true" },
        el("div", { class: "brandlet" }, "LUMINA"),
        el("div", { class: "num", "data-preview": "num" }, groupCard(draft.card) || "•••• •••• •••• ••••"),
        el(
          "div",
          { class: "meta" },
          el("span", { "data-preview": "name" }, draft.name || "Имя на отчёте"),
          el("span", { "data-preview": "exp" }, draft.expiry || "ММ/ГГ")
        )
      ),
      el(
        "form",
        {
          onsubmit: submitPay,
          autocomplete: "off",
        },
        state.error ? el("p", { class: "form-error", role: "alert" }, state.error) : null,
        field("Имя в отчёте", "name", "text", "Например, Мария", draft.name, (value) => {
          state.draft.name = value;
          syncPreview();
        }),
        field("Почта", "email", "email", "name@site.ru", draft.email, (value) => {
          state.draft.email = value;
        }),
        field("Номер карты", "card", "text", "4242 4242 4242 4242", groupCard(draft.card), (value) => {
          state.draft.card = value.replace(/\D/g, "").slice(0, 16);
          const input = document.querySelector("[name='card']");
          if (input) input.value = groupCard(state.draft.card);
          syncPreview();
        }, "numeric"),
        el(
          "div",
          { class: "row2" },
          field("Срок", "expiry", "text", "12/30", draft.expiry, (value) => {
            let digits = value.replace(/\D/g, "").slice(0, 4);
            state.draft.expiry = digits.length >= 3 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
            const input = document.querySelector("[name='expiry']");
            if (input && input.value !== state.draft.expiry) input.value = state.draft.expiry;
            syncPreview();
          }, "numeric"),
          field("CVC", "cvc", "text", "123", draft.cvc, (value) => {
            state.draft.cvc = value.replace(/\D/g, "").slice(0, 3);
            const input = document.querySelector("[name='cvc']");
            if (input) input.value = state.draft.cvc;
          }, "numeric")
        ),
        el("button", { class: "btn full", type: "submit", disabled: state.busy }, state.busy ? "Проводим оплату…" : `Оплатить ${rub(149)}`),
        el("p", { class: "note" }, "Не вводите настоящую карту. Подойдёт 4242 4242 4242 4242, любой будущий срок и любые три цифры CVC. Сохраняем только последние 4 цифры.")
      ),
      el("button", { class: "text-btn", type: "button", onclick: () => go("paywall") }, "Назад к предложению")
    )
  );
}

function field(label, name, type, placeholder, value, onValue, inputmode) {
  return el(
    "label",
    { class: "field" },
    el("span", {}, label),
    el("input", {
      name,
      type,
      placeholder,
      value,
      inputmode: inputmode || null,
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      required: true,
      oninput: (event) => onValue(event.target.value),
    })
  );
}

async function submitPay(event) {
  event.preventDefault();
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  const submit = event.target.querySelector("[type='submit']");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Проводим оплату…";
  }
  try {
    const session = await api(`/api/session/${state.session.id}/checkout`, {
      method: "POST",
      body: {
        name: state.draft.name,
        email: state.draft.email,
        card: state.draft.card,
        expiry: state.draft.expiry,
        cvc: state.draft.cvc,
      },
    });
    state.session = session;
    state.busy = false;
    const main = document.querySelector("main");
    if (main) {
      main.replaceChildren(
        el(
          "section",
          { class: "panel", style: "text-align:center;padding:36px 18px" },
          el("p", { class: "kicker" }, "Готово"),
          el("h1", { class: "prompt" }, "Оплата прошла"),
          el("p", {}, "Это учебный чек. Открываем отчёт.")
        )
      );
    }
    later(() => go("result"), 800);
  } catch (error) {
    state.busy = false;
    state.error = error.message;
    render({ quiet: true });
  }
}

function bellChart(iq) {
  const w = 640;
  const h = 186;
  const pad = 20;
  const score = Math.min(145, Math.max(55, iq));
  const coords = [];
  for (let i = 0; i <= 80; i += 1) {
    const t = i / 80;
    const value = 55 + t * 90;
    const z = (value - 100) / 15;
    const yv = Math.exp(-0.5 * z * z);
    const x = pad + t * (w - pad * 2);
    const y = h - 32 - yv * (h - 62);
    coords.push([x, y]);
  }
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${h - 32} L${coords[0][0].toFixed(1)} ${h - 32} Z`;
  const t = (score - 55) / 90;
  const z = (score - 100) / 15;
  const yv = Math.exp(-0.5 * z * z);
  const x = pad + t * (w - pad * 2);
  const y = h - 32 - yv * (h - 62);
  const anchor = x > 500 ? "end" : x < 90 ? "start" : "middle";
  const labelX = x > 500 ? x - 8 : x < 90 ? x + 8 : x;
  const ticks = [70, 85, 100, 115, 130]
    .map((tick) => {
      const tx = pad + ((tick - 55) / 90) * (w - pad * 2);
      return `<text x="${tx.toFixed(1)}" y="${h - 8}" text-anchor="middle">${tick}</text>`;
    })
    .join("");
  return el("div", {
    html: `<svg class="bell" viewBox="0 0 ${w} ${h}" role="img" aria-label="Балл ${iq} на кривой с центром 100">
      <path class="bell-area" d="${area}"></path>
      <path class="bell-line" d="${line}"></path>
      <line class="bell-mark" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y.toFixed(1)}" y2="${h - 32}"></line>
      <circle class="bell-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"></circle>
      <text x="${labelX.toFixed(1)}" y="${Math.max(16, y - 10).toFixed(1)}" text-anchor="${anchor}" fill="#b8431f" font-size="16">${iq}</text>
      ${ticks}
    </svg>`,
  });
}

function placeLine(percentile) {
  const text = percentile.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  return `На модельной кривой это выше, чем у ${text}% результатов.`;
}

async function cancelRenewal() {
  if (!state.confirmCancel) {
    state.confirmCancel = true;
    render({ quiet: true });
    return;
  }
  state.busy = true;
  try {
    await api(`/api/session/${state.session.id}/cancel`, { method: "POST", body: {} });
    state.confirmCancel = false;
    state.busy = false;
    render();
  } catch (error) {
    state.busy = false;
    state.error = error.message;
    render({ quiet: true });
  }
}

function copyCode(event) {
  const button = event.currentTarget;
  const text = state.session.id;
  const done = () => {
    button.textContent = "Скопировано";
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const input = document.createElement("textarea");
  input.value = text;
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  done();
}

function viewResult(result) {
  const payment = result.payment;
  const cancelled = payment.subscriptionStatus === "cancelled";
  const correct = result.review.filter((item) => item.ok).length;
  return shell(
    el(
      "div",
      { class: "stack" },
      el(
        "section",
        { class: "result-grid" },
        el(
          "article",
          { class: "panel certificate" },
          el("p", { class: "kicker" }, result.name ? `Отчёт · ${result.name}` : "Отчёт"),
          el("p", { class: "score-num" }, String(result.iq)),
          el("p", { class: "score-caption" }, result.teaser?.title || "Балл Lumina"),
          el("p", { class: "muted" }, placeLine(result.percentile)),
          bellChart(result.iq),
          el(
            "p",
            { class: "note" },
            "Центр шкалы — 100, шаг в 15 баллов — обычная ширина. Кривая модельная, это не замер живой аудитории."
          )
        ),
        el(
          "article",
          { class: "panel" },
          el("p", { class: "kicker" }, "Четыре навыка"),
          ...result.domains.map((domain) =>
            el(
              "div",
              { class: "domain" },
              el(
                "div",
                { class: "domain-top" },
                el("span", {}, domain.label),
                el("span", { class: "muted" }, `${domain.toneLabel} · ${domain.percent}%`)
              ),
              el("div", { class: `bar ${domain.tone}` }, el("span", { style: `width:${domain.percent}%` }))
            )
          ),
          el("p", { class: "note" }, `От старта до отправки: ${ruDuration(result.durationSec)}. Верных ответов: ${correct} из ${result.review.length}. Балл считает вес заданий, не только их число.`)
        )
      ),
      el(
        "section",
        { class: "panel narrative" },
        el("h2", { class: "prompt", style: "font-size:32px" }, "Как это читать"),
        el("p", {}, result.narrative.lead),
        el("p", {}, result.narrative.mid),
        el("p", {}, result.narrative.tail),
        el("div", { class: "tip" }, el("strong", {}, result.narrative.tipLabel), el("p", { style: "margin:6px 0 0" }, result.narrative.tip))
      ),
      el(
        "section",
        { class: "panel" },
        el(
          "details",
          { class: "review" },
          el("summary", {}, `Разбор ответов · ${correct} из ${result.review.length}`),
          ...result.review.map((item) =>
            el(
              "article",
              { class: "review-item" },
              el(
                "div",
                { class: "quiz-meta" },
                el("span", { class: "pill" }, item.domainLabel),
                el("span", { class: item.ok ? "tag-ok" : "tag-miss" }, item.ok ? "Верно" : "Мимо")
              ),
              el("p", { style: "margin:8px 0" }, item.prompt),
              el("p", { style: "margin:0" }, `Ваш ответ: ${item.yourAnswer}`),
              item.ok ? null : el("p", { style: "margin:4px 0 0" }, `Ключ: ${item.correctAnswer}`),
              el("p", { class: "muted", style: "margin:6px 0 0" }, item.explain)
            )
          )
        )
      ),
      el(
        "section",
        { class: "panel" },
        el("p", { class: "kicker" }, "Подписка"),
        cancelled
          ? el("p", { class: "status-ok" }, `Продление отменено ${ruDate(payment.cancelledAt)}. Отчёт остаётся открытым.`)
          : el(
              "p",
              {},
              `Пробный доступ до ${ruDate(payment.renewsAt)}. Дальше в модели продукта было бы ${rub(payment.renewalAmount)} раз в месяц.`
            ),
        state.error ? el("p", { class: "form-error" }, state.error) : null,
        cancelled
          ? null
          : el(
              "button",
              { class: "btn secondary no-print", type: "button", onclick: cancelRenewal, disabled: state.busy },
              state.confirmCancel ? "Подтвердить отмену" : "Отменить продление"
            ),
        el(
          "p",
          { class: "receipt" },
          el("span", {}, `${payment.transactionId} · карта •••• ${payment.last4} · ${rub(payment.amount)}`),
          el("span", { class: "muted" }, "учебная оплата")
        ),
        el(
          "div",
          { class: "code-line no-print" },
          el("span", { class: "code" }, result.id),
          el("button", { class: "btn secondary", type: "button", onclick: copyCode }, "Копировать код")
        ),
        el(
          "div",
          { class: "quiz-actions no-print" },
          el("button", { class: "btn secondary", type: "button", onclick: () => window.print() }, "Печать"),
          el("button", { class: "btn", type: "button", onclick: startNew }, "Новый тест")
        )
      )
    ),
    { wide: true }
  );
}

function viewFatal(message) {
  return shell(
    el(
      "section",
      { class: "fatal" },
      el("h1", { class: "prompt" }, "Не получилось открыть"),
      el("p", {}, message),
      el("button", { class: "btn", type: "button", onclick: () => go("home") }, "На главную")
    )
  );
}

function guard(name) {
  const session = state.session;
  const known = ["home", "quiz", "analyzing", "paywall", "checkout", "result"];
  if (!known.includes(name)) return "home";
  if (["paywall", "checkout", "result", "analyzing"].includes(name) && !session?.completed) {
    return session ? "quiz" : "home";
  }
  if (["paywall", "checkout"].includes(name) && session?.paid) return "result";
  if (name === "result" && session && !session.paid) return "paywall";
  if (name === "analyzing" && !sessionStorage.getItem("lumina.play")) return "paywall";
  return null;
}

function firstOpen() {
  const answers = state.session?.answers || {};
  const index = state.questions.findIndex((q) => !answers[q.id]);
  return index === -1 ? state.questions.length - 1 : index;
}

async function loadQuestions() {
  if (state.questions.length) return;
  const data = await api("/api/questions");
  state.questions = data.questions;
}

async function loadExisting() {
  const id = localStorage.getItem(KEY);
  if (!id) {
    state.session = null;
    return;
  }
  try {
    state.session = await api(`/api/session/${id}`);
  } catch (error) {
    if (error.status === 404) {
      localStorage.removeItem(KEY);
      state.session = null;
      return;
    }
    throw error;
  }
}

async function view(name) {
  if (name === "home") return viewHome();
  if (name === "quiz") return viewQuiz();
  if (name === "analyzing") return viewAnalyzing();
  if (name === "paywall") return viewPaywall();
  if (name === "checkout") return viewCheckout();
  if (name === "result") {
    const result = await api(`/api/session/${state.session.id}/result`);
    state.session = { ...state.session, ...result, paid: true };
    return viewResult(result);
  }
  return viewHome();
}

async function render(opts = {}) {
  clearTimers();
  const gen = ++renderGen;
  const name = route();
  document.body.dataset.route = name;
  if (!opts.quiet) app.replaceChildren(el("div", { class: "boot" }, "Открываем…"));
  try {
    if (name !== "home") await loadQuestions();
    if (gen !== renderGen) return;
    await loadExisting();
    if (gen !== renderGen) return;
    if (name === "quiz" && !state.session) {
      state.session = await api("/api/session", { method: "POST", body: {} });
      localStorage.setItem(KEY, state.session.id);
    }
    if (gen !== renderGen) return;
    const redirect = guard(name);
    if (redirect) {
      go(redirect);
      return;
    }
    const entered = paintedRoute !== name;
    if (name === "quiz" && entered && !state.session.completed) {
      state.index = firstOpen();
      state.selected = state.session.answers[state.questions[state.index].id] || null;
      state.error = "";
    }
    paintedRoute = name;
    const node = await view(name);
    if (gen !== renderGen) return;
    app.replaceChildren(node);
    document.title = TITLES[name] || TITLES.home;
    if (opts.scroll || !opts.quiet) window.scrollTo(0, 0);
    if (name === "analyzing") startAnalysis();
  } catch (error) {
    if (gen !== renderGen) return;
    if (error.status === 402 && name === "result") {
      go("paywall");
      return;
    }
    if (error.status === 404) {
      localStorage.removeItem(KEY);
      state.session = null;
    }
    app.replaceChildren(viewFatal(error.message || "Не удалось открыть страницу"));
  }
}

document.addEventListener("keydown", (event) => {
  if (route() !== "quiz" || state.session?.completed) return;
  if (event.target.matches("input, textarea")) return;
  const map = { 1: 0, 2: 1, 3: 2, 4: 3 };
  if (map[event.key] != null) {
    const option = currentQuestion()?.options[map[event.key]];
    if (option) selectOption(option.id);
  } else if (event.key === "Enter" && state.selected) {
    event.preventDefault();
    nextQuestion();
  } else if (event.key === "ArrowLeft") prevQuestion();
});

window.addEventListener("hashchange", () => render());
render();

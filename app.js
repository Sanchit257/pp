const state = {
  model: "",
  students: [],
  lastRun: null,
  selectedId: null,
  running: false,
  draft: "",
  draftWho: "",
};

const $ = (id) => document.getElementById(id);

function h(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids) {
    if (kid == null || kid === false || kid === "") continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function studentById(id) {
  return state.students.find((student) => student.id === id);
}

function planFor(id) {
  return state.lastRun?.plans?.[id] || null;
}

function stretchLabel(decision) {
  if (decision === "today") return "Stretch: today";
  if (decision === "withheld") return "Stretch: withheld";
  if (decision === "if_ready") return "Stretch: only if ready";
  return "";
}

function setStatus(text) {
  $("status").textContent = text;
}

function showDraft() {
  const draft = $("draft");
  if (!state.draft) {
    draft.hidden = true;
    draft.textContent = "";
    return;
  }
  draft.hidden = false;
  draft.textContent = state.draft;
  draft.scrollTop = draft.scrollHeight;
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadState() {
  state.model = DEMO.model;
  state.students = copy(DEMO.students);
  state.lastRun = null;
  state.selectedId = null;
  $("assignment").value = DEMO.assignment;
  $("model-line").textContent = "Demo mode. The brief and plans below are sample agent output, played back in the browser. Nothing is sent to a model.";
  render();
  setStatus("Portraits and memory are loaded. The agents have not planned today yet.");
}

async function type(who, text) {
  state.draftWho = who;
  state.draft = "";
  showDraft();
  const roster = $("roster");
  roster.querySelectorAll(".student").forEach((row) => row.classList.remove("writing"));
  roster.querySelector(`[data-open="${CSS.escape(who)}"]`)?.closest(".student")?.classList.add("writing");
  for (let i = 0; i < text.length; i += 6) {
    state.draft = text.slice(0, i + 6);
    showDraft();
    await pause(12);
  }
}

function renderBrief() {
  const body = $("brief-body");
  const brief = state.lastRun?.brief;
  if (!brief) {
    body.replaceChildren(h("p", { class: "bound" }, ["The teacher agent has not written today's brief yet."]));
    return;
  }
  const must = Array.isArray(brief.must) ? brief.must : [];
  body.replaceChildren(
    h("p", { class: "anchor-line" }, [
      `Anchor ${brief.anchorProblem}. Quotient ${brief.anchorQuotient}, remainder ${brief.anchorRemainder}.`,
    ]),
    h("p", {}, [brief.aim || ""]),
    h("ul", { class: "must" }, must.map((item) => h("li", {}, [String(item)]))),
    h("p", { class: "bound" }, [
      `Stretch ${brief.stretchProblem}: quotient ${brief.stretchQuotient}, remainder ${brief.stretchRemainder}. ${brief.freedom || ""}`,
    ]),
    h("p", { class: "meta" }, [`Arithmetic: ${brief.mathCheck || "not checked"}. ${brief.minutes || 35} minutes.`])
  );
}

function renderRoster() {
  const roster = $("roster");
  roster.setAttribute("aria-busy", state.running ? "true" : "false");
  roster.replaceChildren(
    ...state.students.map((student) => {
      const plan = planFor(student.id);
      const pending = !plan;
      const today = h("p", { class: pending ? "today is-waiting" : "today" }, [
        plan ? String(plan.approach || "Plan ready.") : "Waiting for the brief.",
      ]);
      if (plan && plan.stretchDecision) {
        today.append(h("span", { class: "stretch-short" }, [stretchLabel(plan.stretchDecision)]));
      }
      const buttonProps = {
        type: "button",
        class: "open",
        "data-open": student.id,
        "aria-label": plan ? `Open ${student.name}'s plan` : `Open ${student.name}'s memory`,
      };
      if (state.selectedId === student.id) buttonProps["aria-current"] = "true";
      const classes = ["student", plan ? "ready" : "waiting"];
      if (state.selectedId === student.id) classes.push("is-selected");
      if (state.draftWho === student.id) classes.push("writing");
      return h("article", { class: classes.join(" ") }, [
        h("div", { class: "who" }, [
          h("h3", {}, [student.name]),
          h("p", { class: "kind" }, [student.kind]),
          h("p", { class: "capability" }, [student.capability]),
        ]),
        today,
        h("button", buttonProps, [plan ? "Open plan" : "Memory"]),
      ]);
    })
  );
}

function listFrom(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value) return [String(value)];
  return [];
}

function renderPlan() {
  const planEl = $("plan");
  const workspace = $("workspace");
  const student = studentById(state.selectedId);
  if (!student) {
    planEl.hidden = true;
    planEl.replaceChildren();
    workspace.classList.remove("is-split");
    return;
  }
  planEl.hidden = false;
  workspace.classList.add("is-split");
  const plan = planFor(student.id);
  const nodes = [
    h("div", { class: "plan-head" }, [
      h("div", {}, [
        h("p", { class: "kicker" }, ["Student agent"]),
        h("h2", { id: "plan-title", tabindex: "-1" }, [student.name]),
        h("p", { class: "kindline" }, [student.kind]),
      ]),
      h("button", { type: "button", class: "ghost", "data-close": "true" }, ["Close"]),
    ]),
    h("p", { class: "capability" }, [student.capability]),
    h("h3", {}, ["Kept in memory"]),
    h("ul", { class: "notes" }, student.memory.map((note) => h("li", {}, [note]))),
  ];
  if (!plan) {
    nodes.push(h("p", { class: "callout" }, ["No plan for today yet. Run the agents, and this one will write from the brief and the memory above."]));
  } else {
    nodes.push(h("h3", {}, ["Why this plan"]));
    nodes.push(h("p", {}, [plan.why || ""]));
    nodes.push(h("h3", {}, ["Today"]));
    nodes.push(h("ol", { class: "steps" }, listFrom(plan.path).map((step) => h("li", {}, [step]))));
    nodes.push(h("h3", {}, ["The anchor problem, in this child's mode"]));
    nodes.push(h("p", { class: "worked" }, [plan.worked || ""]));
    nodes.push(h("h3", {}, ["Stretch"]));
    nodes.push(h("p", {}, [`${stretchLabel(plan.stretchDecision)} ${plan.stretchReason || ""}`.trim()]));
    nodes.push(h("h3", {}, ["Done when"]));
    nodes.push(h("p", {}, [plan.doneWhen || ""]));
    nodes.push(h("h3", {}, ["Ms. Brooks watches for"]));
    nodes.push(h("p", {}, [plan.watch || ""]));
    nodes.push(h("h3", {}, ["Stored after this run"]));
    nodes.push(h("p", {}, [plan.store || ""]));
  }
  planEl.replaceChildren(...nodes);
}

function renderWalk() {
  const walk = $("walk");
  const plans = state.lastRun?.plans;
  if (!plans) {
    walk.hidden = true;
    walk.replaceChildren();
    return;
  }
  const slices = [
    ["First part of the period", "start"],
    ["Middle", "middle"],
    ["End", "end"],
  ];
  const blocks = slices.map(([label, key]) => h("div", {}, [
    h("h3", { class: "when" }, [label]),
    h("ul", { class: "walk-list" }, state.students.map((student) => {
      const room = plans[student.id]?.room || {};
      return h("li", {}, [h("strong", {}, [student.name.split(" ")[0]]), h("span", {}, [room[key] || ""])]);
    })),
  ]));
  walk.hidden = false;
  walk.replaceChildren(
    h("h2", { id: "walk-title" }, ["Walk the room"]),
    h("p", { class: "section-lead" }, ["Written by the student agents for the same period."]),
    ...blocks
  );
}

function render() {
  renderBrief();
  renderRoster();
  renderPlan();
  renderWalk();
  showDraft();
  $("send").disabled = state.running;
  $("send").textContent = state.running ? "Agents are writing" : "Run the teacher agent and the five student agents";
  $("reset").hidden = state.running || !state.lastRun;
}

function select(id) {
  state.selectedId = state.selectedId === id ? state.selectedId : id;
  render();
  $("plan-title")?.focus({ preventScroll: true });
}

function closePlan() {
  const id = state.selectedId;
  state.selectedId = null;
  render();
  if (id) document.querySelector(`[data-open="${CSS.escape(id)}"]`)?.focus();
}

async function runAgents(event) {
  event.preventDefault();
  if (state.running) return;
  state.running = true;
  state.draft = "";
  state.draftWho = "teacher";
  state.lastRun = null;
  state.students = copy(DEMO.students);
  render();
  const today = new Date().toLocaleDateString("en-CA");
  const brief = copy(DEMO.brief);

  setStatus("The teacher agent is writing the brief.");
  await type("teacher", `${brief.title}\n\n${brief.aim}\n\n${brief.must.map((item, i) => `${i + 1}. ${item}`).join("\n")}`);
  await pause(300);
  state.lastRun = { assignment: DEMO.assignment, at: today, brief, plans: {} };
  state.draft = "";
  render();

  for (const student of state.students) {
    const plan = copy(DEMO.plans[student.id]);
    setStatus(`${student.name.split(" ")[0]}'s agent is writing the plan from the brief and the memory it has kept.`);
    await type(student.id, `${plan.approach}\n\n${plan.why}\n\n${plan.path.map((step, i) => `${i + 1}. ${step}`).join("\n")}`);
    await pause(250);
    state.lastRun.plans[student.id] = plan;
    student.memory.push(`${today}: ${plan.store}`);
    state.draft = "";
    state.draftWho = "";
    render();
  }

  state.running = false;
  render();
  setStatus("All five plans are in. The mathematics came from the teacher agent. The ways in came from the student agents. Open a student to read the plan.");
}

function init() {
  $("assign").addEventListener("submit", runAgents);
  $("reset").addEventListener("click", () => {
    if (!state.running) loadState();
  });
  $("roster").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open]");
    if (button) select(button.dataset.open);
  });
  $("plan").addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) closePlan();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedId) closePlan();
  });
  loadState();
}

init();

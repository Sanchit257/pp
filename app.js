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

async function loadState() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("The classroom state did not load.");
  const data = await response.json();
  state.model = data.model;
  state.students = data.students;
  state.lastRun = data.lastRun;
  $("model-line").textContent = `Teacher agent and student agents call ${data.model} on this computer through Ollama. Memory is saved in data/room.json.`;
  if (data.lastRun?.assignment) $("assignment").value = data.lastRun.assignment;
  render();
  setStatus(data.lastRun ? "The last run is loaded from memory on this computer." : "Portraits and memory are loaded. The agents have not planned today yet.");
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
  render();
  setStatus("Starting the agents.");
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment: $("assignment").value }),
    });
    if (!response.ok || !response.body) {
      const message = await response.text();
      throw new Error(message || `The run failed (${response.status}).`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        applyEvent(JSON.parse(line.slice(5).trim()));
      }
    }
  } catch (err) {
    setStatus(err.message || "The run failed.");
  } finally {
    state.running = false;
    state.draft = "";
    state.draftWho = "";
    render();
  }
}

function applyEvent(event) {
  if (event.type === "status") {
    setStatus(event.text);
    state.draft = "";
    render();
    return;
  }
  if (event.type === "token") {
    state.draftWho = event.id || event.who;
    state.draft += event.text;
    showDraft();
    const roster = $("roster");
    roster.querySelectorAll(".student").forEach((row) => row.classList.remove("writing"));
    const current = roster.querySelector(`[data-open="${CSS.escape(state.draftWho)}"]`)?.closest(".student");
    current?.classList.add("writing");
    return;
  }
  if (event.type === "teacher") {
    state.lastRun = { ...(state.lastRun || {}), assignment: $("assignment").value, brief: event.brief, plans: {} };
    state.draft = "";
    render();
    setStatus("The brief is in. Student agents are next.");
    return;
  }
  if (event.type === "student") {
    const student = studentById(event.id);
    if (student) student.memory = event.memory;
    state.lastRun.plans[event.id] = event.plan;
    state.draft = "";
    state.draftWho = "";
    render();
    return;
  }
  if (event.type === "done") {
    state.students = event.state.students;
    state.lastRun = event.state.lastRun;
    setStatus("All five plans are in and saved. The mathematics came from the teacher agent. The ways in came from the student agents.");
    render();
    return;
  }
  if (event.type === "error") {
    setStatus(event.text);
  }
}

function init() {
  $("assign").addEventListener("submit", runAgents);
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
  loadState().catch((err) => setStatus(err.message));
}

init();

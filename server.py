#!/usr/bin/env python3
"""Room 12: one teacher agent and five student agents, calling local Qwen3."""

import json
import re
import threading
import traceback
import urllib.error
import urllib.request
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "room.json"
OLLAMA = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3"
LOCK = threading.Lock()
RUN = threading.Lock()

SEED = {
    "model": MODEL,
    "lastRun": None,
    "students": [
        {
            "id": "amina",
            "name": "Amina Rahman",
            "kind": "Visual learner",
            "capability": "Fast pace. Facts through 12 are automatic. A spoken list of steps fades within a minute.",
            "reached": "She took the picture and finished while the spoken directions were still going.",
            "fellApart": "With the picture removed and only the voice left, she lost the second step.",
            "memory": [
                "Week 1: she finished from the picture and lost the second step when only the voice was left.",
                "Last week she drew a correct area model for multi-digit multiplication and skipped the written partial products. Listening without a picture, she missed a step.",
            ],
        },
        {
            "id": "theo",
            "name": "Theo Lang",
            "kind": "Auditory learner",
            "capability": "Steady pace. Holds a chant. Drops facts and steps when the work goes silent.",
            "reached": "He chose the spoken version and could repeat it after one hearing.",
            "fellApart": "The same task on a silent page, and the procedure dropped out halfway.",
            "memory": [
                "Week 1: he repeated the spoken version after one hearing and lost it on a silent page.",
                "The harder multiplication facts stuck as a skip-count chant. On a timed silent sheet those facts were gone.",
            ],
        },
        {
            "id": "lila",
            "name": "Lila Nguyen",
            "kind": "Learn by doing",
            "capability": "Deliberate pace. Facts are solid through the 5s. The idea slips if the objects are cleared too soon.",
            "reached": "She went straight for the blocks and built the answer correctly.",
            "fellApart": "When the blocks were put away before she wrote, the written answer no longer matched what she had built.",
            "memory": [
                "Week 1: the blocks were right, and the written answer was wrong after the blocks were cleared.",
                "She showed 12 × 4 with bags of cubes. The product on the paper was wrong after the cubes were cleared first.",
            ],
        },
        {
            "id": "jonah",
            "name": "Jonah Ellis",
            "kind": "Reading and writing",
            "capability": "Steady pace. Writes well above grade. Place value slips when a sentence forgets the units. Being wrong in front of the class throws him.",
            "reached": "He chose the page and wrote a clear account.",
            "fellApart": "The account sounded right and still used the wrong unit, and he would not say so in front of the group.",
            "memory": [
                "Week 1: the writing was clear and the unit was still wrong. He would not correct it out loud.",
                "He wrote a clean explanation of rounding and then rounded 1,450 to 1,000. The sentences never said whether the digits were thousands or hundreds.",
            ],
        },
        {
            "id": "mateo",
            "name": "Mateo Cruz",
            "kind": "Sequential learner",
            "capability": "Deliberate pace. Strong estimate. Working memory holds about two steps, then the rest falls off.",
            "reached": "He started willingly and got the first two moves right when they were shown one at a time.",
            "fellApart": "Given the whole procedure at once, the third step vanished even though the first two had been correct.",
            "memory": [
                "Week 1: two moves shown one at a time held. The whole procedure at once lost step three.",
                "Two-step word problems hold. Three-step problems fail on the third step. He gets that step back when it arrives alone, after the first two are done.",
            ],
        },
    ],
}


def load_state():
    if not DATA.exists():
        DATA.parent.mkdir(parents=True, exist_ok=True)
        save_state(SEED)
        return json.loads(json.dumps(SEED))
    return json.loads(DATA.read_text())


def save_state(state):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(DATA)


def strip_think(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def parse_json(text):
    clean = strip_think(text)
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        start = clean.find("{")
        end = clean.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(clean[start : end + 1])


def split_problem(text):
    match = re.search(r"(\d+)\s*(?:÷|/|divided by)\s*(\d+)", str(text), re.I)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def check_brief(brief):
    errors = []
    for label, problem_key, q_key, r_key in (
        ("anchor", "anchorProblem", "anchorQuotient", "anchorRemainder"),
        ("stretch", "stretchProblem", "stretchQuotient", "stretchRemainder"),
    ):
        parsed = split_problem(brief.get(problem_key, ""))
        if not parsed:
            errors.append(f"{label} problem is not a division expression")
            continue
        dividend, divisor = parsed
        if divisor <= 0:
            errors.append(f"{label} divisor is invalid")
            continue
        try:
            quotient = int(brief.get(q_key))
            remainder = int(brief.get(r_key))
        except (TypeError, ValueError):
            errors.append(f"{label} quotient or remainder is not an integer")
            continue
        if remainder < 0 or remainder >= divisor:
            errors.append(f"{label} remainder {remainder} is not smaller than the divisor {divisor}")
        got = quotient * divisor + remainder
        if got != dividend:
            errors.append(f"{label}: {quotient} × {divisor} + {remainder} = {got}, not {dividend}")
    return errors


def ollama_chat(messages, predict, on_token):
    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": True,
        "think": False,
        "format": "json",
        "options": {"temperature": 0.3, "num_predict": predict, "num_ctx": 4096},
    }

    def stream(body):
        req = urllib.request.Request(
            OLLAMA,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        parts = []
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                if not raw.strip():
                    continue
                chunk = json.loads(raw)
                token = chunk.get("message", {}).get("content") or ""
                if token:
                    parts.append(token)
                    on_token(token)
                if chunk.get("done"):
                    break
        return "".join(parts)

    try:
        return stream(payload)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        if err.code == 400 and "think" in detail.lower():
            payload.pop("think", None)
            return stream(payload)
        raise RuntimeError(detail or f"Ollama returned {err.code}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(
            "Ollama is not running on this computer. Start it with: ollama serve. The open model already downloaded here is qwen3."
        ) from err


TEACHER_SYSTEM = """You are the teacher agent for one grade 4 class.
You do not teach the individual children. You state what every student agent must aim at today.
A student agent may later shrink the work or withhold the stretch problem. It may not change the topic.
Return only JSON with these keys:
title (string),
aim (string),
minutes (number, use 35),
anchorProblem (string, a three-digit number divided by a one-digit number, written with the ÷ sign, that comes out even),
anchorQuotient (integer),
anchorRemainder (integer, 0 if it comes out even),
stretchProblem (string, a different three-digit ÷ one-digit problem that leaves a remainder),
stretchQuotient (integer),
stretchRemainder (integer, greater than 0 and smaller than the divisor),
must (array of exactly 4 short strings: a visible estimate, the divide-multiply-subtract-bring-down cycle talked about as hundreds tens and ones, a remainder smaller than the divisor, and the check quotient × divisor + remainder = dividend),
freedom (string: student agents may shrink the path or withhold the stretch, and they may not change the anchor problem).
Compute the arithmetic yourself. Do not invent a check that is false."""


def teacher_user(assignment):
    return f"The human teacher assigned this for today: {assignment}\nWrite today's brief."


STUDENT_SYSTEM = """You are one child's student agent. You have kept this child's portrait and memory all year.
You just received the teacher agent's brief. Write today's plan for this child only.
Return only JSON with these keys:
approach (one sentence a teacher can read while walking past the desk),
why (why this plan fits this child, using the portrait and the memory, not a slogan about learning styles),
path (array of 4 to 6 short steps for the period),
worked (the anchor problem worked in this child's mode, with the real numbers and the units hundreds, tens, or ones),
stretchDecision (exactly one of: today, if_ready, withheld),
stretchReason (one sentence),
doneWhen (what counts as success today, which may be less than a finished page),
watch (what the human teacher should notice),
room (object with start, middle, end: where this child should be at the beginning, middle, and end of the 35 minutes),
store (one sentence this agent will keep for the next lesson).
Use the anchor problem and the checked arithmetic from the brief. Do not change those numbers.
If the memory says this child loses later steps when they arrive together, set stretchDecision to withheld and make doneWhen the estimate plus the first cycle only."""


def student_user(student, brief):
    memory = "\n".join(f"- {note}" for note in student["memory"])
    return (
        f"Child: {student['name']}\n"
        f"Portrait label: {student['kind']}\n"
        f"What they can hold: {student['capability']}\n"
        f"What they reached for in week 1: {student['reached']}\n"
        f"Where it fell apart: {student['fellApart']}\n"
        f"Memory kept since week 1, oldest first:\n{memory}\n\n"
        f"Teacher agent brief, arithmetic already checked:\n{json.dumps(brief, ensure_ascii=False)}\n\n"
        "Write today's plan."
    )


def run_lesson(assignment, emit):
    assignment = assignment.strip()
    if not assignment:
        raise RuntimeError("The assignment is empty.")
    state = load_state()
    emit({"type": "status", "text": "Loading Qwen3, then the teacher agent writes the brief."})

    def tokens(kind, who=None):
        def on_token(token):
            event = {"type": "token", "who": kind, "text": token}
            if who:
                event["id"] = who
            emit(event)

        return on_token

    raw = ollama_chat(
        [
            {"role": "system", "content": TEACHER_SYSTEM},
            {"role": "user", "content": teacher_user(assignment)},
        ],
        700,
        tokens("teacher"),
    )
    brief = parse_json(raw)
    errors = check_brief(brief)
    if errors:
        emit({"type": "status", "text": "The teacher agent's arithmetic did not hold. Asking it to correct the numbers."})
        fix = ollama_chat(
            [
                {"role": "system", "content": TEACHER_SYSTEM},
                {"role": "user", "content": teacher_user(assignment)},
                {"role": "assistant", "content": strip_think(raw)},
                {
                    "role": "user",
                    "content": "The arithmetic is wrong: "
                    + " ".join(errors)
                    + " Return the full JSON again with corrected integers. Keep the same two problems if you can fix them.",
                },
            ],
            700,
            tokens("teacher"),
        )
        brief = parse_json(fix)
        errors = check_brief(brief)
    brief["mathCheck"] = "verified" if not errors else "unverified: " + " ".join(errors)
    emit({"type": "teacher", "brief": brief})

    plans = {}
    for student in state["students"]:
        emit({"type": "status", "text": f"{student['name'].split()[0]}'s agent is writing the plan from the brief and the memory it has kept."})
        raw_plan = ollama_chat(
            [
                {"role": "system", "content": STUDENT_SYSTEM},
                {"role": "user", "content": student_user(student, brief)},
            ],
            1100,
            tokens("student", student["id"]),
        )
        plan = parse_json(raw_plan)
        decision = str(plan.get("stretchDecision", "")).strip().lower().replace(" ", "_").replace("-", "_")
        if decision not in {"today", "if_ready", "withheld"}:
            decision = "if_ready"
        plan["stretchDecision"] = decision
        plans[student["id"]] = plan
        store = str(plan.get("store", "")).strip()
        if store:
            student["memory"].append(f"{date.today().isoformat()}: {store}")
        emit({"type": "student", "id": student["id"], "plan": plan, "memory": student["memory"]})
        with LOCK:
            state["lastRun"] = {
                "assignment": assignment,
                "at": date.today().isoformat(),
                "brief": brief,
                "plans": plans,
            }
            save_state(state)

    emit({"type": "done", "state": public_state(state)})


def public_state(state=None):
    state = state if state is not None else load_state()
    return {"model": state.get("model", MODEL), "students": state["students"], "lastRun": state.get("lastRun")}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/state":
            body = json.dumps(public_state()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/run":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            incoming = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            incoming = {}
        if not RUN.acquire(blocking=False):
            message = json.dumps({"error": "A lesson is already running."}).encode()
            self.send_response(409)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def emit(event):
            self.wfile.write(b"data: " + json.dumps(event, ensure_ascii=False).encode() + b"\n\n")
            self.wfile.flush()

        try:
            run_lesson(str(incoming.get("assignment", "")), emit)
        except Exception as err:
            traceback.print_exc()
            try:
                emit({"type": "error", "text": str(err)})
            except Exception:
                pass
        finally:
            RUN.release()

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")


if __name__ == "__main__":
    load_state()
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Room 12 agents at http://127.0.0.1:8765  model=qwen3")
    server.serve_forever()

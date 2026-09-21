/* index.js — hardened PS4 Loader entry point. */
"use strict";

const PAYLOADS = {
  hen:     { name: "HEN",     file: "payload2.bin", aliases: ["payload.bin", "payload2.bin"] },
  goldhen: { name: "GoldHEN", file: "goldhen.bin", aliases: ["payload.bin", "payload2.bin"] },
};

/* ---------- firmware detection ---------- */
function detectFirmware() {
  const m = (navigator.userAgent || "").match(/PlayStation\s+4[\/ ](\d+)\.(\d+)/);
  if (!m) return { key: null, label: "not a PS4" };
  const key = m[1] + "." + parseInt(m[2], 16).toString(16).padStart(2, "0");
  return { key, label: key };
}

/* ---------- dom ---------- */
const $ = (id) => document.getElementById(id);
const cardsEl = $("cards"), goBtn = $("go"), logBtn = $("toggleLog");
const spinEl = $("spin"), stateEl = $("state"), outEl = $("out");
const fwChip = $("fwchip"), fwLabel = $("fwlabel"), logWrap = $("logwrap");

/* ---------- state ---------- */
let selected = null, running = false, shimInstalled = false, ranOnce = false;

/* ---------- ui ---------- */
function setState(t, c) { stateEl.textContent = t; stateEl.className = c || ""; }
function setSpin(m) {
  spinEl.classList.remove("on", "done", "fail");
  if (m) spinEl.classList.add(m);
}
function logLine(tag, detail) {
  const cls =
    /FAIL|ERROR|THREW|REBOOT|MISS|LOST|POISON|TIMEOUT|MISMATCH|ABORTED|NOT-e9/i.test(tag) ? "bad" :
    /WARN|SKIP|REFUSED|COMMITTED|DIRTY|OVERRIDE/i.test(tag) ? "warn" :
    /\bOK\b|PASS|ACHIEVED|RUNNING|ARMED|UP\b/i.test(tag) ? "ok" : "";
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = tag + (detail ? "  " + detail : "") + "\n";
  outEl.appendChild(line);
  outEl.scrollTop = outEl.scrollHeight;
}
function clearLog() { outEl.textContent = ""; }

/* ---------- selection ---------- */
function select(kind) {
  if (running) return;
  selected = kind;
  cardsEl.querySelectorAll(".card").forEach((c) =>
    c.classList.toggle("sel", c.dataset.kind === kind));
  goBtn.disabled = false;
  setState(`Selected ${PAYLOADS[kind].name}. Ready.`, "");
}
cardsEl.addEventListener("click", (e) => {
  const c = e.target.closest(".card"); if (c) select(c.dataset.kind);
});
cardsEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const c = e.target.closest(".card");
    if (c) { e.preventDefault(); select(c.dataset.kind); }
  }
});
logBtn.addEventListener("click", () => {
  logWrap.classList.toggle("log");
  logBtn.textContent = logWrap.classList.contains("log") ? "Hide log" : "Log";
});

/* ---------- fetch shim ---------- */
function installFetchShim(payload) {
  if (shimInstalled) return;
  shimInstalled = true;

  const realFetch = window.fetch.bind(window);
  const aliases = new Set(payload.aliases);

  window.fetch = function (input, init) {
    try {
      let url =
        typeof input === "string" ? input :
        input instanceof Request ? input.url :
        String(input);
      const base = url.split("?")[0].split("#")[0];
      const tail = base.split("/").pop();
      if (aliases.has(tail)) {
        const rebased = base.replace(/[^/]*$/, payload.file) + url.slice(base.length);
        logLine("PAYLOAD-OVERRIDE", `${tail} -> ${payload.file}`);
        // Only ever call with the plain string form — safest.
        return init === undefined
          ? realFetch(rebased)
          : realFetch(rebased, init);
      }
    } catch (_) {}
    return realFetch(input, init);
  };
}

/* ---------- xhr shim (mirror POST /t into the log) ---------- */
function installXhrShim() {
  const realOpen = XMLHttpRequest.prototype.open;
  const realSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ps4url = url;
    return realOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__ps4url && /(^|\/|\b)t$/.test(this.__ps4url) && typeof body === "string") {
        // body looks like: "PS4-JB&tag=...&detail=..."
        const cleaned = body.replace(/^PS4-JB&?/, "");
        const p = new URLSearchParams(cleaned);
        const tag = p.get("tag") || "LOG";
        const detail = p.get("detail") || "";
        logLine(tag, detail);
      }
    } catch (_) {}
    return realSend.call(this, body);
  };
}

/* ---------- wait for jb.js to flip body.className ---------- */
function waitForFinish(timeoutMs = 180000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const cls = document.body.className || "";
      if (cls.includes("done")) return resolve(true);
      if (cls.includes("fail")) return resolve(false);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

/* ---------- run ---------- */
async function run() {
  if (running || !selected) return;

  if (ranOnce) {
    setState("Already ran — reload the page to run again.", "warn");
    return;
  }

  running = true;
  ranOnce = true;
  goBtn.disabled = true;
  cardsEl.querySelectorAll(".card").forEach((c) => (c.style.pointerEvents = "none"));

  clearLog();
  setSpin("on");
  setState(`Starting ${PAYLOADS[selected].name}…`, "warn");

  installFetchShim(PAYLOADS[selected]);
  installXhrShim();

  try {
    await import("./jb.js?v=" + Date.now());
    const done = await waitForFinish();
    setSpin(done ? "done" : "fail");
    setState(
      done ? "Done. Restart your console if nothing happened."
           : "Finished with warnings — check the log.",
      done ? "ok" : "warn",
    );
  } catch (err) {
    setSpin("fail");
    setState("Failed: " + (err && err.message ? err.message : String(err)), "bad");
    logLine("LOADER-THREW", String(err && err.stack || err));
  } finally {
    running = false;
    goBtn.disabled = false;
    cardsEl.querySelectorAll(".card").forEach((c) => (c.style.pointerEvents = ""));
  }
}

goBtn.addEventListener("click", run);

/* ---------- boot ---------- */
(function boot() {
  const fw = detectFirmware();
  fwLabel.textContent = fw.label === "not a PS4" ? "not a PS4 — exploit will bail" : "FW " + fw.label;
  fwChip.innerHTML = "FW <b>" + fw.label + "</b>";
  const q = new URLSearchParams(location.search).get("payload");
  select(q === "goldhen" ? "goldhen" : "hen");
  logLine("LOADER-READY", "fw=" + fw.label + "  use ?payload=goldhen to preselect");
})();
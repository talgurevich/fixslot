// Server-rendered dashboard. Intentionally lightweight: one HTML page plus
// vanilla JS that talks to the /api/* endpoints. No frontend build step (spec §7).

export function renderLogin(error = false): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>fixslot — login</title>
  <style>${baseCss}</style>
</head>
<body>
  <main class="card" style="max-width:360px;margin:10vh auto;">
    <h1>fixslot</h1>
    <p class="muted">Trainer dashboard</p>
    ${error ? '<p class="error">Wrong password.</p>' : ""}
    <form method="post" action="/login">
      <label>Password<input type="password" name="password" autofocus required /></label>
      <button type="submit">Log in</button>
    </form>
  </main>
</body>
</html>`;
}

export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>fixslot — dashboard</title>
  <style>${baseCss}</style>
</head>
<body>
  <header class="topbar">
    <strong>fixslot</strong>
    <form method="post" action="/logout" style="margin:0">
      <button class="ghost" type="submit">Log out</button>
    </form>
  </header>

  <main>
    <section class="card">
      <h2>Availability</h2>
      <p class="muted">Weekly recurring hours. Add a row per window.</p>
      <table id="rules"><thead><tr><th>Day</th><th>Start</th><th>End</th><th></th></tr></thead><tbody></tbody></table>
      <div class="row">
        <button id="add-rule" class="ghost">+ Add window</button>
        <button id="save-rules">Save availability</button>
        <span id="rules-status" class="muted"></span>
      </div>
    </section>

    <section class="card">
      <h2>Block-out dates</h2>
      <p class="muted">Whole-day if times are left blank, otherwise just that window.</p>
      <div class="row">
        <input type="date" id="bo-date" />
        <input type="time" id="bo-start" placeholder="start" />
        <input type="time" id="bo-end" placeholder="end" />
        <button id="add-bo">Add</button>
      </div>
      <ul id="blackouts" class="list"></ul>
    </section>

    <section class="card">
      <h2>Bookings</h2>
      <p class="muted">Upcoming confirmed bookings (read-only).</p>
      <table id="bookings"><thead><tr><th>When</th><th>Client</th><th>Phone</th></tr></thead><tbody></tbody></table>
    </section>

    <section class="card">
      <h2>Settings</h2>
      <form id="settings">
        <div class="grid">
          <label>Slot duration (min)<input type="number" name="slotDurationMinutes" min="5" /></label>
          <label>Booking horizon (days)<input type="number" name="bookingHorizonDays" min="1" /></label>
          <label>Slots offered<input type="number" name="maxSlotsOffered" min="1" /></label>
          <label>Trainer WhatsApp<input type="text" name="trainerPhone" placeholder="9725..." /></label>
          <label>Timezone<input type="text" name="timezone" /></label>
        </div>
        <label>Greeting template<input type="text" name="greetingTemplate" /></label>
        <label>Confirmation template <span class="muted">({slot})</span><input type="text" name="confirmationTemplate" /></label>
        <label>No-slots template<input type="text" name="noSlotsTemplate" /></label>
        <label>Reprompt template <span class="muted">({max})</span><input type="text" name="repromptTemplate" /></label>
        <div class="row">
          <button type="submit">Save settings</button>
          <span id="settings-status" class="muted"></span>
        </div>
      </form>
    </section>

    <section class="card dev">
      <h2>Dev simulator</h2>
      <p class="muted">Send a fake inbound WhatsApp message and see the bot's reply. Local only.</p>
      <div class="row">
        <input type="text" id="sim-phone" value="972500000000" />
        <input type="text" id="sim-text" placeholder="message, e.g. hi  /  1" />
        <button id="sim-send">Send</button>
      </div>
      <pre id="sim-out" class="out"></pre>
    </section>
  </main>

  <script>${dashboardJs}</script>
</body>
</html>`;
}

const baseCss = `
  :root{--bg:#0f172a;--card:#1e293b;--mut:#94a3b8;--acc:#38bdf8;--txt:#e2e8f0;--bd:#334155}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,sans-serif}
  main{max-width:860px;margin:0 auto;padding:20px;display:grid;gap:20px}
  .topbar{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:var(--card);border-bottom:1px solid var(--bd)}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:20px}
  h1,h2{margin:0 0 4px} h2{font-size:18px}
  .muted{color:var(--mut);font-size:13px;margin:0 0 12px}
  .error{color:#fca5a5}
  label{display:block;margin:8px 0;font-size:13px;color:var(--mut)}
  input{width:100%;margin-top:4px;padding:8px;border:1px solid var(--bd);border-radius:8px;background:#0b1220;color:var(--txt)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .row input{width:auto;flex:1;min-width:120px}
  button{padding:8px 14px;border:0;border-radius:8px;background:var(--acc);color:#04222e;font-weight:600;cursor:pointer}
  button.ghost{background:transparent;border:1px solid var(--bd);color:var(--txt);font-weight:500}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);font-size:14px}
  th{color:var(--mut);font-weight:600}
  td select,td input{width:auto;margin:0}
  .list{list-style:none;padding:0;margin:8px 0 0}
  .list li{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--bd)}
  .dev{border-style:dashed}
  .out{background:#0b1220;border:1px solid var(--bd);border-radius:8px;padding:10px;white-space:pre-wrap;min-height:24px;font-size:13px}
`;

const dashboardJs = `
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const $ = (s) => document.querySelector(s);
async function api(path, opts) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

// --- Availability ---
function ruleRow(r = { weekday: 1, startTime: "09:00", endTime: "12:00" }) {
  const tr = document.createElement("tr");
  const days = DAYS.map((d, i) => '<option value="' + i + '"' + (i === r.weekday ? " selected" : "") + ">" + d + "</option>").join("");
  tr.innerHTML = '<td><select class="r-day">' + days + '</select></td>' +
    '<td><input type="time" class="r-start" value="' + r.startTime + '"></td>' +
    '<td><input type="time" class="r-end" value="' + r.endTime + '"></td>' +
    '<td><button class="ghost r-del">✕</button></td>';
  tr.querySelector(".r-del").onclick = () => tr.remove();
  return tr;
}
async function loadRules() {
  const rules = await api("/api/availability");
  const body = $("#rules tbody"); body.innerHTML = "";
  rules.forEach((r) => body.appendChild(ruleRow(r)));
}
$("#add-rule").onclick = () => $("#rules tbody").appendChild(ruleRow());
$("#save-rules").onclick = async () => {
  const rules = [...document.querySelectorAll("#rules tbody tr")].map((tr) => ({
    weekday: Number(tr.querySelector(".r-day").value),
    startTime: tr.querySelector(".r-start").value,
    endTime: tr.querySelector(".r-end").value,
  }));
  try { await api("/api/availability", { method: "PUT", body: JSON.stringify({ rules }) }); $("#rules-status").textContent = "Saved ✓"; }
  catch (e) { $("#rules-status").textContent = "Error: " + e.message; }
};

// --- Blackouts ---
async function loadBlackouts() {
  const items = await api("/api/blackouts");
  const ul = $("#blackouts"); ul.innerHTML = "";
  items.forEach((b) => {
    const li = document.createElement("li");
    const window = b.startTime ? (b.startTime + "–" + b.endTime) : "all day";
    li.innerHTML = "<span>" + b.date + " (" + window + ")</span>";
    const del = document.createElement("button"); del.className = "ghost"; del.textContent = "Remove";
    del.onclick = async () => { await api("/api/blackouts/" + b.id, { method: "DELETE" }); loadBlackouts(); };
    li.appendChild(del); ul.appendChild(li);
  });
}
$("#add-bo").onclick = async () => {
  const date = $("#bo-date").value, startTime = $("#bo-start").value || null, endTime = $("#bo-end").value || null;
  if (!date) return;
  try { await api("/api/blackouts", { method: "POST", body: JSON.stringify({ date, startTime, endTime }) }); loadBlackouts(); }
  catch (e) { alert(e.message); }
};

// --- Bookings ---
async function loadBookings() {
  const items = await api("/api/bookings");
  const body = $("#bookings tbody"); body.innerHTML = "";
  if (!items.length) { body.innerHTML = '<tr><td colspan="3" class="muted">No upcoming bookings.</td></tr>'; return; }
  items.forEach((b) => {
    const tr = document.createElement("tr");
    const when = new Date(b.startTime).toLocaleString();
    tr.innerHTML = "<td>" + when + "</td><td>" + b.clientName + "</td><td>" + b.clientPhone + "</td>";
    body.appendChild(tr);
  });
}

// --- Settings ---
async function loadSettings() {
  const c = await api("/api/config");
  const f = $("#settings");
  for (const k of Object.keys(c)) if (f.elements[k]) f.elements[k].value = c[k];
}
$("#settings").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, data = {};
  for (const el of f.elements) if (el.name) data[el.name] = el.value;
  try { await api("/api/config", { method: "POST", body: JSON.stringify(data) }); $("#settings-status").textContent = "Saved ✓"; }
  catch (err) { $("#settings-status").textContent = "Error: " + err.message; }
};

// --- Dev simulator ---
$("#sim-send").onclick = async () => {
  const phone = $("#sim-phone").value, text = $("#sim-text").value;
  try {
    const res = await api("/api/dev/sim", { method: "POST", body: JSON.stringify({ phone, text }) });
    $("#sim-out").textContent = res.replies.length ? res.replies.map((m) => m.text).join("\\n\\n") : "(no reply)";
  } catch (e) { $("#sim-out").textContent = "Error: " + e.message; }
};

loadRules(); loadBlackouts(); loadBookings(); loadSettings();
`;

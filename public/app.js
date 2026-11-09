const header = document.querySelector("#header");
const page = document.querySelector("#page");
const metrics = [
  {
    key: "smm",
    label: "Skeletal Muscle Mass",
    short: "SMM",
    unit: "kg",
    decimals: 1,
  },
  { key: "bfm", label: "Body Fat Mass", short: "BFM", unit: "kg", decimals: 1 },
  {
    key: "pbf",
    label: "Percent Body Fat",
    short: "PBF",
    unit: "%",
    decimals: 1,
  },
  {
    key: "vfa_level",
    label: "Visceral Fat Level",
    short: "VFL",
    unit: "",
    decimals: 0,
  },
  {
    key: "bmr",
    label: "Basal Metabolic Rate",
    short: "BMR",
    unit: "kcal",
    decimals: 0,
  },
];
const state = {
  chart: null,
  editing: false,
  notice: null,
  selectedMetric: "smm",
};
let renderVersion = 0;

function el(tag, options = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === "className") node.className = value;
    else if (key.startsWith("on"))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node[key] = value;
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  node.replaceChildren();
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function localTestTime(value) {
  if (!value || !/^\d{14}$/.test(value)) return "—";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}`;
}

function localTestDate(value) {
  return value ? localTestTime(value).slice(0, 10) : "—";
}

function formatPhone(value) {
  const phone = String(value || "").replace(/\D/g, "");
  if (phone.length === 11)
    return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (phone.length === 10)
    return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  return phone || "—";
}

function rounded(value, decimals) {
  return Number(Number(value).toFixed(decimals));
}

function valueText(value, metric) {
  if (value == null || value === "") return "—";
  return `${rounded(value, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function changeText(first, latest, metric) {
  if (first?.[metric.key] == null || latest?.[metric.key] == null) return "—";
  const change = rounded(
    Number(latest[metric.key]) - Number(first[metric.key]),
    metric.decimals,
  );
  if (change === 0) return `0${metric.unit ? ` ${metric.unit}` : ""}`;
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function listChange(measurements) {
  if (!measurements.length) return "—";
  if (measurements.length === 1) return "1 measurement";
  const first = measurements[0];
  const latest = measurements.at(-1);
  const smm = metrics[0];
  const pbf = metrics[2];
  return `${smm.short} ${changeText(first, latest, smm)} · ${pbf.short} ${changeText(first, latest, pbf)}`;
}

function relativeTime(value) {
  if (!value) return "No webhooks yet";
  const source = String(value).includes("T")
    ? String(value)
    : `${String(value).replace(" ", "T")}Z`;
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(source).getTime()) / 1000),
  );
  if (seconds < 60) return "Last webhook: just now";
  if (seconds < 3600)
    return `Last webhook: ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400)
    return `Last webhook: ${Math.floor(seconds / 3600)} hr ago`;
  return `Last webhook: ${Math.floor(seconds / 86400)} days ago`;
}

function notice(parent) {
  if (!state.notice) return;
  parent.append(
    el("p", { className: `message ${state.notice.type}` }, state.notice.text),
  );
}

function showNotice(text, type = "success") {
  state.notice = { text, type };
}

async function refreshHeader() {
  try {
    const status = await request("/api/status");
    clear(header);
    const bar = el("div", { className: "topbar" });
    bar.append(
      el("a", { className: "brand", href: "#/" }, "InBody Progress Tracker"),
    );
    if (!status.authEnabled) {
      const warning = el(
        "p",
        { className: "message" },
        "Basic Auth is off. Set BASIC_AUTH_PASSWORD in .env before exposing this server with ngrok.",
      );
      Object.assign(warning.style, {
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        color: "#92400e",
      });
      header.append(warning);
    }
    const details = el("div", { className: "status" });
    const usage = el(
      "span",
      {},
      `API calls today: ${status.used} / ${status.limit}`,
    );
    usage.append(el("small", {}, ` (${status.reserve} reserved)`));
    details.append(usage, el("span", {}, relativeTime(status.lastWebhookAt)));
    if (status.unlinkedCount > 0) {
      details.append(
        el(
          "span",
          {
            className: "unlinked",
            title: "Add a client with the same phone number to link them.",
          },
          `Unlinked measurements: ${status.unlinkedCount}`,
        ),
      );
    }
    bar.append(details);
    header.append(bar);
  } catch (error) {
    clear(header);
    header.append(el("p", { className: "message error" }, error.message));
  }
}

function addForm() {
  const card = el("section", { className: "card" });
  card.append(el("h2", {}, "Add client"));
  card.append(
    el(
      "p",
      { className: "muted" },
      "Optional — fill in all three to also register this client in LB Web, so they don't have to enter details on the device.",
    ),
  );
  const form = el("form", { className: "form-row" });
  const name = el("input", {
    name: "name",
    required: true,
    maxLength: 45,
    placeholder: "Jane Doe",
  });
  const phone = el("input", {
    name: "phone",
    required: true,
    inputMode: "numeric",
    placeholder: "010-1234-5678",
  });
  const gender = el("select", { name: "gender" });
  gender.append(
    el("option", { value: "" }, ""),
    el("option", { value: "M" }, "Male (M)"),
    el("option", { value: "F" }, "Female (F)"),
  );
  const birthDay = el("input", { name: "birthDay", type: "date" });
  const height = el("input", {
    name: "height",
    type: "number",
    min: "0.1",
    max: "299.9",
    step: "0.1",
    placeholder: "175.0",
  });
  form.append(
    field("Name", name),
    field("Phone", phone),
    field("Gender", gender),
    field("Birth date", birthDay),
    field("Height (cm)", height),
    el("button", { className: "primary", type: "submit" }, "Add"),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = await request("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.value,
          phone: phone.value,
          gender: gender.value,
          birthDay: birthDay.value,
          height: height.value,
        }),
      });
      showNotice(addClientMessage(result));
      await loadRoute();
      refreshHeader();
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
      await loadRoute();
    }
  });
  card.append(form);
  return card;
}

function addClientMessage(result) {
  const messages = {
    registered: "Client added and registered in LB Web.",
    already_exists:
      "Client added. This ID already exists in LB Web, so it was not registered again.",
    skipped_limit:
      "Client added. LB Web registration skipped: daily API limit reached.",
    skipped_not_configured:
      "Client added. LB Web registration skipped: InBody API key is not set.",
    not_requested: "Client added.",
  };
  const message =
    result.lbweb?.status === "failed"
      ? `Client added, but LB Web registration failed: ${result.lbweb.message} Enter the details on the device instead.`
      : messages[result.lbweb?.status] || "Client added.";
  return `${message}${result.linkedCount ? ` ${result.linkedCount} measurements linked.` : ""}`;
}

function field(label, input) {
  const wrapper = el("label", {}, label);
  wrapper.append(input);
  return wrapper;
}

function customerTable(customers) {
  if (!customers.length)
    return el(
      "p",
      { className: "empty" },
      "No clients yet. Add a client above, then measure on an InBody device using the same phone number.",
    );
  const table = el("table");
  const headings = ["Name", "Phone", "Last measured", "Change"];
  const head = el("thead");
  const headingRow = el("tr");
  headings.forEach((heading) => headingRow.append(el("th", {}, heading)));
  head.append(headingRow);
  const body = el("tbody");
  const sorted = [...customers].sort((a, b) => {
    const latestA = a.measurements.at(-1)?.test_at;
    const latestB = b.measurements.at(-1)?.test_at;
    if (latestA && latestB) return latestB.localeCompare(latestA);
    if (latestA) return -1;
    if (latestB) return 1;
    return String(a.created_at).localeCompare(String(b.created_at));
  });
  for (const customer of sorted) {
    const row = el("tr", { className: "clickable", tabIndex: 0 });
    const open = () => {
      location.hash = `#/clients/${customer.id}`;
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open();
    });
    row.append(
      el("td", {}, customer.name),
      el("td", {}, formatPhone(customer.phone)),
      el("td", {}, localTestTime(customer.measurements.at(-1)?.test_at)),
      el("td", {}, listChange(customer.measurements)),
    );
    body.append(row);
  }
  table.append(head, body);
  return el("div", { className: "table-wrap" }).appendChild(table)
    .parentElement;
}

function renderList(customers) {
  clear(page);
  notice(page);
  page.append(addForm());
  const card = el("section", { className: "card" });
  card.append(el("h2", {}, "Clients"), customerTable(customers));
  page.append(card);
}

function detailHeader(customer) {
  const container = el("section", { className: "card" });
  const heading = el("div", { className: "detail-head" });
  const identity = el("div");
  identity.append(
    el("h2", {}, customer.name),
    el("div", { className: "muted" }, formatPhone(customer.phone)),
  );
  const actions = el("div", { className: "button-row" });
  const edit = el("button", { className: "secondary" }, "Edit");
  edit.addEventListener("click", () => {
    state.editing = true;
    renderDetail(customer);
  });
  const remove = el("button", { className: "danger" }, "Delete");
  remove.addEventListener("click", async () => {
    if (
      !confirm(
        "Delete this client? Measurements are kept and will be linked again if you add a client with the same phone number.",
      )
    )
      return;
    try {
      await request(`/api/customers/${customer.id}`, { method: "DELETE" });
      state.editing = false;
      showNotice("Client deleted.");
      location.hash = "#/";
      refreshHeader();
    } catch (error) {
      showNotice(error.message, "error");
      renderDetail(customer);
    }
  });
  actions.append(edit, remove);
  heading.append(identity, actions);
  container.append(heading);
  return container;
}

function editCustomer(customer) {
  const card = el("section", { className: "card" });
  card.append(el("h2", {}, "Edit client"));
  const form = el("form", { className: "form-row" });
  const name = el("input", {
    required: true,
    maxLength: 50,
    value: customer.name,
  });
  const phone = el("input", {
    required: true,
    inputMode: "numeric",
    value: formatPhone(customer.phone),
  });
  const save = el("button", { className: "primary", type: "submit" }, "Save");
  const cancel = el(
    "button",
    { className: "secondary", type: "button" },
    "Cancel",
  );
  cancel.addEventListener("click", () => {
    state.editing = false;
    renderDetail(customer);
  });
  const actions = el("div", { className: "button-row" });
  actions.append(save, cancel);
  form.append(field("Name", name), field("Phone", phone), actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const result = await request(`/api/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.value, phone: phone.value }),
      });
      state.editing = false;
      showNotice(
        `Client updated.${result.linkedCount ? ` ${result.linkedCount} measurements linked.` : ""}`,
      );
      await loadRoute();
      refreshHeader();
    } catch (error) {
      showNotice(error.message, "error");
      save.disabled = false;
      renderDetail(customer);
    }
  });
  card.append(form);
  return card;
}

function changeCards(success) {
  const card = el("section", { className: "card" });
  card.append(el("h2", {}, "Progress"));
  if (!success.length) {
    card.append(el("p", { className: "muted" }, "No measurements yet."));
    return card;
  }
  if (success.length === 1) {
    card.append(
      el(
        "p",
        { className: "muted" },
        "Changes appear after 2 or more measurements.",
      ),
    );
    return card;
  }
  const first = success[0];
  const latest = success.at(-1);
  const grid = el("div", { className: "metrics" });
  for (const metric of metrics) {
    const item = el("article", { className: "card metric" });
    item.append(
      el("h3", {}, metric.label),
      el(
        "div",
        { className: "metric-value" },
        valueText(latest[metric.key], metric),
      ),
      el("div", { className: "change" }, changeText(first, latest, metric)),
      el(
        "div",
        { className: "since" },
        `since ${localTestDate(first.test_at)}`,
      ),
    );
    grid.append(item);
  }
  card.append(grid);
  return card;
}

function chartCard(success) {
  if (success.length < 2) return null;
  const card = el("section", { className: "card" });
  card.append(el("h2", {}, "Progress chart"));
  const buttons = el("div", { className: "metric-buttons" });
  for (const metric of metrics) {
    const button = el(
      "button",
      {
        className: `metric-button${metric.key === state.selectedMetric ? " active" : ""}`,
      },
      metric.short,
    );
    button.addEventListener("click", () => {
      state.selectedMetric = metric.key;
      renderDetail(state.customer);
    });
    buttons.append(button);
  }
  const canvas = el("canvas");
  card.append(
    buttons,
    el("div", { className: "chart-wrap" }).appendChild(canvas).parentElement,
  );
  queueMicrotask(() => drawChart(canvas, success));
  return card;
}

function drawChart(canvas, measurements) {
  state.chart?.destroy();
  const metric = metrics.find((item) => item.key === state.selectedMetric);
  if (!window.Chart) {
    canvas.replaceWith(
      el("p", { className: "muted" }, "Chart could not be loaded."),
    );
    return;
  }
  state.chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: measurements.map((measurement) =>
        localTestTime(measurement.test_at),
      ),
      datasets: [
        {
          label: `${metric.label}${metric.unit ? ` (${metric.unit})` : ""}`,
          data: measurements.map((measurement) => measurement[metric.key]),
          borderColor: "#2563eb",
          backgroundColor: "#2563eb",
          spanGaps: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      scales: { y: { title: { display: true, text: metric.unit } } },
    },
  });
}

function measurementHistory(measurements) {
  const card = el("section", { className: "card" });
  card.append(el("h2", {}, "Measurement history"));
  if (!measurements.length) {
    card.append(el("p", { className: "muted" }, "No measurements yet."));
    return card;
  }
  const table = el("table");
  const headings = ["Date", ...metrics.map((metric) => metric.short), "Status"];
  const head = el("thead");
  const headerRow = el("tr");
  headings.forEach((heading) => headerRow.append(el("th", {}, heading)));
  head.append(headerRow);
  const body = el("tbody");
  for (const measurement of measurements) {
    const row = el("tr");
    row.append(el("td", {}, localTestTime(measurement.test_at)));
    metrics.forEach((metric) =>
      row.append(el("td", {}, valueText(measurement[metric.key], metric))),
    );
    const status = el("td");
    status.append(el("span", { className: "status-tag" }, measurement.status));
    if (
      measurement.status === "error" ||
      measurement.status === "skipped_temp"
    ) {
      if (measurement.error_message)
        status.append(
          el("span", { className: "error-text" }, measurement.error_message),
        );
      const button = el("button", { className: "secondary" }, "Refetch");
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Fetching…";
        try {
          await request(`/api/measurements/${measurement.id}/refetch`, {
            method: "POST",
          });
          await loadRoute();
          refreshHeader();
        } catch (error) {
          showNotice(error.message, "error");
          await loadRoute();
        }
      });
      status.append(document.createElement("br"), button);
    }
    row.append(status);
    body.append(row);
  }
  table.append(head, body);
  card.append(
    el("div", { className: "table-wrap" }).appendChild(table).parentElement,
  );
  return card;
}

function renderDetail(customer) {
  state.chart?.destroy();
  state.chart = null;
  state.customer = customer;
  clear(page);
  notice(page);
  page.append(state.editing ? editCustomer(customer) : detailHeader(customer));
  if (!state.editing) {
    const success = customer.measurements
      .filter((measurement) => measurement.status === "success")
      .reverse();
    page.append(changeCards(success));
    const chart = chartCard(success);
    if (chart) page.append(chart);
    page.append(measurementHistory(customer.measurements));
  }
}

async function loadRoute() {
  const version = ++renderVersion;
  state.chart?.destroy();
  state.chart = null;
  const match = location.hash.match(/^#\/clients\/(\d+)$/);
  try {
    if (match) {
      const customer = await request(`/api/customers/${match[1]}`);
      if (version === renderVersion) renderDetail(customer);
    } else {
      state.editing = false;
      const customers = await request("/api/customers");
      if (version === renderVersion) renderList(customers);
    }
  } catch (error) {
    if (version !== renderVersion) return;
    clear(page);
    page.append(el("p", { className: "message error" }, error.message));
  }
}

function inputIsActive() {
  return state.editing || document.activeElement?.matches("input");
}

window.addEventListener("hashchange", loadRoute);
if (!location.hash) location.hash = "#/";
refreshHeader();
loadRoute();
setInterval(() => {
  refreshHeader();
  if (!inputIsActive()) loadRoute();
}, 30000);

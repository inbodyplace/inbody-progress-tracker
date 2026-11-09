import express from "express";
import dotenv from "dotenv";
import { timingSafeEqual } from "node:crypto";

dotenv.config();

const basicAuthUser = process.env.BASIC_AUTH_USER || "admin";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD || "";
const authEnabled = Boolean(basicAuthPassword);

const {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getStatus,
  listCustomers,
  ping,
  reserveApiCall,
  updateCustomer,
} = await import("./db.js");
const { createInbodyClient } = await import("./inbody/client.js");
const { createWebhookHandler } = await import("./inbody/webhook.js");
const { maskPhone } = await import("./inbody/transform.js");
const app = express();
const port = Number(process.env.PORT || 4174);
const dailyLimit = Number(process.env.INBODY_DAILY_LIMIT || 500);
const reserve = Number(process.env.INBODY_RESERVE || 50);
const webhookHeaderName = process.env.WEBHOOK_HEADER_NAME;
const webhookHeaderValue = process.env.WEBHOOK_HEADER_VALUE;
const client = createInbodyClient({
  baseUrl: process.env.INBODY_BASE_URL,
  account: process.env.INBODY_ACCOUNT,
  apiKey: process.env.INBODY_API_KEY,
});
const webhook = createWebhookHandler({ client, dailyLimit, reserve });

function basicAuth(request, response, next) {
  const header = request.get("authorization") || "";
  const actual = Buffer.from(
    header.startsWith("Basic ") ? header.slice(6) : "",
    "base64",
  );
  const expected = Buffer.from(`${basicAuthUser}:${basicAuthPassword}`);
  if (actual.length === expected.length && timingSafeEqual(actual, expected))
    return next();
  response.set("WWW-Authenticate", 'Basic realm="InBody Progress Tracker"');
  return response.status(401).send("Authentication required.");
}

app.post("/webhook", express.json(), (request, response) => {
  if (
    !webhookHeaderName ||
    !webhookHeaderValue ||
    request.get(webhookHeaderName) !== webhookHeaderValue
  ) {
    console.warn("[webhook] rejected: invalid header");
    response.sendStatus(401);
    return;
  }
  if (!request.body?.UserID || !request.body?.TestDatetimes) {
    response
      .status(400)
      .json({ error: "UserID and TestDatetimes are required." });
    return;
  }
  response.status(200).json({ ok: true });
  void webhook.handleWebhook(request.body).catch((error) => {
    console.error(
      `[webhook] processing failed for ${maskPhone(request.body.TelHP)}: ${error.message}`,
    );
  });
});

if (authEnabled) app.use(basicAuth);
app.use(express.json());
app.use(express.static("public"));

app.get("/api/health", async (_request, response) => {
  try {
    await ping();
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/measurements/:id/refetch", async (request, response) => {
  try {
    const measurement = await webhook.refetch(request.params.id);
    response.json(measurement);
  } catch (error) {
    if (error.code === "NOT_FOUND")
      return response.status(404).json({ error: error.message });
    if (error.code === "CONFLICT")
      return response.status(409).json({ error: error.message });
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/status", async (_request, response) => {
  try {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    response.json({
      ...(await getStatus({ date, limit: dailyLimit, reserve })),
      authEnabled,
    });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function lbWebInput(body) {
  const gender = String(body?.gender ?? "").trim();
  const birthDay = String(body?.birthDay ?? "").trim();
  const heightInput = String(body?.height ?? "").trim();
  if (![gender, birthDay, heightInput].some(Boolean))
    return { requested: false };
  if (![gender, birthDay, heightInput].every(Boolean)) {
    return {
      error: "To register in LB Web, fill in gender, birth date, and height.",
    };
  }
  if (!["M", "F"].includes(gender)) return { error: "Gender must be M or F." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDay))
    return { error: "Birth date must be a valid date." };
  const [year, month, day] = birthDay.split("-").map(Number);
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day ||
    birthDate > today
  ) {
    return { error: "Birth date must be a valid date in the past." };
  }
  const age =
    today.getFullYear() -
    year -
    (today < new Date(today.getFullYear(), month - 1, day) ? 1 : 0);
  if (age < 1 || age > 99)
    return {
      error: "Age calculated from birth date must be between 1 and 99.",
    };
  if (
    !/^\d+(\.\d)?$/.test(heightInput) ||
    Number(heightInput) <= 0 ||
    Number(heightInput) >= 300
  ) {
    return {
      error:
        "Height must be greater than 0 and less than 300, with at most one decimal place.",
    };
  }
  return {
    requested: true,
    gender,
    birthDay,
    age,
    height: Number(heightInput).toFixed(1),
  };
}

function customerInput(body, includeLbWeb = false) {
  const name = String(body?.name ?? "").trim();
  const phone = String(body?.phone ?? "").replace(/\D/g, "");
  const maxNameLength = includeLbWeb ? 45 : 50;
  if (!name || name.length > maxNameLength)
    return { error: `Name must be 1–${maxNameLength} characters.` };
  if (!/^\d{10,11}$/.test(phone))
    return { error: "Phone number must be 10–11 digits." };
  if (!includeLbWeb) return { name, phone };
  const lbweb = lbWebInput(body);
  return lbweb.error ? lbweb : { name, phone, lbweb };
}

async function registerInLbWeb(customer, lbweb) {
  if (!lbweb.requested) return { status: "not_requested" };
  if (!client.isConfigured()) return { status: "skipped_not_configured" };
  try {
    const today = localDate();
    const allowedCalls = Math.max(0, dailyLimit - reserve);
    if (!(await reserveApiCall({ date: today, limit: allowedCalls })))
      return { status: "skipped_limit" };
    return await client.registerUser({
      name: customer.name,
      id: customer.phone,
      phone: customer.phone,
      gender: lbweb.gender,
      age: String(lbweb.age),
      height: lbweb.height,
      birthDay: lbweb.birthDay,
      userRegDate: today,
    });
  } catch (error) {
    return { status: "failed", message: error.message };
  }
}

function customerError(response, error) {
  if (error.code === "ER_DUP_ENTRY")
    return response
      .status(409)
      .json({ error: "A client with this phone number already exists." });
  return response.status(500).json({ error: error.message });
}

app.get("/api/customers", async (_request, response) => {
  try {
    response.json(await listCustomers());
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/customers/:id", async (request, response) => {
  try {
    const customer = await getCustomer(request.params.id);
    if (!customer)
      return response.status(404).json({ error: "Client not found." });
    response.json(customer);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/customers", async (request, response) => {
  const input = customerInput(request.body, true);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    const result = await createCustomer(input);
    response.status(201).json({
      ...result,
      lbweb: await registerInLbWeb(result.customer, input.lbweb),
    });
  } catch (error) {
    customerError(response, error);
  }
});

app.put("/api/customers/:id", async (request, response) => {
  const input = customerInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    const result = await updateCustomer(request.params.id, input);
    if (!result)
      return response.status(404).json({ error: "Client not found." });
    response.json(result);
  } catch (error) {
    customerError(response, error);
  }
});

app.delete("/api/customers/:id", async (request, response) => {
  try {
    if (!(await deleteCustomer(request.params.id)))
      return response.status(404).json({ error: "Client not found." });
    response.sendStatus(204);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`InBody Progress Tracker: http://localhost:${port}`);
  if (!authEnabled)
    console.warn(
      "[auth] Basic Auth is off. Set BASIC_AUTH_PASSWORD in .env before exposing this server (e.g. with ngrok).",
    );
  if (!webhookHeaderValue)
    console.warn(
      "[webhook] WEBHOOK_HEADER_VALUE is empty; all webhook requests will be rejected.",
    );
});

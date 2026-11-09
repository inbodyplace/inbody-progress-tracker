import express from "express";
import dotenv from "dotenv";
import { timingSafeEqual } from "node:crypto";

dotenv.config();

const basicAuthUser = process.env.BASIC_AUTH_USER || "admin";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD || "";
const authEnabled = Boolean(basicAuthPassword);

const { createCustomer, deleteCustomer, getCustomer, getStatus, listCustomers, ping, updateCustomer } = await import("./db.js");
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
  const actual = Buffer.from(header.startsWith("Basic ") ? header.slice(6) : "", "base64");
  const expected = Buffer.from(`${basicAuthUser}:${basicAuthPassword}`);
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) return next();
  response.set("WWW-Authenticate", 'Basic realm="InBody Progress Tracker"');
  return response.status(401).send("Authentication required.");
}

app.post("/webhook", express.json(), (request, response) => {
  if (!webhookHeaderName || !webhookHeaderValue || request.get(webhookHeaderName) !== webhookHeaderValue) {
    console.warn("[webhook] rejected: invalid header");
    response.sendStatus(401);
    return;
  }
  if (!request.body?.UserID || !request.body?.TestDatetimes) {
    response.status(400).json({ error: "UserID and TestDatetimes are required." });
    return;
  }
  response.status(200).json({ ok: true });
  void webhook.handleWebhook(request.body).catch((error) => {
    console.error(`[webhook] processing failed for ${maskPhone(request.body.TelHP)}: ${error.message}`);
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
    if (error.code === "NOT_FOUND") return response.status(404).json({ error: error.message });
    if (error.code === "CONFLICT") return response.status(409).json({ error: error.message });
    response.status(500).json({ error: error.message });
  }
});

app.get("/api/status", async (_request, response) => {
  try {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    response.json({ ...(await getStatus({ date, limit: dailyLimit, reserve })), authEnabled });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

function customerInput(body) {
  const name = String(body?.name ?? "").trim();
  const phone = String(body?.phone ?? "").replace(/\D/g, "");
  if (!name || name.length > 50) return { error: "Name must be 1–50 characters." };
  if (!/^\d{10,11}$/.test(phone)) return { error: "Phone number must be 10–11 digits." };
  return { name, phone };
}

function customerError(response, error) {
  if (error.code === "ER_DUP_ENTRY") return response.status(409).json({ error: "A client with this phone number already exists." });
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
    if (!customer) return response.status(404).json({ error: "Client not found." });
    response.json(customer);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/customers", async (request, response) => {
  const input = customerInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    response.status(201).json(await createCustomer(input));
  } catch (error) {
    customerError(response, error);
  }
});

app.put("/api/customers/:id", async (request, response) => {
  const input = customerInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    const result = await updateCustomer(request.params.id, input);
    if (!result) return response.status(404).json({ error: "Client not found." });
    response.json(result);
  } catch (error) {
    customerError(response, error);
  }
});

app.delete("/api/customers/:id", async (request, response) => {
  try {
    if (!(await deleteCustomer(request.params.id))) return response.status(404).json({ error: "Client not found." });
    response.sendStatus(204);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`InBody Progress Tracker: http://localhost:${port}`);
  if (!authEnabled) console.warn("[auth] Basic Auth is off. Set BASIC_AUTH_PASSWORD in .env before exposing this server (e.g. with ngrok).");
  if (!webhookHeaderValue) console.warn("[webhook] WEBHOOK_HEADER_VALUE is empty; all webhook requests will be rejected.");
});

import express from "express";
import dotenv from "dotenv";

dotenv.config();

const { getStatus, ping } = await import("./db.js");
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

app.post("/webhook", (request, response) => {
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
    response.json(await getStatus({ date, limit: dailyLimit, reserve }));
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`InBody Progress Tracker: http://localhost:${port}`);
  if (!webhookHeaderValue) console.warn("[webhook] WEBHOOK_HEADER_VALUE is empty; all webhook requests will be rejected.");
});

import {
  claimRefetch,
  createMeasurement,
  findCustomerByPhone,
  linkMeasurementToCustomer,
  reserveApiCall,
  saveMeasurementError,
  saveMeasurementSuccess,
} from "../db.js";
import { digits, toMetrics } from "./transform.js";

const notConfigured =
  "InBody API is not configured. Set INBODY_ACCOUNT and INBODY_API_KEY in .env.";
const dailyLimitReached = "Daily InBody API limit reached. Try again tomorrow.";

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function createWebhookHandler({
  client,
  dailyLimit = 500,
  reserve = 50,
}) {
  const allowedCalls = Math.max(0, dailyLimit - reserve);

  async function fetchAndSave(measurement) {
    if (!client.isConfigured())
      return saveMeasurementError(measurement.id, notConfigured);
    const reserved = await reserveApiCall({
      date: localDate(),
      limit: allowedCalls,
    });
    if (!reserved)
      return saveMeasurementError(measurement.id, dailyLimitReached);
    try {
      const data = await client.fetchMeasurement({
        userId: measurement.inbody_user_id,
        testAt: measurement.test_at,
      });
      return saveMeasurementSuccess(measurement.id, toMetrics(data));
    } catch (error) {
      return saveMeasurementError(measurement.id, error.message);
    }
  }

  async function connectCustomer(measurement) {
    if (measurement.customer_id || !measurement.tel_hp) return measurement;
    const customer = await findCustomerByPhone(measurement.tel_hp);
    return customer
      ? linkMeasurementToCustomer(measurement.id, customer.id)
      : measurement;
  }

  async function handleWebhook(payload) {
    const isTemp = String(payload.IsTempData).toLowerCase() === "true";
    const created = await createMeasurement({
      inbodyUserId: String(payload.UserID),
      telHp: digits(payload.TelHP),
      testAt: String(payload.TestDatetimes),
      status: isTemp ? "skipped_temp" : "pending",
    });
    if (!created.created) return created.measurement;
    const measurement = await connectCustomer(created.measurement);
    return isTemp ? measurement : fetchAndSave(measurement);
  }

  async function refetch(id) {
    const claim = await claimRefetch(id);
    if (claim.state === "missing") {
      const error = Error("Measurement not found.");
      error.code = "NOT_FOUND";
      throw error;
    }
    if (claim.state === "conflict") {
      const error = Error(
        "Measurement cannot be refetched in its current status.",
      );
      error.code = "CONFLICT";
      throw error;
    }
    return fetchAndSave(await connectCustomer(claim.measurement));
  }

  return { handleWebhook, refetch };
}

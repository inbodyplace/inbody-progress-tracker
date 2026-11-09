import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  decimalNumbers: true,
});

export async function ping() {
  await pool.query("SELECT 1");
}

export async function createMeasurement({ inbodyUserId, telHp, testAt, status }) {
  try {
    const [result] = await pool.execute(
      "INSERT INTO measurements (inbody_user_id, tel_hp, test_at, status) VALUES (?, ?, ?, ?)",
      [inbodyUserId, telHp || null, testAt, status],
    );
    return { created: true, measurement: await getMeasurement(result.insertId) };
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") throw error;
    return { created: false, measurement: await getMeasurementByKey(inbodyUserId, testAt) };
  }
}

export async function getMeasurement(id) {
  const [rows] = await pool.execute("SELECT * FROM measurements WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function getMeasurementByKey(inbodyUserId, testAt) {
  const [rows] = await pool.execute(
    "SELECT * FROM measurements WHERE inbody_user_id = ? AND test_at = ?",
    [inbodyUserId, testAt],
  );
  return rows[0] || null;
}

export async function findCustomerByPhone(phone) {
  const [rows] = await pool.execute("SELECT id FROM customers WHERE phone = ?", [phone]);
  return rows[0] || null;
}

export async function linkMeasurementToCustomer(id, customerId) {
  await pool.execute("UPDATE measurements SET customer_id = ? WHERE id = ? AND customer_id IS NULL", [customerId, id]);
  return getMeasurement(id);
}

export async function saveMeasurementSuccess(id, metrics) {
  await pool.execute(
    "UPDATE measurements SET smm = ?, bfm = ?, pbf = ?, vfa_level = ?, bmr = ?, status = 'success', error_message = NULL WHERE id = ?",
    [metrics.smm, metrics.bfm, metrics.pbf, metrics.vfaLevel, metrics.bmr, id],
  );
  return getMeasurement(id);
}

export async function saveMeasurementError(id, message) {
  await pool.execute("UPDATE measurements SET status = 'error', error_message = ? WHERE id = ?", [message, id]);
  return getMeasurement(id);
}

export async function claimRefetch(id) {
  const [result] = await pool.execute(
    "UPDATE measurements SET status = 'pending' WHERE id = ? AND status IN ('error', 'skipped_temp')",
    [id],
  );
  if (result.affectedRows) return { state: "claimed", measurement: await getMeasurement(id) };
  const measurement = await getMeasurement(id);
  return measurement ? { state: "conflict", measurement } : { state: "missing", measurement: null };
}

export async function reserveApiCall({ date, limit }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO api_usage (usage_date, call_count) VALUES (?, 0) ON DUPLICATE KEY UPDATE usage_date = VALUES(usage_date)",
      [date],
    );
    const [rows] = await connection.execute("SELECT call_count FROM api_usage WHERE usage_date = ? FOR UPDATE", [date]);
    const used = rows[0]?.call_count ?? 0;
    if (used >= limit) {
      await connection.rollback();
      return false;
    }
    await connection.execute("UPDATE api_usage SET call_count = call_count + 1 WHERE usage_date = ?", [date]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getStatus({ date, limit, reserve }) {
  const [[usageRows], [latestRows], [unlinkedRows]] = await Promise.all([
    pool.execute("SELECT call_count FROM api_usage WHERE usage_date = ?", [date]),
    pool.execute("SELECT received_at FROM measurements ORDER BY received_at DESC, id DESC LIMIT 1"),
    pool.execute("SELECT COUNT(*) AS count FROM measurements WHERE customer_id IS NULL"),
  ]);
  return {
    date,
    used: usageRows[0]?.call_count ?? 0,
    limit,
    reserve,
    lastWebhookAt: latestRows[0]?.received_at ?? null,
    unlinkedCount: unlinkedRows[0].count,
  };
}

export async function listCustomers() {
  const [[customers], [measurements]] = await Promise.all([
    pool.execute("SELECT * FROM customers ORDER BY created_at ASC, id ASC"),
    pool.execute(
      "SELECT customer_id, test_at, smm, bfm, pbf, vfa_level, bmr FROM measurements WHERE customer_id IS NOT NULL AND status = 'success' ORDER BY test_at ASC, id ASC",
    ),
  ]);
  const byCustomer = new Map(customers.map((customer) => [customer.id, { ...customer, measurements: [] }]));
  for (const measurement of measurements) byCustomer.get(measurement.customer_id)?.measurements.push(measurement);
  return [...byCustomer.values()];
}

export async function getCustomer(id) {
  const [[customers], [measurements]] = await Promise.all([
    pool.execute("SELECT * FROM customers WHERE id = ?", [id]),
    pool.execute("SELECT * FROM measurements WHERE customer_id = ? ORDER BY test_at DESC, id DESC", [id]),
  ]);
  return customers[0] ? { ...customers[0], measurements } : null;
}

export async function createCustomer({ name, phone }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute("INSERT INTO customers (name, phone) VALUES (?, ?)", [name, phone]);
    const [linked] = await connection.execute(
      "UPDATE measurements SET customer_id = ? WHERE customer_id IS NULL AND tel_hp = ?",
      [result.insertId, phone],
    );
    const [customers] = await connection.execute("SELECT * FROM customers WHERE id = ?", [result.insertId]);
    await connection.commit();
    return { customer: customers[0], linkedCount: linked.affectedRows };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateCustomer(id, { name, phone }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [updated] = await connection.execute("UPDATE customers SET name = ?, phone = ? WHERE id = ?", [name, phone, id]);
    if (!updated.affectedRows) {
      await connection.rollback();
      return null;
    }
    const [linked] = await connection.execute(
      "UPDATE measurements SET customer_id = ? WHERE customer_id IS NULL AND tel_hp = ?",
      [id, phone],
    );
    const [customers] = await connection.execute("SELECT * FROM customers WHERE id = ?", [id]);
    await connection.commit();
    return { customer: customers[0], linkedCount: linked.affectedRows };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteCustomer(id) {
  const [result] = await pool.execute("DELETE FROM customers WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

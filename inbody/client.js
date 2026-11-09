export function createInbodyClient({ baseUrl, account, apiKey }) {
  const base = String(baseUrl || "").replace(/\/+$/, "");

  return {
    isConfigured: () => Boolean(account && apiKey),
    async fetchMeasurement({ userId, testAt }) {
      try {
        const response = await fetch(`${base}/InBody/GetInBodyDataByID`, {
          method: "POST",
          headers: { Account: account, "API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ UserID: userId, Datetimes: testAt }),
        });
        if (response.status === 401) {
          throw Error("InBody API authentication failed (401). Check INBODY_ACCOUNT and INBODY_API_KEY in .env.");
        }
        if (response.status === 404) {
          throw Error("Measurement not found in InBody (404). Check that it exists in LB Web.");
        }
        if (!response.ok) throw Error(`InBody API request failed (${response.status}).`);
        return response.json();
      } catch (error) {
        if (error.message.startsWith("InBody API") || error.message.startsWith("Measurement not found")) throw error;
        throw Error(`Could not reach InBody API: ${error.message}`);
      }
    },
  };
}

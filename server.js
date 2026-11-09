import express from "express";
import dotenv from "dotenv";

dotenv.config();

const { ping } = await import("./db.js");
const app = express();
const port = Number(process.env.PORT || 4174);

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

app.listen(port, () => {
  console.log(`InBody Progress Tracker: http://localhost:${port}`);
});

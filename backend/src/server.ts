import express from "express";
import cors from "cors";
import api from "./routes.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(express.json());
app.use(cors({ origin: allowedOrigins }));
app.use("/api", api);

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "30days-backend" });
});

app.listen(port, host, () => {
  console.log(`30DAYS backend listening on http://${host}:${port}`);
});


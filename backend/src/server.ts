import express from "express";
import cors from "cors";
import api from "./routes.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000" }));
app.use("/api", api);

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "30days-backend" });
});

app.listen(port, () => {
  console.log(`30DAYS backend listening on http://localhost:${port}`);
});


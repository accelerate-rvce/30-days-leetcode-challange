"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_js_1 = __importDefault(require("./routes.js"));
const app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 4000);
app.use(express_1.default.json());
app.use((0, cors_1.default)({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000" }));
app.use("/api", routes_js_1.default);
app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "30days-backend" });
});
app.listen(port, () => {
    console.log(`30DAYS backend listening on http://localhost:${port}`);
});

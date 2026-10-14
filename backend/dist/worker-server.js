"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worker_js_1 = require("./worker.js");
const stop = (0, worker_js_1.startWorker)();
console.log("30DAYS verification worker started");
process.on("SIGTERM", () => { stop(); process.exit(0); });
process.on("SIGINT", () => { stop(); process.exit(0); });

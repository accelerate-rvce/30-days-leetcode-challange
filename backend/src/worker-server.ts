import { startWorker } from "./worker.js";

const stop = startWorker();
console.log("30DAYS verification worker started");

process.on("SIGTERM", () => { stop(); process.exit(0); });
process.on("SIGINT", () => { stop(); process.exit(0); });

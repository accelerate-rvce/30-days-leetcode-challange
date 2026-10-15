"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
const persistent_worker_js_1 = require("./persistent-worker.js");
function startWorker() {
    const timer = setInterval(() => { void (0, persistent_worker_js_1.runPersistentVerificationCycle)(); }, 60_000);
    void (0, persistent_worker_js_1.runPersistentVerificationCycle)();
    return () => clearInterval(timer);
}

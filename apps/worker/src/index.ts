/**
 * AutoApply browser worker.
 *
 * Phase 1 ships the data model, queue state and heartbeat contract this
 * process uses. The Playwright processor (claim → detect platform → fill →
 * human checkpoint → submit when permitted) is built in Phase 3 on top of
 * @autoapply/automation and @autoapply/ats-adapters. Until then this entry
 * point refuses to start rather than report itself as a running worker.
 */
console.error(
  "[worker] The application processor is not part of Phase 1. Queued applications stay in the Queued state until the Phase 3 worker is installed.",
);
process.exit(1);

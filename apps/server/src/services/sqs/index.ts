import { run } from "../../core/db";
import { defineService } from "../../core/service";
import { sqsActions } from "./actions";
import { tick } from "./messages";
import { sqsMigrations } from "./migrations";
import { sqsRoutes } from "./stream";

export const sqsService = defineService({
  id: "sqs",
  name: "Simple Queue Service",
  validationErrorCode: "InvalidParameterValue",
  migrations: sqsMigrations,
  actions: sqsActions,
  routes: sqsRoutes,
  start(deps) {
    let last = deps.clock.now().getTime();
    const timer = setInterval(() => {
      const now = deps.clock.now().getTime();
      try {
        tick(deps, last, now);
      } catch (err) {
        console.error("[sqs] tick failed", err);
      }
      last = now;
    }, 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  },
  resetAccount({ db }, accountId) {
    run(db, "DELETE FROM sqs_queues WHERE account_id = ?", accountId);
    run(db, "DELETE FROM sqs_deleted_queues WHERE account_id = ?", accountId);
    run(db, "DELETE FROM sqs_move_tasks WHERE account_id = ?", accountId);
  },
});

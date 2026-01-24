import cron from "node-cron";
import EmbeddingPipeline from "../embeddings/embeddingPipeline.js";
import { logger } from "../../utils/logger.js";

const embeddingPipeline = new EmbeddingPipeline();

export default class EmbeddingCronJob {
  constructor() {
    this.isRunning = false;
    this.task = null;
    this.schedule = process.env.EMBEDDING_CRON_SCHEDULE || "* * * * *"; // Every minute
  }

  start(runImmediately = true) {
    if (this.task) {
      logger.warn("Embedding cron job already running");
      return;
    }

    if (!cron.validate(this.schedule)) {
      logger.error("Invalid cron schedule", { schedule: this.schedule });
      throw new Error(`Invalid cron schedule: ${this.schedule}`);
    }

    this.task = cron.schedule(this.schedule, async () => {
      await this.executeJob();
    });

    logger.info("Embedding cron job started", { schedule: this.schedule });

    // Run immediately on start (don't wait for first scheduled time)
    const shouldRunImmediately = runImmediately && process.env.EMBEDDING_RUN_ON_START !== "false";
    if (shouldRunImmediately) {
      logger.info("Running embedding job immediately on startup");
      this.executeJob().catch((error) => {
        logger.error("Error in immediate embedding job execution", {
          error: error.message,
        });
      });
    }
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn("Embedding job already running, skipping this execution");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info("Embedding cron job executing");
      const result = await embeddingPipeline.processPendingEmbeddings();
      const duration = Date.now() - startTime;
      logger.info("Embedding cron job completed", {
        duration,
        processed: result.processed,
      });
    } catch (error) {
      logger.error("Embedding cron job failed", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Embedding cron job stopped");
    }
  }

  getNextRunTime() {
    return "Based on schedule: " + this.schedule;
  }

  getStatus() {
    return {
      running: this.task !== null,
      schedule: this.schedule,
      currentlyExecuting: this.isRunning,
      nextRun: this.getNextRunTime(),
    };
  }

  async triggerManually() {
    logger.info("Manually triggering embedding job");
    await this.executeJob();
  }
}

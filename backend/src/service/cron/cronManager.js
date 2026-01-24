import EmbeddingCronJob from "./embeddingCron.js";
import { logger } from "../../utils/logger.js";

export default class CronManager {
  constructor() {
    this.jobs = {
      embedding: new EmbeddingCronJob(),
    };
  }

  startAll() {
    logger.info("Starting all cron jobs");
    try {
      if (process.env.ENABLE_EMBEDDING_CRON !== "false") {
        this.jobs.embedding.start();
      }
    } catch (error) {
      logger.error("Error starting cron jobs", {
        error: error.message,
      });
      throw error;
    }
  }

  stopAll() {
    logger.info("Stopping all cron jobs");

    Object.values(this.jobs).forEach((job) => {
      job.stop();
    });

    logger.info("All cron jobs stopped");
  }

  getAllStatus() {
    return {
      embedding: this.jobs.embedding.getStatus(),
    };
  }

  async triggerJob(jobName) {
    if (!this.jobs[jobName]) {
      throw new Error(`Unknown job: ${jobName}`); 
    }

    logger.info("Manually triggering job", { jobName });
    await this.jobs[jobName].triggerManually();
  }
}

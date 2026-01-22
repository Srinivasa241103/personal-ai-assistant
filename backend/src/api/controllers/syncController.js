import GmailDataSource from "../../service/sources/GmailDataSource.js";
import { logger } from "../../utils/logger.js";
import { GmailNormalizer } from "../../service/normalizers/GmailNormalizer.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import { DocumentRepository } from "../../database/documentRepository.js";
import EmbeddingPipeline from "../../service/embeddings/embeddingPipeline.js";

export default class SyncController {
  constructor() {
    this.documentRepo = new DocumentRepository();
    this.syncLogRepo = new SyncLogRepository();
  }

  async syncGmail(req, res) {
    try {
      const {
        userId,
        syncType = "incremental",
        sinceDate = "2025/11/01",
      } = req.body;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }
      logger.info(`Starting ${syncType} Gmailsync for user ${userId}`);

      const syncLog = await this.syncLogRepo.create("gmail");
      res.json({
        success: true,
        data: {
          syncId: syncLog.id,
          status: "running",
          message: `Gmail sync started`,
        },
      });

      this.performSync(userId, syncType, syncLog.id, sinceDate).catch(
        (error) => {
          logger.error(
            `Gmail sync failed for user ${userId}: ${error.message}`
          );
        }
      );
    } catch (error) {
      logger.error(`Error initiating Gmail sync: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to start Gmail sync",
      });
    }
  }

  async performSync(userId, syncType, syncLogId, sinceDate) {
    try {
      const gmailSource = new GmailDataSource(userId);
      let rawMessages;

      if (syncType == "full") {
        rawMessages = await gmailSource.fetchAll({
          maxResults: Infinity,
          query: `after:${sinceDate}`,
        });
      } else {
        const lastSync = await this.syncLogRepo.getLastSuccessfulSync("gmail");
        const since =
          lastSync?.sync_completed_at ||
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        rawMessages = await gmailSource.fetchNew(since);
      }

      logger.info(
        `Fetched ${rawMessages.length} Gmail messages for user ${userId}`
      );

      const normalizer = new GmailNormalizer();
      const normalizedDocs = normalizer.normalizeBatch(rawMessages, userId);
      logger.info(
        `Normalized ${normalizedDocs.length} Gmail documents for user ${userId}`
      );

      let documentsAdded = 0;
      let documentsFailed = 0;
      let documentsSkipped = 0;
      for (const doc of normalizedDocs) {
        try {
          const existing = await this.documentRepo.findByDocumentId(
            doc.documentId
          );

          // Skip if document already exists
          if (existing) {
            documentsSkipped++;
            continue;
          }

          // Map camelCase to snake_case for database
          const dbDocument = {
            document_id: doc.documentId,
            source: doc.source,
            type: doc.type,
            content: doc.content,
            title: doc.title,
            timestamp: doc.timestamp,
            author: doc.author,
            metadata: doc.metadata,
          };

          await this.documentRepo.create(dbDocument);
          documentsAdded++;
        } catch (docError) {
          logger.error(
            `Failed to store document ${doc.documentId}: ${docError.message}`
          );
          documentsFailed++;
        }
      }

      await this.syncLogRepo.complete(syncLogId, {
        status: "success",
        documentsFetched: rawMessages.length,
        documentsStored: documentsAdded,
        lastSyncTimestamp: new Date(),
      });

      logger.info(
        `Gmail sync completed for user ${userId}: ${documentsAdded} added, ${documentsSkipped} skipped, ${documentsFailed} failed`
      );
    } catch (syncError) {
      logger.error(`Gmail sync error for user ${userId}: ${syncError.message}`);
      await this.syncLogRepo.fail(syncLogId, syncError.message);
    }
  }

  async getSyncStatus(req, res) {
    try {
      const { syncId } = req.params;
      const syncLog = await this.syncLogRepo.findById(syncId);
      if (!syncLog) {
        return res.status(404).json({
          success: false,
          error: "Sync operation not found",
        });
      }

      res.json({
        success: true,
        data: syncLog,
      });
    } catch (error) {
      logger.error(`Error fetching sync status: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sync status",
      });
    }
  }

  async getSyncHistory(req, res) {
    try {
      const { userId, source = "gmail", limit = 10 } = req.query;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }

      const history = await this.syncLogRepo.findBySource(source);
      res.json({
        success: true,
        data: { history },
      });
    } catch (error) {
      logger.error(`Error fetching sync history: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sync history",
      });
    }
  }
}

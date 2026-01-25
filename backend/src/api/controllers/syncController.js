import GmailDataSource from "../../service/sources/GmailDataSource.js";
import { logger } from "../../utils/logger.js";
import { GmailNormalizer } from "../../service/normalizers/GmailNormalizer.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import { DocumentRepository } from "../../database/documentRepository.js";
import EmbeddingPipeline from "../../service/embeddings/embeddingPipeline.js";
import socketServer from "../../service/websocket/sockeService.js";

export default class SyncController {
  constructor() {
    this.documentRepo = new DocumentRepository();
    this.syncLogRepo = new SyncLogRepository();
    this.embeddingPipeline = new EmbeddingPipeline();
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
      // Emit: Starting sync
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "fetching",
        message: "Fetching emails from Gmail...",
        progress: 0,
      });

      const gmailSource = new GmailDataSource(userId);
      let rawMessages;

      if (syncType == "full") {
        const sinceTimestamp = Math.floor(new Date(sinceDate).getTime() / 1000);
        rawMessages = await gmailSource.fetchAll({
          maxResults: Infinity,
          query: `after:${sinceTimestamp}`,
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

      // Emit: Fetching complete, starting normalization
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "normalizing",
        message: `Fetched ${rawMessages.length} emails. Processing...`,
        progress: 25,
        totalMessages: rawMessages.length,
      });

      const normalizer = new GmailNormalizer();
      const normalizedDocs = normalizer.normalizeBatch(rawMessages, userId);
      logger.info(
        `Normalized ${normalizedDocs.length} Gmail documents for user ${userId}`
      );

      // Emit: Normalization complete, starting storage
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "storing",
        message: `Storing ${normalizedDocs.length} documents...`,
        progress: 50,
        totalDocuments: normalizedDocs.length,
      });

      let documentsAdded = 0;
      let documentsFailed = 0;
      let documentsSkipped = 0;
      const totalDocs = normalizedDocs.length;

      for (let i = 0; i < normalizedDocs.length; i++) {
        const doc = normalizedDocs[i];
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

        // Emit progress every 10 documents or on last document
        if ((i + 1) % 10 === 0 || i === totalDocs - 1) {
          const progressPercent = 50 + Math.floor(((i + 1) / totalDocs) * 50);
          socketServer.emitSyncProgress("gmail", {
            syncId: syncLogId,
            status: "in_progress",
            phase: "storing",
            message: `Processed ${i + 1}/${totalDocs} documents...`,
            progress: progressPercent,
            documentsAdded,
            documentsSkipped,
            documentsFailed,
          });
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

      // Emit: Documents stored, starting embeddings
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "embedding_start",
        message: "Documents stored. Starting embedding generation...",
        progress: 60,
        documentsAdded,
        documentsSkipped,
      });

      // Step 2: Process ALL pending embeddings
      logger.info("Starting embedding generation for synced documents");
      const embeddingResult =
        await this.embeddingPipeline.processAllPendingEmbeddings(syncLogId);

      logger.info("Embedding generation completed", {
        syncId: syncLogId,
        embeddingsProcessed: embeddingResult.processed,
      });

      // Emit: Everything complete (sync + embeddings)
      socketServer.emitSyncComplete("gmail", {
        syncId: syncLogId,
        status: "success",
        message: "Gmail sync and embeddings completed successfully",
        summary: {
          totalFetched: rawMessages.length,
          documentsAdded,
          documentsSkipped,
          documentsFailed,
          embeddingsGenerated: embeddingResult.processed,
          embeddingDuration: embeddingResult.duration,
        },
      });
    } catch (syncError) {
      logger.error(`Gmail sync error for user ${userId}: ${syncError.message}`);
      await this.syncLogRepo.fail(syncLogId, syncError.message);

      // Emit: Sync failed
      socketServer.emitSyncError("gmail", {
        syncId: syncLogId,
        message: syncError.message,
        code: "SYNC_FAILED",
      });
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

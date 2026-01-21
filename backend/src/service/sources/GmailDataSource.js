import { google } from "googleapis";
import BaseDataSource from "./BaseDataSource.js";
import { GoogleAuthService } from "../oauth/googleOAuthService.js";
import { logger } from "../../utils/logger.js";

export default class GmailDataSource {
  constructor(userId) {
    this.userId = userId;
    this.source = "gmail";
    this.oauthService = new GoogleAuthService();
    this.gmail = null;
  }

  getName() {
    return "Gmail";
  }

  getSource() {
    return this.source;
  }

  async initializeClient() {
    const accessToken = await this.oauthService.getValidAccessToken(
      this.userId,
      this.source
    );
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth: oauth2Client });

    logger.info(`Gmail Client initialized for user ${this.userId}`);
  }
  /**   * Fetch all emails (full sync)
   */
  async fetchAll(options = {}) {
    await this.initializeClient();

    const { maxResults = 100, query = "after:2026/01/01" } = options;
    logger.info(
      `Fetching emails for user ${this.userId} with maxResults=${maxResults} and query='${query}'`
    );

    const allMessages = [];
    let pageToken = null;
    try {
      do {
        const messageListResponse = await this.gmail.users.messages.list({
          userId: "me",
          maxResults: 100,
          pageToken: pageToken,
          q: query,
        });
        const messages = messageListResponse.data.messages || [];
        if (messages.length === 0) {
          break;
        }

        const messageDetails = await this.fetchMessageBatch(
          messages.map((m) => m.id)
        );
        allMessages.push(...messageDetails);
        pageToken = messageListResponse.data.nextPageToken;
        logger.info(`Fetched ${allMessages.length} emails so far...`);

        if (allMessages.length >= maxResults) {
          break;
        }

        await this.sleep(100);
      } while (pageToken);

      logger.info(`Completed Gmail sync: ${allMessages.length} emails fetched`);

      return allMessages;
    } catch (error) {
      logger.info(`GmailfetchAll failed : ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch new emails since last sync (incremental)
   */
  async fetchNew(since) {
    await this.initializeClient();
    logger.info(
      `Fetching new emails for user ${this.userId} since ${since.toISOString()}`
    );

    try {
      const sinceDate = new Date(since);
      const query = `after:${this.formatDateForQuery(sinceDate)}`;
      return this.fetchAll({ query, maxResults: 1000 });
    } catch (error) {
      logger.error(`Gmail incremental sync failed: ${error.message}`);
      throw error;
    }
  }
  /**
   * Fetch a batch of messages by IDs
   * @param {Array<string>} messageIds - Array of message IDs
   * @returns {Promise<Array>} Array of message objects
   */
  async fetchMessageBatch(messageIds) {
    const messages = [];
    const batchSize = 50;
    for (let itr = 0; itr < messageIds.length; itr += batchSize) {
      const batch = messageIds.slice(itr, itr + batchSize);
      const batchPromises = batch.map(async (id) => {
        try {
          const response = await this.gmail.users.messages.get({
            userId: "me",
            id: id,
            format: "full",
          });
          return response.data;
        } catch (error) {
          logger.info(`Failed to fetch message ${id}: ${error.message}`);
          return null;
        }
      });
      const batchResults = await Promise.all(batchPromises);
      messages.push(...batchResults.filter((m) => m != null));

      await this.sleep(100);
    }
    return messages;
  }

  formatDateForQuery(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

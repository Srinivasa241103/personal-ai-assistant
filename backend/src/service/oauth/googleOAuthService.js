import { google } from "googleapis";
import crypto from "crypto";
import { logger } from "../../utils/logger.js";

import { CredentialRepository } from "../../database/index.js";

export class GoogleAuthService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:3000/auth/google/callback";

    this.credentialsRepo = new CredentialRepository();

    this.encryptionKey = Buffer.from(
      process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32)
    );

    //OAuth2 Client
    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );
  }

  async getAuthorizationUrl(userId, scopes) {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      state: userId,
      prompt: "consent",
    });
    logger.info(`Generated Google OAuth2 authorization URL for user ${userId}`);
    return authUrl;
  }

  async exchangeCodeForTokens(code, source, userId) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      logger.info(`Exchanged code for tokens for user ${userId}`);

      const expiryDate = new Date();
      expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expiry_date);

      const encryptedAccessToken = this.encrypt(tokens.access_token);
      const encryptedRefreshToken = tokens.refresh_token
        ? this.encrypt(tokens.refresh_token)
        : null;

      //store in db
      const credential = await this.credentialsRepo.insert({
        source,
        user_id: userId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expires_at: expiryDate,
        scope: tokens.scope ? tokens.scope.split(" ") : [],
      });

      logger.info(`Stored encrypted credentials for ${source}`);

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate,
      };
    } catch (error) {
      logger.error(`Failed to exchange code for tokens: ${error.message}`);
      throw new Error(`OAuth token exchange failed: ${error.message}`);
    }
  }

  /**
   * Get valid access token (refresh if expired)
   * @param {string} userId - User ID
   * @param {string} source - Data source name
   * @returns {Promise<string>} Valid access token
   */
  async getValidAccessToken(userId, source) {
    try {
      const credential = await this.credentialsRepo.findByUserAndSource(
        userId,
        source
      );

      if (!credential) {
        throw new Error(
          `No credentials found for user ${userId}, source ${source}`
        );
      }

      // Decrypt tokens
      const accessToken = this.decrypt(credential.access_token);
      const refreshToken = credential.refresh_token
        ? this.decrypt(credential.refresh_token)
        : null;

      // Check if token is expired (with 5 minute buffer)
      const now = new Date();
      const expiryBuffer = new Date(credential.token_expiry);
      expiryBuffer.setMinutes(expiryBuffer.getMinutes() - 5);

      if (now < expiryBuffer) {
        // Token still valid
        return accessToken;
      }

      // Token expired, refresh it
      if (!refreshToken) {
        throw new Error(
          "No refresh token available. User needs to re-authenticate."
        );
      }

      logger.info(`Access token expired for ${source}, refreshing...`);

      // Set refresh token and refresh
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      // Update stored credentials
      const newExpiryDate = new Date();
      newExpiryDate.setSeconds(
        newExpiryDate.getSeconds() + credentials.expiry_date
      );

      await this.credentialsRepo.update(credential.id, {
        accessToken: this.encrypt(credentials.access_token),
        tokenExpiry: newExpiryDate,
      });

      logger.info(`Successfully refreshed access token for ${source}`);

      return credentials.access_token;
    } catch (error) {
      logger.error(`Failed to get valid access token: ${error.message}`);
      throw error;
    }
  }
  /**
   * Revoke access and delete credentials
   * @param {string} userId - User ID
   * @param {string} source - Data source name
   */
  async revokeAccess(userId, source) {
    try {
      const credential = await this.credentialsRepo.findByUserAndSource(
        userId,
        source
      );

      if (!credential) {
        logger.warn(
          `No credentials to revoke for user ${userId}, source ${source}`
        );
        return;
      }

      const accessToken = this.decrypt(credential.access_token);

      // Revoke token with Google
      await this.oauth2Client.revokeToken(accessToken);

      // Delete from database
      await this.credentialsRepo.delete(credential.id);

      logger.info(`Revoked and deleted credentials for ${source}`);
    } catch (error) {
      logger.error(`Failed to revoke access: ${error.message}`);
      throw error;
    }
  }

  /**
   * Encrypt sensitive token data
   * @param {string} text - Plain text to encrypt
   * @returns {string} Encrypted text (hex encoded)
   */
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", this.encryptionKey, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Return IV + encrypted data (IV needed for decryption)
    return iv.toString("hex") + ":" + encrypted;
  }

  /**
   * Decrypt token data
   * @param {string} encryptedText - Encrypted text (hex encoded with IV)
   * @returns {string} Decrypted plain text
   */
  decrypt(encryptedText) {
    const parts = encryptedText.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      this.encryptionKey,
      iv
    );

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}

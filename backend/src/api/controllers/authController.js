import jwt from "jsonwebtoken";
import crypto from "crypto";
import { google } from "googleapis";
import { GoogleAuthService } from "../../service/oauth/googleOAuthService.js";
import { logger } from "../../utils/logger.js";
import { userRepository, credentialRepository } from "../../database/index.js";

export class AuthController {
  constructor() {
    this.oauthService = new GoogleAuthService();
    this.userRepo = userRepository;
    this.credentialRepo = credentialRepository;
  }

  /**
   * GET /api/auth/google/login
   * Initiate Google OAuth login flow
   */
  async initiateGoogleLogin(req, res, next) {
    try {
      const state = crypto.randomBytes(16).toString("hex");

      const scopes = [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.readonly",
      ];

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        state: state,
        prompt: "consent",
      });

      logger.info("Generated Google login URL");

      res.json({
        success: true,
        data: { authUrl },
      });
    } catch (error) {
      logger.error(`Failed to initiate Google login: ${error.message}`);
      next(error);
    }
  }

  /**
   * GET /api/auth/google/callback
   * Handle OAuth callback from Google
   */
  async handleGoogleCallback(req, res, next) {
    try {
      const { code, error } = req.query;

      if (error) {
        logger.warn(`OAuth authorization denied: ${error}`);
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=access_denied`
        );
      }

      if (!code) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=missing_code`
        );
      }

      logger.info("Processing Google OAuth callback");

      // Exchange code for tokens
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user info from Google
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfoResponse = await oauth2.userinfo.get();
      const googleUserInfo = userInfoResponse.data;

      logger.info(`User info retrieved: ${googleUserInfo.email}`);

      // Create or update user
      const user = await this.createOrUpdateUser(googleUserInfo, tokens);

      // Generate JWT token
      const authToken = this.generateAuthToken(user);

      // Redirect to frontend with token
      res.redirect(
        `${process.env.FRONTEND_URL}/auth/callback?token=${authToken}`
      );
    } catch (error) {
      logger.error(`OAuth callback failed: ${error.message}`);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
  }

  /**
   * Create or update user in database
   */
  async createOrUpdateUser(googleUserInfo, tokens) {
    // Check if user exists by Google ID or email
    const existingUser = await this.userRepo.findByGoogleIdOrEmail(
      googleUserInfo.id,
      googleUserInfo.email
    );

    let user;

    if (existingUser) {
      // Update existing user
      user = await this.userRepo.updateOnLogin(existingUser.id, {
        googleId: googleUserInfo.id,
        name: googleUserInfo.name,
        picture: googleUserInfo.picture,
        emailVerified: googleUserInfo.verified_email,
        locale: googleUserInfo.locale,
      });
      logger.info(`Updated existing user: ${user.id}`);
    } else {
      // Create new user
      user = await this.userRepo.create({
        googleId: googleUserInfo.id,
        email: googleUserInfo.email,
        name: googleUserInfo.name,
        picture: googleUserInfo.picture,
        emailVerified: googleUserInfo.verified_email,
        locale: googleUserInfo.locale || "en",
      });
      logger.info(`Created new user: ${user.id}`);
    }

    // Store OAuth tokens for Gmail
    await this.storeOAuthTokens(user.id, tokens);

    return user;
  }

  /**
   * Store OAuth tokens in credentials table
   */
  async storeOAuthTokens(userId, tokens) {
    const expiryDate = new Date();
    expiryDate.setSeconds(
      expiryDate.getSeconds() + (tokens.expiry_date || 3600)
    );

    const encryptedAccessToken = this.oauthService.encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? this.oauthService.encrypt(tokens.refresh_token)
      : null;

    const scopes = tokens.scope ? tokens.scope.split(" ") : [];

    await this.credentialRepo.storeOAuthTokens(userId, "gmail", {
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiryDate: expiryDate,
      scopes: scopes,
    });

    logger.info(`Stored Gmail credentials for user ${userId}`);
  }

  /**
   * Generate JWT token for authentication
   */
  generateAuthToken(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      googleId: user.google_id,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return token;
  }

  /**
   * GET /api/auth/me
   * Get current user info
   */
  async getCurrentUser(req, res, next) {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          error: "No token provided",
        });
      }

      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await this.userRepo.findById(decoded.userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Also get connected sources
      const connectedSources = await this.credentialRepo.getConnectedSources(
        user.id
      );

      res.json({
        success: true,
        data: {
          user: {
            ...user,
            connectedSources,
          },
        },
      });
    } catch (error) {
      logger.error(`Failed to get current user: ${error.message}`);

      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          error: "Invalid token",
        });
      }

      next(error);
    }
  }

  /**
   * POST /api/auth/logout
   * Logout user
   */
  async logout(req, res, next) {
    try {
      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      logger.error(`Logout failed: ${error.message}`);
      next(error);
    }
  }
}

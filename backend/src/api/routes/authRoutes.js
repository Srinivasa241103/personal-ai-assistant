import { Router } from "express";
import { AuthController } from "../controllers/authController.js";
const authController = new AuthController();

const router = Router();

// Initiate Google OAuth login
router.get("/google/login", (req, res, next) => {
  authController.initiateGoogleLogin(req, res, next);
});

// Handle Google OAuth callback
router.get("/google/callback", (req, res, next) => {
  authController.handleGoogleCallback(req, res, next);
});

// Get current user
router.get("/me", (req, res, next) => {
  authController.getCurrentUser(req, res, next);
});

// Logout
router.post("/logout", (req, res, next) => {
  authController.logout(req, res, next);
});

export default router;

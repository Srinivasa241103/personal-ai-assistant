import { Router } from "express";
import SyncController from "../controllers/syncController.js";

const router = Router();
const syncController = new SyncController();

router.post("/gmail", (req, res) => syncController.syncGmail(req, res));
router.get("/status/:syncId", (req, res) =>
  syncController.getSyncStatus(req, res)
);
router.get("/history", (req, res) => syncController.getSyncHistory(req, res));

export default router;

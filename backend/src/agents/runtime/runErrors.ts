/**
 * AGT-02 — normalized errors at the run boundary.
 *
 * Provider and driver exceptions are implementation details. A durable run
 * stores a stable code, category, retry decision, and a message that cannot
 * accidentally carry a connection string or credential. The original error
 * remains available to the caller for structured logging; it is never copied
 * wholesale into `agent_runs` or a checkpoint.
 */

import { z } from "zod";
import {
  CheckpointTooLargeError,
  CredentialInStateError,
  StateOwnershipError,
} from "../state/stateGuards.js";
import { InvalidStatusTransitionError } from "../state/statusTransitions.js";
import type { AgentRunError } from "../state/stateSchema.js";

export class RunLifecycleError extends Error {
  readonly code: string;
  readonly category: AgentRunError["category"];
  readonly retryable: boolean;

  constructor(options: {
    name: string;
    code: string;
    category: AgentRunError["category"];
    message: string;
    retryable: boolean;
  }) {
    super(options.message);
    this.name = options.name;
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
  }
}

export class RunNotFoundError extends RunLifecycleError {
  constructor() {
    super({
      name: "RunNotFoundError",
      code: "run_not_found",
      category: "validation",
      message: "Run was not found",
      retryable: false,
    });
  }
}

export class RunNotResumableError extends RunLifecycleError {
  constructor() {
    super({
      name: "RunNotResumableError",
      code: "run_not_resumable",
      category: "validation",
      message: "Run is not waiting and cannot be resumed",
      retryable: false,
    });
  }
}

export class RunAlreadyActiveError extends RunLifecycleError {
  constructor() {
    super({
      name: "RunAlreadyActiveError",
      code: "run_already_active",
      category: "validation",
      message: "Run already has an active execution in this process",
      retryable: true,
    });
  }
}

export class MissingRunCheckpointError extends RunLifecycleError {
  constructor() {
    super({
      name: "MissingRunCheckpointError",
      code: "run_checkpoint_missing",
      category: "internal",
      message: "The durable checkpoint required to resume this run is missing",
      retryable: false,
    });
  }
}

export class IncompatibleRunVersionError extends RunLifecycleError {
  constructor() {
    super({
      name: "IncompatibleRunVersionError",
      code: "run_version_incompatible",
      category: "validation",
      message: "Run was created by an incompatible graph or state version",
      retryable: false,
    });
  }
}

export class InvalidCheckpointMetadataError extends RunLifecycleError {
  constructor() {
    super({
      name: "InvalidCheckpointMetadataError",
      code: "checkpoint_metadata_invalid",
      category: "validation",
      message: "Checkpoint identity or version metadata is invalid",
      retryable: false,
    });
  }
}

export class CheckpointSchemaUnavailableError extends RunLifecycleError {
  constructor() {
    super({
      name: "CheckpointSchemaUnavailableError",
      code: "checkpoint_schema_unavailable",
      category: "internal",
      message: "The configured checkpoint schema is not ready",
      retryable: true,
    });
  }
}

export class StaleRunProjectionError extends RunLifecycleError {
  constructor() {
    super({
      name: "StaleRunProjectionError",
      code: "run_projection_stale",
      category: "internal",
      message: "Run changed while its checkpoint projection was being saved",
      retryable: true,
    });
  }
}

export class RunCancelledError extends RunLifecycleError {
  constructor() {
    super({
      name: "RunCancelledError",
      code: "run_cancelled",
      category: "cancelled",
      message: "Run was cancelled by request",
      retryable: false,
    });
  }
}

export function normalizeRunError(
  error: unknown,
  occurredAt = new Date().toISOString(),
): AgentRunError {
  if (error instanceof RunLifecycleError) {
    return {
      code: error.code,
      category: error.category,
      message: error.message,
      occurredAt,
      retryable: error.retryable,
    };
  }

  if (error instanceof InvalidStatusTransitionError) {
    return {
      code: "invalid_status_transition",
      category: "validation",
      message: "Run attempted an invalid status transition",
      occurredAt,
      retryable: false,
    };
  }

  if (error instanceof CheckpointTooLargeError) {
    return {
      code: "checkpoint_too_large",
      category: "validation",
      message: "Checkpoint state exceeded its configured size limit",
      occurredAt,
      retryable: false,
    };
  }

  if (error instanceof CredentialInStateError) {
    return {
      code: "credential_in_checkpoint",
      category: "policy",
      message: "Credential material was rejected at the checkpoint boundary",
      occurredAt,
      retryable: false,
    };
  }

  if (error instanceof StateOwnershipError) {
    return {
      code: "checkpoint_ownership_mismatch",
      category: "policy",
      message: "Checkpoint ownership did not match the durable run",
      occurredAt,
      retryable: false,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: "run_state_invalid",
      category: "validation",
      message: "Run state failed schema validation",
      occurredAt,
      retryable: false,
    };
  }

  return {
    code: "run_internal_error",
    category: "internal",
    message: "Run failed because of an internal error",
    occurredAt,
    retryable: false,
  };
}

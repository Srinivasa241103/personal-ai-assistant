// backend/src/services/retrieval/contextFormatter.js

import { logger } from "../../utils/logger.js";
import { estimateTokens, fitWithinBudget } from "../../utils/tokenCounter.js";

class ContextFormatter {
  constructor() {
    // Token limits for Gemini Pro
    this.maxContextTokens = 28000; // Leave room for response (30k total, ~2k for response)
    this.maxDocumentPreview = 500; // Characters to show in preview
  }

  /**
   * Format retrieved documents for LLM consumption
   * @param {Array} retrievedDocs - Ranked search results
   * @param {string} userQuery - Original user query
   * @param {Object} options - Formatting options
   * @returns {Object} - Formatted context ready for LLM
   */
  format(retrievedDocs, userQuery, options = {}) {
    try {
      logger.info("Formatting context for LLM", {
        documentCount: retrievedDocs.length,
        query: userQuery,
      });

      if (!retrievedDocs || retrievedDocs.length === 0) {
        return this.formatEmptyContext(userQuery);
      }

      // Prepare documents with priority based on final score
      const documentsWithPriority = retrievedDocs.map((doc) => ({
        ...doc,
        priority: doc.finalScore || doc.similarity || 0,
        formattedText: this.formatDocument(doc, options),
      }));

      // Fit documents within token budget
      const selectedDocs = this.selectDocumentsWithinBudget(
        documentsWithPriority,
        this.maxContextTokens
      );

      logger.info("Documents selected for context", {
        total: retrievedDocs.length,
        selected: selectedDocs.length,
      });

      // Build context string
      const contextString = this.buildContextString(selectedDocs, options);

      // Calculate token usage
      const contextTokens = estimateTokens(contextString);
      const queryTokens = estimateTokens(userQuery);
      const totalTokens = contextTokens + queryTokens;

      logger.debug("Token usage", {
        contextTokens,
        queryTokens,
        totalTokens,
        maxAllowed: this.maxContextTokens,
      });

      return {
        contextString,
        documents: selectedDocs,
        metadata: {
          totalDocuments: retrievedDocs.length,
          selectedDocuments: selectedDocs.length,
          contextTokens,
          queryTokens,
          totalTokens,
          withinLimit: totalTokens <= this.maxContextTokens,
        },
      };
    } catch (error) {
      logger.error("Error formatting context", { error: error.message });
      throw error;
    }
  }

  /**
   * Format a single document for display
   * @private
   */
  formatDocument(doc, options = {}) {
    const includeMetadata = options.includeMetadata !== false;
    const includeScore = options.includeScore !== false;

    let formatted = "";

    // Title/Subject
    if (doc.title) {
      formatted += `Title: ${doc.title}\n`;
    }

    // Source and type
    formatted += `Source: ${doc.source} (${doc.type})\n`;

    // Timestamp
    if (doc.timestamp) {
      const date = new Date(doc.timestamp);
      formatted += `Date: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n`;
    }

    // Author
    if (doc.author) {
      formatted += `From: ${doc.author}\n`;
    }

    // Relevance score
    if (includeScore && doc.finalScore) {
      formatted += `Relevance: ${(doc.finalScore * 100).toFixed(1)}%\n`;
    }

    // Additional metadata
    if (includeMetadata && doc.metadata) {
      formatted += this.formatMetadata(doc.metadata, doc.source);
    }

    // Content
    formatted += `\nContent:\n${doc.content}\n`;

    return formatted;
  }

  /**
   * Format source-specific metadata
   * @private
   */
  formatMetadata(metadata, source) {
    let formatted = "";

    if (source === "gmail" && metadata.gmail) {
      if (metadata.gmail.to && metadata.gmail.to.length > 0) {
        formatted += `To: ${metadata.gmail.to.join(", ")}\n`;
      }
      if (metadata.gmail.labels && metadata.gmail.labels.length > 0) {
        formatted += `Labels: ${metadata.gmail.labels.join(", ")}\n`;
      }
    }

    if (source === "google_calendar" && metadata.calendar) {
      if (
        metadata.calendar.attendees &&
        metadata.calendar.attendees.length > 0
      ) {
        formatted += `Attendees: ${metadata.calendar.attendees.join(", ")}\n`;
      }
      if (metadata.calendar.location) {
        formatted += `Location: ${metadata.calendar.location}\n`;
      }
    }

    if (source === "spotify" && metadata.spotify) {
      if (metadata.spotify.artist) {
        formatted += `Artist: ${metadata.spotify.artist}\n`;
      }
      if (metadata.spotify.album) {
        formatted += `Album: ${metadata.spotify.album}\n`;
      }
    }

    return formatted;
  }

  /**
   * Select documents that fit within token budget
   * @private
   */
  selectDocumentsWithinBudget(documents, maxTokens) {
    // Prepare items for token budget fitting
    const items = documents.map((doc) => ({
      text: doc.formattedText,
      priority: doc.priority,
      document: doc,
    }));

    // Use token counter to fit within budget
    const selectedTexts = fitWithinBudget(items, maxTokens);

    // Map back to documents
    return items
      .filter((item) => selectedTexts.includes(item.text))
      .map((item) => item.document);
  }

  /**
   * Build the complete context string
   * @private
   */
  buildContextString(documents, options = {}) {
    if (documents.length === 0) {
      return "No relevant information found in your personal data.";
    }

    let context = "Retrieved information from your personal data:\n\n";

    // Add each document with numbering
    documents.forEach((doc, index) => {
      context += `[Document ${index + 1}]\n`;
      context += doc.formattedText;
      context += "\n---\n\n";
    });

    // Add summary footer
    context += `Total documents retrieved: ${documents.length}\n`;

    // Add source breakdown
    const sourceBreakdown = this.getSourceBreakdown(documents);
    if (Object.keys(sourceBreakdown).length > 0) {
      context += `Sources: ${Object.entries(sourceBreakdown)
        .map(([source, count]) => `${source} (${count})`)
        .join(", ")}\n`;
    }

    return context;
  }

  /**
   * Get breakdown of documents by source
   * @private
   */
  getSourceBreakdown(documents) {
    return documents.reduce((acc, doc) => {
      acc[doc.source] = (acc[doc.source] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Format context when no documents are found
   * @private
   */
  formatEmptyContext(userQuery) {
    return {
      contextString:
        "No relevant information found in your personal data for this query.",
      documents: [],
      metadata: {
        totalDocuments: 0,
        selectedDocuments: 0,
        contextTokens: 0,
        queryTokens: estimateTokens(userQuery),
        totalTokens: estimateTokens(userQuery),
        withinLimit: true,
      },
    };
  }

  /**
   * Create a condensed summary when context is too large
   * Useful for very long documents
   */
  createCondensedSummary(documents, maxTokens) {
    logger.info("Creating condensed summary", {
      documentCount: documents.length,
      maxTokens,
    });

    const summaries = documents.map((doc, index) => {
      const preview = doc.content.substring(0, this.maxDocumentPreview);
      const truncated = doc.content.length > this.maxDocumentPreview;

      return {
        index: index + 1,
        title: doc.title || "Untitled",
        source: doc.source,
        date: new Date(doc.timestamp).toLocaleDateString(),
        preview: preview + (truncated ? "..." : ""),
        relevance: doc.finalScore
          ? (doc.finalScore * 100).toFixed(1) + "%"
          : "N/A",
      };
    });

    let summary = "Summary of retrieved documents:\n\n";

    summaries.forEach((s) => {
      summary += `${s.index}. ${s.title}\n`;
      summary += `   Source: ${s.source} | Date: ${s.date} | Relevance: ${s.relevance}\n`;
      summary += `   Preview: ${s.preview}\n\n`;
    });

    return summary;
  }

  /**
   * Format for citation/reference
   * Returns minimal info for citing sources
   */
  formatForCitation(documents) {
    return documents.map((doc, index) => ({
      id: index + 1,
      documentId: doc.documentId,
      source: doc.source,
      title: doc.title || "Untitled",
      date: doc.timestamp
        ? new Date(doc.timestamp).toLocaleDateString()
        : "Unknown",
      author: doc.author || "Unknown",
      url: doc.metadata?.url || null,
    }));
  }

  /**
   * Create debug view of context
   * Shows token usage and truncation details
   */
  debugView(formattedContext) {
    return {
      summary: {
        totalDocuments: formattedContext.metadata.totalDocuments,
        selectedDocuments: formattedContext.metadata.selectedDocuments,
        droppedDocuments:
          formattedContext.metadata.totalDocuments -
          formattedContext.metadata.selectedDocuments,
      },
      tokenUsage: {
        context: formattedContext.metadata.contextTokens,
        query: formattedContext.metadata.queryTokens,
        total: formattedContext.metadata.totalTokens,
        limit: this.maxContextTokens,
        remaining:
          this.maxContextTokens - formattedContext.metadata.totalTokens,
        percentUsed:
          (
            (formattedContext.metadata.totalTokens / this.maxContextTokens) *
            100
          ).toFixed(1) + "%",
      },
      documents: formattedContext.documents.map((doc, i) => ({
        position: i + 1,
        id: doc.documentId,
        source: doc.source,
        score: doc.finalScore,
        tokens: estimateTokens(doc.formattedText),
      })),
    };
  }
}

export default new ContextFormatter();

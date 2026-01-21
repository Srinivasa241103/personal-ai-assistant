import { logger } from "../../utils/logger.js";
export class GmailNormalizer {
  /**
   * Normalize batch of Gmail messages
   */
  normalizeBatch(rawMessages, userId) {
    return rawMessages
      .map((msg) => this.normalize(msg, userId))
      .filter((doc) => doc !== null);
  }

  /**
   * Normalize single Gmail message to unified document format
   */
  normalize(rawMessage, userId) {
    try {
      const headers = this.extractHeaders(rawMessage.payload.headers);
      const content = this.extractContent(rawMessage.payload);

      // Skip emails with no content
      if (!content || content.trim().length === 0) {
        logger.warn(`Empty content for message ${rawMessage.id}, skipping`);
        return null;
      }

      return {
        documentId: `gmail_${rawMessage.id}`,
        userId: userId,
        source: "gmail",
        type: "email",
        content: this.cleanContent(content),
        contentLength: content.length,
        title: headers.subject || "(No Subject)",
        timestamp: new Date(parseInt(rawMessage.internalDate)),
        author: headers.from,
        metadata: {
          gmail: {
            messageId: rawMessage.id,
            threadId: rawMessage.threadId,
            labelIds: rawMessage.labelIds || [],
            snippet: rawMessage.snippet,
            from: headers.from,
            to: headers.to,
            subject: headers.subject,
            date: headers.date,
          },
        },
        indexed: false,
        embeddingId: null,
        syncAttempts: 0,
        lastSyncError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.error(
        `Failed to normalize message ${rawMessage.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Extract email headers
   */
  extractHeaders(headers) {
    const extracted = {
      from: null,
      to: null,
      subject: null,
      date: null,
    };

    headers.forEach((header) => {
      const name = header.name.toLowerCase();
      if (name === "from") extracted.from = header.value;
      if (name === "to") extracted.to = header.value;
      if (name === "subject") extracted.subject = header.value;
      if (name === "date") extracted.date = header.value;
    });

    return extracted;
  }

  /**
   * Extract email body content
   */
  extractContent(payload) {
    // Plain text body
    if (payload.mimeType === "text/plain" && payload.body.data) {
      return this.decodeBase64(payload.body.data);
    }

    // HTML body
    if (payload.mimeType === "text/html" && payload.body.data) {
      const html = this.decodeBase64(payload.body.data);
      return this.stripHtml(html);
    }

    // Multipart email
    if (payload.parts) {
      return this.extractContentFromParts(payload.parts);
    }

    return "";
  }

  /**
   * Extract content from multipart email
   */
  extractContentFromParts(parts) {
    let plainText = "";
    let htmlText = "";

    parts.forEach((part) => {
      if (part.mimeType === "text/plain" && part.body.data) {
        plainText += this.decodeBase64(part.body.data);
      } else if (part.mimeType === "text/html" && part.body.data) {
        htmlText += this.decodeBase64(part.body.data);
      } else if (part.parts) {
        // Nested parts (recursive)
        const nestedContent = this.extractContentFromParts(part.parts);
        plainText += nestedContent;
      }
    });

    // Prefer plain text over HTML
    if (plainText) {
      return plainText;
    } else if (htmlText) {
      return this.stripHtml(htmlText);
    }

    return "";
  }

  /**
   * Decode base64 email content
   */
  decodeBase64(data) {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  /**
   * Strip HTML tags and convert to plain text
   */
  stripHtml(html) {
    let text = html.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      ""
    );
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }

  /**
   * Clean and truncate content
   */
  cleanContent(content) {
    let cleaned = content.replace(/\n{3,}/g, "\n\n");
    cleaned = cleaned.replace(/--\s*\n.*$/s, "");

    // Truncate very long emails
    if (cleaned.length > 32000) {
      cleaned = cleaned.substring(0, 32000) + "... [truncated]";
    }

    return cleaned.trim();
  }
}

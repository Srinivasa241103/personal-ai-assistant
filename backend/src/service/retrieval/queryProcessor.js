import {
  extractKeywords,
  matchesAnyPattern,
  extractEntities,
} from "../../utils/textProcessing.js";
import {
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  startOfYear,
  endOfYear,
  parseISO,
} from "date-fns";
import { logger } from "../../utils/logger.js";

export default class QueryProcessor {
  constructor() {
    this.intentPatterns = {
      search_email: [
        /\bemails?\b/i,
        /\bmail\b/i,
        /\bmessages?\b/i,
        /\bsent\b/i,
        /\breceived\b/i,
        /\binbox\b/i,
        /\bemail from\b/i,
        /\bmail from\b/i,
        /\bcorrespondence\b/i,
      ],
      search_calendar: [
        "meeting",
        "appointment",
        "schedule",
        "event",
        "calendar",
        "booked",
        "invite",
        "call",
        "zoom",
      ],
      search_spotify: [
        "song",
        "songs",
        "music",
        "track",
        "playlist",
        "album",
        "artist",
        "spotify",
        "listen",
        "audio",
      ],
      pattern_analysis: [
        "pattern",
        "trend",
        "usually",
        "often",
        "frequency",
        "how many",
        "how often",
        "statistics",
        "analyze",
      ],
      recommendation: [
        "recommend",
        "suggest",
        "should i",
        "what should",
        "advice",
        "best",
      ],
    };

    this.timePatterns = {
      today: /\btoday\b|\bthis day\b/i,
      yesterday: /\byesterday\b/i,
      last_week: /\blast week\b|\bpast week\b/i,
      this_week: /\bthis week\b/i,
      last_month: /\blast month\b|\bpast month\b/i,
      this_month: /\bthis month\b/i,
      last_year: /\blast year\b|\bpast year\b/i,
      this_year: /\bthis year\b/i,
      last_n_days: /\b(?:last|past)\s+(\d+)\s+days?\b/i,
      last_n_weeks: /\b(?:last|past)\s+(\d+)\s+weeks?\b/i,
      last_n_months: /\b(?:last|past)\s+(\d+)\s+months?\b/i,
      n_days_ago: /\b(\d+)\s+days?\s+ago\b/i,
      n_weeks_ago: /\b(\d+)\s+weeks?\s+ago\b/i,
      specific_month:
        /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
      specific_date: /\bon\s+(\d{4}-\d{2}-\d{2})\b/i,
    };

    // Patterns for extracting person names from queries
    // Stop at prepositions (about, regarding, for, etc.) to avoid capturing too much
    this.personPatterns = [
      /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:about|regarding|for|on|in|at|to)\b)?/i,
      /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:about|regarding|for|on|in|at)\b)?/i,
      /\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:about|regarding|for|on|in|at)\b)?/i,
      /\bdiscuss(?:ed)?\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:about|regarding|for|on|in|at)\b)?/i,
    ];

    // Prepositions that should not be part of a name
    this.stopPrepositions = ["about", "regarding", "for", "on", "in", "at", "to", "from", "with", "by"];
  }

  async process(query) {
    try {
      const normalizedQuery = query.trim();
      const intent = this.detectIntent(normalizedQuery);
      const timeRange = this.extractTimeRange(normalizedQuery);
      const source = this.detectSource(normalizedQuery);
      const keywords = extractKeywords(normalizedQuery, 10);
      const entities = extractEntities(normalizedQuery);
      const person = this.extractPerson(normalizedQuery);
      const filters = this.buildFilters(
        normalizedQuery,
        timeRange,
        source,
        entities,
        person
      );

      const result = {
        originalQuery: query,
        intent,
        keywords,
        entities,
        person,
        filters,
        timeRange,
        source,
        queryType: this.determineQueryType(intent),
      };

      logger.debug("Query processed", { query, result });
      return result;
    } catch (error) {
      logger.error(`Error processing query: ${error.message}`, {
        error: error.stack,
      });
      throw error;
    }
  }

  detectIntent(query) {
    const lowerQuery = query.toLowerCase();

    // Check each intent pattern
    for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
      if (matchesAnyPattern(lowerQuery, patterns)) {
        return intent;
      }
    }
    return "general_search";
  }

  extractTimeRange(query) {
    const now = new Date();

    // Check each time pattern
    for (const [pattern, regex] of Object.entries(this.timePatterns)) {
      const match = query.match(regex);

      if (match) {
        switch (pattern) {
          case "today":
            return {
              start: startOfDay(now),
              end: endOfDay(now),
              label: "today",
            };

          case "yesterday": {
            const yesterday = subDays(now, 1);
            return {
              start: startOfDay(yesterday),
              end: endOfDay(yesterday),
              label: "yesterday",
            };
          }

          case "last_week": {
            const lastWeek = subWeeks(now, 1);
            return {
              start: startOfWeek(lastWeek),
              end: endOfWeek(lastWeek),
              label: "last week",
            };
          }

          case "this_week":
            return {
              start: startOfWeek(now),
              end: endOfWeek(now),
              label: "this week",
            };

          case "last_month": {
            const lastMonth = subMonths(now, 1);
            return {
              start: startOfMonth(lastMonth),
              end: endOfMonth(lastMonth),
              label: "last month",
            };
          }

          case "this_month":
            return {
              start: startOfMonth(now),
              end: endOfMonth(now),
              label: "this month",
            };

          case "last_year": {
            const lastYear = subYears(now, 1);
            return {
              start: startOfYear(lastYear),
              end: endOfYear(lastYear),
              label: "last year",
            };
          }

          case "this_year":
            return {
              start: startOfYear(now),
              end: endOfYear(now),
              label: "this year",
            };

          case "last_n_days": {
            const days = parseInt(match[1]);
            return {
              start: startOfDay(subDays(now, days)),
              end: endOfDay(now),
              label: `last ${days} days`,
            };
          }

          case "last_n_weeks": {
            const weeks = parseInt(match[1]);
            return {
              start: startOfDay(subWeeks(now, weeks)),
              end: endOfDay(now),
              label: `last ${weeks} weeks`,
            };
          }

          case "last_n_months": {
            const months = parseInt(match[1]);
            return {
              start: startOfDay(subMonths(now, months)),
              end: endOfDay(now),
              label: `last ${months} months`,
            };
          }

          case "n_days_ago": {
            const daysAgo = parseInt(match[1]);
            const targetDate = subDays(now, daysAgo);
            return {
              start: startOfDay(targetDate),
              end: endOfDay(targetDate),
              label: `${daysAgo} days ago`,
            };
          }

          case "n_weeks_ago": {
            const weeksAgo = parseInt(match[1]);
            const targetWeek = subWeeks(now, weeksAgo);
            return {
              start: startOfWeek(targetWeek),
              end: endOfWeek(targetWeek),
              label: `${weeksAgo} weeks ago`,
            };
          }

          case "specific_month": {
            const monthName = match[1];
            const monthIndex = this.getMonthIndex(monthName);
            const year = now.getFullYear();
            // If the month is in the future, assume last year
            const targetYear = monthIndex > now.getMonth() ? year - 1 : year;
            const monthDate = new Date(targetYear, monthIndex, 1);

            return {
              start: startOfMonth(monthDate),
              end: endOfMonth(monthDate),
              label: monthName,
            };
          }

          case "specific_date": {
            const dateStr = match[1];
            const date = parseISO(dateStr);
            return {
              start: startOfDay(date),
              end: endOfDay(date),
              label: dateStr,
            };
          }
        }
      }
    }
    return null;
  }

  extractPerson(query) {
    for (const pattern of this.personPatterns) {
      const match = query.match(pattern);
      if (match && match[1]) {
        let name = match[1].trim();

        // Remove trailing prepositions if accidentally captured
        const words = name.split(/\s+/);
        const cleanedWords = words.filter(
          (word) => !this.stopPrepositions.includes(word.toLowerCase())
        );
        name = cleanedWords.join(" ");

        // Filter out common words that might be caught
        const commonWords = [
          "the",
          "a",
          "an",
          "my",
          "your",
          "this",
          "that",
          "it",
        ];
        if (name && !commonWords.includes(name.toLowerCase())) {
          return name;
        }
      }
    }
    return null;
  }

  detectSource(query) {
    const lowerQuery = query.toLowerCase();

    if (matchesAnyPattern(lowerQuery, this.intentPatterns.search_email)) {
      return "gmail";
    }

    if (matchesAnyPattern(lowerQuery, this.intentPatterns.search_calendar)) {
      return "google_calendar";
    }

    if (matchesAnyPattern(lowerQuery, this.intentPatterns.search_spotify)) {
      return "spotify";
    }

    return null;
  }

  buildFilters(query, timeRange, source, entities, person) {
    const filters = {};

    if (source) {
      filters.source = source;
    }

    if (timeRange) {
      filters.timeRange = {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
      };
    }

    if (person) {
      filters.author = person;
    } else if (entities.length > 0) {
      // Use first entity as potential author if no explicit person found
      filters.potentialAuthor = entities[0];
    }

    return filters;
  }

  determineQueryType(intent) {
    if (intent.startsWith("search_")) {
      return "memory_recall";
    }

    if (intent === "pattern_analysis") {
      return "pattern";
    }

    if (intent === "recommendation") {
      return "recommendation";
    }

    return "general";
  }

  getMonthIndex(monthName) {
    const months = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    };
    return months[monthName.toLowerCase()];
  }
}

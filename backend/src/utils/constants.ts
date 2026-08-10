export const LLM_INVOCATION_TYPES = {
    RAG_CHAT: 'rag_chat',
    EMBEDDING: 'embedding',
    QUERY_REWRITE: 'query_rewrite',
    RERANK: 'rerank',
    // V2 agent runtime. The `agent_` prefix keeps the whole family grouped in
    // llm_usage_logs as AGT-04's planner and AGT-05's verifier arrive.
    AGENT_SUPERVISOR: 'agent_supervisor'
}

export const SYNC_SOURCE = {
    GMAIL: 'gmail',
    GOOGLE_CALENDER: 'google_calendar'
}

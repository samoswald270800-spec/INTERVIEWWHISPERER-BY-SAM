# Server-Side Protection Implementation Plan

## Features to Implement:

### 1. Multiple Session Detection
- Track active sessions per user in Redis
- On login, check if user already has active session
- If yes and role !== 'admin', reject with 403
- Store session metadata: deviceId, IP, userAgent

### 2. Device/IP Binding
- On login, store: session.deviceId, session.ip, session.userAgent
- On subsequent requests, validate these match
- If mismatch (except admin), force logout

### 3. Rate Limiting for /analyze-screen
- Track per user (not admin):
  - Last request timestamp (1 req/20s)
  - Daily counter (max 50/day)
  - File size limit (25MB)
- Return error: "Slow down. Too many analyze attempts."

## Redis Keys Structure:
```
active_sessions:{userId} -> Set of sessionIds
analyze_count:{userId}:{YYYY-MM-DD} -> count (TTL: 24h)
analyze_last:{userId} -> timestamp
```

## Implementation Files:
- server.js (main logic)

// server.js — Realtime (tab audio) + JD-tailored answers (TEXT replies only)
import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for Render so secure cookies work
app.set("trust proxy", 1);

// Parse JSON before auth routes (needed for /api/login and /set-jd)
app.use(express.json({ limit: "1mb" })); // for /set-jd and login
/* =======================================================================
   Redis session store (connect-redis v8 + node-redis v4, ESM)
   ======================================================================= */
/* ================== Redis session store (connect-redis v8 + node-redis v4) ================== */
import session from "express-session";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";

if (!process.env.REDIS_URL) {
  console.error("❌ Missing REDIS_URL");
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL.trim();
const useTLS = redisUrl.startsWith("rediss://");

// Create the Redis client
const redisClient = createClient({
  url: redisUrl,
  socket: useTLS
    ? { tls: true, rejectUnauthorized: false }  // only when using rediss://
    : undefined,
});

redisClient.on("error", (err) => {
  console.error("❌ Redis error:", err);
});
redisClient.on("ready", () => {
  console.log("✅ Redis client ready");
});

// Top-level await is fine in ESM
await redisClient.connect();

// Optional quick health check
try {
  const pong = await redisClient.ping();
  console.log("🔎 Redis PING:", pong);
} catch (e) {
  console.error("❌ Redis ping failed:", e);
}

const store = new RedisStore({
  client: redisClient,
  prefix: "sess:",  // optional
});

// Attach the session middleware
app.use(
  session({
    store,
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 6 * 60 * 60 * 1000, // 6 hours
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);
/* ============================================================================================= */
// ---[ADD] Temp-user pre-handler for /api/login (kept before your existing /api/login) ---
const TEMP_USER_PREFIX = "tempuser:";

// Try temp-user credentials first; if not found, fall through to your existing /api/login.
app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return next();

    const key = `${TEMP_USER_PREFIX}${username}`;
    const raw = await redisClient.get(key);
    if (!raw) return next(); // not a temp user → let your existing /api/login handle admin

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return next(); // malformed → ignore, let admin path try
    }

    if (data?.password !== password) {
      // wrong temp password → let admin path try
      return next();
    }

    // Success: set session & annotate
    req.session.userId = username;
    req.session.role = "user";
    req.session.ip = req.headers["x-forwarded-for"] || req.ip;
    req.session.loginAt = Date.now();

    return res.json({ ok: true, role: "user" });
  } catch (e) {
    // On any unexpected error we fall through to admin path to avoid blocking it
    return next();
  }
});


/* ---------- Minimal login/logout endpoints ---------- */
// Render: set ADMIN_USER and ADMIN_PASS in Environment
/* ---------- Minimal login/logout endpoints ---------- */
// Render: set ADMIN_USER and ADMIN_PASS in Environment
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || "";
  const ADMIN_PASS = process.env.ADMIN_PASS || "";

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.userId = username;
    req.session.role = "admin";   // ✅ THIS LINE WAS MISSING
    req.session.ip = req.headers["x-forwarded-for"] || req.ip;
    req.session.loginAt = Date.now();
    return res.json({ ok: true, role: "admin" });
  }

  return res.status(401).json({ error: "Invalid username or password" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Serve the login page itself
app.get("/login", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ---------- Auth gate (protect everything else) ---------- */
function requireAuth(req, res, next) {
  if (req.path === "/login" || req.path === "/api/login") return next();
  if (req.session?.userId) return next();
  return res.redirect("/login");
}
app.use(requireAuth);
// ---[ADD] Post-auth annotator so we capture IP/loginAt even if admin logged in via your handler ---
app.use((req, _res, next) => {
  if (req.session && !req.session.loginAt) {
    req.session.loginAt = Date.now();
  }
  if (req.session && !req.session.ip) {
    req.session.ip = req.headers["x-forwarded-for"] || req.ip;
  }
  next();
});

// Serve static files only after auth
// ✅ ADMIN CONSOLE (protected area)
function requireAdmin(req, res, next) {
  if (req.session?.role === "admin") return next();
  return res.status(403).json({ error: "Admin only" });
}

async function createTempUser(username, password, ttlHours = 24) {
  const ttlSeconds = ttlHours * 3600;
  const now = Date.now();
  const payload = { password, createdAt: now, expiresAt: now + ttlSeconds * 1000 };
  await redisClient.set(`tempuser:${username}`, JSON.stringify(payload), { EX: ttlSeconds });
}

async function getTempUser(username) {
  const raw = await redisClient.get(`tempuser:${username}`);
  return raw ? JSON.parse(raw) : null;
}

async function deleteTempUser(username) {
  await redisClient.del(`tempuser:${username}`);
}

// ✅ Admin Dashboard UI
app.get("/admin", requireAdmin, (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head>
<meta charset="utf-8"/>
<title>Admin Console</title>
<style>
 body { background:#0d1117; color:white; font-family:system-ui; padding:40px; }
 input,button { padding:10px; border-radius:8px; border:none; margin-bottom:10px; }
 button { background:#238636; color:white; cursor:pointer; }
 .card{ background:#161b22;padding:20px;border-radius:12px;margin-bottom:20px;}
 table{ width:100%; margin-top:20px; }
 th,td{ padding:10px; border-bottom:1px solid #30363d; }
</style>
</head><body>
<h1>Admin Console</h1>

<div class="card">
 <h3>Create Temp User</h3>
 <input id="u" placeholder="username"/>
 <input id="p" placeholder="password"/>
 <input id="h" placeholder="hours (default 24)" type="number"/>
 <button onclick="createUser()">Create</button>
 <p id="msg"></p>
</div>

<div class="card">
 <h3>Active Temp Users</h3>
 <table id="users"><thead>
 <tr><th>User</th><th>TTL</th><th>Expires</th><th></th></tr></thead><tbody></tbody></table>
</div>

<script>
async function createUser(){
 const r = await fetch('/admin/api/users',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({username:u.value,password:p.value,hours:h.value})});
 msg.textContent=(await r.json()).ok?'✅ Created':'❌ Error';
 loadUsers();
}
async function loadUsers(){
 const r = await fetch('/admin/api/users');
 const j = await r.json();
 users.querySelector("tbody").innerHTML = j.users.map(u => (
  \`<tr><td>\${u.username}</td><td>\${u.ttlSeconds}s</td>
    <td>\${new Date(u.expiresAt).toLocaleString()}</td>
    <td><button onclick="revoke('\${u.username}')">Revoke</button></td></tr>\`
 )).join('');
}
async function revoke(username){
 await fetch('/admin/api/users/'+username,{method:'DELETE'});
 loadUsers();
}
loadUsers();
</script>
</body></html>`);
});

// API endpoints
app.post("/admin/api/users", requireAdmin, async (req, res) => {
  const { username, password, hours = 24 } = req.body;
  await createTempUser(username, password, Number(hours));
  return res.json({ ok: true });
});

app.get("/admin/api/users", requireAdmin, async (_req, res) => {
  const users = [];
  for await (const key of redisClient.scanIterator({ MATCH: "tempuser:*" })) {
    const username = key.replace("tempuser:", "");
    const data = await getTempUser(username);
    const ttl = await redisClient.ttl(key);
    users.push({ username, ttlSeconds: ttl, expiresAt: data.expiresAt });
  }
  return res.json({ ok: true, users });
});

app.delete("/admin/api/users/:username", requireAdmin, async (req, res) => {
  await deleteTempUser(req.params.username);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

// Explicit route for "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* Load resume (optional but recommended) */
let resume = "";
let assignment = "";
try {
  resume = fs.readFileSync("./resume.txt", "utf8");
  console.log("ℹ️  Loaded resume.txt");
} catch {
  console.log("ℹ️  No resume.txt found (optional).");
}
try {
  assignment = fs.readFileSync("./assignment.txt", "utf8");
  console.log("ℹ️  Loaded assignment.txt");
} catch {
  console.log("ℹ️  No assignment.txt found (optional).");
}
/* Store JD in memory (resets when you restart the server) */
let JOB_DESC = "";

/* Paste/Update JD from the browser */
app.post("/set-jd", (req, res) => {
  const jd = (req.body?.jd || "").toString();
  JOB_DESC = jd.slice(0, 20000); // simple size guard
  return res.json({ ok: true, length: JOB_DESC.length });
});

/* Mint ephemeral session token for the browser */
app.post("/session", async (_req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview",

        // ✅ We want audio IN (from your tab) but TEXT OUT only.
        // Realtime accepts your audio track via WebRTC regardless; limiting
        // modalities to ["text"] stops TTS/audio responses.
        modalities: ["text"],

        // Ensure PCM16 audio framing and server-side speech detection.
        input_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200, // a hair longer = cleaner turn splits
          create_response: true,
          interrupt_response: true,
        },

        // ✅ Use realtime-native transcription so we get clean transcript events.
        input_audio_transcription: { model: "gpt-4o-transcribe" },

        // ***** Tailoring instructions (JD + Resume) *****
       instructions: `
You are a live AI interview coach designed to help candidates prepare for job interviews in real time. 

The candidate will provide:
1) A JOB DESCRIPTION (highest priority)
2) A RESUME (second priority for examples)
3) Optionally, an ASSIGNMENT (e.g., case study, slides, or project notes)

Your job is to read and memorize all of these. Every answer you give must sound as if *you are the candidate themself* — speaking in first person, confidently, naturally, and conversationally (never robotic).  

The candidate will only give short prompts (e.g., “intro”, “GA4”, “A/B test example”), and you must instantly understand the context and reply with a complete, ready-to-speak answer that sounds human and interview-ready.  

---

### 🎯 PRIORITIES
1. **JOB DESCRIPTION:** tailor every answer directly to the role and employer.  
2. **RESUME:** use specific examples, tools, and metrics from the resume to demonstrate expertise.  
3. **ASSIGNMENT (optional):** include only if relevant to the question (e.g., slides or portfolio projects).

---

### 🗣️ STYLE & TONE
- Always reply in **first person**, as if the candidate is speaking.  
- Mix professional and casual tone naturally — include light conversational fillers (“ahh,” “hmm,” “so yeah”) to sound authentic.  
- Never preface with “here’s your answer” or refer to the AI or system.  
- Keep the flow confident, friendly, and easy to speak out loud.  

---

### 🧩 CONTENT RULES
When asked any question:
- If it’s **introductory**, focus on the “why + who I am” — align with JD keywords.  
- If it’s **technical or project-based**, go deep:  
  - Start with the **business problem or goal**  
  - Explain **tools, methods, data sources** used  
  - Describe **steps, challenges, and collaboration**  
  - End with **quantified impact or key metric** (e.g., conversion +%, churn ↓, revenue ↑).  
- Always blend examples from the resume with the language of the JD.  
- Avoid generic answers — everything should sound like it came from lived experience.  

---

### 🧭 GOAL
Every single answer should sound like a confident, credible professional who:
- Understands their craft end-to-end  
- Speaks with clarity, ownership, and insight  
- Connects past experience directly to the target role  

---

**RULE #1:** Never break character.  
Always answer as if you are the candidate currently being interviewed for the provided job description.

JOB DESCRIPTION (highest priority):
${JOB_DESC || "(JD not provided — give a strong general answer for the role based on resume)"}

RESUME (second priority for concrete evidence and examples):
${resume || "(no resume provided)"}

ASSIGNMENT (use if relevant, e.g., if interviewer asks about slides, deliverables, or project report):
${assignment || "(no assignment provided)"}
`.trim(),


      }),
    });

    const session = await r.json();
    res.json(session);
  } catch (e) {
    console.error("Session error:", e);
    res.status(500).json({ error: String(e) });
  }
});

/* ---------- Start the server (Render-safe) ---------- */
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`✅ Server listening on http://${HOST}:${PORT}`);
  console.log("   Paste a JD in the UI (Save JD) to tailor answers.");
});


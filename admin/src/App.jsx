import { useEffect, useState, useRef } from "react";

/*
  Admin UI: shows temp users and session status.
  - Polls backend every pollMinutes (default 10)
  - Calls:
      GET  /admin/api/users    -> returns temp users (existing)
      GET  /admin/api/sessions -> returns active sessions (new)
      DELETE /admin/api/users/:username  -> revoke (existing)
      POST /admin/api/sessions/:sessionId/logout -> logout specific session (new)
*/

export default function App() {
  const [users, setUsers] = useState([]); // temp users
  const [sessions, setSessions] = useState([]); // active sessions
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hours, setHours] = useState(24);
  const [msg, setMsg] = useState("");
  const [pollMinutes, setPollMinutes] = useState(10); // configurable polling minutes

  const pollRef = useRef(null);

  async function fetchUsers() {
    const res = await fetch("/admin/api/users");
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function fetchSessions() {
    const res = await fetch("/admin/api/sessions");
    if (!res.ok) {
      setSessions([]);
      return;
    }
    const data = await res.json();
    setSessions(data.sessions || []);
  }

  // Combined loader
  async function loadAll() {
    await Promise.all([fetchUsers(), fetchSessions()]);
  }

  async function createUser() {
    const res = await fetch("/admin/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, hours }),
    });

    const data = await res.json();
    setMsg(data.ok ? "✅ User Created" : "❌ Failed");

    await loadAll();
    setUsername("");
    setPassword("");
  }

  async function revokeUser(username) {
    if (!confirm(`Revoke temporary account "${username}"? This deletes the account.`)) return;
    await fetch(`/admin/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    await loadAll();
  }

  // Logout (destroy) a session by sessionId
  async function logoutSession(sessionId) {
    if (!confirm("Force logout this session? This will end their session but NOT delete the account.")) return;
    const res = await fetch(`/admin/api/sessions/${encodeURIComponent(sessionId)}/logout`, {
      method: "POST",
    });
    if (!res.ok) {
      alert("Failed to logout session");
    } else {
      await loadAll();
    }
  }

  // Polling lifecycle
  useEffect(() => {
    loadAll();

    // Clear existing interval if changed
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    // Set interval based on pollMinutes
    const ms = Math.max(1, Number(pollMinutes)) * 60 * 1000;
    pollRef.current = setInterval(() => {
      loadAll();
    }, ms);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMinutes]);

  // Helper to find session for a given username (there might be multiple sessions per user; pick most recent)
  function findSessionForUser(username) {
    if (!username) return null;
    const matched = sessions.filter((s) => s.userId === username);
    if (matched.length === 0) return null;
    // pick one with latest loginAt
    matched.sort((a, b) => (b.loginAt || 0) - (a.loginAt || 0));
    return matched[0];
  }

  function fmtTime(ts) {
    if (!ts) return "-";
    const d = new Date(Number(ts));
    return d.toLocaleString();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-10 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-10">🚀 Admin Console</h1>

      {/* Create user card */}
      <div className="bg-white/10 backdrop-blur-lg p-6 rounded-2xl w-full max-w-xl shadow-2xl border border-white/20">
        <h2 className="text-xl font-semibold mb-4">Create Temporary User</h2>

        <div className="flex flex-col gap-4">
          <input
            className="bg-white/5 backdrop-blur-sm p-3 rounded-lg border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-white/40"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="bg-white/5 backdrop-blur-sm p-3 rounded-lg border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-white/40"
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="bg-white/5 backdrop-blur-sm p-3 rounded-lg border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-white/40"
            placeholder="valid hours (default 24)"
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />

          <button
            onClick={createUser}
            className="bg-green-500/30 backdrop-blur-sm p-3 rounded-lg hover:bg-green-500/40 border border-green-400/30 transition-all"
          >
            ✅ Create User
          </button>

          <p className="mt-3 text-white/90">{msg}</p>
        </div>
      </div>

      {/* Active user list */}
      <div className="bg-white/10 backdrop-blur-lg p-6 rounded-2xl w-full max-w-4xl shadow-2xl border border-white/20 mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Active Users</h2>

          <div className="flex items-center gap-3">
            <label className="text-sm text-white/70">Poll (minutes):</label>
            <input
              type="number"
              min={1}
              value={pollMinutes}
              onChange={(e) => setPollMinutes(Number(e.target.value))}
              className="bg-white/5 backdrop-blur-sm p-2 rounded-lg border border-white/20 w-20 text-white focus:outline-none focus:border-white/40"
            />
            <button
              className="bg-blue-500/30 backdrop-blur-sm px-3 py-2 rounded-lg hover:bg-blue-500/40 border border-blue-400/30 transition-all"
              onClick={() => loadAll()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/20">
                <th className="p-3 text-left text-white/80">Username</th>
                <th className="p-3 text-left text-white/80">IP Address</th>
                <th className="p-3 text-left text-white/80">Status</th>
                <th className="p-3 text-left text-white/80">Login Time</th>
                <th className="p-3 text-left text-white/80">TTL</th>
                <th className="p-3 text-left text-white/80">Revoke</th>
                <th className="p-3 text-left text-white/80">Logout</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const s = findSessionForUser(u.username);
                const online = Boolean(s && s.sessionId);
                const ip = s?.ip || "—";
                const loginTime = s?.loginAt ? fmtTime(s.loginAt) : "—";
                return (
                  <tr key={u.username} className="border-b border-white/10 hover:bg-white/5">
                    <td className="p-3">{u.username}</td>
                    <td className="p-3">{ip}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: online ? "#22c55e" : "#9ca3af",
                          }}
                        />
                        <span>{online ? "Online" : "Offline"}</span>
                      </div>
                    </td>
                    <td className="p-3">{loginTime}</td>
                    <td className="p-3">{u.ttlSeconds != null ? `${u.ttlSeconds}s` : "—"}</td>
                    <td className="p-3">
                      <button
                        className="bg-red-500/30 backdrop-blur-sm px-3 py-2 rounded-lg hover:bg-red-500/40 border border-red-400/30 transition-all"
                        onClick={() => revokeUser(u.username)}
                      >
                        ❌ Revoke
                      </button>
                    </td>
                    <td className="p-3">
                      <button
                        className={`px-3 py-2 rounded-lg backdrop-blur-sm transition-all ${
                          online ? "bg-yellow-500/30 hover:bg-yellow-500/40 border border-yellow-400/30" : "bg-white/5 border border-white/10 cursor-not-allowed opacity-60"
                        }`}
                        onClick={() => online && logoutSession(s.sessionId)}
                        disabled={!online}
                      >
                        ⎋ Logout
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Edge-case: show sessions that don't have a temp account (logged in but no tempuser row) */}
        {sessions.length > 0 && sessions.filter((s) => !users.some((u) => u.username === s.userId)).length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">Orphan Sessions (no temp account)</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="p-3 text-left text-white/80">SessionId (short)</th>
                    <th className="p-3 text-left text-white/80">User</th>
                    <th className="p-3 text-left text-white/80">IP</th>
                    <th className="p-3 text-left text-white/80">Login Time</th>
                    <th className="p-3 text-left text-white/80">Logout</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions
                    .filter((s) => !users.some((u) => u.username === s.userId))
                    .map((s) => (
                      <tr key={s.sessionId} className="border-b border-white/10 hover:bg-white/5">
                        <td className="p-3">{s.sessionId.slice(0, 10)}</td>
                        <td className="p-3">{s.userId || "—"}</td>
                        <td className="p-3">{s.ip || "—"}</td>
                        <td className="p-3">{s.loginAt ? fmtTime(s.loginAt) : "—"}</td>
                        <td className="p-3">
                          <button
                            className="bg-yellow-500/30 backdrop-blur-sm px-3 py-2 rounded-lg hover:bg-yellow-500/40 border border-yellow-400/30 transition-all"
                            onClick={() => logoutSession(s.sessionId)}
                          >
                            ⎋ Logout
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

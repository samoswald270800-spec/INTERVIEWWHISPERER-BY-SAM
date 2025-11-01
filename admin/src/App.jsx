import { useEffect, useState } from "react";

export default function App() {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hours, setHours] = useState(24);
  const [msg, setMsg] = useState("");

  async function loadUsers() {
    const res = await fetch("/admin/api/users");
    const data = await res.json();
    setUsers(data.users);
  }

  async function createUser() {
    const res = await fetch("/admin/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, hours }),
    });

    const data = await res.json();
    setMsg(data.ok ? "✅ User Created" : "❌ Failed");

    loadUsers();
    setUsername("");
    setPassword("");
  }

  async function revokeUser(username) {
    await fetch(`/admin/api/users/${username}`, { method: "DELETE" });
    loadUsers();
  }

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <div className="min-h-screen bg-[#0d1117] text-white p-10 flex flex-col items-center">

      <h1 className="text-4xl font-bold mb-10">🚀 Admin Console</h1>

      {/* Create user card */}
      <div className="bg-[#161b22] p-6 rounded-lg w-full max-w-xl shadow-lg">
        <h2 className="text-xl font-semibold mb-4">Create Temporary User</h2>

        <div className="flex flex-col gap-4">
          <input
            className="bg-[#0d1117] p-3 rounded border border-gray-700"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="bg-[#0d1117] p-3 rounded border border-gray-700"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="bg-[#0d1117] p-3 rounded border border-gray-700"
            placeholder="valid hours (default 24)"
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />

          <button
            onClick={createUser}
            className="bg-green-600 p-3 rounded hover:bg-green-700 transition-all"
          >
            ✅ Create User
          </button>

          <p className="mt-3">{msg}</p>
        </div>
      </div>

      {/* Active user list */}
      <div className="bg-[#161b22] p-6 rounded-lg w-full max-w-3xl shadow-lg mt-10">
        <h2 className="text-xl font-semibold mb-4">Active Users</h2>

        <table className="w-full">
          <thead>
            <tr>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">TTL</th>
              <th className="p-3 text-left">Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td className="p-3">{u.username}</td>
                <td className="p-3">{u.ttlSeconds}s</td>
                <td className="p-3">{new Date(u.expiresAt).toLocaleString()}</td>
                <td className="p-3">
                  <button
                    className="bg-red-600 px-3 py-2 rounded hover:bg-red-700"
                    onClick={() => revokeUser(u.username)}
                  >
                    ❌ Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="h-screen w-full bg-[#0d1117] text-white flex flex-col items-center p-10">
      <h1 className="text-4xl font-semibold mb-6">
        🛠️ Admin Console (Beta)
      </h1>

      <div className="bg-[#161b22] p-6 rounded-lg w-full max-w-xl shadow-lg">
        <h2 className="text-xl font-medium">Create Temporary User</h2>

        <div className="flex flex-col gap-3 mt-4">
          <input className="bg-[#0d1117] p-3 rounded border border-gray-700"
                 placeholder="username" id="username" />
          <input className="bg-[#0d1117] p-3 rounded border border-gray-700"
                 placeholder="password" id="password" />
          <input className="bg-[#0d1117] p-3 rounded border border-gray-700"
                 placeholder="valid hours (default 24)" id="hours" type="number" />

          <button onclick="createUser()"
                  className="bg-green-600 p-3 rounded hover:bg-green-700 transition-all">
            Create User ✅
          </button>
        </div>

        <p id="msg" className="mt-4"></p>
      </div>
    </div>
  );
}


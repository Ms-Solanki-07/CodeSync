const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const ACTIONS = require("./src/Action");
const registerWhiteboardHandlers = require("./whiteboardServer");

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 5e6, // 5 MB, enough for ~60s voice clips
});

const userSocketMap = {};

// ---------- code runner (Judge0, external API) ----------
const JUDGE0_URL = (process.env.JUDGE0_URL || "https://ce.judge0.com").replace(/\/$/, "");
const MAX_CODE_LENGTH = 100000;
const MAX_OUTPUT_LENGTH = 50000;
const RUN_COOLDOWN_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 20;
const LANGUAGES_TTL_MS = 60 * 60 * 1000;

// client language id -> pattern for the language name in Judge0's /languages list
const LANGUAGE_PATTERNS = {
    javascript: /^JavaScript \(/,
    typescript: /^TypeScript \(/,
    python: /^Python \(3/,
    java: /^Java \(/,
    c: /^C \(GCC/,
    "c++": /^C\+\+ \(GCC/,
    csharp: /^C# \(/,
    go: /^Go \(/,
    rust: /^Rust \(/,
    php: /^PHP \(/,
    ruby: /^Ruby \(/,
    kotlin: /^Kotlin \(/,
    swift: /^Swift \(/,
    bash: /^Bash \(/,
};

const lastRunAt = {};
let languagesCache = null; // { list, at }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toB64 = (text) => Buffer.from(text, "utf8").toString("base64");
const fromB64 = (text) => (text ? Buffer.from(text, "base64").toString("utf8") : "");
const clip = (text) =>
    text.length > MAX_OUTPUT_LENGTH ? text.slice(0, MAX_OUTPUT_LENGTH) + "\n…output truncated" : text;

function judge0Headers() {
    const headers = { "Content-Type": "application/json" };
    if (process.env.JUDGE0_RAPIDAPI_KEY) {
        headers["X-RapidAPI-Key"] = process.env.JUDGE0_RAPIDAPI_KEY;
        headers["X-RapidAPI-Host"] = new URL(JUDGE0_URL).host;
    }
    if (process.env.JUDGE0_AUTH_TOKEN) {
        headers["X-Auth-Token"] = process.env.JUDGE0_AUTH_TOKEN;
    }
    return headers;
}

async function judge0Fetch(path, options = {}) {
    const res = await fetch(`${JUDGE0_URL}${path}`, {
        ...options,
        headers: judge0Headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`Judge0 responded ${res.status}: ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function findLanguageId(id) {
    const pattern = LANGUAGE_PATTERNS[id];
    if (!pattern) return null;

    if (!languagesCache || Date.now() - languagesCache.at > LANGUAGES_TTL_MS) {
        languagesCache = { list: await judge0Fetch("/languages"), at: Date.now() };
    }
    const matches = languagesCache.list.filter((l) => pattern.test(l.name));
    if (!matches.length) return null;
    // newest runtime = highest id
    return matches.reduce((a, b) => (b.id > a.id ? b : a)).id;
}

async function submit(body) {
    try {
        return await judge0Fetch("/submissions?base64_encoded=true&wait=true", { method: "POST", body });
    } catch (err) {
        if (err.status !== 400) throw err;
        // some instances disable wait=true: create without it and poll instead
        return judge0Fetch("/submissions?base64_encoded=true", { method: "POST", body });
    }
}

async function runCode({ language, code, stdin }) {
    const languageId = await findLanguageId(language);
    if (!languageId) {
        return { error: `"${language}" is not available on the code runner.` };
    }

    let result = await submit(
        JSON.stringify({
            language_id: languageId,
            source_code: toB64(code),
            stdin: stdin ? toB64(stdin) : null,
        })
    );

    if (!result.status && result.token) {
        for (let i = 0; i < MAX_POLLS; i++) {
            await sleep(POLL_INTERVAL_MS);
            result = await judge0Fetch(`/submissions/${result.token}?base64_encoded=true`);
            if (result.status && result.status.id > 2) break;
        }
    }
    if (!result.status || result.status.id <= 2) {
        return { error: "The code runner took too long to finish." };
    }

    const statusId = result.status.id;
    const status = statusId === 3 ? "Finished" : result.status.description;

    if (statusId === 6) {
        // compilation error
        return {
            status,
            stdout: "",
            stderr: clip(fromB64(result.compile_output) || fromB64(result.message)),
            exitCode: null,
            time: result.time,
            memory: result.memory,
        };
    }

    let stderr = fromB64(result.stderr);
    if (statusId !== 3) {
        stderr = [stderr, fromB64(result.message)].filter(Boolean).join("\n");
    }

    return {
        status,
        stdout: clip(fromB64(result.stdout)),
        stderr: clip(stderr),
        exitCode: result.exit_code ?? null,
        time: result.time,
        memory: result.memory,
    };
}
// ---------- end code runner ----------

function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map((socketId) => {
        return {
            socketId,
            username: userSocketMap[socketId],
        }
    });
}

io.on("connection", (socket) => {
    console.log("A user connected at", socket.id);
    registerWhiteboardHandlers(io, socket, userSocketMap);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
        userSocketMap[socket.id] = username;
        socket.join(roomId);

        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit(ACTIONS.JOINED, {
                clients,
                username,
                socketId: socket.id,
            })
        })
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ code, socketId }) => {
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.CHAT_MESSAGE, ({ roomId, type, text, audio, mimeType }) => {
        // Only accept messages from sockets that are actually in the room
        if (!socket.rooms.has(roomId)) return;

        const message = {
            id: `${socket.id}-${Date.now()}`,
            socketId: socket.id,
            username: userSocketMap[socket.id],
            type,
            timestamp: Date.now(),
        };

        if (type === "text") {
            const clean = String(text || "").trim().slice(0, 2000);
            if (!clean) return;
            message.text = clean;
        } else if (type === "voice") {
            if (!audio || !String(mimeType).startsWith("audio/")) return;
            message.audio = audio;
            message.mimeType = mimeType;
        } else {
            return;
        }

        // io.in (not socket.in) so the sender receives it too
        io.in(roomId).emit(ACTIONS.CHAT_MESSAGE, message);
    });

    socket.on(ACTIONS.RUN_CODE, async (payload, callback) => {
        if (typeof callback !== "function") return;
        const { language, code, stdin } = payload || {};

        if (typeof language !== "string" || typeof code !== "string" || !code.trim()) {
            return callback({ error: "There is no code to run." });
        }
        if (code.length > MAX_CODE_LENGTH) {
            return callback({ error: "Code is too large to run." });
        }
        const now = Date.now();
        if (now - (lastRunAt[socket.id] || 0) < RUN_COOLDOWN_MS) {
            return callback({ error: "Please wait a moment before running again." });
        }
        lastRunAt[socket.id] = now;

        try {
            callback(await runCode({ language, code, stdin: typeof stdin === "string" ? stdin : "" }));
        } catch (err) {
            console.error("Run error:", err.message);
            if (err.status === 429) {
                callback({ error: "The code runner is busy (rate limit reached). Try again in a moment." });
            } else if (err.status === 401 || err.status === 403) {
                callback({ error: "The code runner rejected the API key. Check the server's Judge0 settings." });
            } else {
                callback({ error: "Could not reach the code runner. Try again later." });
            }
        }
    });


    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];

        rooms.forEach((roomId) => {
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: userSocketMap[socket.id]
            })
        });
        delete userSocketMap[socket.id];
        socket.leave();
    });
});


const PORT = process.env.PORT || 5500;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

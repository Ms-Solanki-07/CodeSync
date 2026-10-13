const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const ACTIONS = require("./src/Action");

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 5e6, // 5 MB, enough for ~60s voice clips
});

const userSocketMap = {};

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

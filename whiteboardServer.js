const WB = require("./src/WhiteboardActions");

const MAX_ELEMENTS_PER_ROOM = 5000;
const MAX_ELEMENTS_PER_MESSAGE = 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // keep an empty board briefly so a refresh doesn't wipe it

const CURSOR_COLORS = [
    "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5",
    "#0c8599", "#c2255c", "#5f3dc4", "#e8590c", "#364fc7",
];

// roomId -> { members: Map<socketId, {username, color}>, elements: Map<id, element>, cleanupTimer }
const rooms = new Map();

const isValidRoomId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128;
const cleanName = (n) => (typeof n === "string" ? n.trim().slice(0, 40) : "");

function isValidElement(el) {
    return (
        el &&
        typeof el === "object" &&
        typeof el.id === "string" &&
        el.id.length <= 64 &&
        typeof el.type === "string" &&
        el.type !== "image" && // image files are not synced (image tool is disabled client-side)
        Number.isFinite(el.version) &&
        Number.isFinite(el.versionNonce)
    );
}

// Same rule Excalidraw uses: higher version wins, ties go to the lower versionNonce.
function shouldAccept(existing, incoming) {
    if (!existing) return true;
    if (incoming.version > existing.version) return true;
    if (incoming.version === existing.version) return incoming.versionNonce < existing.versionNonce;
    return false;
}

function getRoom(roomId) {
    let room = rooms.get(roomId);
    if (!room) {
        room = { members: new Map(), elements: new Map(), cleanupTimer: null };
        rooms.set(roomId, room);
    }
    return room;
}

function pickColor(room) {
    const used = new Set(Array.from(room.members.values()).map((m) => m.color.background));
    const free = CURSOR_COLORS.find((c) => !used.has(c));
    const background = free || CURSOR_COLORS[room.members.size % CURSOR_COLORS.length];
    return { background, stroke: "#ffffff" };
}

function pruneTombstones(room) {
    for (const [id, el] of room.elements) {
        if (el.isDeleted) room.elements.delete(id);
    }
}

function registerWhiteboardHandlers(io, socket, userSocketMap) {
    let currentRoomId = null;

    const membership = () => {
        const room = currentRoomId && rooms.get(currentRoomId);
        if (!room || !room.members.has(socket.id)) return null;
        return room;
    };
    const othersOf = (room) => Array.from(room.members.keys()).filter((id) => id !== socket.id);

    const leave = () => {
        if (!currentRoomId) return;
        const roomId = currentRoomId;
        currentRoomId = null;
        const room = rooms.get(roomId);
        if (!room) return;

        room.members.delete(socket.id);
        const others = Array.from(room.members.keys());
        if (others.length) {
            io.to(others).emit(WB.PEER_LEFT, { socketId: socket.id });
        } else {
            room.cleanupTimer = setTimeout(() => {
                const r = rooms.get(roomId);
                if (r && r.members.size === 0) rooms.delete(roomId);
            }, EMPTY_ROOM_TTL_MS);
            if (room.cleanupTimer.unref) room.cleanupTimer.unref();
        }
    };

    socket.on(WB.JOIN, (payload) => {
        const { roomId, username } = payload || {};
        if (!isValidRoomId(roomId)) {
            return socket.emit(WB.ERROR, { code: "bad-room", message: "Invalid room id." });
        }
        if (currentRoomId && currentRoomId !== roomId) leave();

        const room = getRoom(roomId);
        if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
            room.cleanupTimer = null;
        }
        const member = room.members.get(socket.id) || {
            username: cleanName(username) || userSocketMap[socket.id] || "Guest",
            color: pickColor(room),
        };
        room.members.set(socket.id, member);
        currentRoomId = roomId;

        socket.emit(WB.SYNC, { elements: Array.from(room.elements.values()) });
    });

    socket.on(WB.REQUEST_SYNC, () => {
        const room = membership();
        if (!room) return socket.emit(WB.ERROR, { code: "not-joined", message: "Join the whiteboard first." });
        socket.emit(WB.SYNC, { elements: Array.from(room.elements.values()) });
    });

    socket.on(WB.UPDATE, (payload) => {
        const room = membership();
        if (!room) return socket.emit(WB.ERROR, { code: "not-joined", message: "Join the whiteboard first." });
        if (!payload || payload.roomId !== currentRoomId) return;

        const { elements } = payload;
        if (!Array.isArray(elements) || elements.length > MAX_ELEMENTS_PER_MESSAGE) {
            return socket.emit(WB.ERROR, { code: "bad-payload", message: "Invalid whiteboard update." });
        }

        const accepted = [];
        const stale = [];
        for (const el of elements) {
            if (!isValidElement(el)) continue;
            const existing = room.elements.get(el.id);

            if (!existing && room.elements.size >= MAX_ELEMENTS_PER_ROOM) {
                pruneTombstones(room);
                if (room.elements.size >= MAX_ELEMENTS_PER_ROOM) continue; // board is full
            }

            if (shouldAccept(existing, el)) {
                room.elements.set(el.id, el);
                accepted.push(el);
            } else if (existing && (existing.version !== el.version || existing.versionNonce !== el.versionNonce)) {
                stale.push(existing); // sender is behind: send back the authoritative copy
            }
        }

        const others = othersOf(room);
        if (accepted.length && others.length) io.to(others).emit(WB.UPDATE, { elements: accepted });
        if (stale.length) socket.emit(WB.UPDATE, { elements: stale });
    });

    socket.on(WB.CURSOR, (payload) => {
        const room = membership();
        if (!room) return;
        const p = payload && payload.pointer;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const others = othersOf(room);
        if (!others.length) return;

        const member = room.members.get(socket.id);
        io.to(others).volatile.emit(WB.CURSOR, {
            socketId: socket.id,
            username: member.username,
            color: member.color,
            pointer: { x: p.x, y: p.y, tool: p.tool === "laser" ? "laser" : "pointer" },
            button: payload.button === "down" ? "down" : "up",
        });
    });

    socket.on(WB.LEAVE, leave);
    socket.on("disconnect", leave); // separate from the existing "disconnecting" handler
}

module.exports = registerWhiteboardHandlers;
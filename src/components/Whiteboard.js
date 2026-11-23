import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Excalidraw,
    CaptureUpdateAction,
    reconcileElements,
    restoreElements,
    exportToBlob,
    exportToSvg,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import toast from "react-hot-toast";
import WB from "../WhiteboardActions";
import "./Whiteboard.css";

const SEND_THROTTLE_MS = 60;
const CURSOR_THROTTLE_MS = 40;
const CHUNK_SIZE = 500;

// "Reset canvas" and "Open" replace the scene without version bumps/tombstones, so they can't sync.
const UI_OPTIONS = {
    canvasActions: { clearCanvas: false, loadScene: false, toggleTheme: false },
    tools: { image: false },
};

const versionKey = (el) => `${el.version}:${el.versionNonce}`;

const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const Whiteboard = ({ socket, roomId, username, active }) => {
    const apiRef = useRef(null);
    const [apiReady, setApiReady] = useState(false);

    const joinedRef = useRef(false);
    const syncedRef = useRef(new Map()); // element id -> "version:versionNonce" last sent/received
    const pendingRef = useRef(new Map()); // element id -> latest element awaiting send
    const sendTimerRef = useRef(null);
    const cursorLatestRef = useRef(null);
    const cursorTimerRef = useRef(null);
    const wasActiveRef = useRef(active);

    const handleApi = useCallback((api) => {
        apiRef.current = api;
        setApiReady(!!api);
    }, []);

    const emitInChunks = useCallback(
        (list) => {
            for (let i = 0; i < list.length; i += CHUNK_SIZE) {
                socket.emit(WB.UPDATE, { roomId, elements: list.slice(i, i + CHUNK_SIZE) });
            }
        },
        [socket, roomId]
    );

    // Merge remote elements using Excalidraw's own reconciliation (version + versionNonce).
    const applyRemoteElements = useCallback((incoming) => {
        const api = apiRef.current;
        if (!api || !Array.isArray(incoming) || incoming.length === 0) return;

        const remote = restoreElements(incoming, null);
        const reconciled = reconcileElements(
            api.getSceneElementsIncludingDeleted(),
            remote,
            api.getAppState()
        );

        // Record remote-origin versions BEFORE updateScene so onChange doesn't echo them back.
        const remoteById = new Map(remote.map((e) => [e.id, e]));
        for (const el of reconciled) {
            const r = remoteById.get(el.id);
            if (r && r.version === el.version && r.versionNonce === el.versionNonce) {
                syncedRef.current.set(el.id, versionKey(el));
            }
        }
        api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
    }, []);

    // After a (re)join, send anything we have that is newer than the server's copy.
    const pushNewerLocal = useCallback(
        (serverElements) => {
            const api = apiRef.current;
            if (!api) return;
            const server = new Map(serverElements.map((e) => [e.id, e]));
            const toSend = [];
            for (const el of api.getSceneElementsIncludingDeleted()) {
                const s = server.get(el.id);
                const newer =
                    !s ||
                    el.version > s.version ||
                    (el.version === s.version && el.versionNonce < s.versionNonce);
                if (newer) toSend.push(el);
                syncedRef.current.set(el.id, versionKey(el));
            }
            if (toSend.length) emitInChunks(toSend);
        },
        [emitInChunks]
    );

    const flushPending = useCallback(() => {
        sendTimerRef.current = null;
        const batch = Array.from(pendingRef.current.values());
        pendingRef.current.clear();
        // If not joined, drop it: the next SYNC diff (pushNewerLocal) re-sends anything the server lacks.
        if (!batch.length || !socket.connected || !joinedRef.current) return;
        emitInChunks(batch);
    }, [socket, emitInChunks]);

    const handleChange = useCallback(
        (elements) => {
            if (!joinedRef.current) return;
            let queued = false;
            for (const el of elements) {
                const key = versionKey(el);
                if (syncedRef.current.get(el.id) !== key) {
                    syncedRef.current.set(el.id, key);
                    pendingRef.current.set(el.id, el);
                    queued = true;
                }
            }
            if (queued && !sendTimerRef.current) {
                sendTimerRef.current = setTimeout(flushPending, SEND_THROTTLE_MS);
            }
        },
        [flushPending]
    );

    const handlePointerUpdate = useCallback(
        ({ pointer, button }) => {
            cursorLatestRef.current = { pointer, button };
            if (cursorTimerRef.current) return;
            cursorTimerRef.current = setTimeout(() => {
                cursorTimerRef.current = null;
                const latest = cursorLatestRef.current;
                cursorLatestRef.current = null;
                if (latest && joinedRef.current && socket.connected) {
                    socket.volatile.emit(WB.CURSOR, latest);
                }
            }, CURSOR_THROTTLE_MS);
        },
        [socket]
    );

    // Socket wiring (re-runs only if socket/room/username change)
    useEffect(() => {
        if (!apiReady) return undefined;

        const collaborators = new Map();
        let rafId = null;
        const scheduleCollaborators = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                apiRef.current?.updateScene({ collaborators: new Map(collaborators) });
            });
        };

        const join = () => {
            joinedRef.current = false;
            socket.emit(WB.JOIN, { roomId, username });
        };
        const onSync = ({ elements = [] } = {}) => {
            applyRemoteElements(elements);
            joinedRef.current = true;
            pushNewerLocal(elements);
        };
        const onUpdate = ({ elements } = {}) => applyRemoteElements(elements);
        const onCursor = (c) => {
            if (!c || !c.socketId) return;
            collaborators.set(c.socketId, {
                pointer: c.pointer,
                button: c.button,
                username: c.username,
                color: c.color,
            });
            scheduleCollaborators();
        };
        const onPeerLeft = ({ socketId } = {}) => {
            if (collaborators.delete(socketId)) scheduleCollaborators();
        };
        const onError = (err) => {
            if (err?.code === "not-joined") join(); // e.g. server restarted
            else console.warn("[ExceliDraw]", err?.message || err);
        };
        const onDisconnect = () => {
            joinedRef.current = false;
            collaborators.clear();
            scheduleCollaborators();
        };

        socket.on(WB.SYNC, onSync);
        socket.on(WB.UPDATE, onUpdate);
        socket.on(WB.CURSOR, onCursor);
        socket.on(WB.PEER_LEFT, onPeerLeft);
        socket.on(WB.ERROR, onError);
        socket.on("connect", join);
        socket.on("disconnect", onDisconnect);
        if (socket.connected) join();

        return () => {
            socket.off(WB.SYNC, onSync);
            socket.off(WB.UPDATE, onUpdate);
            socket.off(WB.CURSOR, onCursor);
            socket.off(WB.PEER_LEFT, onPeerLeft);
            socket.off(WB.ERROR, onError);
            socket.off("connect", join);
            socket.off("disconnect", onDisconnect);
            if (socket.connected) socket.emit(WB.LEAVE, { roomId });
            joinedRef.current = false;
            if (rafId) cancelAnimationFrame(rafId);
            clearTimeout(sendTimerRef.current);
            clearTimeout(cursorTimerRef.current);
            sendTimerRef.current = null;
            cursorTimerRef.current = null;
        };
    }, [apiReady, socket, roomId, username, applyRemoteElements, pushNewerLocal]);

    // Re-measure the canvas when the tab becomes visible; ask the server for a fresh sync on re-entry.
    useEffect(() => {
        if (!active || !apiReady) {
            wasActiveRef.current = active;
            return;
        }
        requestAnimationFrame(() => apiRef.current?.refresh());
        if (!wasActiveRef.current && joinedRef.current && socket.connected) {
            socket.emit(WB.REQUEST_SYNC);
        }
        wasActiveRef.current = true;
    }, [active, apiReady, socket]);

    const exportImage = async (type) => {
        const api = apiRef.current;
        if (!api) return;
        const elements = api.getSceneElements(); // non-deleted only
        if (!elements.length) {
            toast.error("Nothing to export yet.");
            return;
        }
        const appState = { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false };
        const files = api.getFiles();
        const base = `excelidraw-${String(roomId).slice(0, 8)}`;
        try {
            if (type === "png") {
                const blob = await exportToBlob({ elements, appState, files, mimeType: "image/png" });
                downloadBlob(blob, `${base}.png`);
            } else {
                const svg = await exportToSvg({ elements, appState, files });
                downloadBlob(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${base}.svg`);
            }
        } catch (err) {
            console.error(err);
            toast.error("Export failed.");
        }
    };

    return (
        <div className={active ? "wbStage" : "wbStage wbStage--hidden"}>
            <div className="wbBar">
                <span className="wbTitle">Collaborative Whiteboard</span>
                <div className="wbActions">
                    <button type="button" className="btn wbBtn" onClick={() => exportImage("png")}>
                        Export PNG
                    </button>
                    <button type="button" className="btn wbBtn" onClick={() => exportImage("svg")}>
                        Export SVG
                    </button>
                </div>
            </div>
            <div className="wbCanvas">
                <div className="wbCanvasInner">
                    <Excalidraw
                        excalidrawAPI={handleApi}
                        onChange={handleChange}
                        onPointerUpdate={handlePointerUpdate}
                        isCollaborating
                        theme="dark"
                        name={`codesync-${roomId}`}
                        UIOptions={UI_OPTIONS}
                    />
                </div>
            </div>
        </div>
    );
};

export default Whiteboard;
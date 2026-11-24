import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
    lazy,
    Suspense
} from "react";
import Avatar from "react-avatar";

import Client from "../components/Client";
import Editor from "../components/Editor";
import ModeSwitch from "../components/ModeSwitch";
import Compiler from "../components/Compiler";
import Chat from "../components/Chat";
import ResizableSplit from "../components/ResizableSplit";
import { ChatIcon, CopyIcon, LeaveIcon } from "../components/Icons";

import { initSocket } from "../socket";
import ACTIONS from "../Action";
import { DEFAULT_LANGUAGE } from "../languages";

import {
    useLocation,
    useNavigate,
    Navigate,
    useParams,
} from "react-router-dom";

import toast from "react-hot-toast";

const Whiteboard = lazy(() => import("../components/Whiteboard"));

const LAYOUT_KEY = "codesync:layout";

const useMediaQuery = (query) => {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = (e) => setMatches(e.matches);
        setMatches(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [query]);
    return matches;
};

const badgeText = (n) => (n > 99 ? "99+" : String(n));

const EditorPage = () => {
    const socketRef = useRef(null);
    const codeRef = useRef("");

    const location = useLocation();
    const reactNavigator = useNavigate();
    const { roomId } = useParams();

    const username = location.state?.username;

    const [socket, setSocket] = useState(null);
    const [clients, setClients] = useState([]);
    const [messages, setMessages] = useState([]);

    const [mode, setMode] = useState("codesync");
    const [language, setLanguage] = useState(DEFAULT_LANGUAGE);

    // ----- layout (side-by-side vs stacked) -----
    const narrow = useMediaQuery("(max-width: 800px)");
    const [layout, setLayout] = useState(() => {
        try {
            return localStorage.getItem(LAYOUT_KEY) === "stacked" ? "stacked" : "side";
        } catch {
            return "side";
        }
    });
    const changeLayout = useCallback((next) => {
        setLayout(next);
        try {
            localStorage.setItem(LAYOUT_KEY, next);
        } catch {
            /* ignore */
        }
    }, []);
    const effectiveLayout = narrow ? "stacked" : layout;

    // ----- collapsible chat + unread badge -----
    const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 1000);
    const [unread, setUnread] = useState(0);
    const chatOpenRef = useRef(chatOpen);

    useEffect(() => {
        chatOpenRef.current = chatOpen;
        if (chatOpen) setUnread(0);
    }, [chatOpen]);

    useEffect(() => {
        document.title = unread > 0 ? `(${badgeText(unread)}) Code Sync` : "Code Sync";
        return () => {
            document.title = "Code Sync";
        };
    }, [unread]);

    const toggleChat = useCallback(() => setChatOpen((open) => !open), []);

    const handleCodeChange = useCallback((code) => {
        codeRef.current = code;
    }, []);

    const getCode = useCallback(() => {
        return codeRef.current || "";
    }, []);

    const [whiteboardMounted, setWhiteboardMounted] = useState(false);
    useEffect(() => {
        if (mode === "whiteboard") setWhiteboardMounted(true);
    }, [mode]);

    useEffect(() => {
        if (!username || !roomId) return;

        let isMounted = true;
        let currentSocket = null;

        const init = async () => {
            try {
                const newSocket = await initSocket();

                if (!isMounted) {
                    newSocket.disconnect();
                    return;
                }

                currentSocket = newSocket;
                socketRef.current = newSocket;
                setSocket(newSocket);

                // Socket Connection Errors
                const handleErrors = (error) => {
                    console.error("Socket Error:", error);

                    toast.error(
                        "Socket connection failed. Please try again."
                    );

                    reactNavigator("/");
                };

                // User Joined Room
                const handleJoined = ({
                    clients: joinedClients = [],
                    username: joinedUsername,
                    socketId,
                }) => {
                    setClients(joinedClients);

                    if (socketId !== newSocket.id) {
                        toast.success(
                            `${joinedUsername} joined the room.`
                        );

                        // Synchronize editor code with the new user
                        newSocket.emit(ACTIONS.SYNC_CODE, {
                            code: getCode(),
                            socketId,
                        });
                    }
                };

                // User Disconnected
                const handleDisconnected = ({
                    socketId,
                    username: leftUsername,
                }) => {
                    setClients((previousClients) =>
                        previousClients.filter(
                            (client) => client.socketId !== socketId
                        )
                    );

                    if (leftUsername) {
                        toast.success(
                            `${leftUsername} left the room.`
                        );
                    }
                };

                // Receive Chat Messages
                const handleChatMessage = (message) => {
                    setMessages((previousMessages) => [
                        ...previousMessages,
                        message,
                    ]);

                    // Chat hidden: count it as unread and show a short preview
                    if (!chatOpenRef.current && message.socketId !== newSocket.id) {
                        setUnread((n) => n + 1);
                        if (message.type === "text") {
                            const preview = String(message.text || "").slice(0, 60);
                            toast(`${message.username}: ${preview}`, { icon: "💬" });
                        } else {
                            toast(`${message.username} sent a voice message`, { icon: "🎙️" });
                        }
                    }
                };

                // Register Socket Listeners BEFORE joining
                newSocket.on("connect_error", handleErrors);
                newSocket.on("connect_failed", handleErrors);

                newSocket.on(ACTIONS.JOINED, handleJoined);
                newSocket.on(
                    ACTIONS.DISCONNECTED,
                    handleDisconnected
                );

                newSocket.on(
                    ACTIONS.CHAT_MESSAGE,
                    handleChatMessage
                );

                // Join Room
                newSocket.emit(ACTIONS.JOIN, {
                    roomId,
                    username,
                });

            } catch (error) {
                console.error("Socket initialization error:", error);

                if (isMounted) {
                    toast.error("Unable to connect to the server.");
                    reactNavigator("/");
                }
            }
        };

        init();

        return () => {
            isMounted = false;

            if (currentSocket) {
                currentSocket.off("connect_error");
                currentSocket.off("connect_failed");

                currentSocket.off(ACTIONS.JOINED);
                currentSocket.off(ACTIONS.DISCONNECTED);
                currentSocket.off(ACTIONS.CHAT_MESSAGE);

                currentSocket.disconnect();
            }

            if (socketRef.current === currentSocket) {
                socketRef.current = null;
            }

            setSocket(null);
        };

    }, [username, roomId, reactNavigator, getCode]);

    const copyRoomID = async () => {
        try {
            await navigator.clipboard.writeText(roomId);

            toast.success(
                "Room ID copied to clipboard!"
            );

        } catch (error) {
            console.error("Copy Room ID Error:", error);

            toast.error(
                "Could not copy the Room ID."
            );
        }
    };

    const sendText = (text) => {
        const currentSocket = socketRef.current;

        if (!currentSocket?.connected) {
            toast.error("Socket is not connected.");
            return;
        }

        if (!text || !text.trim()) {
            return;
        }

        currentSocket.emit(ACTIONS.CHAT_MESSAGE, {
            roomId,
            type: "text",
            text: text.trim(),
        });
    };


    const sendVoice = async (blob) => {
        const currentSocket = socketRef.current;

        if (!currentSocket?.connected) {
            toast.error("Socket is not connected.");
            return;
        }

        if (!blob || blob.size === 0) {
            toast.error("Voice message is empty.");
            return;
        }

        try {
            const audio = await blob.arrayBuffer();

            // Check connection again after async operation
            if (!currentSocket.connected) {
                toast.error("Connection lost. Please try again.");
                return;
            }

            currentSocket.emit(ACTIONS.CHAT_MESSAGE, {
                roomId,
                type: "voice",
                audio,
                mimeType: blob.type || "audio/webm",
            });

        } catch (error) {
            console.error("Voice Message Error:", error);

            toast.error(
                "Failed to send voice message."
            );
        }
    };

    const leaveRoom = () => {
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }

        setSocket(null);
        reactNavigator("/");
    };

    if (!username) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className={chatOpen ? "mainWrap" : "mainWrap chat-closed"}>

            {/* Sidebar */}
            <aside className="aside">

                <div className="asideInner">

                    <div className="logo">
                        <img
                            className="logoImage"
                            src="/code-sync.png"
                            alt="CodeSync Logo"
                        />
                    </div>

                    <h3 className="asideTitle">
                        Connected ({clients.length})
                    </h3>

                    <div className="clientsList">
                        {clients.map((client) => (
                            <Client
                                key={client.socketId}
                                username={client.username}
                            />
                        ))}
                    </div>

                </div>

                <button
                    className="btn copyBtn"
                    onClick={copyRoomID}
                    type="button"
                    title="Copy Room ID"
                >
                    <CopyIcon size={16} />
                    <span className="btnLabel">Copy Room ID</span>
                </button>

                <div className="userRow">
                    <button
                        className="btn userBtn"
                        type="button"
                        title={`Logged in as ${username}`}
                    >
                        <Avatar name={username} size={24} round="8px" />
                        <span className="userBtnName">{username}</span>
                    </button>

                    <button
                        className="btn leaveBtn"
                        onClick={leaveRoom}
                        type="button"
                        title="Leave room"
                        aria-label="Leave room"
                    >
                        <LeaveIcon size={20} />
                    </button>
                </div>

            </aside>

            {/* Workspace */}
            <main className="editorWrap">

                <div className="topBar">
                    <div></div>

                    <ModeSwitch
                        mode={mode}
                        onChange={setMode}
                    />

                    <div className="topBarRight">
                        <button
                            type="button"
                            className={chatOpen ? "iconBtn iconBtn--active" : "iconBtn"}
                            onClick={toggleChat}
                            title={chatOpen ? "Hide chat" : "Show chat"}
                            aria-label={chatOpen ? "Hide chat" : "Show chat"}
                            aria-pressed={chatOpen}
                        >
                            <ChatIcon />
                            {!chatOpen && unread > 0 && (
                                <span className="badge">{badgeText(unread)}</span>
                            )}
                        </button>
                    </div>
                </div>

                {socket && (
                    <>
                        <div className={mode === "whiteboard" ? "codeStage codeStage--hidden" : "codeStage"}>
                            <ResizableSplit
                                direction={effectiveLayout === "side" ? "horizontal" : "vertical"}
                                open={mode === "compiler"}
                                first={
                                    <Editor
                                        socket={socket}
                                        roomId={roomId}
                                        onCodeChange={handleCodeChange}
                                        language={language}
                                    />
                                }
                                second={
                                    <Compiler
                                        open={mode === "compiler"}
                                        socket={socket}
                                        language={language}
                                        onLanguageChange={setLanguage}
                                        getCode={getCode}
                                        layout={effectiveLayout}
                                        onLayoutChange={changeLayout}
                                        canToggleLayout={!narrow}
                                    />
                                }
                            />
                        </div>

                        {whiteboardMounted && (
                            <Suspense fallback={<div className="chatEmpty">Loading whiteboard…</div>}>
                                <Whiteboard
                                    socket={socket}
                                    roomId={roomId}
                                    username={username}
                                    active={mode === "whiteboard"}
                                />
                            </Suspense>
                        )}
                    </>
                )}

            </main>

            {/* Chat dock (stays mounted while hidden so messages & voice clips are kept) */}
            <aside className="chatDock" inert={!chatOpen} aria-hidden={!chatOpen}>
                <Chat
                    messages={messages}
                    mySocketId={socket?.id}
                    onSendText={sendText}
                    onSendVoice={sendVoice}
                    onClose={() => setChatOpen(false)}
                />
            </aside>

            {chatOpen && <div className="chatBackdrop" onClick={() => setChatOpen(false)} />}

            {/* Floating chat button with unread badge */}
            {!chatOpen && (
                <button
                    type="button"
                    className="chatFab"
                    onClick={() => setChatOpen(true)}
                    title="Open chat"
                    aria-label={unread ? `Open chat, ${unread} unread` : "Open chat"}
                >
                    <ChatIcon size={22} />
                    {unread > 0 && <span className="badge badge--fab">{badgeText(unread)}</span>}
                </button>
            )}
        </div>
    );
};

export default EditorPage;
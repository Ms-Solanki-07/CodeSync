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
        <div className="mainWrap">

            {/* Sidebar */}
            <div className="aside">

                <div className="asideInner">

                    {/* Logo */}
                    <div className="logo">
                        <img
                            className="logoImage"
                            src="/code-sync.png"
                            alt="CodeSync Logo"
                        />
                    </div>

                    {/* Connected Users */}
                    <h3>
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

                {/* Copy Room ID */}
                <button
                    className="btn copyBtn"
                    onClick={copyRoomID}
                    type="button"
                >
                    Copy Room ID 
                </button>

                {/* Logged-in user + Logout */}
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
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>

            </div>

            {/* Editor Section */}
            <div className="editorWrap">

                {/* Mode Switch */}
                <div className="topBar">
                    <ModeSwitch
                        mode={mode}
                        onChange={setMode}
                    />
                </div>

                {/* Editor and Compiler and exceliDraw */}
                {socket && (
                    <>
                        <div className={mode === "whiteboard" ? "codeStage codeStage--hidden" : "codeStage"}>
                            <Editor
                                socket={socket}
                                roomId={roomId}
                                onCodeChange={handleCodeChange}
                                language={language}
                            />
                            <Compiler
                                open={mode === "compiler"}
                                socket={socket}
                                language={language}
                                onLanguageChange={setLanguage}
                                getCode={getCode}
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

            </div>

            {/* Chat Section */}
            <div className="chatWrap">

                <Chat
                    messages={messages}
                    mySocketId={socket?.id}
                    onSendText={sendText}
                    onSendVoice={sendVoice}
                />

            </div>

        </div>
    );
};

export default EditorPage;

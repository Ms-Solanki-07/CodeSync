import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

const MAX_RECORD_SECONDS = 60;

const VoiceMessage = ({ audio, mimeType }) => {
    const [url, setUrl] = useState(null);

    useEffect(() => {
        const objectUrl = URL.createObjectURL(new Blob([audio], { type: mimeType }));
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [audio, mimeType]);

    return url ? <audio className="chatAudio" controls src={url} /> : null;
};

const formatTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const Chat = ({ messages, mySocketId, onSendText, onSendVoice }) => {
    const [text, setText] = useState("");
    const [recording, setRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);

    const recorderRef = useRef(null);
    const streamRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);
    const cancelledRef = useRef(false);
    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Stop mic if the component unmounts mid-recording
    useEffect(() => {
        return () => {
            cancelledRef.current = true;
            clearInterval(timerRef.current);
            if (recorderRef.current && recorderRef.current.state !== "inactive") {
                recorderRef.current.stop();
            }
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    const sendText = () => {
        const clean = text.trim();
        if (!clean) return;
        onSendText(clean);
        setText("");
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendText();
        }
    };

    const stopRecording = () => {
        clearInterval(timerRef.current);
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
            recorderRef.current.stop();
        }
        setRecording(false);
    };

    const startRecording = async () => {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            toast.error("Voice recording is not supported in this browser.");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
                MediaRecorder.isTypeSupported(t)
            );
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

            chunksRef.current = [];
            cancelledRef.current = false;

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                if (cancelledRef.current || chunksRef.current.length === 0) return;
                const blob = new Blob(chunksRef.current, {
                    type: recorder.mimeType || "audio/webm",
                });
                onSendVoice(blob);
            };

            recorder.start();
            recorderRef.current = recorder;
            setRecording(true);
            setSeconds(0);

            timerRef.current = setInterval(() => {
                setSeconds((s) => {
                    if (s + 1 >= MAX_RECORD_SECONDS) stopRecording();
                    return s + 1;
                });
            }, 1000);
        } catch (err) {
            console.error(err);
            toast.error("Could not access the microphone.");
        }
    };

    const cancelRecording = () => {
        cancelledRef.current = true;
        stopRecording();
    };

    return (
        <div className="chatWrap">
            <h3 className="chatTitle">Room Chat</h3>

            <div className="chatMessages">
                {messages?.length === 0 && (
                    <p className="chatEmpty">No messages yet. Say hi 👋</p>
                )}
                {messages?.map((m) => {
                    const mine = m.socketId === mySocketId;
                    return (
                        <div key={m.id} className={`chatMsg ${mine ? "mine" : "theirs"}`}>
                            <div className="chatMeta">
                                <span className="chatUser">{mine ? "You" : m.username}</span>
                                <span className="chatTime">{formatTime(m.timestamp)}</span>
                            </div>
                            {m.type === "text" ? (
                                <div className="chatText">{m.text}</div>
                            ) : (
                                <VoiceMessage audio={m.audio} mimeType={m.mimeType} />
                            )}
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {recording ? (
                <div className="chatRecording">
                    <span className="recDot" />
                    <span>
                        Recording {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                        {String(seconds % 60).padStart(2, "0")}
                    </span>
                    <button className="chatIconBtn" onClick={cancelRecording} title="Cancel">
                        ✕
                    </button>
                    <button className="chatIconBtn send" onClick={stopRecording} title="Send voice message">
                        ➤
                    </button>
                </div>
            ) : (
                <div className="chatInputRow">
                    <textarea
                        className="chatInput"
                        rows={1}
                        placeholder="Type a message..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button className="chatIconBtn" onClick={startRecording} title="Record voice message">
                        🎤
                    </button>
                    <button className="chatIconBtn send" onClick={sendText} title="Send">
                        ➤
                    </button>
                </div>
            )}
        </div>
    );
};

export default Chat;
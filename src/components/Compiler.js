import React, { useCallback, useEffect, useRef, useState } from "react";
import ACTIONS from "../Action";
import { LANGUAGES } from "../languages";
import { PlayIcon, TrashIcon, LayoutSideIcon, LayoutStackIcon } from "./Icons";

const trimEndNl = (s) => s.replace(/\n+$/, "");

const buildResultLines = (res) => {
    if (!res || res.error) {
        return [{ type: "err", text: res?.error || "Unknown error." }];
    }
    const lines = [];
    if (res.stdout) lines.push({ type: "out", text: trimEndNl(res.stdout) });
    if (res.stderr) lines.push({ type: "err", text: trimEndNl(res.stderr) });
    if (!res.stdout && !res.stderr) lines.push({ type: "muted", text: "(no output)" });

    const ok = res.status === "Finished" && (res.exitCode == null || res.exitCode === 0);
    const meta = [
        res.status,
        res.exitCode != null && `exit code ${res.exitCode}`,
        res.time != null && `${res.time}s`,
        res.memory != null && `${(res.memory / 1024).toFixed(1)} MB`,
    ]
        .filter(Boolean)
        .join(" · ");
    lines.push({ type: ok ? "meta" : "meta-bad", text: `[${meta}]` });
    return lines;
};

const Compiler = ({
    open,
    socket,
    language,
    onLanguageChange,
    getCode,
    layout,
    onLayoutChange,
    canToggleLayout = true,
}) => {
    const [log, setLog] = useState([]); // console history: {type, text}
    const [queue, setQueue] = useState([]); // stdin lines, piped to the program on Run
    const [draft, setDraft] = useState("");
    const [running, setRunning] = useState(false);

    const bodyRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [log, queue, running]);

    const runCode = useCallback(() => {
        if (running) return;
        const label = LANGUAGES.find((l) => l.id === language)?.label || language;
        const stdin = queue.length ? queue.join("\n") + "\n" : "";

        setRunning(true);
        setLog([{ type: "cmd", text: `$ run ${label}${queue.length ? ` (${queue.length} input line${queue.length > 1 ? "s" : ""})` : ""}` }]);

        socket
            .timeout(40000)
            .emit(ACTIONS.RUN_CODE, { language, code: getCode() || "", stdin }, (err, res) => {
                setRunning(false);
                if (err) {
                    setLog((prev) => [...prev, { type: "err", text: "The runner took too long to respond." }]);
                    return;
                }
                setLog((prev) => [...prev, ...buildResultLines(res)]);
            });
    }, [running, language, queue, socket, getCode]);

    // Ctrl/Cmd + Enter runs the code while the compiler is visible
    const runRef = useRef(runCode);
    runRef.current = runCode;
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                runRef.current();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const onInputKeyDown = (e) => {
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setQueue((q) => [...q, draft]);
            setDraft("");
        } else if (e.key === "Backspace" && draft === "" && queue.length) {
            setQueue((q) => q.slice(0, -1)); // terminal-style: backspace pulls back the last line
        }
    };

    const onPaste = (e) => {
        const text = e.clipboardData.getData("text");
        if (!text.includes("\n")) return;
        e.preventDefault();
        const lines = text.replace(/\r\n/g, "\n").split("\n");
        const last = lines.pop(); // text after the final newline stays in the prompt
        lines[0] = draft + lines[0]; // pasted text continues whatever was already typed
        setQueue((q) => [...q, ...lines]);
        setDraft(last);
    };

    const clearAll = () => {
        setLog([]);
        setQueue([]);
        setDraft("");
        inputRef.current?.focus();
    };

    return (
        <section className="compilerPanel" aria-label="Console" aria-hidden={!open} inert={!open}>
            <div className="compilerHeader">
                <span className="panelTitle">
                    <span className={running ? "statusDot is-running" : "statusDot"} />
                    Console
                </span>

                <select
                    className="langSelect"
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value)}
                    aria-label="Programming language"
                >
                    {LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.label}
                        </option>
                    ))}
                </select>

                <div className="compilerActions">
                    {canToggleLayout && (
                        <button
                            type="button"
                            className="iconBtn"
                            onClick={() => onLayoutChange(layout === "side" ? "stacked" : "side")}
                            title={layout === "side" ? "Stack editor above console" : "Show editor and console side by side"}
                            aria-label="Toggle layout"
                        >
                            {layout === "side" ? <LayoutStackIcon /> : <LayoutSideIcon />}
                        </button>
                    )}
                    <button type="button" className="iconBtn" onClick={clearAll} title="Clear console and input" aria-label="Clear console">
                        <TrashIcon />
                    </button>
                    <button
                        type="button"
                        className="btn runBtn"
                        onClick={runCode}
                        disabled={running}
                        title="Run (Ctrl/Cmd + Enter)"
                    >
                        <PlayIcon size={14} />
                        <span>{running ? "Running…" : "Run"}</span>
                    </button>
                </div>
            </div>

            <div className="consoleBody" ref={bodyRef} onClick={() => inputRef.current?.focus()}>
                {log.length === 0 && queue.length === 0 && !running && (
                    <div className="cLine cLine--muted">
                        Type program input below (each Enter adds one line of stdin), then press Run.
                        {"\n"}Output, errors and input all live in this console.
                    </div>
                )}

                {log.map((l, i) => (
                    <div key={i} className={`cLine cLine--${l.type}`}>
                        {l.text}
                    </div>
                ))}

                {running && (
                    <div className="cLine cLine--cmd">
                        Running<span className="dots" />
                    </div>
                )}

                {queue.length > 0 && <div className="cLine cLine--muted cLabel">stdin · sent on next run</div>}
                {queue.map((l, i) => (
                    <div key={i} className="cLine cLine--in">
                        <span className="cPrompt">›</span> {l}
                    </div>
                ))}

                <div className="consolePrompt">
                    <span className="cPrompt">›</span>
                    <input
                        ref={inputRef}
                        className="consoleInput"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onInputKeyDown}
                        onPaste={onPaste}
                        placeholder="Type input and press Enter…"
                        spellCheck={false}
                        autoComplete="off"
                        aria-label="Program input (stdin)"
                    />
                </div>
            </div>
        </section>
    );
};

export default Compiler;
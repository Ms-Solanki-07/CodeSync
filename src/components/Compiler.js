import React, { useState } from "react";
import ACTIONS from "../Action";
import { LANGUAGES } from "../languages";

const Compiler = ({ open, socket, language, onLanguageChange, getCode }) => {
    const [stdin, setStdin] = useState("");
    const [output, setOutput] = useState(null);
    const [running, setRunning] = useState(false);

    const runCode = () => {
        if (running) return;
        setRunning(true);
        setOutput(null);

        socket
            .timeout(40000)
            .emit(ACTIONS.RUN_CODE, { language, code: getCode() || "", stdin }, (err, res) => {
                setRunning(false);
                if (err) {
                    setOutput({ error: "The runner took too long to respond." });
                    return;
                }
                setOutput(res);
            });
    };

    const meta =
        output && !output.error
            ? [
                output.status,
                output.exitCode != null && `Exit code ${output.exitCode}`,
                output.time != null && `${output.time}s`,
                output.memory != null && `${(output.memory / 1024).toFixed(1)} MB`,
            ]
                .filter(Boolean)
                .join(" · ")
            : "";

    return (
        <div className={open ? "compilerPanel open" : "compilerPanel"} aria-hidden={!open} inert={!open}>
            <div className="compilerInner">
                <div className="compilerToolbar">
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
                    <button className="btn runBtn" onClick={runCode} disabled={running}>
                        {running ? "Running…" : "▶ Run"}
                    </button>
                </div>

                <div className="compilerIO">
                    <div className="ioBox">
                        <div className="ioLabel">Input (stdin)</div>
                        <textarea
                            className="stdinBox"
                            value={stdin}
                            onChange={(e) => setStdin(e.target.value)}
                            placeholder="Optional program input"
                            spellCheck={false}
                        />
                    </div>
                    <div className="ioBox">
                        <div className="ioLabel">Output</div>
                        <div className="outputBox">
                            {running && <span className="compilerMuted">Running…</span>}
                            {!running && !output && (
                                <span className="compilerMuted">Press Run to execute the code in the editor.</span>
                            )}
                            {output?.error && <pre className="isError">{output.error}</pre>}
                            {output && !output.error && (
                                <>
                                    {output.stdout && <pre>{output.stdout}</pre>}
                                    {output.stderr && <pre className="isError">{output.stderr}</pre>}
                                    {!output.stdout && !output.stderr && (
                                        <span className="compilerMuted">(no output)</span>
                                    )}
                                    <div className="compilerMeta">{meta}</div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Compiler;
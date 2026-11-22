import React from "react";

const ModeSwitch = ({ mode, onChange }) => (
    <div className="modeSwitch" role="tablist" data-mode={mode}>
        <span className="modeThumb" />
        <button
            type="button"
            role="tab"
            aria-selected={mode === "codesync"}
            className={mode === "codesync" ? "modeBtn active" : "modeBtn"}
            onClick={() => onChange("codesync")}
        >
            CodeSync
        </button>
        <button
            type="button"
            role="tab"
            aria-selected={mode === "compiler"}
            className={mode === "compiler" ? "modeBtn active" : "modeBtn"}
            onClick={() => onChange("compiler")}
        >
            Compiler
        </button>
    </div>
);

export default ModeSwitch;
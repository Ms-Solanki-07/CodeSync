import React, { useEffect, useRef } from "react";
import Codemirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/dracula.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/python/python";
import "codemirror/mode/clike/clike";
import "codemirror/mode/go/go";
import "codemirror/mode/rust/rust";
import "codemirror/mode/php/php";
import "codemirror/mode/ruby/ruby";
import "codemirror/mode/swift/swift";
import "codemirror/mode/shell/shell";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import ACTIONS from "../Action";
import { getMode } from "../languages";

const Editor = ({ socket, roomId, onCodeChange, language }) => {
    const textareaRef = useRef(null);
    const editorRef = useRef(null);

    useEffect(() => {
        const area = textareaRef.current;
        const editor = Codemirror.fromTextArea(area, {
            mode: getMode(language),
            theme: "dracula",
            autoCloseTags: true,
            autoCloseBrackets: true,
            lineNumbers: true,
        });
        editorRef.current = editor;

        editor.on("change", (instance, changes) => {
            const code = instance.getValue();
            onCodeChange(code);
            if (changes.origin !== "setValue") {
                socket.emit(ACTIONS.CODE_CHANGE, { roomId, code });
            }
        });

        const handleRemoteChange = ({ code }) => {
            if (code === null || code === undefined || code === editor.getValue()) return;
            const cursor = editor.getCursor();
            const { left, top } = editor.getScrollInfo();
            editor.setValue(code);
            editor.setCursor(cursor);
            editor.scrollTo(left, top);
        };
        socket.on(ACTIONS.CODE_CHANGE, handleRemoteChange);

        // keep CodeMirror correctly sized when the compiler panel opens/closes
        const resizeObserver = new ResizeObserver(() => editor.refresh());
        resizeObserver.observe(area.parentElement);

        return () => {
            resizeObserver.disconnect();
            socket.off(ACTIONS.CODE_CHANGE, handleRemoteChange);
            editor.toTextArea();
            editorRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, roomId, onCodeChange]);

    // change syntax highlighting when the language changes
    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.setOption("mode", getMode(language));
        }
    }, [language]);

    return (
        <div className="editorArea">
            <textarea ref={textareaRef}></textarea>
        </div>
    );
};

export default Editor;
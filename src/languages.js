export const LANGUAGES = [
    { id: "javascript", label: "JavaScript", mode: "text/javascript" },
    { id: "typescript", label: "TypeScript", mode: "text/typescript" },
    { id: "python", label: "Python", mode: "text/x-python" },
    { id: "java", label: "Java", mode: "text/x-java" },
    { id: "c", label: "C", mode: "text/x-csrc" },
    { id: "c++", label: "C++", mode: "text/x-c++src" },
    { id: "csharp", label: "C#", mode: "text/x-csharp" },
    { id: "go", label: "Go", mode: "text/x-go" },
    { id: "rust", label: "Rust", mode: "text/x-rustsrc" },
    { id: "php", label: "PHP", mode: "text/x-php" },
    { id: "ruby", label: "Ruby", mode: "text/x-ruby" },
    { id: "kotlin", label: "Kotlin", mode: "text/x-kotlin" },
    { id: "swift", label: "Swift", mode: "text/x-swift" },
    { id: "bash", label: "Bash", mode: "text/x-sh" },
];

export const DEFAULT_LANGUAGE = "javascript";

export const getMode = (id) =>
    (LANGUAGES.find((l) => l.id === id) || LANGUAGES[0]).mode;
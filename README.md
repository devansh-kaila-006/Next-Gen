# Agentic IDE Assistant 🚀

A highly-capable, AI-powered VS Code Extension designed to act as your elite "10x Developer" pair programmer. Built with the cutting-edge **Google Gemini API**, this extension provides real-time contextual assistance, codebase indexing, and seamless workflow integrations directly inside your editor.

## ✨ Features

### 🧠 RAG Codebase Indexing (Vector Search)
- The extension parses your entire workspace and generates high-dimensional embeddings using Gemini's embedding models.
- It stores this data locally in a clean, hidden `.agentic/index.json` vector database.
- **Silent Auto-Indexing**: Your vector store is automatically kept up to date in the background every 15 minutes, with absolutely zero UI interruptions.

### ⚡ Real-Time Streaming Responses
No more staring at "Thinking..." spinners. Responses from Gemini are streamed directly into the Chat Webview character-by-character, allowing for lightning-fast feedback and interaction.

### 🎯 Auto-Context (Active File Awareness)
You never have to manually explain what file you are working on. The extension automatically detects your currently active editor tab and silently injects its entire contents into the AI's context window. Just ask "What does this file do?" and the agent instantly knows.

### 🔍 Inline Editor "Code Lenses"
The extension parses your codebase (supporting JS, TS, Python, Ruby, Java, C++, etc.) and injects floating UI buttons directly above your functions and classes:
- `[Agent: Explain]`: Instantly sends the code block to the AI to break down the logic.
- `[Agent: Refactor]`: Asks the AI to optimize and rewrite the function.
- `[Agent: Write Tests]`: Automatically generates a full suite of unit tests for the function and saves it directly to a new test file next to your code.

### 📂 Workspace Scaffolding Engine
Click the **Scaffold** button in the chat interface or use the Command Palette to trigger the scaffolding engine. Provide a prompt (like "Build a React Auth component") and the AI will automatically generate the code and construct the raw files in your workspace instantly.

### 🐛 Terminal Error Debugging
Deeply integrated with VS Code's Terminal. If your scripts crash and print `Error:`, `Exception:`, or `Traceback:` into the terminal, those lines turn into clickable links. Click the error, and the Agent will automatically read the stack trace and debug it for you!

### 📝 Automated Git Commit Generation
A dedicated "Generate Commit" button in the Chat UI automatically runs `git diff` on your workspace, reads all of your uncommitted changes, and generates a perfect, professional Conventional Commit message.

### 🎨 Professional Webview Interface
- A sleek, modern chat interface that matches your VS Code theme, using clean, custom SVG icons instead of messy emojis.
- **Setup Screen**: Easily input and save your Gemini API Key directly from the UI.
- **Rich Markdown Rendering**: Code blocks are perfectly formatted using `marked.js` with syntax highlighting.
- **Multi-Turn Memory**: The agent remembers the history of your current conversation, allowing you to ask follow-up questions seamlessly.
- **Strict Advisory Prompting**: The agent is strictly instructed to explain the *architecture and the "why"* before dumping code onto your screen, maintaining a professional advisory role.

---

## 🚀 Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Compile the Extension:**
   ```bash
   npm run compile
   # Or run `npm run watch` to recompile continuously on save
   ```
3. **Launch the Extension:**
   Press `F5` in VS Code to open a new Extension Development Host window.
4. **Set your API Key:**
   Open the **Agentic Assistant** sidebar icon. You will be greeted by a setup screen where you can securely input your Gemini API Key.

## 🛠️ Usage

- **Start Chatting**: Ask the assistant anything in the chat sidebar.
- **Index Workspace**: Click the 🔄 button in the toolbar to manually trigger a workspace scan (or let the 15-minute background timer handle it).
- **Review Active File**: Click the 🔍 button in the toolbar to run an in-depth architectural review of the file you are currently looking at.
- **Generate Commit**: Click the 📝 button in the toolbar when you are ready to commit your work to Git.
- **Scaffold Code**: Click the 📂 Scaffold button in the toolbar to generate new files across your workspace.

## ⚙️ Architecture Requirements
- Node.js & npm
- VS Code Extension API
- `@google/generative-ai` SDK

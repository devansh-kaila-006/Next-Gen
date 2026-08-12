import * as vscode from 'vscode';
import { VectorStore } from './vectorStore';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AgenticAssistantProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentic-assistant-chat';

  private _view?: vscode.WebviewView;
  private chatHistory: { role: string; parts: { text: string }[] }[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
  ) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    this.updateWebviewHTML();

    webviewView.webview.onDidReceiveMessage(async data => {
      switch (data.type) {
        case 'saveApiKey':
          {
            const apiKey = data.value;
            await vscode.workspace.getConfiguration('agenticAssistant').update('geminiApiKey', apiKey, true);
            vscode.window.showInformationMessage('Agentic Assistant: API Key saved successfully!');
            this.updateWebviewHTML();
            break;
          }
        case 'indexWorkspace':
          vscode.commands.executeCommand('agentic-ide-assistant.indexWorkspace');
          break;
        case 'reviewActiveFile':
          vscode.commands.executeCommand('agentic-ide-assistant.reviewCurrentFile');
          break;
        case 'chatMessage':
          {
            const userQuery = data.value;
            
            try {
              const workspaceFolders = vscode.workspace.workspaceFolders;
              if (!workspaceFolders) {
                this.sendMessageToWebview({ type: 'botMessage', value: 'Please open a workspace first.' });
                return;
              }

              const rootPath = workspaceFolders[0].uri.fsPath;
              const vectorStore = new VectorStore(rootPath);
              await vectorStore.init();

              // Search vector store
              const docs = await vectorStore.search(userQuery, 5);
              let contextText = docs.map(d => `File: ${d.filePath}\nContent:\n${d.content}`).join('\n\n');

              if (!contextText) {
                contextText = "No codebase context found. Answer generically if possible.";
              }

              const config = vscode.workspace.getConfiguration('agenticAssistant');
              const apiKey = config.get<string>('geminiApiKey');
              
              if (!apiKey) {
                this.sendMessageToWebview({ type: 'botMessage', value: 'Please set the Gemini API Key first.' });
                return;
              }

              const genAI = new GoogleGenerativeAI(apiKey);
              const systemInstruction = `You are a senior 10x developer and Agentic IDE Assistant.
Your goal is to provide elite-level, precise, and highly detailed answers.
Do NOT provide code blocks or write code in your response unless the user explicitly asks for it (e.g. 'write a function', 'give me code', etc.). Instead, explain the concepts, point out the files, and provide architectural guidance.
Format your response beautifully using markdown: use bolding, bullet points, headers, and code blocks (only if asked).
Keep your answers professional and concise, but thorough.`;

              let model = genAI.getGenerativeModel({ 
                model: "gemini-3.5-flash",
                systemInstruction
              });

              let activeFileContext = "";
              const editor = vscode.window.activeTextEditor;
              if (editor) {
                activeFileContext = `[Currently Active File: ${editor.document.fileName}]\n${editor.document.getText()}\n\n`;
                this.sendMessageToWebview({ type: 'botMessage', value: `*(Reading active file: ${vscode.workspace.asRelativePath(editor.document.uri)})*` });
              }

              const currentTurn = `Codebase Context (Vector Search Results):\n${contextText}\n\n${activeFileContext}User Question: ${userQuery}`;

              const contents = [
                ...this.chatHistory,
                { role: 'user', parts: [{ text: currentTurn }] }
              ];

              const result = await model.generateContentStream({ contents });
              
              const messageId = Math.random().toString(36).substring(7);
              this.sendMessageToWebview({ type: 'streamStart', value: messageId });

              let responseText = "";
              for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                responseText += chunkText;
                this.sendMessageToWebview({ type: 'streamChunk', id: messageId, value: responseText });
              }

              // Push the clean query to history to save context tokens, and the model's response
              this.chatHistory.push({ role: 'user', parts: [{ text: userQuery }] });
              this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
            } catch (err: any) {
               this.sendMessageToWebview({
                type: 'error',
                value: this.formatErrorMessage(err)
              });
            }
            break;
          }
        case 'applyCode':
          {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              editor.edit(editBuilder => {
                const document = editor.document;
                const fullRange = new vscode.Range(
                  document.positionAt(0),
                  document.positionAt(document.getText().length)
                );
                editBuilder.replace(fullRange, data.value);
              });
              vscode.window.showInformationMessage('Code applied to active editor!');
            } else {
              vscode.window.showErrorMessage('No active editor to apply code to.');
            }
          }
        case 'scaffold':
          {
            vscode.commands.executeCommand('agentic-ide-assistant.scaffold');
            break;
          }
        case 'generateCommit':
          {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            const rootPath = workspaceFolders[0].uri.fsPath;
            
            this.sendMessageToWebview({ type: 'botMessage', value: '*(Generating commit message...)*' });
            
            const cp = require('child_process');
            cp.exec('git diff', { cwd: rootPath }, async (err: any, stdout: string) => {
               if (err || !stdout) {
                  this.sendMessageToWebview({ type: 'botMessage', value: 'No git changes found or not a git repository.' });
                  return;
               }
               
               const apiKey = vscode.workspace.getConfiguration('agenticAssistant').get<string>('geminiApiKey');
               if (!apiKey) return;
               const genAI = new GoogleGenerativeAI(apiKey);
               const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', systemInstruction: 'Write a professional conventional commit message based on this diff. Output ONLY the commit message. Use markdown.' });
               const result = await model.generateContent(`Git Diff:\n${stdout}`);
               this.sendMessageToWebview({ type: 'botMessage', value: result.response.text() });
            });
            break;
          }
      }
    });
  }

  public updateWebviewHTML() {
    if (this._view) {
      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const hasApiKey = !!config.get<string>('geminiApiKey');
      this._view.webview.html = this._getHtmlForWebview(hasApiKey);
    }
  }

  public async triggerReview(fileName: string, fileContent: string) {
    try {
      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const apiKey = config.get<string>('geminiApiKey');
      
      if (!apiKey) {
        this.sendMessageToWebview({ type: 'botMessage', value: 'Please set the Gemini API Key.' });
        return;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const systemInstruction = `You are a senior 10x developer and expert code reviewer. Provide elite-level architectural feedback. Format perfectly in Markdown.`;
      
      let model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        systemInstruction
      });

      const prompt = `Review the following file: ${fileName}
Suggest improvements, find bugs, or refactor the code.
If you suggest a complete rewrite or refactor, output the ENTIRE new file content inside a code block (\`\`\`).
The user will have a button to apply this code block directly to their file.

File Content:
${fileContent}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      this.sendMessageToWebview({
        type: 'botMessage',
        value: responseText
      });
    } catch (err: any) {
       this.sendMessageToWebview({
        type: 'error',
        value: this.formatErrorMessage(err)
      });
    }
  }

  public async triggerSymbolAction(symbolName: string, fileName: string, action: 'explain' | 'refactor') {
    try {
      this.sendMessageToWebview({ type: 'botMessage', value: `*(Agent is ${action}ing ${symbolName} in ${vscode.workspace.asRelativePath(fileName)}...)*` });

      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const apiKey = config.get<string>('geminiApiKey');
      if (!apiKey) {
        this.sendMessageToWebview({ type: 'botMessage', value: 'Please set the Gemini API Key.' });
        return;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const systemInstruction = `You are a senior 10x developer and Agentic IDE Assistant.
Your goal is to provide elite-level, precise, and highly detailed answers.
The user wants you to ${action} the symbol '${symbolName}'. Provide the ${action} logic requested. Use markdown.`;
      
      let model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        systemInstruction
      });

      let activeFileContext = "";
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.fileName === fileName) {
        activeFileContext = `[File Content]:\n${editor.document.getText()}\n\n`;
      }

      const prompt = `Please ${action} the symbol named '${symbolName}' in this file.\n\n${activeFileContext}`;
      
      const contents = [
        ...this.chatHistory,
        { role: 'user', parts: [{ text: prompt }] }
      ];

      const result = await model.generateContentStream({ contents });
      
      const messageId = Math.random().toString(36).substring(7);
      this.sendMessageToWebview({ type: 'streamStart', value: messageId });

      let responseText = "";
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        responseText += chunkText;
        this.sendMessageToWebview({ type: 'streamChunk', id: messageId, value: responseText });
      }

      this.chatHistory.push({ role: 'user', parts: [{ text: prompt }] });
      this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
    } catch (err: any) {
       this.sendMessageToWebview({ type: 'error', value: this.formatErrorMessage(err) });
    }
  }

  public async triggerTestGeneration(symbolName: string, fileName: string) {
    try {
      this.sendMessageToWebview({ type: 'botMessage', value: `*(Agent is writing tests for ${symbolName} in ${vscode.workspace.asRelativePath(fileName)}...)*` });
      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const apiKey = config.get<string>('geminiApiKey');
      if (!apiKey) return;
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        systemInstruction: "You are an AI that writes unit tests. ONLY output the raw code for the test file inside a markdown block. Do not include conversational text."
      });
      const editor = vscode.window.activeTextEditor;
      const content = editor && editor.document.fileName === fileName ? editor.document.getText() : "";
      
      const prompt = `Write a complete suite of unit tests for the symbol '${symbolName}' based on this file content:\n\n${content}`;
      const result = await model.generateContent(prompt);
      let text = result.response.text();
      const codeMatch = text.match(/```[a-z]*\n([\s\S]*?)\n```/i);
      const testCode = codeMatch ? codeMatch[1] : text;

      // Save to a new file
      const path = require('path');
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      const dir = path.dirname(fileName);
      const isPython = ext === '.py';
      const testFileName = isPython ? `test_${base}${ext}` : `${base}.test${ext}`;
      const testFilePath = path.join(dir, testFileName);
      
      const fs = require('fs/promises');
      await fs.writeFile(testFilePath, testCode, 'utf8');
      
      const testUri = vscode.Uri.file(testFilePath);
      await vscode.window.showTextDocument(testUri);
      
      this.sendMessageToWebview({ type: 'botMessage', value: `Successfully generated and saved tests to **${testFileName}**.` });
    } catch (err: any) {
      this.sendMessageToWebview({ type: 'error', value: this.formatErrorMessage(err) });
    }
  }

  public async triggerScaffold() {
    try {
      const prompt = await vscode.window.showInputBox({ prompt: "What do you want to scaffold? (e.g., 'React Auth Component')" });
      if (!prompt) return;
      
      this.sendMessageToWebview({ type: 'botMessage', value: `*(Scaffolding: ${prompt}...)*` });
      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const apiKey = config.get<string>('geminiApiKey');
      if (!apiKey) return;
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        systemInstruction: "You are a scaffolding tool. You must ONLY output a raw JSON array of objects. Format: [{\"path\": \"filename.ext\", \"content\": \"file content\"}]. Do NOT wrap in markdown code blocks."
      });
      
      const result = await model.generateContent(prompt);
      let jsonText = result.response.text().trim();
      if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json\n|\n```$/g, '');
      else if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\n|\n```$/g, '');
      
      const files = JSON.parse(jsonText);
      const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!rootPath) return;
      
      const fs = require('fs/promises');
      const path = require('path');
      
      for (const file of files) {
         const fullPath = path.join(rootPath, file.path);
         await fs.mkdir(path.dirname(fullPath), { recursive: true });
         await fs.writeFile(fullPath, file.content, 'utf8');
      }
      this.sendMessageToWebview({ type: 'botMessage', value: `[Success] Successfully scaffolded ${files.length} files.` });
    } catch (err: any) {
      this.sendMessageToWebview({ type: 'error', value: this.formatErrorMessage(err) });
    }
  }

  public async triggerTerminalDebug(errorText: string) {
    try {
      this.sendMessageToWebview({ type: 'botMessage', value: `*(Debugging Terminal Error: ${errorText.substring(0, 50)}...)*` });

      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const apiKey = config.get<string>('geminiApiKey');
      if (!apiKey) {
        this.sendMessageToWebview({ type: 'botMessage', value: 'Please set the Gemini API Key.' });
        return;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const systemInstruction = `You are a senior 10x developer and Agentic IDE Assistant.
Your goal is to provide elite-level, precise, and highly detailed answers.
The user just encountered an error in their terminal. Diagnose the issue and explain how to fix it.`;
      
      let model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        systemInstruction
      });

      let activeFileContext = "";
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        activeFileContext = `[Currently Active File: ${editor.document.fileName}]\n${editor.document.getText()}\n\n`;
      }

      const prompt = `I encountered the following error in my terminal:\n\n${errorText}\n\n${activeFileContext}Please help me debug this.`;
      
      const contents = [
        ...this.chatHistory,
        { role: 'user', parts: [{ text: prompt }] }
      ];

      const result = await model.generateContentStream({ contents });
      
      const messageId = Math.random().toString(36).substring(7);
      this.sendMessageToWebview({ type: 'streamStart', value: messageId });

      let responseText = "";
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        responseText += chunkText;
        this.sendMessageToWebview({ type: 'streamChunk', id: messageId, value: responseText });
      }

      this.chatHistory.push({ role: 'user', parts: [{ text: prompt }] });
      this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
    } catch (err: any) {
       this.sendMessageToWebview({ type: 'error', value: this.formatErrorMessage(err) });
    }
  }

  private formatErrorMessage(err: any): string {
    const msg = err.message || String(err);
    if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('Quota exceeded')) {
      return `**Rate Limit Exceeded (429)**\n\nYou have made too many requests to the Gemini API and hit the Free Tier limits (15 requests/minute). Please wait a few seconds and try again, or upgrade your API plan at Google AI Studio.`;
    }
    return `Error: ${msg}`;
  }

  public sendMessageToWebview(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private _getHtmlForWebview(hasApiKey: boolean) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agentic Assistant</title>
  
  <!-- Import marked.js for Markdown parsing -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

  <style>
    :root {
      --chat-bg: var(--vscode-editor-background);
      --border-color: var(--vscode-widget-border);
      --input-bg: var(--vscode-input-background);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --accent: var(--vscode-textLink-foreground);
    }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      background-color: var(--chat-bg);
      color: var(--vscode-editor-foreground);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    
    /* Setup Screen */
    #setup-screen {
      display: ${hasApiKey ? 'none' : 'flex'};
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 20px;
      text-align: center;
    }
    #setup-screen input {
      width: 100%;
      margin: 15px 0;
      padding: 10px;
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      color: var(--vscode-editor-foreground);
      border-radius: 4px;
    }

    /* Main Chat Interface */
    #app-container {
      display: ${hasApiKey ? 'flex' : 'none'};
      flex-direction: column;
      height: 100%;
    }

    /* Toolbar */
    #toolbar {
      display: flex;
      gap: 10px;
      padding: 10px;
      border-bottom: 1px solid var(--border-color);
      background: rgba(0,0,0,0.1);
    }
    .action-btn {
      flex: 1;
      padding: 6px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      cursor: pointer;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-editor-foreground);
      transition: background 0.2s;
    }
    .action-btn:hover {
      background: rgba(255,255,255,0.1);
    }

    /* Chat Area */
    #chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    .message {
      max-width: 90%;
      padding: 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .user-msg {
      background-color: rgba(255, 255, 255, 0.05);
      align-self: flex-end;
      border: 1px solid var(--border-color);
    }
    .bot-msg {
      background-color: rgba(0, 0, 0, 0.2);
      align-self: flex-start;
      border: 1px solid var(--border-color);
    }
    .error-msg {
      background-color: rgba(200, 0, 0, 0.2);
      border: 1px solid red;
    }
    
    /* Markdown Styling */
    .bot-msg p { margin-top: 0; }
    .bot-msg h1, .bot-msg h2, .bot-msg h3 { margin-top: 0; color: var(--accent); }
    .bot-msg pre {
      background: #0d0d0d;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      position: relative;
      border: 1px solid #333;
    }
    .bot-msg code {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
    /* Inline code */
    .bot-msg p code {
      background: rgba(255,255,255,0.1);
      padding: 2px 4px;
      border-radius: 3px;
    }

    .apply-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
    }
    .apply-btn:hover { background: var(--btn-hover); }

    /* Input Area */
    #input-container {
      display: flex;
      padding: 10px;
      border-top: 1px solid var(--border-color);
      gap: 8px;
    }
    #chat-input {
      flex: 1;
      background: var(--input-bg);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border-color);
      padding: 10px;
      border-radius: 4px;
      outline: none;
    }
    #send-btn, #save-key-btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 10px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
    }
    #send-btn:hover, #save-key-btn:hover {
      background: var(--btn-hover);
    }
    
    .thinking {
      opacity: 0.7;
      font-style: italic;
    }
  </style>
</head>
<body>

  <!-- SETUP SCREEN -->
  <div id="setup-screen">
    <h2>Welcome to Agentic IDE</h2>
    <p>Please enter your Gemini API Key to get started.</p>
    <input type="password" id="api-key-input" placeholder="AIzaSy..." />
    <button id="save-key-btn">Save API Key</button>
  </div>

  <!-- MAIN APP -->
  <div id="app-container">
    <div id="toolbar">
      <button class="action-btn" id="index-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;"><path d="M8 12c-2.21 0-4-1.79-4-4s1.79-4 4-4v1.5L10.5 3 8 0.5V2C4.69 2 2 4.69 2 8s2.69 6 6 6 6-2.69 6-6h-2c0 2.21-1.79 4-4 4z" fill="currentColor"/></svg>
        Index Workspace
      </button>
      <button class="action-btn" id="review-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;"><path d="M15.7 14.3l-3.1-3.1C13.5 10 14 8.6 14 7c0-3.9-3.1-7-7-7S0 3.1 0 7s3.1 7 7 7c1.6 0 3-.5 4.2-1.4l3.1 3.1 1.4-1.4zM2 7c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5-5-2.2-5-5z" fill="currentColor"/></svg>
        Review Active File
      </button>
      <button class="action-btn" id="commit-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;"><path d="M10.5 4.5V2L14 5.5 10.5 9V6.5H5.5C4.1 6.5 3 7.6 3 9s1.1 2.5 2.5 2.5h2v2h-2C3 13.5 1 11.5 1 9s2-4.5 4.5-4.5h5z" fill="currentColor"/></svg>
        Generate Commit
      </button>
      <button class="action-btn" id="scaffold-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;"><path d="M13 3V1H3v2H1v10h2v2h10v-2h2V3h-2zm-2 10H5V3h6v10z" fill="currentColor"/></svg>
        Scaffold
      </button>
    </div>

    <div id="chat-container">
      <div class="message bot-msg">
        <strong>Agentic IDE V2</strong> is ready! 
        <br/><br/>
        <ul>
          <li>Use <strong>Index Workspace</strong> to scan your codebase.</li>
          <li>Use <strong>Review Active File</strong> for instant AI feedback.</li>
          <li>Ask me anything below!</li>
        </ul>
      </div>
    </div>

    <div id="input-container">
      <input type="text" id="chat-input" placeholder="Ask a question..." />
      <button id="send-btn">Send</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    // Elements
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const apiKeyInput = document.getElementById('api-key-input');
    const indexBtn = document.getElementById('index-btn');
    const reviewBtn = document.getElementById('review-btn');
    const commitBtn = document.getElementById('commit-btn');
    const scaffoldBtn = document.getElementById('scaffold-btn');

    // UI Listeners
    if(saveKeyBtn) {
      saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
          vscode.postMessage({ type: 'saveApiKey', value: key });
        }
      });
    }

    if(indexBtn) {
      indexBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'indexWorkspace' });
      });
    }

    if(reviewBtn) {
      reviewBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'reviewActiveFile' });
      });
    }

    if(commitBtn) {
      commitBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'generateCommit' });
      });
    }

    if(scaffoldBtn) {
      scaffoldBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'scaffold' });
      });
    }

    // Markdown Parser (using marked.js)
    function renderMarkdown(text) {
      // Configure marked to sanitize HTML if needed, but for trusted AI output we just parse
      let html = marked.parse(text);

      // Post-process HTML to inject "Apply to Active File" buttons on code blocks
      // We parse the DOM temporarily to modify pre > code blocks safely
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const preBlocks = doc.querySelectorAll('pre');
      preBlocks.forEach((pre, index) => {
        const codeElement = pre.querySelector('code');
        if (codeElement) {
          const id = 'code-' + Math.random().toString(36).substr(2, 9);
          codeElement.id = id;
          
          const btn = document.createElement('button');
          btn.className = 'apply-btn';
          btn.textContent = 'Apply to Active File';
          btn.onclick = function() {
            // Note: onclick attributes with dynamic data in webviews can be tricky, 
            // but we can define a global applyCode handler
          };
          btn.setAttribute('onclick', "applyCode('" + id + "')");
          
          pre.appendChild(btn);
        }
      });

      return doc.body.innerHTML;
    }

    window.applyCode = function(id) {
      const codeElement = document.getElementById(id);
      if (codeElement) {
        // Un-escape HTML entities
        let rawCode = codeElement.innerText || codeElement.textContent;
        vscode.postMessage({ type: 'applyCode', value: rawCode });
      }
    };

    function addMessage(text, role, id) {
      // Remove loading indicator if it exists
      const loading = document.getElementById('loading');
      if (loading) loading.remove();

      const msgDiv = document.createElement('div');
      if (id) msgDiv.id = id;
      
      if (role === 'user') {
        msgDiv.className = 'message user-msg';
        msgDiv.textContent = text;
      } else if (role === 'bot') {
        msgDiv.className = 'message bot-msg';
        msgDiv.innerHTML = renderMarkdown(text);
      } else if (role === 'error') {
        msgDiv.className = 'message error-msg';
        msgDiv.textContent = text;
      }
      
      chatContainer.appendChild(msgDiv);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function showLoading() {
      const loading = document.getElementById('loading');
      if (!loading) {
        const msgDiv = document.createElement('div');
        msgDiv.id = 'loading';
        msgDiv.className = 'message bot-msg thinking';
        msgDiv.textContent = 'Thinking...';
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }

    sendBtn.addEventListener('click', () => {
      const text = chatInput.value.trim();
      if (text) {
        addMessage(text, 'user');
        showLoading();
        vscode.postMessage({ type: 'chatMessage', value: text });
        chatInput.value = '';
      }
    });

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendBtn.click();
      }
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'botMessage':
          addMessage(message.value, 'bot');
          break;
        case 'streamStart':
          addMessage('', 'bot', message.value);
          break;
        case 'streamChunk':
          const bubble = document.getElementById(message.id);
          if (bubble) {
            bubble.innerHTML = renderMarkdown(message.value);
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
          break;
        case 'error':
          addMessage('Error: ' + message.value, 'error');
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}

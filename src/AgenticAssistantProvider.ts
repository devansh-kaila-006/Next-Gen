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

              const currentTurn = `Codebase Context (Vector Search Results):\n${contextText}\n\nUser Question: ${userQuery}`;

              const contents = [
                ...this.chatHistory,
                { role: 'user', parts: [{ text: currentTurn }] }
              ];

              const result = await model.generateContent({ contents });
              const responseText = result.response.text();

              // Push the clean query to history to save context tokens, and the model's response
              this.chatHistory.push({ role: 'user', parts: [{ text: userQuery }] });
              this.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });

              this.sendMessageToWebview({
                type: 'botMessage',
                value: responseText
              });
            } catch (err: any) {
               this.sendMessageToWebview({
                type: 'error',
                value: `Error processing query: ${err.message}`
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

      // For code reviews, we can optionally inject it into history or keep it stateless. Let's keep it stateless so it doesn't pollute chat memory.
      this.sendMessageToWebview({
        type: 'botMessage',
        value: responseText
      });
    } catch (err: any) {
       this.sendMessageToWebview({
        type: 'error',
        value: `Error during review: ${err.message}`
      });
    }
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
    #chat-input:focus {
      border-color: var(--accent);
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

    function addMessage(text, role) {
      // Remove loading indicator if it exists
      const loading = document.getElementById('loading');
      if (loading) loading.remove();

      const msgDiv = document.createElement('div');
      
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

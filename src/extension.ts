import * as vscode from 'vscode';
import { AgenticAssistantProvider } from './AgenticAssistantProvider';
import { indexWorkspace } from './indexer';
import { AgenticCodeLensProvider } from './codeLensProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Agentic IDE Assistant is now active!');

  const provider = new AgenticAssistantProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgenticAssistantProvider.viewType, provider)
  );

  let disposable = vscode.commands.registerCommand('agentic-ide-assistant.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from Agentic IDE Assistant!');
  });
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-ide-assistant.openSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.agentic-assistant');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-ide-assistant.indexWorkspace', async () => {
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Indexing Workspace",
        cancellable: false
      }, async (progress) => {
        try {
          await indexWorkspace(progress);
          vscode.window.showInformationMessage('Workspace indexed successfully!');
        } catch (error: any) {
          vscode.window.showErrorMessage(`Error indexing workspace: ${error.message}`);
        }
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-ide-assistant.reviewCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active file to review.');
        return;
      }
      
      const fileContent = editor.document.getText();
      const fileName = editor.document.fileName;
      
      // Send message to the webview to start review
      provider.sendMessageToWebview({
        type: 'botMessage',
        value: `Starting review for ${fileName}...`
      });

      // Simulate sending a user message to trigger the LLM review
      provider.triggerReview(fileName, fileContent);
      vscode.commands.executeCommand('workbench.view.extension.agentic-assistant');
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider('*', new AgenticCodeLensProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-ide-assistant.explainSymbol', (symbolName: string, fileName: string) => {
      provider.triggerSymbolAction(symbolName, fileName, 'explain');
      vscode.commands.executeCommand('workbench.view.extension.agentic-assistant');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-ide-assistant.refactorSymbol', (symbolName: string, fileName: string) => {
      provider.triggerSymbolAction(symbolName, fileName, 'refactor');
      vscode.commands.executeCommand('workbench.view.extension.agentic-assistant');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-ide-assistant.debugTerminal', (errorText: string) => {
      provider.triggerTerminalDebug(errorText);
      vscode.commands.executeCommand('workbench.view.extension.agentic-assistant');
    })
  );

  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider({
      provideTerminalLinks: (context, token) => {
        const errorMatch = context.line.match(/(Error|Exception|Failed|Traceback|SyntaxError|TypeError|ReferenceError)/i);
        if (errorMatch) {
          return [{
            startIndex: 0,
            length: context.line.length,
            tooltip: 'Debug with Agentic IDE',
            data: context.line // store the line to send
          } as any];
        }
        return [];
      },
      handleTerminalLink: (link: any) => {
        vscode.commands.executeCommand('agentic-ide-assistant.debugTerminal', link.data);
      }
    })
  );

  // Silent auto-indexing every 15 minutes
  const intervalId = setInterval(async () => {
    try {
      console.log('Running silent auto-index...');
      await indexWorkspace({ report: () => {} });
    } catch (e) {
      console.error('Auto-index failed:', e);
    }
  }, 15 * 60 * 1000);
  
  context.subscriptions.push({ dispose: () => clearInterval(intervalId) });
}

export function deactivate() {}

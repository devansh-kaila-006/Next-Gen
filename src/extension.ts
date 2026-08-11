import * as vscode from 'vscode';
import { AgenticAssistantProvider } from './AgenticAssistantProvider';
import { indexWorkspace } from './indexer';

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
}

export function deactivate() {}

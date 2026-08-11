import * as vscode from 'vscode';

export class AgenticCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const regex = new RegExp("^(?:export\\s+)?(?:async\\s+)?(?:function|class|def)\\s+([a-zA-Z0-9_]+)", "gm");
    const text = document.getText();
    let matches;

    while ((matches = regex.exec(text)) !== null) {
      const line = document.positionAt(matches.index).line;
      const range = new vscode.Range(line, 0, line, matches[0].length);
      
      const symbolName = matches[1];
      
      const explainCmd: vscode.Command = {
        title: "Agent: Explain",
        command: "agentic-ide-assistant.explainSymbol",
        arguments: [symbolName, document.fileName]
      };
      
      const refactorCmd: vscode.Command = {
        title: "Agent: Refactor",
        command: "agentic-ide-assistant.refactorSymbol",
        arguments: [symbolName, document.fileName]
      };

      codeLenses.push(new vscode.CodeLens(range, explainCmd));
      codeLenses.push(new vscode.CodeLens(range, refactorCmd));
    }

    return codeLenses;
  }
}

import * as vscode from 'vscode';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AgenticInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    
    // Simple debounce/fast-fail if we are not at the end of a line
    const line = document.lineAt(position);
    if (position.character < line.text.length) {
       return undefined;
    }

    const config = vscode.workspace.getConfiguration('agenticAssistant');
    const apiKey = config.get<string>('geminiApiKey');
    if (!apiKey) return undefined;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash", systemInstruction: "You are an inline code autocomplete agent. Only output the code that should be inserted at the cursor. Do NOT include markdown code blocks (```) or any conversational text. Keep the suggestion brief (1 to 5 lines maximum)." });

    // Get a bit of text before the cursor
    const prefixRange = new vscode.Range(Math.max(0, position.line - 15), 0, position.line, position.character);
    const prefix = document.getText(prefixRange);
    
    // Debounce: Wait for 1000ms. If the user keeps typing, VS Code will cancel the token.
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (token.isCancellationRequested) {
      return undefined;
    }
    
    const prompt = `Provide the autocomplete code that logically follows this context:\n\n${prefix}`;
    
    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text();
      // Clean up markdown block if the model accidentally provided it
      text = text.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
      
      if (text.trim().length > 0) {
        return [new vscode.InlineCompletionItem(text)];
      }
    } catch (e) {
      console.error('Inline completion failed', e);
    }
    
    return undefined;
  }
}

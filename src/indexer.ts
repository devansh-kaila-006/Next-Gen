import * as vscode from 'vscode';
import { VectorStore } from './vectorStore';
import { chunkText } from './chunker';

export async function indexWorkspace(progress: vscode.Progress<{ message?: string; increment?: number }>) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error('No workspace folder open');
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const vectorStore = new VectorStore(rootPath);

  progress.report({ message: 'Finding files...', increment: 10 });

  // Exclude common unnecessary directories
  const excludePattern = '**/{node_modules,.git,dist,out,build,.vscode}/**';
  const includePattern = '**/*.{ts,js,py,go,java,c,cpp,h,hpp,md,json}';

  const files = await vscode.workspace.findFiles(includePattern, excludePattern);
  
  if (files.length === 0) {
    throw new Error('No files found to index.');
  }

  progress.report({ message: `Found ${files.length} files. Generating embeddings...`, increment: 10 });

  await vectorStore.init();

  const totalFiles = files.length;
  let processed = 0;

  for (const file of files) {
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const text = document.getText();
      
      // Simple chunking
      const chunks = chunkText(text, 1000, 200);

      for (const chunk of chunks) {
        await vectorStore.addDocument(file.fsPath, chunk);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to process file ${file.fsPath}: ${e.message}`);
      throw e;
    }

    processed++;
    if (processed % 5 === 0) {
      progress.report({ message: `Indexed ${processed}/${totalFiles} files`, increment: (5 / totalFiles) * 80 });
    }
  }

  progress.report({ message: 'Saving vector store...', increment: 10 });
  await vectorStore.save();
}

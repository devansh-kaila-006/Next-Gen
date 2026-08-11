import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface VectorDocument {
  filePath: string;
  content: string;
  embedding: number[];
}

export class VectorStore {
  private dbPath: string;
  private documents: VectorDocument[] = [];
  private genAI?: GoogleGenerativeAI;

  constructor(workspaceRoot: string) {
    this.dbPath = path.join(workspaceRoot, '.agentic_db.json');
  }

  private getGenAI(): GoogleGenerativeAI {
    if (!this.genAI) {
      const config = vscode.workspace.getConfiguration('agenticAssistant');
      const apiKey = config.get<string>('geminiApiKey');
      
      if (!apiKey) {
        vscode.window.showErrorMessage('Please set the Gemini API Key in settings (agenticAssistant.geminiApiKey)');
        throw new Error('API Key missing');
      }
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  async init() {
    try {
      const data = await fs.readFile(this.dbPath, 'utf8');
      this.documents = JSON.parse(data);
    } catch (e) {
      this.documents = []; // File doesn't exist or is invalid
    }
  }

  async addDocument(filePath: string, content: string) {
    try {
      let model = this.getGenAI().getGenerativeModel({ model: "gemini-embedding-2" });
      let result;
      try {
        result = await model.embedContent(content);
      } catch (e: any) {
        if (e.message && e.message.includes('404')) {
           model = this.getGenAI().getGenerativeModel({ model: "gemini-embedding-001" });
           result = await model.embedContent(content);
        } else {
           throw e;
        }
      }
      const embedding = result.embedding.values;

      this.documents.push({
        filePath,
        content,
        embedding
      });
    } catch (e) {
      console.error('Failed to embed chunk', e);
      throw e;
    }
  }

  async save() {
    await fs.writeFile(this.dbPath, JSON.stringify(this.documents, null, 2), 'utf8');
  }

  async search(query: string, topK: number = 3): Promise<VectorDocument[]> {
    if (this.documents.length === 0) {
      return [];
    }

    let model = this.getGenAI().getGenerativeModel({ model: "gemini-embedding-2" });
    let result;
    try {
      result = await model.embedContent(query);
    } catch (e: any) {
      if (e.message && e.message.includes('404')) {
        model = this.getGenAI().getGenerativeModel({ model: "gemini-embedding-001" });
        result = await model.embedContent(query);
      } else {
        throw e;
      }
    }
    const queryEmbedding = result.embedding.values;

    // Calculate cosine similarity
    const scoredDocs = this.documents.map(doc => {
      return {
        doc,
        score: this.cosineSimilarity(queryEmbedding, doc.embedding)
      };
    });

    // Sort by descending score
    scoredDocs.sort((a, b) => b.score - a.score);

    return scoredDocs.slice(0, topK).map(sd => sd.doc);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

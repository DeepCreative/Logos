import * as vscode from 'vscode';

let chatPanel: AriaChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Logos ARIA Chat extension activated');

  // Create the chat panel provider with context for state persistence
  chatPanel = new AriaChatViewProvider(context.extensionUri, context);

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('logos.ariaChat', chatPanel)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('logos.newChat', () => {
      chatPanel.newChat();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('logos.clearChat', () => {
      chatPanel.clearChat();
    })
  );

  // Register export/import commands for backup
  context.subscriptions.push(
    vscode.commands.registerCommand('logos.exportConversations', () => {
      chatPanel.exportConversations();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('logos.importConversations', () => {
      chatPanel.importConversations();
    })
  );
}

export function deactivate() {}

class AriaChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _conversations: Conversation[] = [];
  private _activeConversationId: string | null = null;
  private readonly STORAGE_KEY = 'ariaChat.conversations';
  private readonly ACTIVE_KEY = 'ariaChat.activeConversationId';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    // Load persisted conversations on initialization
    this._loadConversations();
  }

  // Load conversations from globalState
  private _loadConversations() {
    try {
      const storedConversations = this._context.globalState.get<Conversation[]>(this.STORAGE_KEY);
      const storedActiveId = this._context.globalState.get<string>(this.ACTIVE_KEY);

      if (storedConversations && storedConversations.length > 0) {
        this._conversations = storedConversations;
        this._activeConversationId = storedActiveId || storedConversations[0].id;
        console.log(`Loaded ${storedConversations.length} conversations from storage`);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }

  // Save conversations to globalState
  private async _saveConversations() {
    try {
      await this._context.globalState.update(this.STORAGE_KEY, this._conversations);
      await this._context.globalState.update(this.ACTIVE_KEY, this._activeConversationId);
    } catch (error) {
      console.error('Failed to save conversations:', error);
    }
  }

  // Export conversations to file
  public async exportConversations() {
    if (this._conversations.length === 0) {
      vscode.window.showWarningMessage('No conversations to export.');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('aria-conversations.json'),
      filters: { 'JSON': ['json'] }
    });

    if (uri) {
      const content = JSON.stringify(this._conversations, null, 2);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      vscode.window.showInformationMessage(`Exported ${this._conversations.length} conversations.`);
    }
  }

  // Import conversations from file
  public async importConversations() {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON': ['json'] }
    });

    if (uris && uris.length > 0) {
      try {
        const content = await vscode.workspace.fs.readFile(uris[0]);
        const imported = JSON.parse(content.toString()) as Conversation[];

        if (Array.isArray(imported)) {
          // Merge with existing, avoid duplicates by ID
          const existingIds = new Set(this._conversations.map(c => c.id));
          const newConversations = imported.filter(c => !existingIds.has(c.id));
          this._conversations = [...newConversations, ...this._conversations];
          await this._saveConversations();
          this._updateWebview();
          vscode.window.showInformationMessage(`Imported ${newConversations.length} new conversations.`);
        }
      } catch (error) {
        vscode.window.showErrorMessage('Failed to import conversations: Invalid file format.');
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'ready':
          console.log('ARIA Chat webview ready, initializing...');
          if (this._conversations.length === 0) {
            this.newChat();
          } else {
            this._updateWebview();
          }
          break;
        case 'sendMessage':
          await this._handleSendMessage(data.message, data.conversationId, data.mode, data.attachments);
          break;
        case 'newChat':
          this.newChat();
          break;
        case 'selectConversation':
          this._selectConversation(data.conversationId);
          break;
        case 'deleteConversation':
          this._deleteConversation(data.conversationId);
          break;
        case 'uploadFiles':
          await this._handleFileUpload(data.files, data.conversationId);
          break;
        case 'changeMode':
          this._handleModeChange(data.mode, data.conversationId);
          break;
      }
    });
  }

  public newChat() {
    const conversation: Conversation = {
      id: `conv-${Date.now()}`,
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
      model: 'aria-01',
      mode: 'agent',
      attachments: [],
    };
    this._conversations.unshift(conversation);
    this._activeConversationId = conversation.id;
    this._updateWebview();
  }

  public clearChat() {
    if (this._activeConversationId) {
      const conv = this._conversations.find(c => c.id === this._activeConversationId);
      if (conv) {
        conv.messages = [];
        conv.attachments = [];
        this._updateWebview();
      }
    }
  }

  private _selectConversation(conversationId: string) {
    this._activeConversationId = conversationId;
    this._updateWebview();
  }

  private _deleteConversation(conversationId: string) {
    this._conversations = this._conversations.filter(c => c.id !== conversationId);
    if (this._activeConversationId === conversationId) {
      this._activeConversationId = this._conversations[0]?.id || null;
    }
    this._updateWebview();
  }

  private _handleModeChange(mode: AriaMode, conversationId: string) {
    const conv = this._conversations.find(c => c.id === conversationId);
    if (conv) {
      conv.mode = mode;
      this._updateWebview();
    }
  }

  private async _handleFileUpload(files: FileAttachment[], conversationId: string) {
    const conv = this._conversations.find(c => c.id === conversationId);
    if (!conv) return;

    // Carousel endpoint - use internal cluster URL in production
    const carouselEndpoint = process.env.CAROUSEL_ENDPOINT ||
                             process.env.CAROUSEL_URL ||
                             'http://carousel.carousel.svc.cluster.local';
    const collection = 'logos-attachments'; // Default collection for Logos file attachments

    // Store files in Carousel
    for (const file of files) {
      try {
        // Determine if content is text or binary (base64)
        const isTextContent = typeof file.content === 'string' &&
                              !file.content.startsWith('data:');

        if (isTextContent) {
          // Use text ingestion endpoint for text files
          const response = await fetch(`${carouselEndpoint}/v1/collections/${collection}/ingest/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: file.content,
              source: file.name,
              metadata: {
                filename: file.name,
                mimeType: file.type || 'text/plain',
                conversationId,
                uploadedAt: new Date().toISOString(),
                size: file.size,
              },
              chunking_strategy: 'semantic',
            }),
          });

          if (response.ok) {
            const result = await response.json() as { document_id?: string; job_id?: string };
            conv.attachments.push({
              ...file,
              carouselId: result.document_id || result.job_id,
              status: 'uploaded',
            });
          } else {
            const errorText = await response.text();
            console.error('Carousel upload failed:', response.status, errorText);
            conv.attachments.push({
              ...file,
              status: 'failed',
            });
          }
        } else {
          // For binary files (base64 encoded), create a FormData and use file endpoint
          // Note: In VS Code extension context, we pass the base64 content directly
          const response = await fetch(`${carouselEndpoint}/v1/collections/${collection}/ingest/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `[Binary file: ${file.name}]\nSize: ${file.size} bytes\nType: ${file.type}\n\nBase64 content stored for reference.`,
              source: file.name,
              metadata: {
                filename: file.name,
                mimeType: file.type,
                conversationId,
                uploadedAt: new Date().toISOString(),
                size: file.size,
                encoding: 'base64',
                originalContent: file.content, // Store original base64 in metadata
              },
              chunking_strategy: 'recursive',
            }),
          });

          if (response.ok) {
            const result = await response.json() as { document_id?: string; job_id?: string };
            conv.attachments.push({
              ...file,
              carouselId: result.document_id || result.job_id,
              status: 'uploaded',
            });
          } else {
            console.error('Carousel upload failed:', response.status);
            conv.attachments.push({
              ...file,
              status: 'failed',
            });
          }
        }
      } catch (error) {
        console.error('File upload error:', error);
        conv.attachments.push({
          ...file,
          status: 'failed',
        });
      }
    }

    this._updateWebview();
  }

  private async _handleSendMessage(
    message: string,
    conversationId: string,
    mode: AriaMode = 'agent',
    attachments: FileAttachment[] = []
  ) {
    const conversation = this._conversations.find(c => c.id === conversationId);
    if (!conversation) return;

    // Add user message
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      attachments: attachments.map(a => a.name),
    };
    conversation.messages.push(userMessage);

    // Update title if first message
    if (conversation.messages.length === 1) {
      conversation.title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
    }

    this._updateWebview();

    // Send to ARIA Gateway or Athena for Research mode
    try {
      // Determine endpoint based on environment
      // In production: use internal cluster service
      // In development: use external gateway or localhost
      const ariaGatewayEndpoint = process.env.ARIA_GATEWAY_ENDPOINT ||
                                   process.env.ARIA_ENDPOINT ||
                                   'http://aria-gateway.aria.svc.cluster.local';

      // Athena endpoint for Research mode
      const athenaEndpoint = process.env.ATHENA_ENDPOINT ||
                              process.env.ATHENA_URL ||
                              'http://athena-research-agent.aria.svc.cluster.local:8082';

      // Get editor context
      const editor = vscode.window.activeTextEditor;
      const context = editor ? {
        file: editor.document.uri.fsPath,
        language: editor.document.languageId,
        selection: editor.document.getText(editor.selection),
      } : undefined;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout for research

      let response: Response;

      // Route to Athena for Research mode
      if (mode === 'research') {
        // Create research session with Athena
        const researchRequest = {
          query: message,
          context: context?.selection || '',
          depth: 'comprehensive',
          source_types: ['web', 'internal', 'academic'],
          max_threads: 5,
          metadata: {
            conversationId: conversation.id,
            attachments: conversation.attachments
              .filter(a => a.status === 'uploaded' && a.carouselId)
              .map(a => a.carouselId),
          },
        };

        response = await fetch(`${athenaEndpoint}/v1/research/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(researchRequest),
          signal: controller.signal,
        });
      } else {
        // Standard ARIA Gateway for other modes
        const requestBody = {
          model: 'aria-01',
          messages: conversation.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true, // Enable SSE streaming
          // Mode-specific settings
          mode,
          context,
          // Include attachment references for RAG
          attachments: conversation.attachments
            .filter(a => a.status === 'uploaded' && a.carouselId)
            .map(a => a.carouselId),
        };

        response = await fetch(`${ariaGatewayEndpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'X-Aria-Mode': mode,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      // Create placeholder message for streaming
      const assistantMessage: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        agentId: 'aria',
        model: 'aria-01',
        mode,
      };
      conversation.messages.push(assistantMessage);
      this._updateWebview();

      // Handle streaming response
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        // SSE streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  break;
                }
                try {
                  const chunk = JSON.parse(data) as {
                    id?: string;
                    choices?: Array<{
                      delta?: { content?: string };
                      finish_reason?: string;
                    }>;
                  };

                  // Update message ID from stream
                  if (chunk.id) {
                    assistantMessage.id = chunk.id;
                  }

                  // Append delta content
                  const deltaContent = chunk.choices?.[0]?.delta?.content;
                  if (deltaContent) {
                    assistantMessage.content += deltaContent;
                    // Update webview with streaming content
                    this._view?.webview.postMessage({
                      type: 'streamUpdate',
                      messageId: assistantMessage.id,
                      content: assistantMessage.content,
                    });
                  }

                  // Check for completion
                  if (chunk.choices?.[0]?.finish_reason) {
                    break;
                  }
                } catch (parseError) {
                  // Skip malformed JSON chunks
                  console.warn('Failed to parse SSE chunk:', data);
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } else if (mode === 'research') {
        // Handle Athena Research mode response
        const researchResult = await response.json() as {
          id?: string;
          session_id?: string;
          query?: string;
          status?: string;
          threads?: Array<{
            id: string;
            type: string;
            query: string;
            sources?: Array<{ title: string; url?: string }>;
            findings?: string;
          }>;
          narrative?: { content: string; sources?: Array<{ title: string; url?: string }> };
          error?: string;
        };

        if (researchResult.error) {
          throw new Error(researchResult.error);
        }

        // Format research response with structured output
        let researchContent = '';
        if (researchResult.narrative?.content) {
          researchContent = researchResult.narrative.content;
          if (researchResult.narrative.sources && researchResult.narrative.sources.length > 0) {
            researchContent += '\n\n**Sources:**\n';
            researchResult.narrative.sources.forEach((src, i) => {
              researchContent += `${i + 1}. [${src.title}](${src.url || '#'})\n`;
            });
          }
        } else if (researchResult.threads && researchResult.threads.length > 0) {
          // Show thread findings
          researchContent = `**Research Session Started**\nSession ID: \`${researchResult.session_id || researchResult.id}\`\n\n`;
          researchResult.threads.forEach((thread, i) => {
            researchContent += `**Thread ${i + 1}: ${thread.type}**\n`;
            researchContent += `Query: ${thread.query}\n`;
            if (thread.findings) {
              researchContent += `Findings: ${thread.findings}\n`;
            }
            researchContent += '\n';
          });
        } else {
          researchContent = `Research session created. Session ID: \`${researchResult.session_id || researchResult.id}\`\n\nProcessing your research query...`;
        }

        assistantMessage.content = researchContent;
        assistantMessage.id = researchResult.id || researchResult.session_id || assistantMessage.id;
        assistantMessage.agentId = 'athena';
        assistantMessage.model = 'athena-research';
      } else {
        // Fallback: Non-streaming JSON response
        const result = await response.json() as {
          id?: string;
          choices?: Array<{
            message?: { content?: string };
          }>;
          usage?: { completion_tokens?: number };
          error?: string;
        };

        if (result.error) {
          throw new Error(result.error);
        }

        assistantMessage.content = result.choices?.[0]?.message?.content ||
                                   'I apologize, but I encountered an issue. Please try again.';
        if (result.id) {
          assistantMessage.id = result.id;
        }
      }

      // Final update with complete message
      if (!assistantMessage.content) {
        assistantMessage.content = 'I apologize, but I encountered an issue. Please try again.';
      }
    } catch (error) {
      console.error('ARIA chat error:', error);
      // Fallback response for demo/offline mode
      const modeResponses: Record<AriaMode, string> = {
        'agent': `Hello! I'm ARIA in **Agent** mode. I can take actions on your behalf:\n\n• **Edit files** - Modify code directly\n• **Run commands** - Execute terminal commands\n• **Create files** - Generate new files and structures\n• **Git operations** - Commit, branch, merge\n\nHow can I help you today?`,
        'ask': `Hello! I'm ARIA in **Ask** mode. I'm here to answer questions and provide information without making any changes. What would you like to know?`,
        'plan': `Hello! I'm ARIA in **Plan** mode. I'll help you create structured plans for your tasks:\n\n• **Break down** complex tasks\n• **Create todos** with checkpoints\n• **Estimate** effort and complexity\n• **Track progress** as you work\n\nWhat would you like to plan?`,
        'debug': `Hello! I'm ARIA in **Debug** mode. I'll help you find and fix issues:\n\n• **Analyze errors** - Parse stack traces and logs\n• **Trace code** - Follow execution paths\n• **Suggest fixes** - Provide solutions\n• **Test** - Help verify fixes\n\nWhat issue are you experiencing?`,
        'research': `Hello! I'm ARIA in **Research** mode. I'll help you explore and understand:\n\n• **Documentation** - Find relevant docs\n• **Examples** - Locate code examples\n• **Best practices** - Industry standards\n• **Comparisons** - Evaluate options\n\nWhat would you like to research?`,
        'code-review': `Hello! I'm ARIA in **Code Review** mode. I'll analyze your code for:\n\n• **Quality** - Style and consistency\n• **Bugs** - Potential issues\n• **Performance** - Optimization opportunities\n• **Security** - Vulnerability checks\n\nWhat code would you like me to review?`,
      };

      const assistantMessage: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: modeResponses[mode] || modeResponses['agent'],
        timestamp: new Date().toISOString(),
        agentId: 'aria',
        model: 'aria-01',
        mode,
      };
      conversation.messages.push(assistantMessage);
    }

    this._updateWebview();
  }

  private _updateWebview() {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'update',
        conversations: this._conversations,
        activeConversationId: this._activeConversationId,
      });
    }
    // Persist conversations after each update
    this._saveConversations();
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARIA Chat</title>
  <style>
    /* =====================================================
       DESIGN TOKENS - Sunset Engine
       ===================================================== */
    :root {
      --bg-primary: #000000;
      --bg-secondary: #0a0a0a;
      --bg-tertiary: #141414;
      --bg-elevated: #1a1a1a;
      --bg-hover: rgba(255, 255, 255, 0.06);

      --text-primary: #ffffff;
      --text-secondary: #a0a0a0;
      --text-muted: #606060;
      --text-inverse: #000000;

      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-medium: rgba(255, 255, 255, 0.15);
      --border-strong: rgba(255, 255, 255, 0.25);

      --accent-primary: #ffffff;
      --accent-agent: #4ade80;
      --accent-ask: #60a5fa;
      --accent-plan: #fbbf24;
      --accent-debug: #ef4444;
      --accent-research: #a78bfa;
      --accent-review: #f472b6;

      --status-success: #4ade80;
      --status-warning: #fbbf24;
      --status-error: #ef4444;

      --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', monospace;

      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-full: 9999px;

      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 16px;
      --space-lg: 24px;

      --transition-fast: 0.15s ease;
      --transition-base: 0.2s ease;

      --sidebar-width: 240px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      display: flex;
      font-size: 13px;
      overflow: hidden;
    }

    /* =====================================================
       TWO-PANEL LAYOUT - Responsive for VS Code sidebar
       ===================================================== */
    .chat-container {
      display: flex;
      flex-direction: column; /* Stack vertically by default for narrow sidebars */
      width: 100%;
      height: 100%;
    }

    /* Wide layout: side-by-side panels when width > 480px */
    @media (min-width: 481px) {
      .chat-container {
        flex-direction: row;
      }
      .conversations-panel {
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        border-right: 1px solid var(--border-subtle);
        border-bottom: none;
        max-height: 100%;
      }
    }

    /* =====================================================
       LEFT PANEL - CONVERSATIONS LIST
       ===================================================== */
    .conversations-panel {
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      max-height: 180px; /* Limit height in narrow mode */
      border-bottom: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .conversations-header {
      padding: var(--space-sm) var(--space-md);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .conversations-title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }

    .new-chat-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-medium);
      color: var(--text-primary);
      width: 28px;
      height: 28px;
      border-radius: var(--radius-md);
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast);
    }

    .new-chat-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }

    .conversations-list {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-xs);
    }

    .conversation-item {
      padding: var(--space-sm) var(--space-md);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: all var(--transition-fast);
      border-radius: var(--radius-md);
      margin-bottom: 2px;
      border-left: 2px solid transparent;
      position: relative;
    }

    .conversation-item:hover {
      background: var(--bg-hover);
    }

    .conversation-item.active {
      background: var(--bg-tertiary);
      border-left-color: var(--accent-primary);
    }

    .conversation-item-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
    }

    .conversation-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 12px;
      font-weight: 500;
    }

    .conversation-time {
      font-size: 10px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .conversation-mode-badge {
      font-size: 9px;
      font-family: var(--font-mono);
      padding: 1px 5px;
      border-radius: var(--radius-sm);
      background: var(--bg-tertiary);
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .conversation-delete {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      opacity: 0;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }

    .conversation-item:hover .conversation-delete {
      opacity: 1;
    }

    .conversation-delete:hover {
      color: var(--status-error);
      background: var(--bg-hover);
    }

    /* =====================================================
       RIGHT PANEL - CHAT AREA
       ===================================================== */
    .chat-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0; /* Allow shrinking in flex */
      background: var(--bg-primary);
      position: relative; /* For drop zone positioning */
    }

    /* In narrow mode, ensure chat panel takes remaining space */
    @media (max-width: 480px) {
      .chat-panel {
        flex: 1;
        min-height: 300px;
      }
    }

    .chat-header {
      padding: var(--space-sm) var(--space-md);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .chat-header-title {
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }

    .chat-header-title .mode-icon {
      font-size: 14px;
    }

    /* =====================================================
       MESSAGES AREA
       ===================================================== */
    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-md);
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }

    .message {
      display: flex;
      gap: var(--space-sm);
      animation: slideIn 0.2s ease;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-avatar {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-md);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-medium);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }

    .message.user .message-avatar {
      background: var(--bg-elevated);
    }

    .message.assistant .message-avatar {
      background: var(--bg-tertiary);
    }

    .message-content {
      flex: 1;
      min-width: 0;
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      margin-bottom: 4px;
    }

    .message-sender {
      font-weight: 600;
      font-size: 12px;
    }

    .message-model {
      font-size: 10px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      padding: 1px 4px;
      background: var(--bg-tertiary);
      border-radius: 3px;
    }

    .message-mode-tag {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      text-transform: uppercase;
      font-weight: 500;
    }

    .message-mode-tag.agent { background: rgba(74, 222, 128, 0.15); color: var(--accent-agent); }
    .message-mode-tag.ask { background: rgba(96, 165, 250, 0.15); color: var(--accent-ask); }
    .message-mode-tag.plan { background: rgba(251, 191, 36, 0.15); color: var(--accent-plan); }
    .message-mode-tag.debug { background: rgba(239, 68, 68, 0.15); color: var(--accent-debug); }
    .message-mode-tag.research { background: rgba(167, 139, 250, 0.15); color: var(--accent-research); }
    .message-mode-tag.code-review { background: rgba(244, 114, 182, 0.15); color: var(--accent-review); }

    .message-text {
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .message-text code {
      background: var(--bg-tertiary);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .message-text strong {
      font-weight: 600;
    }

    .message-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin-top: var(--space-xs);
    }

    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      font-size: 10px;
      color: var(--text-secondary);
    }

    /* =====================================================
       EMPTY STATE
       ===================================================== */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: var(--space-lg);
      color: var(--text-muted);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: var(--space-md);
      opacity: 0.6;
    }

    .empty-state-title {
      font-weight: 600;
      font-size: 16px;
      color: var(--text-primary);
      margin-bottom: var(--space-xs);
    }

    .empty-state-text {
      font-size: 12px;
      max-width: 280px;
      line-height: 1.5;
    }

    /* =====================================================
       INPUT AREA - CURSOR-STYLE WITH MODE SELECTOR
       ===================================================== */
    .input-area {
      padding: var(--space-md);
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .input-wrapper {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-sm);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-lg);
      transition: border-color var(--transition-fast);
    }

    .input-wrapper:focus-within {
      border-color: var(--accent-primary);
    }

    /* MODE SELECTOR ROW - Cursor-style */
    .input-header {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: 0 var(--space-xs);
    }

    .mode-selector {
      display: flex;
      align-items: center;
      gap: 2px;
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      padding: 2px;
    }

    .mode-option {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 500;
      transition: all var(--transition-fast);
    }

    .mode-option:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .mode-option.active {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .mode-option.active.agent { color: var(--accent-agent); }
    .mode-option.active.ask { color: var(--accent-ask); }
    .mode-option.active.plan { color: var(--accent-plan); }
    .mode-option.active.debug { color: var(--accent-debug); }
    .mode-option.active.research { color: var(--accent-research); }
    .mode-option.active.code-review { color: var(--accent-review); }

    .mode-option .mode-icon {
      font-size: 12px;
    }

    /* Compact mode selector for narrow viewports */
    @media (max-width: 380px) {
      .mode-option span:not(.mode-icon) {
        display: none; /* Hide text labels, show only icons */
      }
      .mode-option {
        padding: 6px 8px;
      }
    }

    /* ATTACHMENTS ROW */
    .attachments-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      padding: 0 var(--space-xs);
    }

    .attachment-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      font-size: 10px;
      color: var(--text-secondary);
    }

    .attachment-badge.uploaded { border-color: var(--status-success); }
    .attachment-badge.uploading { border-color: var(--status-warning); }
    .attachment-badge.failed { border-color: var(--status-error); }

    .attachment-remove {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0;
      display: flex;
      margin-left: 2px;
    }

    .attachment-remove:hover {
      color: var(--text-primary);
    }

    /* INPUT ROW */
    .input-row {
      display: flex;
      align-items: flex-end;
      gap: var(--space-sm);
    }

    #messageInput {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13px;
      resize: none;
      outline: none;
      min-height: 24px;
      max-height: 160px;
      padding: var(--space-xs) var(--space-sm);
      line-height: 1.5;
    }

    #messageInput::placeholder {
      color: var(--text-muted);
    }

    .input-actions {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      flex-shrink: 0;
    }

    .attach-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 6px;
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .attach-btn:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      color: var(--text-inverse);
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast);
      font-size: 14px;
    }

    .send-btn:hover:not(:disabled) {
      opacity: 0.9;
      transform: scale(1.02);
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* INPUT FOOTER */
    .input-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--space-xs);
      font-size: 10px;
      color: var(--text-muted);
    }

    .input-footer kbd {
      padding: 1px 4px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 9px;
    }

    /* =====================================================
       DROP ZONE
       ===================================================== */
    .drop-zone {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      border: 2px dashed var(--accent-primary);
      border-radius: var(--radius-lg);
    }

    .drop-zone.active {
      display: flex;
    }

    .drop-zone-content {
      text-align: center;
      color: var(--text-primary);
    }

    .drop-zone-icon {
      font-size: 48px;
      margin-bottom: var(--space-md);
    }

    .drop-zone-text {
      font-size: 14px;
      font-weight: 500;
    }

    .drop-zone-hint {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: var(--space-xs);
    }

    /* Hidden file input */
    #fileInput {
      display: none;
    }

    /* =====================================================
       SCROLLBAR
       ===================================================== */
    ::-webkit-scrollbar {
      width: 6px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--border-medium);
      border-radius: 3px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-strong);
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <!-- LEFT PANEL: Conversations List -->
    <div class="conversations-panel">
      <div class="conversations-header">
        <span class="conversations-title">Conversations</span>
        <button class="new-chat-btn" onclick="newChat()" title="New Chat">+</button>
      </div>
      <div class="conversations-list" id="conversationsList"></div>
    </div>

    <!-- RIGHT PANEL: Chat Area -->
    <div class="chat-panel" id="chatPanel">
      <div class="chat-header">
        <div class="chat-header-title">
          <span class="mode-icon" id="headerModeIcon">⚡</span>
          <span id="chatTitle">ARIA Assistant</span>
        </div>
      </div>

      <!-- Messages -->
      <div class="messages-container" id="messagesContainer">
        <div class="empty-state">
          <div class="empty-state-icon">⚡</div>
          <div class="empty-state-title">ARIA Assistant</div>
          <div class="empty-state-text">Start a new conversation with ARIA. Choose a mode below to customize how I interact with you.</div>
        </div>
      </div>

      <!-- Input Area with Mode Selector -->
      <div class="input-area">
        <div class="input-wrapper" id="inputWrapper">
          <!-- Mode Selector Row (Cursor-style) -->
          <div class="input-header">
            <div class="mode-selector" id="modeSelector">
              <button class="mode-option active agent" data-mode="agent" onclick="setMode('agent')">
                <span class="mode-icon">⚡</span>
                <span>Agent</span>
              </button>
              <button class="mode-option ask" data-mode="ask" onclick="setMode('ask')">
                <span class="mode-icon">💬</span>
                <span>Ask</span>
              </button>
              <button class="mode-option plan" data-mode="plan" onclick="setMode('plan')">
                <span class="mode-icon">📋</span>
                <span>Plan</span>
              </button>
              <button class="mode-option debug" data-mode="debug" onclick="setMode('debug')">
                <span class="mode-icon">🐛</span>
                <span>Debug</span>
              </button>
              <button class="mode-option research" data-mode="research" onclick="setMode('research')">
                <span class="mode-icon">🔬</span>
                <span>Research</span>
              </button>
            </div>
          </div>

          <!-- Attachments Row -->
          <div class="attachments-row" id="attachmentsRow"></div>

          <!-- Input Row -->
          <div class="input-row">
            <textarea
              id="messageInput"
              placeholder="Message ARIA..."
              rows="1"
              onkeydown="handleKeyDown(event)"
            ></textarea>
            <div class="input-actions">
              <button class="attach-btn" onclick="triggerFileUpload()" title="Attach files">
                📎
              </button>
              <button class="send-btn" onclick="sendMessage()" id="sendBtn" title="Send message">
                ➤
              </button>
            </div>
          </div>

          <!-- Input Footer -->
          <div class="input-footer">
            <span><kbd>@</kbd> mention • <kbd>⌘</kbd>+<kbd>↵</kbd> send</span>
            <span>Drop files to attach</span>
          </div>
        </div>
      </div>

      <!-- Drop Zone -->
      <div class="drop-zone" id="dropZone">
        <div class="drop-zone-content">
          <div class="drop-zone-icon">📁</div>
          <div class="drop-zone-text">Drop files to attach</div>
          <div class="drop-zone-hint">PDFs, images, documents, code files</div>
        </div>
      </div>
    </div>
  </div>

  <input type="file" id="fileInput" multiple accept="*/*" onchange="handleFileSelect(event)" />

  <script>
    const vscode = acquireVsCodeApi();
    let conversations = [];
    let activeConversationId = null;
    let currentMode = 'agent';
    let pendingAttachments = [];

    // Mode configurations
    const modes = {
      'agent': { icon: '⚡', name: 'Agent', color: 'var(--accent-agent)' },
      'ask': { icon: '💬', name: 'Ask', color: 'var(--accent-ask)' },
      'plan': { icon: '📋', name: 'Plan', color: 'var(--accent-plan)' },
      'debug': { icon: '🐛', name: 'Debug', color: 'var(--accent-debug)' },
      'research': { icon: '🔬', name: 'Research', color: 'var(--accent-research)' },
      'code-review': { icon: '👁️', name: 'Review', color: 'var(--accent-review)' },
    };

    function newChat() {
      vscode.postMessage({ type: 'newChat' });
    }

    function selectConversation(id) {
      vscode.postMessage({ type: 'selectConversation', conversationId: id });
    }

    function deleteConversation(id, event) {
      event.stopPropagation();
      vscode.postMessage({ type: 'deleteConversation', conversationId: id });
    }

    function setMode(mode) {
      currentMode = mode;

      // Update mode selector UI
      document.querySelectorAll('.mode-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === mode) {
          btn.classList.add('active');
        }
      });

      // Update header
      const modeConfig = modes[mode];
      document.getElementById('headerModeIcon').textContent = modeConfig.icon;

      // Notify extension
      if (activeConversationId) {
        vscode.postMessage({
          type: 'changeMode',
          mode,
          conversationId: activeConversationId
        });
      }
    }

    function triggerFileUpload() {
      document.getElementById('fileInput').click();
    }

    function handleFileSelect(event) {
      const files = event.target.files;
      if (files.length > 0) {
        processFiles(files);
      }
      event.target.value = ''; // Reset for same file selection
    }

    async function processFiles(fileList) {
      const files = Array.from(fileList);

      for (const file of files) {
        const attachment = {
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          type: file.type,
          size: file.size,
          status: 'uploading',
          content: null,
        };

        pendingAttachments.push(attachment);
        renderAttachments();

        // Read file content
        try {
          const content = await readFileContent(file);
          attachment.content = content;
          attachment.status = 'ready';
        } catch (error) {
          console.error('Error reading file:', error);
          attachment.status = 'failed';
        }

        renderAttachments();
      }
    }

    function readFileContent(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);

        // Read as text for text files, base64 for binary
        if (file.type.startsWith('text/') ||
            file.name.endsWith('.md') ||
            file.name.endsWith('.json') ||
            file.name.endsWith('.yaml') ||
            file.name.endsWith('.yml') ||
            file.name.endsWith('.ts') ||
            file.name.endsWith('.js') ||
            file.name.endsWith('.py') ||
            file.name.endsWith('.go') ||
            file.name.endsWith('.rs')) {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      });
    }

    function removeAttachment(id) {
      pendingAttachments = pendingAttachments.filter(a => a.id !== id);
      renderAttachments();
    }

    function renderAttachments() {
      const row = document.getElementById('attachmentsRow');
      row.innerHTML = pendingAttachments.map(att => \`
        <div class="attachment-badge \${att.status}">
          <span>📄</span>
          <span>\${att.name}</span>
          <button class="attachment-remove" onclick="removeAttachment('\${att.id}')">✕</button>
        </div>
      \`).join('');
    }

    function sendMessage() {
      const input = document.getElementById('messageInput');
      const message = input.value.trim();
      if (!message || !activeConversationId) return;

      // Get ready attachments
      const readyAttachments = pendingAttachments.filter(a => a.status === 'ready');

      vscode.postMessage({
        type: 'sendMessage',
        message: message,
        conversationId: activeConversationId,
        mode: currentMode,
        attachments: readyAttachments,
      });

      // Upload files to Carousel
      if (readyAttachments.length > 0) {
        vscode.postMessage({
          type: 'uploadFiles',
          files: readyAttachments,
          conversationId: activeConversationId,
        });
      }

      input.value = '';
      input.style.height = 'auto';
      pendingAttachments = [];
      renderAttachments();
    }

    function handleKeyDown(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendMessage();
      }
    }

    function formatMessage(text) {
      if (!text || typeof text !== 'string') return text || '';
      return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\`(.*?)\`/g, '<code>$1</code>')
        .replace(/• /g, '• ');
    }

    // Enhanced message formatter with markdown support
    function formatMessageContent(text) {
      if (!text || typeof text !== 'string') return text || '';
      // Handle newlines, bold, code, lists
      return text
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')  // Escape HTML
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
        .replace(/\`(.*?)\`/g, '<code>$1</code>')
        .replace(/^• /gm, '<span class="bullet">•</span> ')
        .replace(/^- /gm, '<span class="bullet">•</span> ')
        .replace(/^\\* /gm, '<span class="bullet">•</span> ')
        .replace(/\\n/g, '<br>');
    }

    function getRelativeTime(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'now';
      if (diffMins < 60) return diffMins + 'm';
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return diffHours + 'h';
      return Math.floor(diffHours / 24) + 'd';
    }

    function render() {
      // Render conversations list
      const listEl = document.getElementById('conversationsList');
      listEl.innerHTML = conversations.map(conv => {
        const modeConfig = modes[conv.mode || 'agent'];
        return \`
          <div class="conversation-item \${conv.id === activeConversationId ? 'active' : ''}"
               onclick="selectConversation('\${conv.id}')">
            <div class="conversation-item-header">
              <span class="conversation-title">\${conv.title}</span>
              <span class="conversation-time">\${getRelativeTime(conv.createdAt)}</span>
            </div>
            <span class="conversation-mode-badge">\${modeConfig.icon} \${modeConfig.name}</span>
            <button class="conversation-delete" onclick="deleteConversation('\${conv.id}', event)" title="Delete">
              🗑️
            </button>
          </div>
        \`;
      }).join('');

      // Render messages
      const messagesEl = document.getElementById('messagesContainer');
      const activeConv = conversations.find(c => c.id === activeConversationId);

      if (!activeConv || activeConv.messages.length === 0) {
        const modeConfig = modes[currentMode];
        messagesEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">\${modeConfig.icon}</div>
            <div class="empty-state-title">ARIA Assistant</div>
            <div class="empty-state-text">Start a conversation with ARIA in \${modeConfig.name} mode. Type a message below or drag files to attach.</div>
          </div>
        \`;
        return;
      }

      // Update mode from active conversation
      if (activeConv.mode && activeConv.mode !== currentMode) {
        setMode(activeConv.mode);
      }

      messagesEl.innerHTML = activeConv.messages.map(msg => {
        const modeConfig = modes[msg.mode || 'agent'];
        const attachmentsHtml = msg.attachments && msg.attachments.length > 0
          ? \`<div class="message-attachments">\${msg.attachments.map(a => \`<span class="attachment-chip">📄 \${a}</span>\`).join('')}</div>\`
          : '';

        return \`
          <div class="message \${msg.role}" data-message-id="\${msg.id}">
            <div class="message-avatar">
              \${msg.role === 'user' ? '👤' : modeConfig.icon}
            </div>
            <div class="message-bubble">
              <div class="message-header">
                <span class="message-sender">\${msg.role === 'user' ? 'You' : 'ARIA'}</span>
                \${msg.model ? \`<span class="message-model">\${msg.model}</span>\` : ''}
                \${msg.role === 'assistant' && msg.mode ? \`<span class="message-mode-tag \${msg.mode}">\${modeConfig.name}</span>\` : ''}
              </div>
              <div class="message-content">\${formatMessageContent(msg.content)}</div>
              \${attachmentsHtml}
            </div>
          </div>
        \`;
      }).join('');

      // Scroll to bottom
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Drag and drop handling
    const chatPanel = document.getElementById('chatPanel');
    const dropZone = document.getElementById('dropZone');

    chatPanel.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dropZone.classList.add('active');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (e.target === dropZone) {
        dropZone.classList.remove('active');
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('active');

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFiles(files);
      }
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        conversations = message.conversations;
        activeConversationId = message.activeConversationId;
        render();
      } else if (message.type === 'streamUpdate') {
        // Handle streaming token updates
        const conv = conversations.find(c => c.id === activeConversationId);
        if (conv) {
          const msg = conv.messages.find(m => m.id === message.messageId);
          if (msg) {
            msg.content = message.content;
            // Update just the message content in-place for smooth streaming
            const messageEl = document.querySelector(\`[data-message-id="\${message.messageId}"] .message-content\`);
            if (messageEl) {
              messageEl.innerHTML = formatMessageContent(message.content);
              // Scroll to bottom
              const messagesArea = document.getElementById('messagesArea');
              if (messagesArea) {
                messagesArea.scrollTop = messagesArea.scrollHeight;
              }
            } else {
              // Full re-render if element not found
              render();
            }
          }
        }
      }
    });

    // Auto-resize textarea
    document.getElementById('messageInput').addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 160) + 'px';
    });

    // Signal to extension that webview is ready
    console.log('ARIA Chat webview loaded, sending ready signal...');
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

type AriaMode = 'agent' | 'ask' | 'plan' | 'debug' | 'research' | 'code-review';

interface FileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string | null;
  status: 'uploading' | 'ready' | 'uploaded' | 'failed';
  carouselId?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  model: string;
  mode: AriaMode;
  attachments: FileAttachment[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  agentId?: string;
  model?: string;
  tier?: number;
  mode?: AriaMode;
  attachments?: string[];
}

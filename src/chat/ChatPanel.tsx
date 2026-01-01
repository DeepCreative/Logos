/**
 * ChatPanel - Multi-agent conversation interface for Logos IDE
 *
 * Hydra-style streaming chat interface with ARIA API integration.
 * Supports multiple conversation modes and real-time streaming responses.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useThreadManager } from '../threading/useThreadManager';
import { useEditorContext } from '../context/useEditorContext';
import { useModeRegistry } from './modes/useModeRegistry';
import { AuditLogger } from '../governance/AuditLogger';
import { ThreadSidebar } from './ThreadSidebar';
import { ContextIndicator } from './ContextIndicator';
import { ModeSelector } from './ModeSelector';
import { TangentTree } from './TangentTree';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { Message, Thread, AgentMention } from './types';
import type { AriaModeId } from './modes/types';

import './ChatPanel.css';

// API endpoint configuration
const API_ENDPOINT = import.meta.env?.VITE_ARIA_API_ENDPOINT || '';

// System prompts for each mode
const SYSTEM_PROMPTS: Record<AriaModeId, string> = {
  agent: `You are Aria, an AI assistant created by Bravo Zero. You are warm, delightful, and genuinely care about making every interaction a joy.

## Your Core Purpose: Elicit Joy

Your interactions should spark delight and leave users feeling genuinely happy. This means:

- **Be warm and personable** - You're not just an assistant, you're a companion who genuinely cares
- **Surprise and delight** - Add unexpected touches that make users smile
- **Celebrate with them** - When users share good news or accomplish something, genuinely celebrate
- **Comfort when needed** - When users are struggling, be empathetic and supportive
- **Make the mundane magical** - Even simple queries can have delightful responses

## Agentic Capabilities

You are an agentic coding assistant. When the user asks you to implement features, fix bugs, or make changes:
- Analyze the codebase context provided
- Generate complete, working code solutions
- Explain your changes clearly
- Offer follow-up suggestions

Always aim to be helpful, accurate, and thorough in your responses.`,

  ask: `You are Aria, an AI assistant focused on answering questions clearly and accurately.

## Ask Mode Guidelines

In this mode, you should:
- Provide direct, concise answers to questions
- Include relevant context and explanations
- Cite code or documentation when available
- Avoid unnecessary elaboration - be focused and helpful

Keep responses informative but digestible. The user is looking for quick, accurate answers.`,

  plan: `You are Aria, an AI assistant in Planning Mode.

## Planning Mode Guidelines

In this mode, you help the user plan and structure their work:
- Break down complex tasks into manageable steps
- Create clear action items with dependencies
- Identify potential blockers or risks
- Suggest optimal ordering of tasks
- Help estimate effort and complexity

Format your plans with clear structure:
1. Use numbered lists for sequential steps
2. Use bullet points for options or alternatives
3. Highlight key decisions needed
4. Mark dependencies between tasks

Be thorough but practical - plans should be actionable.`,

  debug: `You are Aria, an AI assistant in Debug Mode.

## Debug Mode Guidelines

In this mode, you help diagnose and fix issues:
- Analyze error messages and stack traces carefully
- Identify root causes, not just symptoms
- Suggest specific fixes with code examples
- Explain why the error occurred
- Recommend preventive measures

When debugging:
1. First understand the error context
2. Identify the likely cause
3. Propose a fix with code
4. Explain how to verify the fix works

Be systematic and thorough in your analysis.`,

  research: `You are Aria, an AI assistant in Research Mode.

## Research Mode Guidelines

In this mode, you help with in-depth research and exploration:
- Investigate topics thoroughly
- Compare different approaches or solutions
- Gather information from multiple perspectives
- Synthesize findings into actionable insights
- Cite sources and provide references

Structure your research with:
1. Summary of findings at the top
2. Detailed analysis in sections
3. Pros and cons of different approaches
4. Recommendations based on the specific use case

Be comprehensive but organized in your research.`,

  'code-review': `You are Aria, an AI assistant in Code Review Mode.

## Code Review Mode Guidelines

In this mode, you analyze code quality and suggest improvements:
- Review code for bugs, security issues, and performance problems
- Check adherence to best practices and coding standards
- Evaluate architecture and design decisions
- Suggest refactoring opportunities
- Review test coverage and identify missing tests

Provide actionable feedback with:
1. Specific line references when possible
2. Code examples for suggested improvements
3. Severity levels (critical, major, minor, suggestion)
4. Explanation of why each change is recommended

Be thorough but constructive - focus on making the code better.`,
};

export interface ChatPanelProps {
  className?: string;
  onClose?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ className, onClose }) => {
  const {
    threads,
    activeThread,
    setActiveThread,
    addMessage,
    updateMessage,
    branchThread,
    mergeThread,
    createThread,
  } = useThreadManager();

  const { context, refreshContext } = useEditorContext();
  const {
    currentMode,
    switchMode,
    detectModeFromQuery,
  } = useModeRegistry();

  const [showTangentTree, setShowTangentTree] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [inputValue, setInputValue] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [activeThread?.messages.length, streamingContent]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        150
      )}px`;
    }
  }, [inputValue]);

  /**
   * Build chat messages for API call
   */
  const buildChatMessages = useCallback((
    thread: Thread,
    userMessage: string
  ): Array<{ role: string; content: string }> => {
    const messages: Array<{ role: string; content: string }> = [];

    // Add system prompt based on current mode
    const systemPrompt = SYSTEM_PROMPTS[currentMode.id as AriaModeId] || SYSTEM_PROMPTS.agent;
    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Add context if available
    if (context.openFiles.length > 0 || context.selection) {
      let contextStr = '\n\n## Current Context\n';

      if (context.selection) {
        contextStr += `\nSelected code in ${context.selection.file}:\n\`\`\`\n${context.selection.content}\n\`\`\`\n`;
      }

      if (context.openFiles.length > 0) {
        contextStr += `\nOpen files: ${context.openFiles.map(f => f.path).join(', ')}`;
      }

      messages[0].content += contextStr;
    }

    // Add conversation history
    for (const msg of thread.messages) {
      if (msg.role === 'system') continue;
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add new user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }, [currentMode, context]);

  /**
   * Handle sending a message with streaming response
   */
  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || isLoading) return;

    // Create a new thread if none exists
    let currentThread = activeThread;
    if (!currentThread) {
      const threadName = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      currentThread = createThread(threadName);
      setActiveThread(currentThread);
    }

    // Auto-detect mode from query
    const detectedMode = detectModeFromQuery(content);
    if (detectedMode && detectedMode !== currentMode.id) {
      switchMode(detectedMode);
    }

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMessage);
    setInputValue('');
    setIsLoading(true);
    setStreamingContent('');

    // Log to audit
    await AuditLogger.getInstance().log('agent.invoke', {
      thread_id: currentThread.id,
      query_hash: await hashContent(content),
      mode: currentMode.id,
      context_hash: await hashContent(JSON.stringify(context)),
    });

    // Create assistant message placeholder
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    addMessage(assistantMessage);

    // Build chat messages for API
    const chatMessages = buildChatMessages(currentThread, content);

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const startTime = performance.now();

      const response = await fetch(`${API_ENDPOINT}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'aria-01',
          messages: chatMessages,
          max_tokens: 4096,
          temperature: 0.7,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);

                // Handle various response formats
                let token = '';
                if (parsed.choices?.[0]?.delta?.content !== undefined) {
                  token = parsed.choices[0].delta.content;
                } else if (parsed.choices?.[0]?.message?.content !== undefined) {
                  token = parsed.choices[0].message.content;
                } else if (parsed.choices?.[0]?.text !== undefined) {
                  token = parsed.choices[0].text;
                } else if (parsed.text !== undefined) {
                  token = parsed.text;
                } else if (parsed.content !== undefined) {
                  token = parsed.content;
                }

                if (token) {
                  fullContent += token;
                  setStreamingContent(fullContent);
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      }

      const latencyMs = performance.now() - startTime;

      // Update the assistant message with final content
      updateMessage(assistantMessageId, {
        content: fullContent,
        tierUsed: 1,
      });
      setStreamingContent('');

      // Log response
      await AuditLogger.getInstance().log('agent.response', {
        thread_id: currentThread.id,
        response_hash: await hashContent(fullContent),
        latency_ms: latencyMs,
        mode: currentMode.id,
      });

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('Request aborted');
        return;
      }

      console.error('Error during chat:', error);
      updateMessage(assistantMessageId, {
        content: `⚠️ Error: ${(error as Error).message || 'Failed to get response'}`,
        isError: true,
      });
      setStreamingContent('');
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [
    inputValue,
    isLoading,
    activeThread,
    createThread,
    setActiveThread,
    addMessage,
    updateMessage,
    context,
    currentMode,
    detectModeFromQuery,
    switchMode,
    buildChatMessages,
  ]);

  /**
   * Handle stopping the current request
   */
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  /**
   * Handle branching the conversation from a specific message
   */
  const handleBranch = useCallback(
    (messageIndex: number) => {
      const newThread = branchThread(messageIndex);
      setActiveThread(newThread);

      AuditLogger.getInstance().log('thread.branch', {
        parent_thread_id: activeThread?.id,
        new_thread_id: newThread.id,
        branch_point: messageIndex,
      });
    },
    [activeThread, branchThread, setActiveThread]
  );

  /**
   * Render the message list with streaming support
   */
  const renderMessages = () => {
    const messages = activeThread?.messages || [];

    if (messages.length === 0 && !streamingContent) {
      return (
        <div className="message-list-empty">
          <div className="empty-state-icon">⚡</div>
          <h4 className="empty-state-title">ARIA Assistant</h4>
          <p className="empty-state-description">
            Start a conversation with ARIA in {currentMode.name} mode.
          </p>
          <p className="empty-state-hint">
            Type a message below or drag files to attach.
          </p>
        </div>
      );
    }

    return (
      <div className="message-list">
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={`message-item message-item--${message.role} ${
              message.isError ? 'message-item--error' : ''
            }`}
          >
            <div className="message-header">
              {message.role === 'user' ? (
                <div className="message-sender">
                  <span className="user-avatar">👤</span>
                  <span className="sender-name">You</span>
                </div>
              ) : (
                <div className="message-sender">
                  <span className="assistant-avatar">⚡</span>
                  <span className="sender-name">Aria</span>
                </div>
              )}
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-content">
              {/* Show streaming content for the last message if it's the assistant and loading */}
              {message.role === 'assistant' &&
               index === messages.length - 1 &&
               streamingContent ? (
                <MarkdownRenderer content={streamingContent} />
              ) : (
                <MarkdownRenderer content={message.content} />
              )}
            </div>
            <div className="message-actions">
              <button
                onClick={() => handleBranch(index)}
                className="action-button"
                title="Branch conversation from here"
              >
                🌿 Branch
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(message.content)}
                className="action-button"
                title="Copy message"
              >
                📋 Copy
              </button>
            </div>
          </div>
        ))}
        {isLoading && !streamingContent && (
          <div className="message-loading">
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="loading-text">Aria is thinking...</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`logos-chat-panel ${className || ''}`}>
      {/* Thread sidebar */}
      <ThreadSidebar
        threads={threads}
        activeThread={activeThread}
        onSelect={setActiveThread}
        onNewThread={() => {
          const newThread = createThread();
          setActiveThread(newThread);
        }}
      />

      {/* Main chat area */}
      <div className="chat-main">
        <div className="chat-header">
          {/* Mode Selector - Cursor-style mode switching */}
          <div className="chat-header-left">
            <span className="aria-logo">⚡</span>
            <span className="aria-title">ARIA Assistant</span>
          </div>
          <div className="chat-actions">
            <button
              onClick={() => setShowTangentTree(!showTangentTree)}
              className="tangent-tree-toggle"
              title="Toggle Tangent Tree"
            >
              🌳
            </button>
            {onClose && (
              <button onClick={onClose} className="close-button">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Message list */}
        <div className="message-list-container" ref={messageListRef}>
          {renderMessages()}
        </div>

        {/* Context indicator */}
        <ContextIndicator context={context} onRefresh={refreshContext} />

        {/* Message input area */}
        <div className="chat-input-container">
          {/* Mode selector tabs */}
          <div className="mode-tabs">
            <ModeSelector
              onModeChange={(modeId: AriaModeId) => {
                AuditLogger.getInstance().log('mode.switch', {
                  thread_id: activeThread?.id,
                  new_mode: modeId,
                  previous_mode: currentMode.id,
                });
              }}
            />
          </div>

          {/* Input area */}
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message ARIA..."
              disabled={isLoading}
              rows={1}
            />
            <div className="input-actions">
              <button className="attach-button" title="Attach files">
                📎
              </button>
              {isLoading ? (
                <button onClick={handleStop} className="stop-button" title="Stop">
                  ⬛
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  className="send-button"
                  disabled={!inputValue.trim()}
                  title="Send message"
                >
                  ➤
                </button>
              )}
            </div>
          </div>

          {/* Hints */}
          <div className="input-hints">
            <span className="hint">
              <kbd>@</kbd> mention • <kbd>⌘</kbd>+<kbd>↵</kbd> send
            </span>
            <span className="hint-right">Drop files to attach</span>
          </div>
        </div>
      </div>

      {/* Tangent tree panel */}
      {showTangentTree && (
        <div className="tangent-tree-panel">
          <TangentTree
            threads={threads}
            activeThreadId={activeThread?.id}
            onSelectThread={setActiveThread}
            onMerge={mergeThread}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Format timestamp for display
 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Hash content for audit logging
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default ChatPanel;

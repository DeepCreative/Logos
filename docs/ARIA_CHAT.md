# ARIA Chat - Logos IDE AI Assistant

ARIA Chat is the integrated AI assistant for Logos IDE, providing multi-modal conversation capabilities with context-aware assistance for software development tasks.

## Overview

ARIA Chat offers a Cursor-style interface with multiple interaction modes, file attachment support, and deep integration with the BraveZero platform services.

## Features

### Two-Panel Layout

The chat interface consists of:

1. **Conversations Panel** (Left) - Lists all conversation threads with:
   - Conversation titles (auto-generated from first message)
   - Timestamps and relative time display
   - Mode badges (Agent, Ask, Debug, Research, etc.)
   - Quick delete option for each thread

2. **Chat Panel** (Right) - The active conversation showing:
   - Message history with role indicators
   - Real-time streaming responses
   - Mode-specific formatting
   - Attachment displays

### Conversation Modes

Switch between modes using the integrated mode selector in the input bar:

| Mode | Icon | Description |
|------|------|-------------|
| **Agent** | ⚡ | Full autonomous mode - can edit files, run commands, create files, and perform Git operations |
| **Ask** | 💬 | Information and explanation mode - answers questions without making changes |
| **Plan** | 📋 | Task planning mode - creates structured plans, breaks down tasks, estimates effort |
| **Debug** | 🗑️ | Debugging mode - analyzes errors, traces code paths, suggests fixes |
| **Research** | 🔬 | Research mode - powered by Athena for comprehensive web and documentation research |
| **Code Review** | 📝 | Review mode - analyzes code for quality, bugs, performance, and security |

### File Attachments

Drag and drop files directly into the chat for context:

- **Supported formats**: PDF, Word docs, images, text files, code files, JSON, YAML, Markdown
- **Processing**: Files are uploaded to Carousel for vector indexing
- **Context**: Attached files are automatically included as RAG context for ARIA responses

### Real-Time Streaming

Responses stream in real-time using Server-Sent Events (SSE):

- See tokens appear as they're generated
- Visual feedback during processing
- Graceful fallback for non-streaming responses

### Conversation Persistence

Conversations are automatically saved and restored:

- Stored in VS Code's `globalState` for local persistence
- Survives IDE restarts
- Export/Import functionality for backup

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+N` (Mac) / `Ctrl+Shift+N` (Win) | New Chat |
| `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Win) | Switch Mode |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |

## Commands

Available from Command Palette (`Cmd+Shift+P`):

- `logos.newChat` - Start a new conversation
- `logos.clearChat` - Clear current conversation
- `logos.switchMode` - Change ARIA mode
- `logos.exportConversations` - Export all conversations to JSON
- `logos.importConversations` - Import conversations from JSON file

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Logos IDE (Browser)                      │
├─────────────────────────────────────────────────────────────┤
│  logos-aria-chat Extension (VS Code Webview)                │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ Conversations   │  │ Chat Panel                       │  │
│  │ Panel           │  │ ┌─────────────────────────────┐  │  │
│  │                 │  │ │ Messages Area              │  │  │
│  │ • New Chat ⚡   │  │ │ ⚡ ARIA Agent               │  │  │
│  │ • Research 🔬   │  │ │ ...streaming response...   │  │  │
│  │ • Debug 🗑️     │  │ └─────────────────────────────┘  │  │
│  │                 │  │ ┌─────────────────────────────┐  │  │
│  │                 │  │ │ Input Bar + Mode Selector  │  │  │
│  └─────────────────┘  │ └─────────────────────────────┘  │  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    aria namespace (K8s)                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────┐    │
│  │ aria-gateway        │    │ athena-research-agent   │    │
│  │ (OpenAI-compatible) │    │ (Research Mode)         │    │
│  │ Port: 80            │    │ Port: 8082              │    │
│  └──────────┬──────────┘    └──────────┬──────────────┘    │
└─────────────┼───────────────────────────┼───────────────────┘
              │                           │
              ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                          │
├─────────────────────────────────────────────────────────────┤
│  • aria-inference (AI Oracle)                                │
│  • persona-api (Authentication)                              │
│  • carousel (Document Storage / RAG)                         │
│  • d3n-gateway (Flash Apps)                                  │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

The extension uses environment variables for backend configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `ARIA_GATEWAY_ENDPOINT` | `http://aria-gateway.aria.svc.cluster.local` | ARIA Gateway URL |
| `ATHENA_ENDPOINT` | `http://athena-research-agent.aria.svc.cluster.local:8082` | Athena Research URL |
| `CAROUSEL_ENDPOINT` | `http://carousel.carousel.svc.cluster.local` | Carousel Storage URL |

## API Integration

### ARIA Gateway

Standard chat completions use the OpenAI-compatible `/v1/chat/completions` endpoint:

```http
POST /v1/chat/completions
Content-Type: application/json
Accept: text/event-stream
X-Aria-Mode: agent

{
  "model": "aria-01",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true,
  "mode": "agent",
  "context": { "file": "/path/to/file.ts" },
  "attachments": ["carousel-doc-id-1", "carousel-doc-id-2"]
}
```

### Athena Research

Research mode uses Athena's research sessions API:

```http
POST /v1/research/sessions
Content-Type: application/json

{
  "query": "How does async/await work in JavaScript?",
  "depth": "comprehensive",
  "source_types": ["web", "internal", "academic"],
  "max_threads": 5
}
```

## Troubleshooting

### Chat not responding

1. Check if aria-gateway pods are running: `kubectl get pods -n aria`
2. Verify network connectivity to the gateway
3. Check browser console for errors

### File uploads failing

1. Verify Carousel service is running: `kubectl get pods -n carousel`
2. Check file size limits
3. Ensure the `logos-attachments` collection exists

### Research mode not working

1. Check Athena deployment: `kubectl get pods -n aria | grep athena`
2. Verify Athena secrets and config: `kubectl get secrets -n aria`
3. Check Athena logs: `kubectl logs deployment/athena-research-agent -n aria`

## Version History

- **v2.0.0** - Two-panel layout, mode selector, streaming, file attachments, Research mode
- **v1.0.0** - Initial release with basic chat functionality

## Related Documentation

- [ARIA Gateway Integration Guide](/aria-gateway/docs/INTEGRATION_GUIDE.md)
- [Athena Research Agent API](/Athena/docs/API.md)
- [Carousel Document Storage](/Carousel/docs/api.md)
- [Logos IDE Architecture](/Logos/docs/architecture.md)




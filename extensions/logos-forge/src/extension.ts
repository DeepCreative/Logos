import * as vscode from 'vscode';
import * as path from 'path';
import WebSocket from 'ws';

// Forge API client
class ForgeClient {
    private serverUrl: string;
    private bridgeUrl: string;
    private token: string | undefined;
    private ws: WebSocket | null = null;

    constructor() {
        const config = vscode.workspace.getConfiguration('logos-forge');
        this.serverUrl = config.get('serverUrl', 'https://forge.bravozero.ai');
        this.bridgeUrl = config.get('bridgeUrl', 'https://forge.bravozero.ai/api/v1/logos');
    }

    async initialize(): Promise<void> {
        // Get token from PERSONA auth
        const session = await vscode.authentication.getSession('persona', ['forge:read', 'forge:write'], { createIfNone: true });
        this.token = session?.accessToken;
    }

    async connectWebSocket(repoId: string): Promise<void> {
        if (this.ws) {
            this.ws.close();
        }

        const wsUrl = this.bridgeUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/connect?repo=' + repoId;
        this.ws = new WebSocket(wsUrl, {
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });

        this.ws.on('open', () => {
            console.log('Connected to Forge Bridge');
            this.sendHeartbeat();
        });

        this.ws.on('message', (data) => {
            const event = JSON.parse(data.toString());
            this.handleBridgeEvent(event);
        });

        this.ws.on('close', () => {
            console.log('Disconnected from Forge Bridge');
            // Reconnect after delay
            setTimeout(() => this.connectWebSocket(repoId), 5000);
        });
    }

    private sendHeartbeat(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'heartbeat' }));
            setTimeout(() => this.sendHeartbeat(), 30000);
        }
    }

    private handleBridgeEvent(event: any): void {
        switch (event.type) {
            case 'pr_updated':
                vscode.window.showInformationMessage(`PR #${event.data.number} updated: ${event.data.title}`);
                break;
            case 'ci_status':
                this.updateCIStatus(event.data);
                break;
            case 'review_completed':
                vscode.window.showInformationMessage(`Code review completed for ${event.data.repository}`);
                break;
            case 'agent_action':
                this.handleAgentAction(event.data);
                break;
        }
    }

    private updateCIStatus(data: any): void {
        // Update CI status in status bar and gutter
        forgeStatusBar.updateCI(data.status);
    }

    private handleAgentAction(data: any): void {
        vscode.window.showInformationMessage(`Agent action: ${data.description}`, 'View', 'Dismiss')
            .then(selection => {
                if (selection === 'View') {
                    vscode.commands.executeCommand('logos-forge.viewAgentAction', data.id);
                }
            });
    }

    async getRepository(owner: string, repo: string): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/v1/repos/${owner}/${repo}`, {
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/json'
            }
        });
        return response.json();
    }

    async listPullRequests(owner: string, repo: string, state: string = 'open'): Promise<any[]> {
        const response = await fetch(`${this.serverUrl}/api/v1/repos/${owner}/${repo}/pulls?state=${state}`, {
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/json'
            }
        });
        return response.json();
    }

    async createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body: string): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/v1/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, head, base, body })
        });
        return response.json();
    }

    async requestReview(repository: string, prNumber: number, sha: string): Promise<any> {
        const response = await fetch(`${this.bridgeUrl.replace('/logos', '/review')}/request`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ repository, pr_number: prNumber, sha })
        });
        return response.json();
    }

    async requestAgentAction(type: string, repository: string, file: string, description: string): Promise<any> {
        const response = await fetch(`${this.bridgeUrl}/agent/request`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                agent_id: `${type}_agent`,
                type,
                repository,
                target_file: file,
                description
            })
        });
        return response.json();
    }

    async getCIStatus(owner: string, repo: string, ref: string): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/v1/repos/${owner}/${repo}/commits/${ref}/status`, {
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/json'
            }
        });
        return response.json();
    }

    async triggerWorkflow(owner: string, repo: string, workflow: string, ref: string): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/v1/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ref })
        });
        return response.json();
    }

    async syncWorkspace(state: any): Promise<void> {
        await fetch(`${this.bridgeUrl}/workspace/sync`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state)
        });
    }
}

// Status bar item
class ForgeStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private ciStatus: string = 'unknown';

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'logos-forge.viewCIStatus';
        this.update();
        this.statusBarItem.show();
    }

    update(): void {
        const icon = this.ciStatus === 'success' ? '$(check)' :
                     this.ciStatus === 'failure' ? '$(x)' :
                     this.ciStatus === 'pending' ? '$(clock)' : '$(dash)';
        this.statusBarItem.text = `${icon} Forge`;
        this.statusBarItem.tooltip = `Forge CI Status: ${this.ciStatus}`;
    }

    updateCI(status: string): void {
        this.ciStatus = status;
        this.update();
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

// Tree data providers
class PullRequestsProvider implements vscode.TreeDataProvider<PRItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PRItem | undefined> = new vscode.EventEmitter<PRItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<PRItem | undefined> = this._onDidChangeTreeData.event;

    constructor(private forgeClient: ForgeClient, private repoInfo: { owner: string; repo: string } | null) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: PRItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PRItem): Promise<PRItem[]> {
        if (!this.repoInfo) {
            return [];
        }

        if (!element) {
            try {
                const prs = await this.forgeClient.listPullRequests(this.repoInfo.owner, this.repoInfo.repo);
                return prs.map(pr => new PRItem(
                    `#${pr.number} ${pr.title}`,
                    pr.state,
                    vscode.TreeItemCollapsibleState.None,
                    pr
                ));
            } catch {
                return [];
            }
        }
        return [];
    }
}

class PRItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly state: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly pr: any
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.pr.title}\n${this.pr.body || 'No description'}`;
        this.iconPath = new vscode.ThemeIcon(state === 'open' ? 'git-pull-request' : 'git-merge');
        this.contextValue = 'pullRequest';
        this.command = {
            command: 'logos-forge.viewPR',
            title: 'View Pull Request',
            arguments: [this.pr]
        };
    }
}

// Global instances
let forgeClient: ForgeClient;
let forgeStatusBar: ForgeStatusBar;
let prProvider: PullRequestsProvider;

// Extension activation
export async function activate(context: vscode.ExtensionContext) {
    console.log('Logos Forge extension is now active');

    // Initialize client
    forgeClient = new ForgeClient();
    await forgeClient.initialize();

    // Initialize status bar
    forgeStatusBar = new ForgeStatusBar();
    context.subscriptions.push({ dispose: () => forgeStatusBar.dispose() });

    // Get repo info from git
    const repoInfo = await getRepositoryInfo();

    // Initialize tree view
    prProvider = new PullRequestsProvider(forgeClient, repoInfo);
    vscode.window.registerTreeDataProvider('forge.pullRequests', prProvider);

    // Connect WebSocket if repo detected
    if (repoInfo) {
        forgeClient.connectWebSocket(`${repoInfo.owner}/${repoInfo.repo}`);
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('logos-forge.openInForge', openInForge),
        vscode.commands.registerCommand('logos-forge.createPR', createPullRequest),
        vscode.commands.registerCommand('logos-forge.viewPR', viewPullRequest),
        vscode.commands.registerCommand('logos-forge.requestReview', requestARIAReview),
        vscode.commands.registerCommand('logos-forge.triggerAction', triggerAction),
        vscode.commands.registerCommand('logos-forge.viewCIStatus', viewCIStatus),
        vscode.commands.registerCommand('logos-forge.syncWorkspace', syncWorkspace),
        vscode.commands.registerCommand('logos-forge.agentFix', requestAgentFix)
    );

    // Auto-sync workspace
    const config = vscode.workspace.getConfiguration('logos-forge');
    if (config.get('autoSync', true) && repoInfo) {
        setInterval(() => syncWorkspaceState(repoInfo), 60000);
    }
}

async function getRepositoryInfo(): Promise<{ owner: string; repo: string } | null> {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        return null;
    }

    const api = gitExtension.getAPI(1);
    const repo = api.repositories[0];
    if (!repo) {
        return null;
    }

    const remote = repo.state.remotes.find((r: any) => r.name === 'origin');
    if (!remote) {
        return null;
    }

    // Parse remote URL
    const url = remote.fetchUrl || remote.pushUrl;
    const match = url.match(/[:/]([^/]+)\/([^/.]+)/);
    if (!match) {
        return null;
    }

    return { owner: match[1], repo: match[2] };
}

async function openInForge(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    const config = vscode.workspace.getConfiguration('logos-forge');
    const serverUrl = config.get('serverUrl', 'https://forge.bravozero.ai');

    const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
    const line = editor.selection.active.line + 1;

    const url = `${serverUrl}/${repoInfo.owner}/${repoInfo.repo}/src/branch/main/${relativePath}#L${line}`;
    vscode.env.openExternal(vscode.Uri.parse(url));
}

async function createPullRequest(): Promise<void> {
    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    const title = await vscode.window.showInputBox({
        prompt: 'Pull Request Title',
        placeHolder: 'Enter a title for your PR'
    });

    if (!title) {
        return;
    }

    const body = await vscode.window.showInputBox({
        prompt: 'Pull Request Description',
        placeHolder: 'Enter a description (optional)'
    });

    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const api = gitExtension.getAPI(1);
    const repo = api.repositories[0];
    const currentBranch = repo.state.HEAD?.name || 'main';

    try {
        const pr = await forgeClient.createPullRequest(
            repoInfo.owner,
            repoInfo.repo,
            title,
            currentBranch,
            'main',
            body || ''
        );

        vscode.window.showInformationMessage(`Created PR #${pr.number}`, 'Open in Forge')
            .then(selection => {
                if (selection === 'Open in Forge') {
                    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
                }
            });

        prProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create PR: ${error}`);
    }
}

async function viewPullRequest(pr: any): Promise<void> {
    if (pr?.html_url) {
        vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
    }
}

async function requestARIAReview(): Promise<void> {
    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const api = gitExtension.getAPI(1);
    const repo = api.repositories[0];
    const sha = repo.state.HEAD?.commit;

    // Get PR number if on a PR branch
    const prs = await forgeClient.listPullRequests(repoInfo.owner, repoInfo.repo);
    const currentBranch = repo.state.HEAD?.name;
    const pr = prs.find(p => p.head === currentBranch);

    if (!pr) {
        vscode.window.showWarningMessage('No pull request found for current branch. Create a PR first.');
        return;
    }

    try {
        const review = await forgeClient.requestReview(
            `${repoInfo.owner}/${repoInfo.repo}`,
            pr.number,
            sha
        );

        vscode.window.showInformationMessage(`ARIA code review started: ${review.id}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to request review: ${error}`);
    }
}

async function triggerAction(): Promise<void> {
    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    const workflow = await vscode.window.showInputBox({
        prompt: 'Workflow name',
        placeHolder: 'e.g., ci.yml'
    });

    if (!workflow) {
        return;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const api = gitExtension.getAPI(1);
    const repo = api.repositories[0];
    const branch = repo.state.HEAD?.name || 'main';

    try {
        await forgeClient.triggerWorkflow(repoInfo.owner, repoInfo.repo, workflow, branch);
        vscode.window.showInformationMessage(`Triggered workflow: ${workflow}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to trigger workflow: ${error}`);
    }
}

async function viewCIStatus(): Promise<void> {
    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const api = gitExtension.getAPI(1);
    const repo = api.repositories[0];
    const sha = repo.state.HEAD?.commit;

    try {
        const status = await forgeClient.getCIStatus(repoInfo.owner, repoInfo.repo, sha);

        const items = status.statuses.map((s: any) => ({
            label: `${s.state === 'success' ? '✓' : s.state === 'failure' ? '✗' : '○'} ${s.context}`,
            description: s.description,
            detail: s.target_url
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `CI Status: ${status.state}`
        });

        if (selected?.detail) {
            vscode.env.openExternal(vscode.Uri.parse(selected.detail));
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get CI status: ${error}`);
    }
}

async function syncWorkspace(): Promise<void> {
    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    await syncWorkspaceState(repoInfo);
    vscode.window.showInformationMessage('Synced with Forge');
}

async function syncWorkspaceState(repoInfo: { owner: string; repo: string }): Promise<void> {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const api = gitExtension.getAPI(1);
    const repo = api.repositories[0];

    const state = {
        repository_id: `${repoInfo.owner}/${repoInfo.repo}`,
        current_branch: repo.state.HEAD?.name,
        head_commit: repo.state.HEAD?.commit,
        dirty_files: repo.state.workingTreeChanges.map((c: any) => c.uri.fsPath),
        active_file: vscode.window.activeTextEditor?.document.uri.fsPath
    };

    await forgeClient.syncWorkspace(state);
}

async function requestAgentFix(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const repoInfo = await getRepositoryInfo();
    if (!repoInfo) {
        vscode.window.showErrorMessage('Could not determine repository');
        return;
    }

    const fixType = await vscode.window.showQuickPick([
        { label: 'Lint Fix', value: 'lint_fix' },
        { label: 'Security Patch', value: 'security_patch' },
        { label: 'Refactor', value: 'refactor' },
        { label: 'Add Tests', value: 'add_tests' }
    ], {
        placeHolder: 'Select fix type'
    });

    if (!fixType) {
        return;
    }

    const relativePath = vscode.workspace.asRelativePath(editor.document.uri);

    try {
        const action = await forgeClient.requestAgentAction(
            fixType.value,
            `${repoInfo.owner}/${repoInfo.repo}`,
            relativePath,
            `${fixType.label} for ${relativePath}`
        );

        vscode.window.showInformationMessage(`Agent action started: ${action.id}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to request agent fix: ${error}`);
    }
}

export function deactivate() {
    console.log('Logos Forge extension deactivated');
}


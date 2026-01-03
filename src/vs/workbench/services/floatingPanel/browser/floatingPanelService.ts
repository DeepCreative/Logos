/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Bravo Zero, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IAuxiliaryWindowService, IAuxiliaryWindow, IAuxiliaryWindowOpenOptions } from '../../auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Dimension } from '../../../../base/browser/dom.js';

export const IFloatingPanelService = createDecorator<IFloatingPanelService>('floatingPanelService');

export interface IFloatingPanel extends IDisposable {
	readonly id: string;
	readonly viewId: string;
	readonly window: IAuxiliaryWindow;
	readonly container: HTMLElement;

	bringToFront(): void;
	close(): void;
}

export interface IFloatingPanelOpenOptions extends IAuxiliaryWindowOpenOptions {
	readonly viewId: string;
	readonly title?: string;
}

export interface IFloatingPanelService {
	readonly _serviceBrand: undefined;

	readonly onDidOpenFloatingPanel: Event<IFloatingPanel>;
	readonly onDidCloseFloatingPanel: Event<IFloatingPanel>;

	openFloatingPanel(options: IFloatingPanelOpenOptions): Promise<IFloatingPanel>;
	closeFloatingPanel(panelId: string): void;
	getFloatingPanel(panelId: string): IFloatingPanel | undefined;
	getFloatingPanelByViewId(viewId: string): IFloatingPanel | undefined;
	getAllFloatingPanels(): IFloatingPanel[];

	isViewFloating(viewId: string): boolean;
	dockFloatingPanel(panelId: string, location: ViewContainerLocation): void;
}

class FloatingPanel extends Disposable implements IFloatingPanel {
	private static _idCounter = 0;

	readonly id: string;

	constructor(
		readonly viewId: string,
		readonly window: IAuxiliaryWindow,
		readonly container: HTMLElement,
		private readonly onCloseCallback: () => void
	) {
		super();

		this.id = `floating-panel-${FloatingPanel._idCounter++}`;

		this._register(window.onUnload(() => {
			this.onCloseCallback();
		}));
	}

	bringToFront(): void {
		this.window.window.focus();
	}

	close(): void {
		this.dispose();
	}

	override dispose(): void {
		this.window.dispose();
		super.dispose();
	}
}

export class FloatingPanelService extends Disposable implements IFloatingPanelService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidOpenFloatingPanel = this._register(new Emitter<IFloatingPanel>());
	readonly onDidOpenFloatingPanel = this._onDidOpenFloatingPanel.event;

	private readonly _onDidCloseFloatingPanel = this._register(new Emitter<IFloatingPanel>());
	readonly onDidCloseFloatingPanel = this._onDidCloseFloatingPanel.event;

	private readonly floatingPanels = new Map<string, FloatingPanel>();
	private readonly floatingPanelsByViewId = new Map<string, FloatingPanel>();

	constructor(
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService
	) {
		super();
	}

	async openFloatingPanel(options: IFloatingPanelOpenOptions): Promise<IFloatingPanel> {
		const { viewId, title, ...windowOptions } = options;

		// Check if already floating
		const existing = this.floatingPanelsByViewId.get(viewId);
		if (existing) {
			existing.bringToFront();
			return existing;
		}

		// Open auxiliary window
		const auxiliaryWindow = await this.auxiliaryWindowService.open({
			...windowOptions,
			bounds: windowOptions.bounds ?? { width: 400, height: 300 }
		});

		// Create floating panel
		const panel = new FloatingPanel(
			viewId,
			auxiliaryWindow,
			auxiliaryWindow.container,
			() => this.handlePanelClosed(panel)
		);

		// Register panel
		this.floatingPanels.set(panel.id, panel);
		this.floatingPanelsByViewId.set(viewId, panel);

		this._onDidOpenFloatingPanel.fire(panel);

		return panel;
	}

	private handlePanelClosed(panel: FloatingPanel): void {
		this.floatingPanels.delete(panel.id);
		this.floatingPanelsByViewId.delete(panel.viewId);
		this._onDidCloseFloatingPanel.fire(panel);
	}

	closeFloatingPanel(panelId: string): void {
		const panel = this.floatingPanels.get(panelId);
		if (panel) {
			panel.close();
		}
	}

	getFloatingPanel(panelId: string): IFloatingPanel | undefined {
		return this.floatingPanels.get(panelId);
	}

	getFloatingPanelByViewId(viewId: string): IFloatingPanel | undefined {
		return this.floatingPanelsByViewId.get(viewId);
	}

	getAllFloatingPanels(): IFloatingPanel[] {
		return Array.from(this.floatingPanels.values());
	}

	isViewFloating(viewId: string): boolean {
		return this.floatingPanelsByViewId.has(viewId);
	}

	dockFloatingPanel(panelId: string, location: ViewContainerLocation): void {
		const panel = this.floatingPanels.get(panelId);
		if (!panel) {
			return;
		}

		const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(panel.viewId);
		if (viewDescriptor && viewDescriptor.canMoveView) {
			this.viewDescriptorService.moveViewToLocation(viewDescriptor, location, 'dock');
		}

		panel.close();
	}
}

registerSingleton(IFloatingPanelService, FloatingPanelService, InstantiationType.Delayed);


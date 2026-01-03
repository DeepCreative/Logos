/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Bravo Zero, Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IFloatingPanelService } from '../../../services/floatingPanel/browser/floatingPanelService.js';
import { ViewContainerLocation, IViewDescriptorService, IViewsService } from '../../../common/views.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';

const FLOAT_VIEW_COMMAND_ID = 'workbench.action.floatView';
const DOCK_VIEW_SIDEBAR_COMMAND_ID = 'workbench.action.dockViewToSidebar';
const DOCK_VIEW_PANEL_COMMAND_ID = 'workbench.action.dockViewToPanel';
const DOCK_VIEW_AUXILIARYBAR_COMMAND_ID = 'workbench.action.dockViewToAuxiliaryBar';

export class FloatViewAction extends Action2 {
	constructor() {
		super({
			id: FLOAT_VIEW_COMMAND_ID,
			title: localize2('floatView', 'Float View'),
			category: localize2('view', 'View'),
			f1: true,
			menu: [{
				id: MenuId.ViewTitleContext,
				order: 100,
				group: 'layout'
			}, {
				id: MenuId.ViewContainerTitleContext,
				order: 100,
				group: 'layout'
			}]
		});
	}

	async run(accessor: ServicesAccessor, viewId?: string): Promise<void> {
		const floatingPanelService = accessor.get(IFloatingPanelService);
		const viewsService = accessor.get(IViewsService);
		const viewDescriptorService = accessor.get(IViewDescriptorService);

		if (!viewId) {
			// Get the focused view if no viewId provided
			const focusedView = viewsService.getFocusedViewName();
			if (focusedView) {
				// Try to resolve the view ID from the focused view
				return;
			}
			return;
		}

		const viewDescriptor = viewDescriptorService.getViewDescriptorById(viewId);
		if (!viewDescriptor) {
			return;
		}

		// Check if already floating
		if (floatingPanelService.isViewFloating(viewId)) {
			const panel = floatingPanelService.getFloatingPanelByViewId(viewId);
			panel?.bringToFront();
			return;
		}

		// Open as floating panel
		await floatingPanelService.openFloatingPanel({
			viewId,
			title: typeof viewDescriptor.name === 'string' ? viewDescriptor.name : viewDescriptor.name.value,
			bounds: { width: 500, height: 400 }
		});
	}
}

export class DockViewToSidebarAction extends Action2 {
	constructor() {
		super({
			id: DOCK_VIEW_SIDEBAR_COMMAND_ID,
			title: localize2('dockViewToSidebar', 'Move View to Sidebar'),
			category: localize2('view', 'View'),
			f1: true,
			menu: [{
				id: MenuId.ViewTitleContext,
				order: 101,
				group: 'layout'
			}]
		});
	}

	run(accessor: ServicesAccessor, viewId?: string): void {
		if (!viewId) {
			return;
		}

		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const floatingPanelService = accessor.get(IFloatingPanelService);

		// If floating, dock it
		const floatingPanel = floatingPanelService.getFloatingPanelByViewId(viewId);
		if (floatingPanel) {
			floatingPanelService.dockFloatingPanel(floatingPanel.id, ViewContainerLocation.Sidebar);
			return;
		}

		// Otherwise move via view descriptor service
		const viewDescriptor = viewDescriptorService.getViewDescriptorById(viewId);
		if (viewDescriptor?.canMoveView) {
			viewDescriptorService.moveViewToLocation(viewDescriptor, ViewContainerLocation.Sidebar, 'dock');
		}
	}
}

export class DockViewToPanelAction extends Action2 {
	constructor() {
		super({
			id: DOCK_VIEW_PANEL_COMMAND_ID,
			title: localize2('dockViewToPanel', 'Move View to Panel'),
			category: localize2('view', 'View'),
			f1: true,
			menu: [{
				id: MenuId.ViewTitleContext,
				order: 102,
				group: 'layout'
			}]
		});
	}

	run(accessor: ServicesAccessor, viewId?: string): void {
		if (!viewId) {
			return;
		}

		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const floatingPanelService = accessor.get(IFloatingPanelService);

		// If floating, dock it
		const floatingPanel = floatingPanelService.getFloatingPanelByViewId(viewId);
		if (floatingPanel) {
			floatingPanelService.dockFloatingPanel(floatingPanel.id, ViewContainerLocation.Panel);
			return;
		}

		// Otherwise move via view descriptor service
		const viewDescriptor = viewDescriptorService.getViewDescriptorById(viewId);
		if (viewDescriptor?.canMoveView) {
			viewDescriptorService.moveViewToLocation(viewDescriptor, ViewContainerLocation.Panel, 'dock');
		}
	}
}

export class DockViewToAuxiliaryBarAction extends Action2 {
	constructor() {
		super({
			id: DOCK_VIEW_AUXILIARYBAR_COMMAND_ID,
			title: localize2('dockViewToSecondaryBar', 'Move View to Secondary Side Bar'),
			category: localize2('view', 'View'),
			f1: true,
			menu: [{
				id: MenuId.ViewTitleContext,
				order: 103,
				group: 'layout'
			}]
		});
	}

	run(accessor: ServicesAccessor, viewId?: string): void {
		if (!viewId) {
			return;
		}

		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const floatingPanelService = accessor.get(IFloatingPanelService);

		// If floating, dock it
		const floatingPanel = floatingPanelService.getFloatingPanelByViewId(viewId);
		if (floatingPanel) {
			floatingPanelService.dockFloatingPanel(floatingPanel.id, ViewContainerLocation.AuxiliaryBar);
			return;
		}

		// Otherwise move via view descriptor service
		const viewDescriptor = viewDescriptorService.getViewDescriptorById(viewId);
		if (viewDescriptor?.canMoveView) {
			viewDescriptorService.moveViewToLocation(viewDescriptor, ViewContainerLocation.AuxiliaryBar, 'dock');
		}
	}
}

// Register all actions
registerAction2(FloatViewAction);
registerAction2(DockViewToSidebarAction);
registerAction2(DockViewToPanelAction);
registerAction2(DockViewToAuxiliaryBarAction);


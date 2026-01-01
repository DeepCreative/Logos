/**
 * ModeSelector - UI component for selecting Aria modes
 *
 * Displays mode tabs for switching between Agent, Ask, Plan, Debug,
 * and Research modes - similar to Hydra's Cursor-style interface.
 */

import React, { useCallback } from 'react';
import { useModeRegistry } from './modes/useModeRegistry';
import type { AriaModeId, AriaModeConfig } from './modes/types';

import './ModeSelector.css';

export interface ModeSelectorProps {
  className?: string;
  disabled?: boolean;
  onModeChange?: (modeId: AriaModeId) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  className,
  disabled = false,
  onModeChange,
}) => {
  const { modes, currentMode, switchMode } = useModeRegistry();

  const handleModeSelect = useCallback(
    (modeId: AriaModeId) => {
      if (disabled) return;
      switchMode(modeId, 'user');
      onModeChange?.(modeId);
    },
    [switchMode, onModeChange, disabled]
  );

  return (
    <div className={`logos-mode-tabs ${className || ''} ${disabled ? 'disabled' : ''}`}>
      {modes.map((mode) => (
        <ModeTab
          key={mode.id}
          mode={mode}
          isSelected={mode.id === currentMode.id}
          onSelect={() => handleModeSelect(mode.id)}
          disabled={disabled}
        />
      ))}
    </div>
  );
};

interface ModeTabProps {
  mode: AriaModeConfig;
  isSelected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

const ModeTab: React.FC<ModeTabProps> = ({
  mode,
  isSelected,
  onSelect,
  disabled,
}) => {
  return (
    <button
      className={`mode-tab ${isSelected ? 'mode-tab--active' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      title={`${mode.description}${mode.shortcut ? ` (${mode.shortcut})` : ''}`}
    >
      <span className="mode-tab-icon" style={{ color: isSelected ? mode.color : undefined }}>
        {mode.icon}
      </span>
      <span className="mode-tab-label">{mode.displayName}</span>
    </button>
  );
};

/**
 * Compact mode indicator for space-constrained layouts
 */
export const ModeIndicator: React.FC<{
  className?: string;
  onClick?: () => void;
}> = ({ className, onClick }) => {
  const { currentMode } = useModeRegistry();

  return (
    <div
      className={`logos-mode-indicator ${className || ''}`}
      onClick={onClick}
      style={{ borderColor: currentMode.color }}
      title={`Mode: ${currentMode.displayName}`}
    >
      <span className="indicator-icon" style={{ color: currentMode.color }}>
        {currentMode.icon}
      </span>
      <span className="indicator-label">{currentMode.displayName}</span>
    </div>
  );
};

export default ModeSelector;

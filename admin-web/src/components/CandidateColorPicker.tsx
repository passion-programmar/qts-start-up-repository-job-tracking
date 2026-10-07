'use client';

import {
  CANDIDATE_NAME_COLORS,
  normalizeCandidateColor,
  type CandidateColor,
} from '../../shared/candidate-colors';

export function CandidateColorPicker({
  value,
  onChange,
  previewName = '',
  fallbackIndex = 0,
}: {
  value: string;
  onChange: (color: CandidateColor) => void;
  previewName?: string;
  fallbackIndex?: number;
}) {
  const selected = normalizeCandidateColor(value, fallbackIndex);
  const displayName = previewName.trim() || 'Candidate name';

  return (
    <div className="color-picker" role="radiogroup" aria-label="Name color">
      <div className="color-picker-swatches">
        {CANDIDATE_NAME_COLORS.map((option) => {
          const active = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              title={option.label}
              className={`color-picker-swatch${active ? ' is-selected' : ''}`}
              style={{ backgroundColor: option.value }}
              onClick={() => onChange(option.value)}
            />
          );
        })}
      </div>
      <div className="color-picker-preview">
        <span className="color-picker-preview-swatch" style={{ backgroundColor: selected }} />
        <span
          className={`color-picker-preview-name${previewName.trim() ? '' : ' is-placeholder'}`}
          style={previewName.trim() ? { color: selected } : undefined}
        >
          {displayName}
        </span>
      </div>
    </div>
  );
}

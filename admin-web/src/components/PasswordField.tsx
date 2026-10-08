'use client';

import { useState } from 'react';

export function PasswordField({
  value,
  onChange,
  placeholder,
  id,
  readOnly = false,
  required,
  minLength,
  maxLength,
  autoComplete,
}: {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  id?: string;
  readOnly?: boolean;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        id={id}
        key={visible ? 'visible' : 'hidden'}
        type={visible ? 'text' : 'password'}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
        onChange={readOnly ? undefined : (e) => onChange?.(e.target.value)}
      />
      <button
        type="button"
        className="password-field-toggle"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  );
}

export function PasswordReveal({
  password,
  emptyLabel = '—',
}: {
  password?: string | null;
  emptyLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  const hasPassword = Boolean(password);

  return (
    <div className="password-reveal">
      <span className="password-reveal-value">
        {hasPassword ? (visible ? password : '••••••••') : emptyLabel}
      </span>
      {hasPassword && (
        <button
          type="button"
          className="password-field-toggle password-field-toggle--inline"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? '🙈' : '👁'}
        </button>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';

export function PasswordField({
  value,
  onChange,
  placeholder,
  id,
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  id?: string;
  readOnly?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
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

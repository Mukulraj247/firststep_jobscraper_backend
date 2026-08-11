import React, { useMemo, useState } from 'react';
import {
  MAX_AUTOMATION_TAGS,
  TAG_CATALOG,
} from '../../../../src/constants/tagCatalog';

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
};

/**
 * Lightweight tag multi-select for the Chrome extension sidepanel
 * (plain HTML selects — no MUI).
 */
export const ExtensionTagPicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [namespace, setNamespace] = useState(TAG_CATALOG[0]?.namespace || 'role');
  const currentNs = useMemo(
    () => TAG_CATALOG.find((n) => n.namespace === namespace) || TAG_CATALOG[0],
    [namespace]
  );

  const addTag = (rawValue: string) => {
    if (!rawValue || !currentNs) return;
    const tag = `${currentNs.namespace}:${rawValue}`;
    if (value.includes(tag)) return;
    if (value.length >= MAX_AUTOMATION_TAGS) return;
    onChange([...value, tag]);
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        Tags (max {MAX_AUTOMATION_TAGS})
      </label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <select
          value={namespace}
          disabled={disabled || value.length >= MAX_AUTOMATION_TAGS}
          onChange={(e) => setNamespace(e.target.value as any)}
          style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
        >
          {TAG_CATALOG.map((ns) => (
            <option key={ns.namespace} value={ns.namespace}>
              {ns.label}
            </option>
          ))}
        </select>
        <select
          disabled={disabled || value.length >= MAX_AUTOMATION_TAGS}
          defaultValue=""
          key={`${namespace}-${value.length}`}
          onChange={(e) => {
            addTag(e.target.value);
            e.target.value = '';
          }}
          style={{ flex: 2, fontSize: 12, padding: '4px 6px' }}
        >
          <option value="">Add tag…</option>
          {(currentNs?.values || []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {value.map((tag) => (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => removeTag(tag)}
            title="Remove tag"
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            {tag} ×
          </button>
        ))}
      </div>
    </div>
  );
};

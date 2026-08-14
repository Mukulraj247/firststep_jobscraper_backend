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

const TAG_PLACEHOLDER = 'e.g. fortune 500, Seattle, tech, sponsorship';

/**
 * Lightweight tag multi-select for the Chrome extension sidepanel
 * (plain HTML — no MUI). Type-to-filter + View all tags modal.
 */
export const ExtensionTagPicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [namespace, setNamespace] = useState(TAG_CATALOG[0]?.namespace || 'role');
  const [valueFilter, setValueFilter] = useState('');
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [modalFilter, setModalFilter] = useState('');

  const currentNs = useMemo(
    () => TAG_CATALOG.find((n) => n.namespace === namespace) || TAG_CATALOG[0],
    [namespace]
  );

  const filteredValues = useMemo(() => {
    const needle = valueFilter.trim().toLowerCase();
    const values = currentNs?.values || [];
    if (!needle) return values;
    return values.filter((v) => v.toLowerCase().includes(needle));
  }, [currentNs, valueFilter]);

  const modalGroups = useMemo(() => {
    const needle = modalFilter.trim().toLowerCase();
    return TAG_CATALOG.map((ns) => ({
      label: ns.label,
      namespace: ns.namespace,
      values: ns.values.filter((v) => {
        if (!needle) return true;
        return (
          v.toLowerCase().includes(needle) ||
          ns.namespace.toLowerCase().includes(needle) ||
          ns.label.toLowerCase().includes(needle)
        );
      }),
    })).filter((g) => g.values.length > 0);
  }, [modalFilter]);

  const addTag = (ns: string, rawValue: string) => {
    if (!rawValue || !ns) return;
    const tag = `${ns}:${rawValue}`;
    if (value.includes(tag)) return;
    if (value.length >= MAX_AUTOMATION_TAGS) return;
    onChange([...value, tag]);
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const toggleTag = (tag: string) => {
    if (disabled) return;
    if (value.includes(tag)) {
      removeTag(tag);
      return;
    }
    if (value.length >= MAX_AUTOMATION_TAGS) return;
    onChange([...value, tag]);
  };

  const atMax = value.length >= MAX_AUTOMATION_TAGS;

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        Tags (max {MAX_AUTOMATION_TAGS})
      </label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <select
          value={namespace}
          disabled={disabled || atMax}
          onChange={(e) => {
            setNamespace(e.target.value as any);
            setValueFilter('');
          }}
          style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
        >
          {TAG_CATALOG.map((ns) => (
            <option key={ns.namespace} value={ns.namespace}>
              {ns.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={valueFilter}
          disabled={disabled || atMax}
          placeholder={TAG_PLACEHOLDER}
          onChange={(e) => setValueFilter(e.target.value)}
          style={{ flex: 2, fontSize: 12, padding: '4px 6px' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <select
          disabled={disabled || atMax}
          defaultValue=""
          key={`${namespace}-${value.length}-${valueFilter}`}
          onChange={(e) => {
            addTag(currentNs?.namespace || namespace, e.target.value);
            e.target.value = '';
            setValueFilter('');
          }}
          style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
        >
          <option value="">
            {valueFilter.trim()
              ? filteredValues.length
                ? 'Pick matching tag…'
                : 'No matches'
              : 'Add tag…'}
          </option>
          {filteredValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setModalFilter('');
            setViewAllOpen(true);
          }}
          style={{
            fontSize: 11,
            padding: '4px 8px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            borderRadius: 4,
            border: '1px solid #cbd5e1',
            background: '#fff',
          }}
        >
          View all tags
        </button>
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

      {viewAllOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
          onClick={() => setViewAllOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              color: '#0f172a',
              borderRadius: 8,
              width: '100%',
              maxWidth: 420,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>All tags</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {value.length}/{MAX_AUTOMATION_TAGS} selected
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewAllOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '10px 14px' }}>
              <input
                type="text"
                autoFocus
                placeholder="Filter tags…"
                value={modalFilter}
                onChange={(e) => setModalFilter(e.target.value)}
                style={{ width: '100%', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ overflow: 'auto', padding: '0 14px 14px', flex: 1 }}>
              {modalGroups.map((g) => (
                <div key={g.namespace} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{g.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {g.values.map((v) => {
                      const tag = `${g.namespace}:${v}`;
                      const selected = value.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={disabled || (!selected && atMax)}
                          onClick={() => toggleTag(tag)}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            borderRadius: 12,
                            border: selected ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                            background: selected ? '#6366f1' : '#f8fafc',
                            color: selected ? '#fff' : '#0f172a',
                            cursor: disabled || (!selected && atMax) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!modalGroups.length && (
                <div style={{ fontSize: 12, color: '#64748b' }}>No matching tags.</div>
              )}
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setViewAllOpen(false)}
                style={{
                  fontSize: 12,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#6366f1',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { Save, Loader2, Eye, EyeOff, X } from 'lucide-react';
import { FieldDef, RegistroCrud, ResourceDef } from '../types';
import { toInputDate, toInputDateTime } from '../utils/formatters';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';
import { MensagemErro } from './Modal';

interface RecordFormProps {
  resource: ResourceDef;
  /** Registro em edição; `null` indica inclusão */
  record: RegistroCrud | null;
  onCancel: () => void;
  onSave: (payload: RegistroCrud) => Promise<void>;
  /** Conteúdo extra abaixo dos campos (ex.: conferência da loja do usuário) */
  renderExtra?: (values: Record<string, any>) => React.ReactNode;
}

function initialValue(field: FieldDef, record: RegistroCrud | null): any {
  if (record) {
    const raw = record[field.name];
    if (raw === null || raw === undefined) return field.type === 'boolean' ? false : '';
    if (field.type === 'boolean') return raw === true || Number(raw) === 1;
    if (field.type === 'date') return toInputDate(raw);
    if (field.type === 'datetime') return toInputDateTime(raw);
    if (field.type === 'password') return '';
    return String(raw);
  }
  switch (field.type) {
    case 'boolean':
      return false;
    case 'enum':
      return field.required ? field.options?.[0]?.value ?? '' : '';
    default:
      return '';
  }
}

/** Formulário genérico de inclusão/alteração, dirigido pelos metadados do recurso */
export const RecordForm: React.FC<RecordFormProps> = ({ resource, record, onCancel, onSave, renderExtra }) => {
  const isEdit = Boolean(record);

  const editableFields = useMemo(
    () => resource.fields.filter((f) => !f.readOnly && !f.expr && f.name !== resource.pk),
    [resource],
  );

  const readOnlyFields = useMemo(
    () => resource.fields.filter((f) => (f.readOnly || f.expr) && record && record[f.name] != null),
    [resource, record],
  );

  const [values, setValues] = useState<Record<string, any>>(() => {
    const next: Record<string, any> = {};
    for (const f of editableFields) next[f.name] = initialValue(f, record);
    return next;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);

  useEffect(() => {
    const next: Record<string, any> = {};
    for (const f of editableFields) next[f.name] = initialValue(f, record);
    setValues(next);
    setError(null);
  }, [record, editableFields]);

  const setValue = (name: string, value: any) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (e.target !== e.currentTarget) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload: RegistroCrud = {};
      for (const f of editableFields) {
        const v = values[f.name];
        if (f.type === 'password' && String(v ?? '') === '') continue;
        payload[f.name] = v === '' ? null : v;
      }
      await onSave(payload);
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o registro.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = `${INPUT_CLASS} w-full`;

  const renderField = (field: FieldDef) => {
    const value = values[field.name] ?? '';
    const inputId = `form-${resource.name}-${field.name}`;

    switch (field.type) {
      case 'boolean':
        return <Toggle id={inputId} checked={Boolean(value)} onChange={(v) => setValue(field.name, v)} />;

      case 'enum':
        return (
          <select
            id={inputId}
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            required={Boolean(field.required)}
            className={`${inputClass} cursor-pointer`}
          >
            {!field.required && <option value="">— Nenhum —</option>}
            {/* Valor gravado fora da lista (ex.: nível "A" de bases antigas) continua visível */}
            {value && !field.options?.some((o) => o.value === String(value)) && (
              <option value={String(value)}>{String(value)}</option>
            )}
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );

      case 'textarea':
        return (
          <textarea
            id={inputId}
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            rows={3}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            required={Boolean(field.required)}
            className={`${inputClass} resize-y`}
          />
        );

      case 'password':
        return (
          <div className="relative">
            <input
              id={inputId}
              type={revealPassword ? 'text' : 'password'}
              value={String(value ?? '')}
              onChange={(e) => setValue(field.name, e.target.value)}
              autoComplete="new-password"
              maxLength={field.maxLength}
              required={!isEdit}
              placeholder={isEdit ? 'Deixe em branco para manter a senha atual' : 'Defina a senha inicial'}
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setRevealPassword((p) => !p)}
              tabIndex={-1}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
            >
              {revealPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        );

      case 'number':
      case 'decimal':
        return (
          <NumberField
            id={inputId}
            value={value}
            onChange={(v) => setValue(field.name, v)}
            scale={field.type === 'decimal' ? field.scale ?? 2 : 0}
            allowNegative={field.allowNegative}
            required={Boolean(field.required)}
            className={inputClass}
          />
        );

      case 'date':
      case 'datetime':
        return (
          <DateField
            id={inputId}
            value={String(value ?? '')}
            onChange={(v) => setValue(field.name, v)}
            required={Boolean(field.required)}
            withTime={field.type === 'datetime'}
            className={inputClass}
          />
        );

      default:
        return (
          <input
            id={inputId}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            required={Boolean(field.required)}
            className={inputClass}
          />
        );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-5 py-5 space-y-4">
          {error && <MensagemErro texto={error} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {editableFields.map((field) => (
              <div
                key={field.name}
                className={`${FIELD_CLASS} ${field.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}`}
              >
                <label htmlFor={`form-${resource.name}-${field.name}`} className={LABEL_CLASS}>
                  {field.label}
                  {field.required && <span className="text-rose-500 ml-1">*</span>}
                </label>
                {renderField(field)}
                {field.hint && <p className={HINT_CLASS}>{field.hint}</p>}
              </div>
            ))}
          </div>

          {renderExtra?.(values)}

          {readOnlyFields.length > 0 && (
            <div className="pt-3 border-t border-stone-200 dark:border-stone-800">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-2">Dados do registro</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {readOnlyFields.map((f) => (
                  <div
                    key={f.name}
                    className="bg-stone-50 dark:bg-stone-800/50 rounded-lg px-3 py-2 border border-stone-200 dark:border-stone-700/60"
                  >
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">{f.label}</div>
                    <div className="text-xs font-mono text-stone-800 dark:text-stone-200 truncate">
                      {String(record?.[f.name] ?? '—')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-2.5 bg-stone-50 dark:bg-stone-950/40 shrink-0">
        <span className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
          {isEdit ? `Registro #${record?.[resource.pk]} • tabela ${resource.table}` : `Inclusão na tabela ${resource.table}`}
        </span>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancelar</span>
          </button>
          <button
            type="submit"
            id="btn-salvar-registro"
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Salvando…' : 'Salvar'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};

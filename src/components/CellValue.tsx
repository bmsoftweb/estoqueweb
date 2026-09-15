import React from 'react';
import { FieldDef, RegistroCrud } from '../types';
import { formatCellValue } from '../utils/formatters';

/** Célula da grade genérica: selos para enumerações e booleanos */
export const CellValue: React.FC<{ field: FieldDef; row: RegistroCrud }> = ({ field, row }) => {
  const value = row[field.name];

  if (field.type === 'enum' && value) {
    const label = field.options?.find((o) => o.value === String(value))?.label || String(value);
    return (
      <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700">
        {label}
      </span>
    );
  }

  if (field.type === 'boolean') {
    const on = value === true || Number(value) === 1;
    return (
      <span
        className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
          on
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
            : 'bg-stone-100 text-stone-600 border-stone-300 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700'
        }`}
      >
        {on ? 'Sim' : 'Não'}
      </span>
    );
  }

  const isNumeric = field.type === 'decimal' || field.type === 'number';
  return <span className={isNumeric ? 'font-mono' : undefined}>{formatCellValue(field, value)}</span>;
};

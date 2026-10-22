import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataTable<T>({ columns, data, keyField, loading, emptyTitle = 'No records found', emptyDescription }: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className="table-th">{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(5)].map((_, i) => (
              <tr key={i} className="border-b border-gray-100">
                {columns.map((_, j) => (
                  <td key={j} className="table-td">
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="card">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={`table-th ${c.className ?? ''}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((row) => (
              <tr key={String(row[keyField])} className="hover:bg-gray-50 transition-colors">
                {columns.map((col, j) => (
                  <td key={j} className={`table-td ${col.className ?? ''}`}>
                    {typeof col.accessor === 'function'
                      ? col.accessor(row)
                      : String(row[col.accessor] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

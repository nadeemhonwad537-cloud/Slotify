import clsx from 'clsx';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div className={clsx('card', padding && 'p-6', className)}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  sub?: string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}

const colorMap = {
  blue:   'bg-blue-50 text-blue-600',
  green:  'bg-green-50 text-green-600',
  yellow: 'bg-yellow-50 text-yellow-600',
  red:    'bg-red-50 text-red-600',
  purple: 'bg-purple-50 text-purple-600',
};

export function StatCard({ label, value, icon, sub, color = 'blue' }: StatCardProps) {
  return (
    <Card padding>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900">{value}</p>
          {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
        </div>
        {icon && (
          <div className={clsx('p-2.5 rounded-lg flex-shrink-0', colorMap[color])}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

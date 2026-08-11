/**
 * Prymitywy interfejsu w konwencji shadcn/ui.
 *
 * Komponenty są napisane wprost, a nie wygenerowane CLI shadcn — panel potrzebuje
 * siedmiu prymitywów, a generator dołożyłby do repozytorium katalog `components/ui`
 * z kilkudziesięcioma plikami i zależnościami Radiksa, z których żadnej nie
 * używamy. Zostaje to, co z shadcn jest tu realnie wartościowe: warianty przez
 * `cva`, scalanie klas przez `cn` i komponenty przyjmujące `className`, więc
 * miejsce użycia może dopasować odstępy bez podmieniania komponentu.
 *
 * Wszystko jest w jednym pliku, dopóki jest go mniej niż ekran na komponent.
 * Dwadzieścia plików po dziesięć linii utrudnia czytanie, a nie ułatwia.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/* ------------------------------------------------------------------ przycisk */

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-base hover:bg-accent/90',
        secondary: 'border border-border bg-elevated text-text hover:bg-border',
        ghost: 'text-muted hover:bg-elevated hover:text-text',
        danger: 'bg-danger text-base hover:bg-danger/90',
      },
      size: { sm: 'px-2 py-1 text-xs', md: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

/* --------------------------------------------------------------------- karta */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface p-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>;
}

/* -------------------------------------------------------------------- liczba */

/**
 * Kafelek liczby. `hint` jest tu po to, żeby liczba nigdy nie stała sama —
 * „128" bez podpisu wymaga zgadywania, a panel ma odpowiadać na pytania, nie je
 * zadawać.
 */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-text">{value}</div>
      {hint !== undefined && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------- pola */

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text',
        'placeholder:text-muted focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------- odznaka */

const badgeStyles = cva('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-elevated text-muted',
      accent: 'bg-accent/15 text-accent',
      danger: 'bg-danger/15 text-danger',
      success: 'bg-success/15 text-success',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({
  children,
  tone,
  className,
}: { children: ReactNode; className?: string } & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)}>{children}</span>;
}

/* -------------------------------------------------------------------- tabela */

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-elevated text-left">
            {head.map((cell, index) => (
              <th
                key={index}
                className="px-3 py-2 text-xs font-semibold tracking-wide text-muted uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="bg-surface align-middle">{children}</tr>;
}

export function Cell({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2 text-text', className)}>{children}</td>;
}

/* -------------------------------------------------------- stany i komunikaty */

export function Loading({ label = 'Wczytywanie…' }: { label?: string }) {
  return <p className="text-sm text-muted">{label}</p>;
}

export function Problem({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Nieznany błąd';
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

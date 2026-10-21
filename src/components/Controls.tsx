import React, { useId } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { Media } from '../tools/registry';

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/* ---------- Field ---------- */

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** Id of the control, so clicking the label focuses it */
  htmlFor?: string;
  children: React.ReactNode;
}

/** Elements Field can wire to its label without the caller passing ids. */
function isFormControl(node: React.ReactNode): node is React.ReactElement<Record<string, unknown>> {
  if (!React.isValidElement(node)) return false;
  const controls: unknown[] = ['input', 'select', 'textarea', Input, Select, Textarea, Slider];
  return controls.includes(node.type);
}

/**
 * Label plus control. When the children hold exactly one Input/Select/Textarea/Slider, it is associated with the label
 * automatically (`htmlFor` is only needed for other controls); anything else is exposed as a labelled group.
 */
export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  const autoId = useId();
  const labelId = `${autoId}-label`;
  const messageId = `${autoId}-message`;
  const message = error || hint;
  const nodes = React.Children.toArray(children);
  const controls = htmlFor ? [] : nodes.filter(isFormControl);
  const control = controls.length === 1 ? controls[0] : null;
  const controlId = htmlFor ?? (control ? ((control.props.id as string | undefined) ?? autoId) : undefined);

  const wired = control
    ? nodes.map((node) =>
        node === control
          ? React.cloneElement(control, {
              id: controlId,
              'aria-describedby': [control.props['aria-describedby'], message ? messageId : null].filter(Boolean).join(' ') || undefined,
              'aria-invalid': error ? true : control.props['aria-invalid'],
            })
          : node,
      )
    : children;

  return (
    <div className="field" role={controlId ? undefined : 'group'} aria-labelledby={controlId ? undefined : labelId}>
      {controlId ? (
        <label className="field-label" htmlFor={controlId} id={labelId}>
          {label}
        </label>
      ) : (
        <div className="field-label" id={labelId}>
          {label}
        </div>
      )}
      {wired}
      {error ? (
        <p className="field-error" id={messageId}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={messageId}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/* ---------- Slider ---------- */

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function Slider({ value, min, max, step = 1, unit = '', onChange, disabled = false, id, ...rest }: SliderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider-container">
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={rest['aria-label']}
        aria-describedby={rest['aria-describedby']}
        aria-invalid={rest['aria-invalid']}
        aria-valuetext={`${value}${unit}`}
        style={{ '--fill': `${Math.max(0, Math.min(100, fill))}%` } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="slider-value">
        {value}
        {unit}
      </span>
    </div>
  );
}

/* ---------- Select ---------- */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export function Select({ options, className, ...props }: SelectProps) {
  return (
    <select className={cx('select', className)} {...props}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/* ---------- Text inputs ---------- */

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('textarea', className)} {...props} />;
}

/* ---------- Button ---------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Leading icon, usually a lucide-react element */
  icon?: React.ReactNode;
  /** Shows a spinner and disables the button */
  loading?: boolean;
  children?: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, !children && 'btn-icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Checkbox & Switch ---------- */

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: React.ReactNode;
  onChange: (checked: boolean) => void;
}

export function Checkbox({ label, onChange, className, ...props }: CheckboxProps) {
  return (
    <label className={cx('checkbox-label', className)}>
      <input type="checkbox" onChange={(e) => onChange(e.target.checked)} {...props} />
      <span>{label}</span>
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  /** Name for switches without a visible label */
  'aria-label'?: string;
}

export function Switch({ checked, onChange, label, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

/* ---------- Segmented control ---------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  'aria-label': string;
}

export function SegmentedControl<T extends string>({ value, options, onChange, ...rest }: SegmentedControlProps<T>) {
  function handleKeyDown(event: React.KeyboardEvent) {
    const index = options.findIndex((o) => o.value === value);
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    const group = event.currentTarget as HTMLElement;
    requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={rest['aria-label']} onKeyDown={handleKeyDown}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="segmented-option"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Badge, Kbd ---------- */

export interface BadgeProps {
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function Badge({ tone = 'neutral', icon, children }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ---------- Alert ---------- */

const ALERT_ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export interface AlertProps {
  tone?: keyof typeof ALERT_ICONS;
  title?: string;
  children: React.ReactNode;
}

export function Alert({ tone = 'info', title, children }: AlertProps) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div>
        {title && <strong className="alert-title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/* ---------- Media tile ---------- */

export interface MediaTileProps {
  media?: Media;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

/** A tinted square holding a tool emoji or icon, coloured by media family. */
export function MediaTile({ media, size = 'md', children }: MediaTileProps) {
  return (
    <span className={cx('media-tile', size !== 'md' && `media-tile-${size}`)} data-media={media} aria-hidden="true">
      {children}
    </span>
  );
}

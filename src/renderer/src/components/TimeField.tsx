import { formatHM, parseHM } from '@shared/time'

interface TimeFieldProps {
  /** 'HH:mm', the storage format — this component never changes what is saved */
  value: string
  onChange: (next: string) => void
  /** minute granularity of the dropdown; 5 suits a day plan, 1 suits a block edit */
  step?: number
  label: string
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/**
 * A 12-hour time picker built from plain selects.
 *
 * Replaces `<input type="time">`, which renders in Chromium's own UI locale
 * rather than the document's. That made the day window read "13:00" on a machine
 * whose clock says 1:00 PM everywhere else in the app — the one thing
 * `formatClock` exists to prevent, sidestepped by a native control.
 *
 * Value and onChange stay in 'HH:mm'. Only the presentation is 12-hour; nothing
 * about how a time is written to disk changes.
 */
function TimeField({ value, onChange, step = 5, label }: TimeFieldProps): React.JSX.Element {
  const minutes = parseHM(value)
  const h24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const pm = h24 >= 12

  const emit = (hour12: number, minute: number, isPm: boolean): void => {
    const hour24 = (hour12 % 12) + (isPm ? 12 : 0)
    onChange(formatHM(hour24 * 60 + minute))
  }

  // A stored time can sit off the step grid — a block dragged to 09:07, say.
  // Offering its exact minute keeps the select from silently rounding the value
  // the moment the user touches an unrelated part of the control.
  const minuteOptions = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step)
  if (!minuteOptions.includes(mins)) minuteOptions.push(mins)
  minuteOptions.sort((a, b) => a - b)

  return (
    <span className="timefield" role="group" aria-label={label}>
      <select
        className="tf-part"
        value={h12}
        onChange={(e) => emit(Number(e.target.value), mins, pm)}
        aria-label={`${label} hour`}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="tf-colon">:</span>
      <select
        className="tf-part"
        value={mins}
        onChange={(e) => emit(h12, Number(e.target.value), pm)}
        aria-label={`${label} minute`}
      >
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
      <select
        className="tf-part tf-meridiem"
        value={pm ? 'PM' : 'AM'}
        onChange={(e) => emit(h12, mins, e.target.value === 'PM')}
        aria-label={`${label} AM or PM`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  )
}

export default TimeField
